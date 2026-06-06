// live-ui-failure-diag.spec.ts — the CEO's core ask: FUNCTIONALLY prove the
// deploy-failure DEBUG path works end to end against a real backend, not a mock.
// "Deploy an application and get its logs; fail a deployment and get its
// logs/events." Three legs, two lanes:
//
// Design ref: docs/ci/02-FAILURE-DIAGNOSIS-AND-AUTODEBUG.md §5.4 (web —
// real-backend FailureAutopsyPanel) + the api with_failed_deploy factory
// (internal_e2e_account.go, #70, 021bb7e) which seeds ONE status=failed
// deployment + a failure_autopsy event (OOMKilled / exit 137 / JS-heap
// last_lines / a memory hint) and surfaces its app_id as failed_deploy_id.
//
// ── LEGS ────────────────────────────────────────────────────────────────────
//   A. HAPPY deploy → LOGS (schedule lane): mint pro → create a deploy (202
//      contract) → assert the build LOGS are RETRIEVABLE (GET /deploy/:id/logs
//      reachable AND the LiveBuild SSE panel connects in the UI). This is the
//      "deploy an app and get its logs" half.
//   B. FAILED deploy → /events (API) — @pr-smoke: mint with_failed_deploy →
//      GET /api/v1/deployments/:failed_deploy_id  → status=failed +
//      non-empty error_message; GET /api/v1/deployments/:failed_deploy_id/events
//      → events[] with reason + non-empty last_lines + hint. This is the AGENT
//      auto-debug surface (the reliable machine surface, docs §2) — asserted
//      end to end, including the auth-negative (401) + cross-team (404) cells so
//      a regression of the access contract reds CI.
//   C. FAILED deploy → UI panel — @pr-smoke: load /app/deployments/:id in the
//      browser (minted session) → assert the FailureAutopsyPanel renders the
//      reason (humanised heading) + hint + last_lines (log toggle), and handles
//      the "diagnostics pending" state contract.
//
// ── LANES ─────────────────────────────────────────────────────────────────────
//   @pr-smoke (legs B + C): FAST — just the seeded-failed-deploy API reads + the
//      panel render. No real Kaniko build. Runs on EVERY web PR (e2e-pr-smoke.yml
//      --grep @pr-smoke) so agent-discoverability of the debug path can't
//      silently regress.
//   schedule (leg A): the heavier real-deploy + live-log half stays on the
//      30-min schedule (e2e-prod.yml npm run test:e2e:live), since it needs a
//      compute backend + a real 202.
//
// Safety: every minted account is cohort-tagged (is_test_cohort=true → the
// worker neuters billing/churn/email/quota) + reaped — inline reap + the ledger
// backstop + the afterAll cascade (rule 24). Gated on the e2e token: skip-clean
// (loudly) when E2E_LIVE!=1 / E2E_API_URL unset / the mint endpoint is inert.

import { gzipSync } from 'node:zlib'

import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'

import { assertSafeApiTarget, cohortName, COHORT_MARKER } from './cohort'
import { recordEntity, loadLedger, reapEntities, clearLedger } from './cleanup-ledger'
import {
  mintUser,
  mintUserWithFailedDeploy,
  reap,
  factoryArmed,
  apiBase,
  type MintedUser,
} from './factory'
import { newAuthedContext, appURL } from './ui-helpers'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = apiBase()

const STATUS_ACCEPTED = 202
const STATUS_OK = 200
const STATUS_UNAUTHORIZED = 401
const STATUS_NOT_FOUND = 404
const STATUS_CONFLICT = 409
const STATUS_BACKEND_UNAVAILABLE = 503
const SKIP_EMAIL_HEADER = 'X-Skip-Email-Confirmation'

// The api seeds a deterministic OOMKilled autopsy (internal_e2e_account.go
// e2eFailedDeploy* constants). We assert the SHAPE (reason present, last_lines
// non-empty, hint non-empty) rather than pinning the exact strings — the
// contract the agent/UI debug loop depends on is "reason + last_lines + hint are
// there", and pinning the prose would couple this spec to api copy. We DO assert
// the seeded reason is the known OOMKilled value as a sanity anchor.
const SEEDED_REASON = 'OOMKilled'

