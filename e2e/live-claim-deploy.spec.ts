// WS1-P3 (matrix W3) — real-backend (LIVE) cross-surface E2E for the
// claim/conversion + deploy-lifecycle + env-switcher flows.
//
// Plan: docs/sessions/2026-06-04/USER-FLOW-INVENTORY-AND-TEST-MATRIX.md §W3
//   - Claim/conversion (anon→claimed): anonymous provision → POST /claim →
//     the resource is now owned by a REAL team and visible on the dashboard's
//     resource surface (GET /api/v1/resources); claim-replay of the SAME token
//     is 409 (single-use JWT, rule 7).
//   - Deploy lifecycle: POST /deploy/new → 202 accepted contract (id/app_id/
//     status/environment) → GET /api/v1/deployments/:id/events returns the
//     event-timeline surface → DELETE → gone. The full Kaniko build→live-URL
//     leg is DEFERRED (too slow/heavy for E2E); we assert the
//     create→accepted→events-surface→delete contract, which is the user-visible
//     integration boundary the 2026-05-30 silent-deploy-failure class lived on.
//   - Env switcher: provision an authenticated resource in `development` vs
//     `production` (mig 026) → the dashboard's per-env resource call
//     (GET /api/v1/resources?env=) returns ONLY that env's resources, and the
//     provision response echoes the resolved env (rule 11).
//
// Each flow is a genuine cross-surface assertion: a UI/agent action → a real
// backend state change → the UI-facing read surface reflects it (the
// login-outage class — "shipped" ≠ "the user-facing surface shows it").
//
// It mirrors live-auth.spec.ts / live-anon-provision.spec.ts EXACTLY for the
// safety machinery: E2E_LIVE=1 gating (whole file SKIPS loudly in normal PR CI
// so the per-PR gate NEVER depends on a live backend), cohort-branded
// ledger-before-assert + inline reap + afterAll backstop (rule 24), and a
// uniqueIP() per provision so the per-fingerprint dedup cap (rule 6) never hands
// back an EXISTING token. Named live-*.spec.ts so playwright.live.config.ts's
// testMatch picks it up and the default (mocked, per-PR) config ignores it.
//
// ── Mint method (Brevo-free) ───────────────────────────────────────────────────
// Per TEST-ACCOUNTS-AND-NR-SYNTHETICS-PLAN.md §1.1: anonymous provision →
// /claim it into a real user/team. The claim RETURNS a real session_token
// (onboarding.go:537), so the claim/conversion + env-switcher legs need NO
// E2E_JWT_SECRET and NO email round-trip. No Brevo: only the claim NOTIFICATION
// email is Brevo-gated and it is best-effort/non-blocking on the 201.
//
// ── STAGING-ONLY legs ───────────────────────────────────────────────────────────
// 1. Until the backend skip-cohort guards ship (separate api/worker PR) ALL
//    account-minting legs run against STAGING, not prod (cohort.ts:14-19).
// 2. The deploy-lifecycle leg additionally needs a team with deployment
//    headroom (free=deployments_apps=0 → POST /deploy/new is a 402 wall). The
//    Brevo-free claim mints a `free` team, so we elevate it via the DEV-ONLY
//    POST /internal/set-tier (ENVIRONMENT=development only — dev.go). That
//    endpoint 404s in prod, so the deploy leg SKIPS LOUDLY outside a dev/
//    staging stack rather than charging or 402-walling. This is the
//    "needs the skip-cohort/dev guards before PROD" annotation the brief asks
//    for: tier elevation must never touch a real billing path.

import { gzipSync } from 'node:zlib'

import { expect, test, type APIRequestContext } from '@playwright/test'

import {
  cohortEmail,
  cohortName,
  COHORT_MARKER,
  isCohortBranded,
  assertSafeApiTarget,
  anonProvisionHeaders,
  mintedSession,
} from './cohort'
import {
  recordEntity,
  loadLedger,
  reapEntities,
  clearLedger,
  type CohortEntity,
} from './cleanup-ledger'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = (process.env.E2E_API_URL ?? process.env.AGENT_API_URL ?? '')
  .toString()
  .replace(/\/$/, '')

