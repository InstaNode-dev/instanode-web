// Wave 3 — real-backend UI journeys #3 (deploy lifecycle + build LOGS +
// make-permanent) and #4 (delete-when-exhausted → replace — the CEO's headline
// scenario), driven through the ACTUAL dashboard.
//
// Design ref: docs/ci/01-CI-INTEGRATION-DESIGN.md (Wave 3).
//
// Journey #3 — deploy lifecycle + LOGS + make-permanent ("enable"):
//   Mint PRO → create a deploy via the 202-accepted contract (we do NOT wait for
//   a full Kaniko build — too slow; the lifecycle UI doesn't need it). Render
//   /app/deployments → assert the deploy ROW appears with a status. Open
//   /app/deployments/:app_id → open the Logs tab → assert the LiveBuild SSE
//   panel connects (lands in connecting/open OR a graceful closed/error state —
//   all are honest; a still-building or GC'd build can legitimately close).
//   A fresh deploy is ttl_policy=auto_24h, so the TtlBadge banner + Make
//   Permanent button render — click "Keep this deployment" ("enable") and assert
//   the badge flips to Permanent (TTL cleared). Then delete (two-step contract).
//
// Journey #4 — delete-when-exhausted → REPLACE (deployments_apps EXHAUSTED):
//   Mint HOBBY (deployments_apps=1). Create deploy #1 → assert it renders.
//   Attempt deploy #2 → assert the 402 deployment_limit_reached WALL (the real
//   tier gate) AND that the UI still shows the single capped deploy (no #2
//   row). Delete deploy #1 → assert the list empties in the UI. Create the
//   REPLACEMENT deploy → assert it now succeeds (202) and its row renders (slot
//   freed). This is the headline journey — robust + UI-observed at every step.
//
// Note on read-only dashboard: deploys are agent-driven (DeploymentsPage ships
// PromptCards, not a Deploy button), and deletes likewise. So create/delete go
// through the REAL api (authed as the minted team) and we assert the dashboard
// renders the resulting state in the browser. The genuinely-clickable UI
// mutation here is Make Permanent (TtlBadge) — that one is driven through the UI.

import { gzipSync } from 'node:zlib'

import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'

import { assertSafeApiTarget, cohortName, COHORT_MARKER } from './cohort'
import { recordEntity, loadLedger, reapEntities, clearLedger } from './cleanup-ledger'
import { mintUser, mintAtDeployCap, reap, factoryArmed, apiBase, type MintedUser } from './factory'
import { newAuthedContext, appURL } from './ui-helpers'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = apiBase()

const STATUS_ACCEPTED = 202
const STATUS_PAYMENT_REQUIRED = 402
const STATUS_BACKEND_UNAVAILABLE = 503
const SKIP_EMAIL_HEADER = 'X-Skip-Email-Confirmation'