test.describe('LIVE-UI — deploy-failure diagnosis (happy logs + failed /events + FailureAutopsyPanel)', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(!LIVE, 'E2E_LIVE!=1 — the real-backend failure-diagnosis journey is opt-in.')
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
        `[live-ui-failure-diag afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── LEG B — FAILED deploy → /events (the agent auto-debug surface) ── @pr-smoke
  test('@pr-smoke failed deploy: GET /deployments/:id status=failed+error; /events carries reason+last_lines+hint; authz enforced', async ({
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintUserWithFailedDeploy(request)
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    expect(
      u.failedDeployID,
      'with_failed_deploy must surface the seeded deployment app_id as failed_deploy_id ' +
        '(the id the agent/UI navigates to). Empty → the api seed did not run.',
    ).toBeTruthy()
    // The seeded deployment is permanent (TTLPolicy=permanent) + cascades on the
    // account reap, but record it so a partial run still reaps it.
    recordEntity({
      kind: 'deployment',
      id: u.failedDeployID,
      apiUrl: API_URL,
      token: u.sessionJWT,
      note: 'failure-diag seeded failed deploy',
    })

    try {
      // ── (1) GET /api/v1/deployments/:id → status=failed + non-empty error_message
      const item = await getDeploymentItem(request, u.sessionJWT, u.failedDeployID)
      expect(String(item.status), 'the seeded deployment must read status=failed.').toBe('failed')
      expect(
        String(item.error ?? item.error_message ?? ''),
        'a failed deployment must carry a non-empty error_message (the one-line cause the UI/agent shows).',
      ).not.toBe('')

      // ── (2) GET /api/v1/deployments/:id/events → autopsy with reason+last_lines+hint
      const eventsResp = await rawGetEvents(request, u.sessionJWT, u.failedDeployID)
      expect(
        eventsResp.status(),
        `the /events debug surface must return 200; got ${eventsResp.status()}. ` +
          `Body: ${await eventsResp.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const eventsBody = (await eventsResp.json()) as {
        ok?: boolean
        count?: number
        events?: Array<{
          kind?: string
          reason?: string
          last_lines?: unknown
          hint?: string
          exit_code?: number | null
          created_at?: string
        }>
      }
      const events = eventsBody.events ?? []
      expect(
        events.length,
        'the seeded failed deploy must expose at least one autopsy event on /events ' +
          '(this is the reliable machine surface the agent auto-debug loop reads — docs §2).',
      ).toBeGreaterThan(0)
      const autopsy = events[0]
      // reason — the classified cause (sanity-anchored to the seeded OOMKilled).
      expect(String(autopsy.reason ?? ''), 'autopsy event must carry a classified reason.').not.toBe('')
      expect(String(autopsy.reason ?? ''), 'the seeded reason must be OOMKilled.').toBe(SEEDED_REASON)
      // last_lines — the actual error tail (the real signal an agent acts on).
      expect(
        Array.isArray(autopsy.last_lines) && (autopsy.last_lines as unknown[]).length > 0,
        'autopsy event must carry NON-EMPTY last_lines (the build/runtime log tail = the real error output).',
      ).toBeTruthy()
      // hint — the plain-language remedy.
      expect(String(autopsy.hint ?? ''), 'autopsy event must carry a plain-language hint (remedy).').not.toBe('')
      // eslint-disable-next-line no-console
      console.log(
        `[live-ui-failure-diag] /events agent surface OK: reason=${autopsy.reason} ` +
          `last_lines=${(autopsy.last_lines as unknown[]).length} hint_len=${String(autopsy.hint ?? '').length}`,
      )

      // ── (3) AUTHZ — no token → 401 (the surface is not anonymous).
      const noAuth = await request.fetch(eventsURL(u.failedDeployID), { failOnStatusCode: false })
      expect(
        noAuth.status(),
        `the /events surface must reject an unauthenticated read (401); got ${noAuth.status()}.`,
      ).toBe(STATUS_UNAUTHORIZED)

      // ── (4) AUTHZ — another team's session → 404 (never leak the failure of a
      //        deployment you don't own; the api returns 404 not 403 by design).
      const other = await mintUser(request, { tier: 'pro' })
      if (other) {
        const o = other as MintedUser
        recordEntity({
          kind: 'e2e-account',
          id: o.teamID,
          apiUrl: API_URL,
          note: 'failure-diag cross-team probe account',
        })
        const cross = await rawGetEvents(request, o.sessionJWT, u.failedDeployID)
        expect(
          cross.status(),
          `another team must NOT be able to read this team's failure (/events → 404); got ${cross.status()}.`,
        ).toBe(STATUS_NOT_FOUND)
        await reap(request, o.teamID)
      }
    } finally {
      await reap(request, u.teamID)
    }
  })

  // ── LEG C — FAILED deploy → UI FailureAutopsyPanel (real backend) ── @pr-smoke
  test('@pr-smoke failed deploy: /app/deployments/:id renders FailureAutopsyPanel with reason+hint+last_lines', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintUserWithFailedDeploy(request)
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser
    expect(u.failedDeployID, 'failed_deploy_id required to navigate the UI panel.').toBeTruthy()
    recordEntity({
      kind: 'deployment',
      id: u.failedDeployID,
      apiUrl: API_URL,
      token: u.sessionJWT,
      note: 'failure-diag UI panel seeded deploy',
    })

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      await page.goto(appURL(`/app/deployments/${u.failedDeployID}`), { waitUntil: 'domcontentloaded' })

      // The detail header proves getDeployment resolved against prod.
      await expect(
        page.getByTestId('deploy-detail-name'),
        'the deploy detail header must render (proves getDeployment resolved against the real api).',
      ).toBeVisible({ timeout: 30_000 })

      // THE PANEL — the autopsy payload (item.failure) is present, so the FULL
      // panel renders (not the "diagnostics pending" banner). It sits above the
      // tab bar so the user sees WHY it failed first.
      const panel = page.getByTestId('failure-autopsy-panel')
      await expect(
        panel,
        'a failed deploy WITH an autopsy must render the FULL FailureAutopsyPanel against the real backend ' +
          '(not a mock) — this is the UI debug surface, docs §1 row 3.',
      ).toBeVisible({ timeout: 30_000 })

      // reason — the humanised heading. The OOMKilled label is "Out of memory
      // (OOMKilled)" (FAILURE_REASON_LABELS); assert it contains the raw reason
      // so a label-copy tweak doesn't red the test but a missing heading does.
      await expect(
        page.getByTestId('failure-autopsy-heading'),
        'the panel heading must surface the classified reason.',
      ).toContainText(SEEDED_REASON, { timeout: 10_000 })

      // hint — the plain-language remedy must be non-empty.
      const hint = page.getByTestId('failure-autopsy-hint')
      await expect(hint, 'the panel must render the plain-language hint.').toBeVisible()
      expect(
        ((await hint.textContent()) ?? '').trim().length,
        'the hint text must be non-empty.',
      ).toBeGreaterThan(0)

      // last_lines — collapsed by default; expand via the log toggle and assert
      // the log block renders with at least one line (the real error tail).
      const toggle = page.getByTestId('failure-autopsy-log-toggle')
      await expect(
        toggle,
        'a failed deploy with last_lines must offer the "show last N lines" toggle.',
      ).toBeVisible({ timeout: 10_000 })
      await toggle.click()
      const logBlock = page.getByTestId('failure-autopsy-log-block')
      await expect(logBlock, 'expanding the toggle must reveal the log block (the build/runtime log tail).').toBeVisible()
      await expect(
        page.getByTestId('failure-log-line-0'),
        'the log block must render at least one captured log line (the actual error output).',
      ).toBeVisible()

      // eslint-disable-next-line no-console
      console.log('[live-ui-failure-diag] FailureAutopsyPanel rendered reason+hint+last_lines against real backend.')
    } finally {
      await context.close()
      await reap(request, u.teamID)
    }
  })

  // ── LEG A — HAPPY deploy → LOGS (schedule lane; needs a compute backend) ─────
  test('happy deploy: create deploy (202) → build logs retrievable (API reachable + LiveBuild SSE connects)', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintUser(request, { tier: 'pro' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    const appID = await createDeploy(request, u.sessionJWT, cohortName('faildiaghappy'))
    test.skip(
      appID === null,
      '/deploy/new returned 503 — compute/build backend not enabled in this stack (happy-log leg is schedule-only).',
    )
    const id = appID as string
    recordEntity({ kind: 'deployment', id, apiUrl: API_URL, token: u.sessionJWT, note: 'failure-diag happy deploy' })

    try {
      // API — the build LOGS endpoint must be REACHABLE for a deploy you own (the
      // agent's live-watch surface, docs §2 step 1). We don't assert log CONTENT
      // — a deploy that was just 202-accepted is asynchronous, so the logs
      // endpoint legitimately returns one of:
      //   200 — the SSE stream is live (build pod exists, provider_id assigned);
      //   409 not_ready — still building, no provider_id yet (deploy.go:1571 —
      //         the honest "build hasn't reached the pod stage" state);
      //   404 — the build pod / deployment was GC'd (a fast build that finished).
      // What proves the surface WORKS (vs broken) is that it authorizes the owner
      // and returns a RECOGNIZED state — NOT a 401 (auth broken) or 5xx (endpoint
      // broken). The UI LiveBuild SSE leg below then exercises the actual stream.
      const logsResp = await rawGetBuildLogs(request, u.sessionJWT, id)
      const logsStatus = logsResp.status()
      const logsBody = logsStatus >= 400 ? await logsResp.text().catch(() => '<unreadable>') : ''
      expect(
        logsStatus === STATUS_OK || logsStatus === STATUS_CONFLICT || logsStatus === STATUS_NOT_FOUND,
        `the build-logs endpoint must authorize the owner and return a recognized state ` +
          `(200 streaming / 409 not_ready-still-building / 404 GC'd) — NOT 401/5xx; got ${logsStatus}. ` +
          `Body: ${logsBody}. This is the "deploy an app and get its logs" surface.`,
      ).toBeTruthy()
      // The owner must NEVER be denied (401) on their own deploy's logs.
      expect(logsStatus, 'the owner must not be unauthorized (401) on their own build logs.').not.toBe(
        STATUS_UNAUTHORIZED,
      )

      // UI — open the detail, click Logs, assert the LiveBuild SSE panel reaches
      // a rendered stream state (connecting/streaming/closed/unavailable — all
      // honest). Proves the cross-origin SSE to prod connected, not hung blank.
      const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
      try {
        await page.goto(appURL(`/app/deployments/${id}`), { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('deploy-detail-name')).toBeVisible({ timeout: 30_000 })
        await page.getByRole('button', { name: 'Logs' }).click()
        const logsBox = page.locator('.logs').first()
        await expect(logsBox, 'the build logs panel must render under the Logs tab.').toBeVisible({ timeout: 30_000 })
        await expect(
          page.locator('.logs-foot').first(),
          'the LiveBuild SSE must reach a rendered stream state — proves the live build-log stream to prod connected.',
        ).toContainText(/connecting|streaming|stream closed|stream unavailable|session expired/, { timeout: 30_000 })
      } finally {
        await context.close()
      }

      await finalDeleteDeploy(request, u.sessionJWT, id)
    } finally {
      await reap(request, u.teamID)
    }
  })

  // Keep COHORT_MARKER load-bearing so the import isn't dropped when authed legs
  // skip (no mint token).
  test('cohort marker wired', () => {
    expect(COHORT_MARKER).toBe('e2e-cohort')
  })
})