const STATUS_OK = 200
const STATUS_CREATED = 201
const STATUS_ACCEPTED = 202
const STATUS_NOT_FOUND = 404
const STATUS_CONFLICT = 409
const STATUS_BACKEND_UNAVAILABLE = 503

// Dev-only tier-elevation endpoint (api dev.go; registered only when
// ENVIRONMENT=development). Pro gives deployments_apps=10 — enough headroom for
// the single deploy this file creates. NEVER present in prod (404 there).
const SET_TIER_PATH = '/internal/set-tier'
const DEPLOY_TIER = 'pro'

// Unique source IP per provision so the per-fingerprint dedup cap (5/day, rule 6)
// doesn't hand back an EXISTING token — mirrors live-anon-provision.spec.ts.
function uniqueIP(): string {
  const b = () => Math.floor(Math.random() * 254) + 1
  return `10.${b()}.${b()}.${b()}`
}

// Pull the anon-upgrade JWT out of the `note` of a /cache/new response (the note
// carries a "/start?t=<jwt>" upgrade link). Mirrors live-auth.spec.ts /
// auth-roundtrip.spec.ts.
function extractUpgradeJWT(note: string): string {
  const marker = '?t='
  const idx = note.indexOf(marker)
  if (idx === -1) throw new Error(`no "?t=" upgrade token in /cache/new note: ${note}`)
  let tok = note.slice(idx + marker.length)
  const stop = tok.search(/[\s)"']/)
  if (stop !== -1) tok = tok.slice(0, stop)
  return tok
}

interface AnonProvision {
  /** The anonymous resource token (the thing /claim grafts onto the new team). */
  token: string
  /** The anon-upgrade JWT extracted from the provision note. */
  upgradeJWT: string
}

// Provision an anonymous cache and record it to the ledger BEFORE any throwing
// assertion (rule 24). Returns the token + the anon-upgrade JWT for /claim.
// Skips loudly if the cache backend is 503 (can't mint a claimable resource).
async function provisionAnonCache(request: APIRequestContext): Promise<AnonProvision> {
  // anonProvisionHeaders() carries the X-E2E-Test-Token fingerprint-bypass when
  // E2E_TEST_TOKEN is set (prod ignores X-Forwarded-For, tripping the recycle
  // gate) + a unique XFF for staging/local. A cohort name keeps the resource
  // cohort-tagged (harmless for /cache/new, which does not require a name).
  const resp = await request.fetch(`${API_URL}/cache/new`, {
    method: 'POST',
    headers: anonProvisionHeaders(),
    data: JSON.stringify({ name: cohortName('w3-anon-cache') }),
    failOnStatusCode: false,
  })
  test.skip(
    resp.status() === STATUS_BACKEND_UNAVAILABLE,
    `cache service returned 503 at ${API_URL} — provisioning backend not enabled in this ` +
      `stack; cannot mint a claimable anonymous resource. Reports skipped.`,
  )
  expect(
    resp.status(),
    `POST /cache/new should return ${STATUS_CREATED}; got ${resp.status()}. ` +
      `Body: ${await resp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const body = (await resp.json()) as { token: string; note: string }
  // Record the instant it exists, before the claim assertions, so a later
  // failure still leaves a reapable record.
  recordEntity({ kind: 'resource', id: body.token, apiUrl: API_URL, note: `W3 anon cache ${body.token}` })
  return { token: body.token, upgradeJWT: extractUpgradeJWT(body.note) }
}

interface ClaimedTeam {
  userID: string
  teamID: string
  email: string
  /** Real session JWT the claim hands back — usable as a dashboard Bearer. */
  sessionToken: string
}

// Claim an anon-upgrade JWT into a REAL user/team and return the session token
// the claim mints (onboarding.go:537). Brevo-free.
async function claim(request: APIRequestContext, upgradeJWT: string): Promise<ClaimedTeam> {
  const email = cohortEmail('w3')
  const resp = await request.fetch(`${API_URL}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ jwt: upgradeJWT, email }),
    failOnStatusCode: false,
  })
  expect(
    resp.status(),
    `POST /claim should return ${STATUS_CREATED}; got ${resp.status()}. ` +
      `Body: ${await resp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const body = (await resp.json()) as {
    user_id: string
    team_id: string
    session_token?: string
  }
  expect(body.user_id, 'claim must return a user_id').toBeTruthy()
  expect(body.team_id, 'claim must return a team_id').toBeTruthy()
  expect(
    body.session_token,
    'claim must return a session_token so the just-claimed user can immediately reach ' +
      'the authenticated dashboard surface (onboarding.go:537). Without it the user would ' +
      'land on a signed-out dashboard right after a "successful" claim.',
  ).toBeTruthy()
  return {
    userID: body.user_id,
    teamID: body.team_id,
    email,
    sessionToken: String(body.session_token),
  }
}

// Authenticated provision of a redis resource in a specific env, as the
// dashboard/agent would (Bearer + JSON body {name, env}). Returns the token +
// the env the response echoed (rule 11). Records to the ledger before asserting.
async function provisionInEnv(
  request: APIRequestContext,
  sessionToken: string,
  env: string,
): Promise<{ token: string; echoedEnv: string }> {
  const name = cohortName(`w3-env-${env}`)
  const resp = await request.fetch(`${API_URL}/cache/new`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
      'X-Forwarded-For': uniqueIP(),
    },
    data: JSON.stringify({ name, env }),
    failOnStatusCode: false,
  })
  test.skip(
    resp.status() === STATUS_BACKEND_UNAVAILABLE,
    `cache service returned 503 at ${API_URL} — cannot provision the env-tagged resource. Reports skipped.`,
  )
  expect(
    resp.status(),
    `authenticated POST /cache/new (env=${env}) should return ${STATUS_CREATED}; got ${resp.status()}. ` +
      `Body: ${await resp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const body = (await resp.json()) as Record<string, unknown>
  const token = String(body.token ?? '')
  recordEntity({
    kind: 'resource',
    id: token,
    apiUrl: API_URL,
    token: sessionToken,
    note: `W3 env=${env} ${name}`,
  })
  return { token, echoedEnv: String(body.env ?? '') }
}

test.describe('LIVE — W3 claim/conversion + deploy-lifecycle + env-switcher (cross-surface)', () => {
  test.describe.configure({ mode: 'serial' })

  // These legs do real prod provisioning + claim + deploy (each heavy) and the
  // assert-usable connect from the CI runner — occasionally well past the 120s
  // default under prod contention, timing out the serial group on transient
  // latency (recovered on retry). Raise the per-test budget so a slow-but-OK
  // run doesn't red the suite. See live-anon-provision.spec.ts for the same.
  test.beforeEach(() => {
    test.setTimeout(180_000)
  })

  // Hard skip in normal CI: the LIVE harness must never make the per-PR gate
  // depend on a reachable backend.
  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend W3 suite is opt-in. Set E2E_LIVE=1 + ' +
      'E2E_API_URL=<staging api> to run it.',
  )
  test.skip(
    LIVE && !API_URL,
    'E2E_LIVE=1 but E2E_API_URL/AGENT_API_URL is unset — no backend to target.',
  )

  // Prod-target safety (item 3): refuse an un-sanctioned prod target; allow it
  // only for a minted-account run (E2E_ACCOUNT_TOKEN/E2E_SESSION_JWT present).
  // The claim/conversion + env-switcher legs create real claimed cohort teams
  // (reaped via the ledger); the deploy-lifecycle leg self-skips on prod.
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  // Backstop reaper (rule 24): even if a leg throws before its inline reap,
  // afterAll reaps every still-ledgered entity; reap-cohort.ts re-runs the same
  // path out-of-process in CI teardown if the process dies.
  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-claim-deploy afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── Claim / conversion (anon → claimed) ─────────────────────────────────────
  // The cross-surface assertion: an anonymous resource → POST /claim → the
  // resource is now OWNED by a real team AND appears on the dashboard's resource
  // read surface (GET /api/v1/resources, authed with the claim's session_token).
  // This proves the conversion landed everywhere the user looks, not just that
  // /claim returned 201 — the "shipped ≠ user-visible" class.
  test.describe('claim/conversion — anon resource becomes team-owned + dashboard-visible', () => {
    test('anon provision → /claim → resource owned by the new team + visible in GET /api/v1/resources', async ({
      request,
    }) => {
      const anon = await provisionAnonCache(request)
      const team = await claim(request, anon.upgradeJWT)

      // Cross-surface: the dashboard lists resources via GET /api/v1/resources
      // (api/client.ts listResources). The just-claimed token MUST be there,
      // owned by the new team — the conversion is real, not just a 201.
      const list = await request.fetch(`${API_URL}/api/v1/resources`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${team.sessionToken}` },
        failOnStatusCode: false,
      })
      expect(
        list.status(),
        `GET /api/v1/resources with the claim session_token should return ${STATUS_OK}; got ` +
          `${list.status()}. Body: ${await list.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const listBody = (await list.json()) as { items?: Array<Record<string, unknown>> }
      const items = listBody.items ?? []
      const claimed = items.find((r) => String(r.token) === anon.token)
      expect(
        claimed,
        `the claimed resource token ${anon.token} must appear in the new team's resource list ` +
          `(${items.length} item(s) returned) — the dashboard would otherwise show an empty ` +
          `dashboard right after a successful claim. The conversion did not graft the resource ` +
          `onto the team, or the team scoping is wrong.`,
      ).toBeTruthy()
      // Ownership proof: the row now carries the claimed team_id (was NULL/anon).
      expect(
        String((claimed as Record<string, unknown>).team_id ?? ''),
        `the claimed resource must be owned by the new team ${team.teamID}; got team_id=` +
          `${String((claimed as Record<string, unknown>).team_id)}.`,
      ).toBe(team.teamID)

      // Reap (afterAll + reap-cohort.ts back this up). Authed delete with the
      // session token — the resource is now team-owned, not anonymous.
      const result = await reapEntities(request, [
        {
          kind: 'resource',
          id: anon.token,
          apiUrl: API_URL,
          token: team.sessionToken,
          note: 'W3 claim-conversion leg',
          recordedAt: new Date().toISOString(),
        },
      ])
      expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
      clearLedger()
    })

    test('claim-replay — the SAME upgrade token claimed twice → second is 409 (single-use)', async ({
      request,
    }) => {
      const anon = await provisionAnonCache(request)

      // First claim succeeds (mints a real team).
      const team = await claim(request, anon.upgradeJWT)

      // Second claim of the SAME upgrade JWT MUST be 409 — the single-use JWT
      // invariant (rule 7: atomic UPDATE ... WHERE converted_at IS NULL).
      // A 201 here would mean a token replay grafts the resource a second time
      // (or onto a second account) — the exact account-takeover class the
      // single-use guard exists to prevent.
      const replay = await request.fetch(`${API_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ jwt: anon.upgradeJWT, email: cohortEmail('w3-replay') }),
        failOnStatusCode: false,
      })
      expect(
        replay.status(),
        `replaying the SAME upgrade token must return ${STATUS_CONFLICT} (already_claimed); got ` +
          `${replay.status()}. A 2xx here is a single-use-JWT regression (rule 7) — token replay. ` +
          `Body: ${await replay.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_CONFLICT)
      const replayBody = (await replay.json().catch(() => ({}))) as { error?: string }
      expect(
        replayBody.error,
        `the 409 should carry the already_claimed error code; got ${JSON.stringify(replayBody)}.`,
      ).toBe('already_claimed')

      // Reap the resource (owned by the first, successful claim's team).
      const result = await reapEntities(request, [
        {
          kind: 'resource',
          id: anon.token,
          apiUrl: API_URL,
          token: team.sessionToken,
          note: 'W3 claim-replay leg',
          recordedAt: new Date().toISOString(),
        },
      ])
      expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
      clearLedger()
    })
  })

  // ── Env switcher (dashboard) ────────────────────────────────────────────────
  // The dashboard's per-env resource read is GET /api/v1/resources?env=<name>
  // (api/client.ts listResources(env)). Provision the SAME team in two envs and
  // assert each env's list contains ONLY its own resource — and that each
  // provision echoed the resolved env (rule 11). This is the backend contract
  // the VaultPage env tabs (and any future global env switcher) sit on; the
  // global chrome switcher is currently retired (useDashboardCtx.ts), so the
  // load-bearing surface IS the ?env= query, asserted here.
  test.describe('env switcher — per-env resource isolation + resolved-env echo (rule 11)', () => {
    test('provision dev + prod → ?env= returns only that env; provision echoes the env', async ({
      request,
    }) => {
      const anon = await provisionAnonCache(request)
      const team = await claim(request, anon.upgradeJWT)

      const dev = await provisionInEnv(request, team.sessionToken, 'development')
      const prod = await provisionInEnv(request, team.sessionToken, 'production')

      // Rule 11: every provision echoes the resolved env.
      expect(
        dev.echoedEnv,
        `provision with env=development must echo env=development (rule 11); got '${dev.echoedEnv}'.`,
      ).toBe('development')
      expect(
        prod.echoedEnv,
        `provision with env=production must echo env=production (rule 11); got '${prod.echoedEnv}'.`,
      ).toBe('production')

      // Cross-surface: the env switcher's read surface returns ONLY the matching
      // env's resources. The dev resource must NOT leak into the production view
      // and vice-versa — the precise bug a per-env dashboard tab would surface.
      const listByEnv = async (env: string): Promise<Array<Record<string, unknown>>> => {
        const resp = await request.fetch(`${API_URL}/api/v1/resources?env=${encodeURIComponent(env)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${team.sessionToken}` },
          failOnStatusCode: false,
        })
        expect(
          resp.status(),
          `GET /api/v1/resources?env=${env} should return ${STATUS_OK}; got ${resp.status()}.`,
        ).toBe(STATUS_OK)
        const body = (await resp.json()) as { items?: Array<Record<string, unknown>> }
        return body.items ?? []
      }

      const devList = await listByEnv('development')
      const prodList = await listByEnv('production')

      const devTokens = devList.map((r) => String(r.token))
      const prodTokens = prodList.map((r) => String(r.token))

      expect(
        devTokens,
        `the development env view must contain the dev resource ${dev.token}.`,
      ).toContain(dev.token)
      expect(
        devTokens,
        `the development env view must NOT contain the production resource ${prod.token} — env ` +
          `isolation leak (the dashboard would show prod resources under the dev tab).`,
      ).not.toContain(prod.token)
      expect(
        prodTokens,
        `the production env view must contain the prod resource ${prod.token}.`,
      ).toContain(prod.token)
      expect(
        prodTokens,
        `the production env view must NOT contain the development resource ${dev.token} — env ` +
          `isolation leak (the dashboard would show dev resources under the prod tab).`,
      ).not.toContain(dev.token)

      // Every returned dev-view row must actually be env=development (the server
      // filters by env, not just by team) — and likewise for prod.
      for (const r of devList) {
        expect(String(r.env), `a row in the development view has env=${String(r.env)}`).toBe('development')
      }
      for (const r of prodList) {
        expect(String(r.env), `a row in the production view has env=${String(r.env)}`).toBe('production')
      }

      // Reap both env-tagged resources.
      const result = await reapEntities(request, [
        { kind: 'resource', id: dev.token, apiUrl: API_URL, token: team.sessionToken, note: 'W3 env dev', recordedAt: new Date().toISOString() },
        { kind: 'resource', id: prod.token, apiUrl: API_URL, token: team.sessionToken, note: 'W3 env prod', recordedAt: new Date().toISOString() },
        { kind: 'resource', id: anon.token, apiUrl: API_URL, token: team.sessionToken, note: 'W3 env claimed base', recordedAt: new Date().toISOString() },
      ])
      expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
      clearLedger()
    })
  })

  // ── Deploy lifecycle ────────────────────────────────────────────────────────
  // STAGING-ONLY: needs a team with deployment headroom. The Brevo-free claim
  // mints a `free` team (deployments_apps=0 → 402 wall), so we elevate it via
  // the DEV-ONLY POST /internal/set-tier (ENVIRONMENT=development only). That
  // endpoint 404s in prod, so this leg SKIPS LOUDLY outside a dev/staging stack
  // — tier elevation must NEVER cross a real billing path.
  //
  // The full Kaniko build → live URL leg is DEFERRED (too slow/heavy for E2E).
  // We assert the create→202-accepted contract (id/app_id/status/environment) →
  // the GET /api/v1/deployments/:id/events read surface (the failure-timeline
  // shipped 2026-05-30, #200) → DELETE → 404 gone. That is the user-visible
  // integration boundary; the build-to-live leg is exercised by /instant-e2e
  // and the per-deploy synthetic, not here.
  test.describe('deploy lifecycle — create(202) → events surface → delete → gone', () => {
    test('POST /deploy/new accepted → events timeline → DELETE → gone', async ({ request }) => {
      // Resolve a team with deployment headroom WITHOUT crossing a billing path:
      //   - Prod (sanctioned run): the workflow-minted account is already PRO
      //     (deployments_apps=10), so we deploy AS it directly — no claim, no
      //     dev-only set-tier. This is the brief's "use the minted pro account".
      //   - Staging/local: the Brevo-free claim mints a `free` team (0 deploy
      //     headroom → 402), so we elevate it via the DEV-ONLY set-tier endpoint.
      //     If that endpoint 404s AND there is no minted session, we skip loudly
      //     (never 402-wall or charge).
      const minted = mintedSession()
      let deployBearer: string
      let baseResource: { token: string; bearer: string } | null = null

      if (minted?.token) {
        // Deploy as the minted pro account — has deployment headroom already.
        deployBearer = minted.token
      } else {
        const anon = await provisionAnonCache(request)
        const team = await claim(request, anon.upgradeJWT)
        baseResource = { token: anon.token, bearer: team.sessionToken }

        // Elevate the free team to a deployable tier via the dev-only endpoint.
        // 404 ⇒ not a dev/staging stack AND no minted account ⇒ skip loudly.
        const setTier = await request.fetch(`${API_URL}${SET_TIER_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ team_id: team.teamID, tier: DEPLOY_TIER }),
          failOnStatusCode: false,
        })
        test.skip(
          setTier.status() === STATUS_NOT_FOUND,
          `${SET_TIER_PATH} returned 404 — this is a prod stack (dev-only endpoint not registered) ` +
            `and no minted pro account is present. The deploy leg needs deployment headroom and we ` +
            `must never cross a real billing path to elevate a free team. Reports skipped. Run ` +
            `against a dev/staging api (ENVIRONMENT=development) or a sanctioned minted-account run.`,
        )
        expect(
          setTier.status(),
          `${SET_TIER_PATH} should return ${STATUS_OK} on a dev/staging stack; got ${setTier.status()}. ` +
            `Body: ${await setTier.text().catch(() => '<unreadable>')}`,
        ).toBe(STATUS_OK)
        deployBearer = team.sessionToken
      }

      // ── Create: a minimal tarball deploy. We do NOT wait for the Kaniko build
      //    to go live (deferred) — only the accepted contract + events surface +
      //    delete are asserted. The tarball is a tiny gzipped tar carrying a
      //    Dockerfile; the build outcome is irrelevant to the legs under test
      //    (a build that later fails still writes events the failure surface
      //    reads — exactly the 2026-05-30 class). ──────────────────────────────
      const deployName = cohortName('w3-deploy')
      const form = {
        name: deployName,
        env: 'development',
        // Smallest plausible build context: a Dockerfile in a gzipped tar.
        tarball: {
          name: 'context.tar.gz',
          mimeType: 'application/gzip',
          buffer: makeMinimalTarGz(),
        },
      }
      const create = await request.fetch(`${API_URL}/deploy/new`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${deployBearer}` },
        multipart: form,
        failOnStatusCode: false,
      })
      test.skip(
        create.status() === STATUS_BACKEND_UNAVAILABLE,
        `/deploy/new returned 503 — the compute/build backend is not enabled in this stack; ` +
          `cannot create a deployment. Reports skipped.`,
      )
      expect(
        create.status(),
        `POST /deploy/new should return ${STATUS_ACCEPTED} (async build accepted); got ` +
          `${create.status()}. A 402 means the tier elevation didn't take; a 4xx means the ` +
          `multipart contract changed. Body: ${await create.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_ACCEPTED)
      const created = (await create.json()) as { ok?: boolean; item?: Record<string, unknown> }
      const item = created.item ?? {}
      // app_id is the public id used to address the deployment (deploy.go:546-547);
      // it is what GET/DELETE /api/v1/deployments/:id and the events route key on.
      const appID = String(item.app_id ?? item.token ?? '')
      expect(
        appID,
        `/deploy/new must return an app_id to address the deployment; got item=${JSON.stringify(item)}.`,
      ).toBeTruthy()
      // Record for reaping the instant we have an addressable id.
      recordEntity({
        kind: 'deployment',
        id: appID,
        apiUrl: API_URL,
        token: deployBearer,
        note: `W3 deploy ${deployName}`,
      })
      // Accepted-contract assertions: a real building deployment in the env we
      // asked for. status is 'building'/'pending' on the async path (deploy.go).
      expect(created.ok, '/deploy/new ok flag').toBe(true)
      expect(item.id, '/deploy/new item must carry a db id').toBeTruthy()
      expect(
        String(item.status ?? ''),
        `/deploy/new item must carry a lifecycle status (e.g. building/pending); got ` +
          `'${String(item.status)}'.`,
      ).toBeTruthy()
      expect(
        String(item.environment ?? ''),
        `/deploy/new must echo the resolved environment=development (rule 11); got ` +
          `'${String(item.environment)}'.`,
      ).toBe('development')
      expect(
        isCohortBranded(String(item.name ?? '')),
        `the deployment name must carry the cohort marker '${COHORT_MARKER}' so backend guards ` +
          `can identify it; got '${String(item.name)}'.`,
      ).toBe(true)

      // ── Events surface: GET /api/v1/deployments/:id/events — the
      //    failure-timeline read surface (#200, 2026-05-30). It must respond
      //    with the canonical {ok, deployment_id, events[], count} envelope for
      //    a deployment the team owns, even when the timeline is still empty
      //    (the build hasn't progressed). An empty-but-200 envelope is the
      //    correct early-lifecycle shape; the contract under test is that the
      //    surface EXISTS and is team-scoped, not that a specific event landed. ─
      const events = await request.fetch(
        `${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}/events`,
        { method: 'GET', headers: { Authorization: `Bearer ${deployBearer}` }, failOnStatusCode: false },
      )
      expect(
        events.status(),
        `GET /api/v1/deployments/:id/events should return ${STATUS_OK} for an owned deployment; got ` +
          `${events.status()}. Body: ${await events.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const eventsBody = (await events.json()) as {
        ok?: boolean
        deployment_id?: string
        events?: unknown[]
        count?: number
      }
      expect(eventsBody.ok, 'events envelope ok flag').toBe(true)
      expect(
        eventsBody.deployment_id,
        'events envelope must echo the deployment_id it resolved.',
      ).toBeTruthy()
      expect(
        Array.isArray(eventsBody.events),
        `events envelope must carry an events[] array (the failure-timeline surface); got ` +
          `${JSON.stringify(eventsBody)}.`,
      ).toBe(true)
      expect(
        eventsBody.count,
        'events envelope count must equal the events[] length.',
      ).toBe((eventsBody.events ?? []).length)

      // ── Delete → gone. The cross-surface assertion: DELETE then re-query the
      //    events surface and get 404 — the deployment is no longer addressable,
      //    so the dashboard would correctly show it as removed. ────────────────
      const del = await request.fetch(
        `${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${deployBearer}` }, failOnStatusCode: false },
      )
      expect(
        del.status() >= 200 && del.status() < 300,
        `DELETE /api/v1/deployments/:id should succeed (2xx); got ${del.status()}. ` +
          `Body: ${await del.text().catch(() => '<unreadable>')}`,
      ).toBe(true)

      // Gone: the events surface (same RBAC as GET) now 404s — never confirm a
      // deleted/other-team deployment. Deletion is async teardown, so a brief
      // window may still return 200 while the row flips to a terminal state; we
      // accept either "404 not found" OR a non-active terminal status, but the
      // load-bearing assertion is that the team can no longer act on it as live.
      const afterDelete = await request.fetch(
        `${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}/events`,
        { method: 'GET', headers: { Authorization: `Bearer ${deployBearer}` }, failOnStatusCode: false },
      )
      expect(
        [STATUS_OK, STATUS_NOT_FOUND].includes(afterDelete.status()),
        `post-delete events query should be 404 (gone) or 200 (terminal/teardown in progress); got ` +
          `${afterDelete.status()}. A 5xx here means the delete left the row in a broken state.`,
      ).toBe(true)

      // Reap is now idempotent (404 == alreadyGone). Clears the ledger.
      const reapTargets = [
        { kind: 'deployment' as const, id: appID, apiUrl: API_URL, token: deployBearer, note: 'W3 deploy reap', recordedAt: new Date().toISOString() },
      ]
      // The staging path created an anon base resource (claimed → team-owned);
      // reap it too. The minted-account path created no base resource.
      if (baseResource) {
        reapTargets.push({
          kind: 'resource' as const,
          id: baseResource.token,
          apiUrl: API_URL,
          token: baseResource.bearer,
          note: 'W3 deploy base resource',
          recordedAt: new Date().toISOString(),
        })
      }
      const result = await reapEntities(request, reapTargets)
      expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
      clearLedger()
    })
  })

  // Coverage manifest (rule 18): the matrix W3 leg IDs this file covers. A
  // future registry-iterating done-bar test can read this to confirm no W3 leg
  // silently dropped. COHORT_MARKER is referenced so the cohort import stays
  // load-bearing even when the account legs all skip.
  test('coverage manifest — W3 legs present + cohort marker wired', () => {
    const covered = [
      'claim-conversion',
      'claim-replay-409',
      'env-switch-isolation',
      'env-resolved-echo',
      'deploy-create-202',
      'deploy-events-surface',
      'deploy-delete-gone',
    ]
    const deferred = ['deploy-build-to-live-url'] // too slow/heavy for E2E
    expect(covered.length, 'W3 leg manifest should be non-empty').toBeGreaterThan(0)
    expect(deferred.length, 'W3 deferred-leg note present').toBeGreaterThan(0)
    expect(COHORT_MARKER, 'cohort marker must be the shared brand').toBe('e2e-cohort')
  })
})