test.describe('LIVE-UI — deploy lifecycle/logs/make-permanent + delete-when-exhausted→replace (journeys #3, #4)', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(!LIVE, 'E2E_LIVE!=1 — real-backend deploy UI journeys are opt-in.')
  test.skip(LIVE && !API_URL, 'E2E_LIVE=1 but E2E_API_URL is unset — no backend to target.')
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-ui-deploy afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── Journey #3 — lifecycle + LOGS + make-permanent ── tag: @pr-smoke (row) ───
  test('@pr-smoke pro: create deploy → row appears in UI; detail logs connect; make-permanent flips badge', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintUser(request, { tier: 'pro' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    // Create a deploy via the real api (202 accepted; build outcome irrelevant).
    const created = await createDeploy(request, u.sessionJWT, cohortName('uideploy'))
    test.skip(
      created === null,
      '/deploy/new returned 503 — compute/build backend not enabled in this stack.',
    )
    const appID = created as string
    recordEntity({ kind: 'deployment', id: appID, apiUrl: API_URL, token: u.sessionJWT, note: 'journey#3 deploy' })

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      // LIST — the new deploy row appears with a status.
      await page.goto(appURL('/app/deployments'), { waitUntil: 'domcontentloaded' })
      const row = page.getByTestId(`deployment-row-name-`).or(
        page.locator(`[data-testid^="deployment-row-name-"]`),
      )
      await expect(
        row.first(),
        'the new deployment row must render on /app/deployments (proves listDeployments resolved against prod).',
      ).toBeVisible({ timeout: 30_000 })

      // DETAIL — open by app_id (the route resolves :id against app_id).
      await page.goto(appURL(`/app/deployments/${appID}`), { waitUntil: 'domcontentloaded' })
      await expect(
        page.getByTestId('deploy-detail-name'),
        'the deploy detail header must render (proves getDeployment resolved against prod).',
      ).toBeVisible({ timeout: 30_000 })

      // LOGS — open the Logs tab; assert the LiveBuild SSE panel connects. The
      // foot reflects the stream state. Any of connecting/streaming/closed/
      // unavailable is honest (a building or GC'd build legitimately closes);
      // what we assert is that the panel WIRED UP and rendered a state, i.e. the
      // cross-origin SSE to prod did not hard-fail to render.
      await page.getByRole('button', { name: 'Logs' }).click()
      const logsBox = page.locator('.logs').first()
      await expect(logsBox, 'the build logs panel must render under the Logs tab.').toBeVisible({
        timeout: 30_000,
      })
      const streamState = page.locator('.logs-foot').first()
      await expect(
        streamState,
        'the LiveBuild SSE must reach a rendered stream state (connecting/streaming/closed/unavailable) — ' +
          'proves the cross-origin log stream to prod connected, not hung blank.',
      ).toContainText(/connecting|streaming|stream closed|stream unavailable|session expired/, {
        timeout: 30_000,
      })

      // MAKE PERMANENT ("enable") — a fresh deploy is auto_24h, so the TtlBadge
      // banner + button render. Click Keep → assert the badge flips to Permanent.
      const keepBtn = page.getByTestId('make-permanent-button')
      await expect(
        keepBtn,
        'a fresh auto_24h deploy must show the Make Permanent ("Keep") button in the TTL banner.',
      ).toBeVisible({ timeout: 30_000 })
      await keepBtn.click()
      await expect(
        page.getByTestId('ttl-permanent'),
        'clicking "Keep this deployment" must flip the badge to Permanent (proves the make-permanent write applied + TTL cleared).',
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await context.close()
    }

    // DELETE (two-step contract; final reap uses skip-email so it doesn't depend
    // on a Brevo-delivered confirmation — sender unvalidated on prod).
    await finalDeleteDeploy(request, u.sessionJWT, appID)
    await reapUser(request, u)
  })

  // ── Journey #4 — delete-when-exhausted → REPLACE (headline) ──────────────────
  test('hobby (cap=1): deploy #1 renders → #2 hits the 402 cap wall → delete #1 → replacement succeeds', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintAtDeployCap(request)
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser
    expect(u.tier, 'mintAtDeployCap must mint the hobby tier (deployments_apps=1).').toBe('hobby')

    // DEPLOY #1 — fills the single slot.
    const app1 = await createDeploy(request, u.sessionJWT, cohortName('cap1'))
    test.skip(app1 === null, '/deploy/new returned 503 — compute/build backend not enabled.')
    const appID1 = app1 as string
    recordEntity({ kind: 'deployment', id: appID1, apiUrl: API_URL, token: u.sessionJWT, note: 'journey#4 deploy1' })

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      // UI shows deploy #1 in the list (the capped state).
      await page.goto(appURL('/app/deployments'), { waitUntil: 'domcontentloaded' })
      await expect(
        page.locator(`[data-testid^="deployment-row-name-"]`).first(),
        'deploy #1 must render in the UI before we attempt the over-cap #2.',
      ).toBeVisible({ timeout: 30_000 })
      await expect(
        page.locator(`[data-testid^="deployment-row-name-"]`),
        'at the cap, exactly one deployment row must be present.',
      ).toHaveCount(1)

      // DEPLOY #2 — the over-cap attempt. THE WALL: the real api returns 402
      // deployment_limit_reached (the tier gate). This is the load-bearing proof
      // the cap is enforced; the UI deploy path is agent-driven so the wall lives
      // at the api boundary, which we assert directly.
      const over = await rawCreateDeploy(request, u.sessionJWT, cohortName('cap2'))
      expect(
        over.status(),
        `over-cap deploy #2 must hit the 402 cap wall; got ${over.status()}. ` +
          `Body: ${await over.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_PAYMENT_REQUIRED)
      const overBody = (await over.json().catch(() => ({}))) as Record<string, unknown>
      expect(
        String(overBody.error ?? ''),
        'the 402 must be the deployment cap error (deployment_limit_reached).',
      ).toBe('deployment_limit_reached')
      expect(
        String(overBody.agent_action ?? ''),
        'the 402 must carry an agent_action upsell (the UI/agent surface for the wall).',
      ).toContain('cap')

      // The UI must STILL show only the single capped deploy — #2 never landed.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(
        page.locator(`[data-testid^="deployment-row-name-"]`),
        'after the rejected over-cap deploy, the UI must still show exactly one deployment (no #2 row).',
      ).toHaveCount(1, { timeout: 30_000 })

      // DELETE #1 — free the slot (agent-driven in the read-only UI → real api).
      await finalDeleteDeploy(request, u.sessionJWT, appID1)
      // The list empties in the UI.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(
        page.getByTestId('deployments-empty'),
        'after deleting the only deploy, the UI must show the empty state (slot freed).',
      ).toBeVisible({ timeout: 30_000 })

      // REPLACEMENT — now that the slot is free, a new deploy succeeds (202) and
      // its row renders. This is the "create the replacement → it succeeds" proof.
      const replace = await createDeploy(request, u.sessionJWT, cohortName('capreplace'))
      expect(replace, 'the replacement deploy must succeed (202) now the slot is freed.').not.toBeNull()
      const appIDReplace = replace as string
      recordEntity({
        kind: 'deployment',
        id: appIDReplace,
        apiUrl: API_URL,
        token: u.sessionJWT,
        note: 'journey#4 replacement',
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(
        page.locator(`[data-testid^="deployment-row-name-"]`).first(),
        'the replacement deploy must render in the UI list (the freed slot accepted a new app).',
      ).toBeVisible({ timeout: 30_000 })

      // Tidy: delete the replacement (the account cascade backstops it).
      await finalDeleteDeploy(request, u.sessionJWT, appIDReplace)
    } finally {
      await context.close()
    }
    await reapUser(request, u)
  })

  // Keep COHORT_MARKER load-bearing so the cohort import isn't dropped when the
  // authed legs skip (no mint token).
  test('cohort marker wired', () => {
    expect(COHORT_MARKER).toBe('e2e-cohort')
  })
})

// ── helpers ──────────────────────────────────────────────────────────────────

// A minimal gzipped-tar build context carrying a Dockerfile (mirrors
// live-writes.spec.ts). The build OUTCOME is irrelevant to the lifecycle legs.
function makeMinimalTarGz(): Buffer {
  const content = Buffer.from('FROM scratch\n', 'utf8')
  return gzipSync(buildUstarTar('Dockerfile', content))
}

function buildUstarTar(name: string, content: Buffer): Buffer {
  const BLOCK = 512
  const header = Buffer.alloc(BLOCK)
  header.write(name, 0, 'utf8')
  header.write('0000644', 100, 'ascii')
  header.write('0000000', 108, 'ascii')
  header.write('0000000', 116, 'ascii')
  header.write(content.length.toString(8).padStart(11, '0'), 124, 'ascii')
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0'), 136, 'ascii')
  header.write('0', 156, 'ascii')
  header.write('ustar', 257, 'ascii')
  header.write('00', 263, 'ascii')
  header.write('        ', 148, 'ascii')
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  const contentBlocks = Math.ceil(content.length / BLOCK)
  const paddedContent = Buffer.alloc(contentBlocks * BLOCK)
  content.copy(paddedContent)
  const terminator = Buffer.alloc(BLOCK * 2)
  return Buffer.concat([header, paddedContent, terminator])
}

/** POST /deploy/new (multipart). Returns the raw response (caller asserts). */
function rawCreateDeploy(
  request: APIRequestContext,
  bearer: string,
  name: string,
): Promise<APIResponse> {
  return request.fetch(`${API_URL}/deploy/new`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}` },
    multipart: {
      name,
      env: 'development',
      tarball: { name: 'context.tar.gz', mimeType: 'application/gzip', buffer: makeMinimalTarGz() },
    },
    failOnStatusCode: false,
  })
}