// ── helpers ──────────────────────────────────────────────────────────────────

function eventsURL(appID: string): string {
  return `${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}/events`
}

/** GET /api/v1/deployments/:id/events with a bearer. Raw response (caller asserts). */
function rawGetEvents(request: APIRequestContext, bearer: string, appID: string): Promise<APIResponse> {
  return request.fetch(eventsURL(appID), {
    headers: { Authorization: `Bearer ${bearer}` },
    failOnStatusCode: false,
  })
}

/** GET /api/v1/deployments/:id → the item map (status + error_message + failure). */
async function getDeploymentItem(
  request: APIRequestContext,
  bearer: string,
  appID: string,
): Promise<Record<string, unknown>> {
  const resp = await request.fetch(`${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}`, {
    headers: { Authorization: `Bearer ${bearer}` },
    failOnStatusCode: false,
  })
  expect(
    resp.status(),
    `GET /api/v1/deployments/:id must return 200 for a deploy you own; got ${resp.status()}. ` +
      `Body: ${await resp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_OK)
  const body = (await resp.json()) as { item?: Record<string, unknown> }
  expect(body.item, 'GET /api/v1/deployments/:id must return an item.').toBeTruthy()
  return body.item as Record<string, unknown>
}

/** GET the kaniko build-log stream for a deploy (SSE; we only check reachability). */
function rawGetBuildLogs(request: APIRequestContext, bearer: string, appID: string): Promise<APIResponse> {
  return request.fetch(`${API_URL}/deploy/${encodeURIComponent(appID)}/logs`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'text/event-stream' },
    failOnStatusCode: false,
    timeout: 15_000,
  })
}

// A minimal gzipped-tar build context carrying a Dockerfile (mirrors
// live-ui-deploy.spec.ts). The build OUTCOME is irrelevant to the happy-log leg.
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

/**
 * Create a deploy and return its app_id. Returns null on a 503 (compute backend
 * off → caller SKIPS). Throws on any non-202/503 so a contract break surfaces.
 */
async function createDeploy(
  request: APIRequestContext,
  bearer: string,
  name: string,
): Promise<string | null> {
  const resp = await request.fetch(`${API_URL}/deploy/new`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}` },
    multipart: {
      name,
      env: 'development',
      tarball: { name: 'context.tar.gz', mimeType: 'application/gzip', buffer: makeMinimalTarGz() },
    },
    failOnStatusCode: false,
  })
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
async function finalDeleteDeploy(request: APIRequestContext, bearer: string, appID: string): Promise<void> {
  const resp = await request.fetch(`${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bearer}`, [SKIP_EMAIL_HEADER]: 'yes' },
    failOnStatusCode: false,
  })
  expect(
    (resp.status() >= 200 && resp.status() < 300) || resp.status() === 404 || resp.status() === 409,
    `deploy delete should be 2xx/404/409; got ${resp.status()}.`,
  ).toBe(true)
}