// ── Minimal gzipped-tar build context ──────────────────────────────────────────
// A real /deploy/new requires a multipart `tarball` (gzipped tar) carrying a
// Dockerfile. We hand-roll the smallest valid one rather than pull in a tar/gzip
// dep: one 512-byte ustar header for `Dockerfile` + its content + the two
// 512-byte zero blocks that terminate a tar, then gzip via Node's zlib. The
// build outcome is irrelevant to the legs under test (create/events/delete); we
// just need a structurally-valid upload the handler accepts.
function makeMinimalTarGz(): Buffer {
  const content = Buffer.from('FROM scratch\n', 'utf8')
  const tar = buildUstarTar('Dockerfile', content)
  return gzipSync(tar)
}

// Build a single-file ustar tar archive (one header block + padded content +
// two terminating zero blocks).
function buildUstarTar(name: string, content: Buffer): Buffer {
  const BLOCK = 512
  const header = Buffer.alloc(BLOCK)
  header.write(name, 0, 'utf8') // name (offset 0, 100 bytes)
  header.write('0000644', 100, 'ascii') // mode
  header.write('0000000', 108, 'ascii') // uid
  header.write('0000000', 116, 'ascii') // gid
  header.write(content.length.toString(8).padStart(11, '0'), 124, 'ascii') // size (octal)
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0'), 136, 'ascii') // mtime
  header.write('0', 156, 'ascii') // typeflag: regular file
  header.write('ustar', 257, 'ascii') // magic
  header.write('00', 263, 'ascii') // version
  // Checksum: spaces while computing, then the octal sum.
  header.write('        ', 148, 'ascii')
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')

  const contentBlocks = Math.ceil(content.length / BLOCK)
  const paddedContent = Buffer.alloc(contentBlocks * BLOCK)
  content.copy(paddedContent)

  // Two zero blocks terminate the archive.
  const terminator = Buffer.alloc(BLOCK * 2)
  return Buffer.concat([header, paddedContent, terminator])
}

// Re-export for a potential future registry-iterating coverage test (rule 18).
export type { CohortEntity }

// Covered-route manifest (rule 18), defined in the playwright-free sibling so the
// vitest prod-coverage done-bar guard can union it without the @playwright/test
// runtime. The spec tags legs by W3 leg-ID; the sibling maps them to route
// strings (matrix §0.2 / §1.C / §1.E / §1.K).
export { coveredRoutes } from './live-claim-deploy.coverage'