/**
 * Create a deploy and return its app_id. Returns null on a 503 (compute backend
 * off → caller SKIPS). Throws on any non-202/503 so a contract break surfaces.
 */
async function createDeploy(
  request: APIRequestContext,
  bearer: string,
  name: string,
): Promise<string | null> {
  const resp = await rawCreateDeploy(request, bearer, name)
  if (resp.status() === STATUS_BACKEND_UNAVAILABLE) return null
  if (resp.status() !== STATUS_ACCEPTED) {
    throw new Error(
      `createDeploy expected 202; got ${resp.status()}. Body: ${await resp.text().catch(() => '<unreadable>')}`,
    )
  }
  const body = (await resp.json()) as { item?: Record<string, unknown> }
  const appID = String(body.item?.app_id ?? body.item?.token ?? '')
  if (!appID) throw new Error(`createDeploy: /deploy/new returned no app_id (item=${JSON.stringify(body.item)})`)
  return appID
}

/** Final destruction of a deploy, skip-email so it never waits on Brevo. */
async function finalDeleteDeploy(
  request: APIRequestContext,
  bearer: string,
  appID: string,
): Promise<void> {
  const resp = await request.fetch(`${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bearer}`, [SKIP_EMAIL_HEADER]: 'yes' },
    failOnStatusCode: false,
  })
  expect(
    (resp.status() >= 200 && resp.status() < 300) || resp.status() === 404 || resp.status() === 409,
    `deploy delete should be 2xx/404/409; got ${resp.status()}. Body: ${await resp
      .text()
      .catch(() => '<unreadable>')}`,
  ).toBe(true)
}

async function reapUser(request: APIRequestContext, u: MintedUser): Promise<void> {
  await reap(request, u.teamID)
  clearLedger()
}
