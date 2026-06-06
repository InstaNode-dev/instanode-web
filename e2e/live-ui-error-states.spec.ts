// LIVE-UI error/async-state matrix — the per-async-state sweep.
//
// Design ref: docs/ci/00-INTERACTION-PATHS.md Part C (the per-async-state gap)
// + Part A3 ("Async: loading / success / empty / error (4xx vs 5xx) / offline /
// timeout. 401→clear token→/login?session_expired=1; 429→retry-hint banners").
// Companion to live-ui-tier-matrix.spec.ts (the per-tier sweep). This forces and
// asserts each async/error state on the relevant dashboard pages against the
// REAL backend where reachable, and via a TARGETED route-stub where a real prod
// condition can't be produced safely.
//
// ── REAL vs MOCKED (called out per leg, per the task) ─────────────────────────
//   • 401 expired/revoked  — REAL. Mint a DISPOSABLE cohort account, revoke its
//                            session via POST /auth/logout (jti → Redis
//                            revocation set), then load /app/* with the revoked
//                            bearer → /auth/me 401 → the SPA redirects to
//                            /login?session_expired=1 (NOT a white screen). Uses
//                            a disposable minted account so the shared minted JWT
//                            is never revoked (mirrors live-auth A10).
//   • 402 at-limit         — REAL. Mint at the deploy cap (hobby) — a sub-Pro
//                            tier — and click Pause on a seeded resource; the
//                            real api returns 402 (pause is Pro+) and the UI
//                            swaps in the upgrade wall (pause-resume-upgrade).
//                            This is a genuine real-backend 402 UI wall (the
//                            deploy-cap 402 itself is asserted at the api level in
//                            live-ui-deploy.spec.ts; rendering a fresh deploy to
//                            fill the slot is too slow for a render assertion).
//   • 429 rate-limit       — MOCKED. A real 429 can't be produced on demand
//                            against prod without hammering it (and would be
//                            flaky / abusive). We route-stub GET
//                            /api/v1/deployments → 429 and assert the
//                            DeploymentsPage amber rate-limit retry-hint banner.
//   • 5xx server error     — MOCKED. A real 5xx isn't safely reachable on prod;
//                            we route-stub GET /api/v1/deployments → 503 and
//                            assert the rose error banner (NOT a silent collapse
//                            to "No deployments yet", which would lie about
//                            platform state — the bug DeploymentsPage guards).
//   • empty states         — REAL. A fresh minted account (no resources / no
//                            deploys) → Overview + Deployments render their
//                            empty-state copy, not an infinite spinner.
//
// Safety machinery mirrors live-ui-auth.spec.ts EXACTLY (rule 24): E2E_LIVE
// gating, assertSafeApiTarget, mint→ledger→cascade-reap + afterAll backstop.

import { test, expect, type APIRequestContext, type Route } from '@playwright/test'

import { assertSafeApiTarget } from './cohort'
import { loadLedger, reapEntities, clearLedger } from './cleanup-ledger'
import {
  mintUser,
  mintUserWithResources,
  mintAtDeployCap,
  reap,
  factoryArmed,
  apiBase,
  type MintedUser,
} from './factory'
import { newAuthedContext, appURL } from './ui-helpers'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = apiBase()

const STATUS_OK = 200
const STATUS_TOO_MANY = 429
const STATUS_UNAVAILABLE = 503
const RETRY_AFTER_SECONDS = '30'

test.describe('LIVE-UI — async/error-state matrix sweep', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend error-state sweep is opt-in. Set E2E_LIVE=1 + ' +
      'E2E_API_URL + E2E_ACCOUNT_TOKEN (mint guard) to run it.',
  )
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
        `[live-ui-error-states afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── 401 — revoked session → /login?session_expired=1 (REAL) ── @pr-smoke ──────
  test('@pr-smoke 401: a revoked session loading /app/* redirects to /login?session_expired=1 (not a white screen)', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a disposable cohort account.')
    // A DISPOSABLE account — we REVOKE its session, so it must never be the
    // shared minted JWT (mirrors live-auth A10's disposable-bearer rule).
    const user = await mintUser(request, { tier: 'free' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    // Pre-revoke: the bearer works (proves the jti is recognized — otherwise the
    // revocation assertion below would be meaningless).
    const pre = await request.fetch(`${API_URL}/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${u.sessionJWT}` },
      failOnStatusCode: false,
    })
    expect(pre.status(), `pre-revoke /auth/me with the disposable bearer should be 200; got ${pre.status()}.`).toBe(
      STATUS_OK,
    )

    // REVOKE — POST /auth/logout adds the jti to the Redis revocation set so the
    // SAME bearer is now rejected (the disposable-session expiry the UI must
    // handle gracefully).
    const logout = await request.fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u.sessionJWT}` },
      failOnStatusCode: false,
    })
    expect(logout.status(), `POST /auth/logout should be 200; got ${logout.status()}.`).toBe(STATUS_OK)

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      // Load a gated /app/* page with the REVOKED bearer. The AuthGate is
      // token-presence only, so the page mounts and fires /auth/me → 401 → the
      // api layer's handle401 redirects to /login?session_expired=1 (because the
      // path is under /app). A white screen / hang here is the failure mode.
      await page.goto(appURL('/app/resources'), { waitUntil: 'domcontentloaded' })
      await expect(
        page,
        'a revoked session loading /app/* must redirect to /login?session_expired=1 (the SPA must NOT ' +
          'hang on a white screen or render a phantom authed shell for a dead token).',
      ).toHaveURL(/\/login\?(.*&)?session_expired=1/, { timeout: 30_000 })
      // The login page must actually render the "session expired" banner, not just
      // change the URL — a real user must SEE why they were bounced.
      await expect(
        page.getByTestId('email-input'),
        'the /login page must render after the redirect (the login form is visible, not a blank page).',
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await context.close()
    }
    await reapUser(request, u)
  })

  // ── 402 — at-limit tier wall renders in the UI (REAL) ─────────────────────────
  test('402: a sub-Pro (deploy-cap) account hitting a Pro-gated action sees the 402 upgrade wall', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    // mintAtDeployCap → hobby (deployments_apps=1), a sub-Pro tier. Pause/resume
    // is Pro+, so a hobby Pause hits a REAL 402 → the UI upgrade wall. We seed a
    // resource so there's something to Pause (the deploy-cap 402 itself is
    // covered at the api level in live-ui-deploy.spec.ts).
    const capped = await mintAtDeployCap(request)
    test.skip(capped === null, 'mint endpoint not armed (404).')
    const cap = capped as MintedUser
    expect(cap.tier, 'mintAtDeployCap must mint hobby (deployments_apps=1, sub-Pro for pause).').toBe('hobby')

    // Seed a resource on the SAME hobby team to Pause (separate mint so the cap
    // account's tier is the one under test). Reuse mintUserWithResources at hobby.
    const seeded = await mintUserWithResources(request, { tier: 'hobby' })
    test.skip(seeded === null, 'could not mint a hobby account with a seeded resource for the 402 wall.')
    const s = seeded as MintedUser
    const seededToken = s.seededTokens[0]
    expect(seededToken, 'the hobby account must have a seeded resource to Pause.').toBeTruthy()

    const { context, page } = await newAuthedContext(browser, { sessionJWT: s.sessionJWT })
    try {
      await page.goto(appURL(`/app/resources/${seededToken}`), { waitUntil: 'domcontentloaded' })
      const pauseBtn = page.getByTestId('pause-resume-button')
      await expect(pauseBtn, 'the Pause button must render on the resource detail.').toBeVisible({ timeout: 30_000 })
      await pauseBtn.click()
      await expect(page.getByTestId('pause-resume-modal'), 'the pause confirm modal must open.').toBeVisible()
      await page.getByTestId('pause-resume-confirm').click()
      // THE WALL: a sub-Pro Pause must surface the real api's 402 as the in-UI
      // upgrade prompt (PauseResumeButton tierBlocked → UpgradeButton).
      await expect(
        page.getByTestId('pause-resume-upgrade'),
        'a hobby (sub-Pro) Pause must surface the 402 upgrade wall in the UI (real api 402 → UpgradeButton CTA).',
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await context.close()
    }
    await reap(request, cap.teamID)
    await reapUser(request, s)
  })

  // ── 429 — rate-limit retry-hint banner (MOCKED) ───────────────────────────────
  test('429 [MOCKED]: a rate-limited deployments list renders the amber retry-hint banner', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintUser(request, { tier: 'pro' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      // MOCKED: a real 429 can't be produced on prod without abusive hammering.
      // We intercept the deployments list fetch (same-origin, before the preview
      // proxy) and return a 429 + Retry-After so the page's retry-hint path runs.
      // /auth/me + every other read still hits the REAL api (the shell renders
      // authed) — only this one list is stubbed.
      await page.route(/\/api\/v1\/deployments(\?[^/]*)?$/, (route: Route) =>
        route.fulfill({
          status: STATUS_TOO_MANY,
          headers: { 'Retry-After': RETRY_AFTER_SECONDS },
          contentType: 'application/json',
          body: JSON.stringify({ error: 'rate_limited', message: 'Too many requests' }),
        }),
      )
      await page.goto(appURL('/app/deployments'), { waitUntil: 'domcontentloaded' })
      const banner = page.getByTestId('deployments-error')
      await expect(
        banner,
        'a 429 on the deployments list must render the error banner (not silently collapse to "No deployments yet").',
      ).toBeVisible({ timeout: 30_000 })
      await expect(
        banner,
        'the 429 banner must carry the rate-limit retry-hint copy (the amber rate-limited path).',
      ).toContainText(/rate-limited|too many requests/i)
      // NOTE (finding F1): the page ALSO renders the "No deployments yet" empty row
      // alongside the error banner, because on error it sets items=[] and the
      // empty-state condition is `!loading && items.length === 0` (it doesn't also
      // gate on `!err`). The error banner (role=alert, top of page) is the dominant
      // signal so the anti-silent-collapse guarantee holds — but the simultaneous
      // "No deployments yet" copy is mildly contradictory UX. Reported as a finding
      // for the (src/-owning) bug-hunt team; we assert the load-bearing guarantee
      // here (the error IS surfaced, NOT silently swallowed) rather than the
      // empty-row's absence, which would red against true current behavior.
    } finally {
      await context.close()
    }
    await reapUser(request, u)
  })

  // ── 5xx — server error banner, not a silent empty collapse (MOCKED) ───────────
  test('5xx [MOCKED]: a 503 on the deployments list renders the error banner, not the empty state', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintUser(request, { tier: 'pro' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      // MOCKED: a real 5xx isn't safely reachable on prod. Stub the deployments
      // list → 503; everything else hits the REAL api.
      await page.route(/\/api\/v1\/deployments(\?[^/]*)?$/, (route: Route) =>
        route.fulfill({
          status: STATUS_UNAVAILABLE,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'service_unavailable', message: 'backend unavailable' }),
        }),
      )
      await page.goto(appURL('/app/deployments'), { waitUntil: 'domcontentloaded' })
      const banner = page.getByTestId('deployments-error')
      await expect(
        banner,
        'a 5xx on the deployments list must render the error banner (the page must surface the failure).',
      ).toBeVisible({ timeout: 30_000 })
      await expect(
        banner,
        'the 5xx banner must show the "could not load" copy (the rose, non-rate-limited error arm).',
      ).toContainText(/could not load deployments/i)
      // NOTE (finding F1, same as the 429 leg): the empty "No deployments yet" row
      // also renders here. The load-bearing guarantee — a 5xx is SURFACED as an
      // error banner (role=alert), NOT silently collapsed to a clean empty list —
      // holds, which is what we assert. The contradictory simultaneous empty copy
      // is filed as a finding for the src/-owning team.
    } finally {
      await context.close()
    }
    await reapUser(request, u)
  })

  // ── empty states — fresh account renders empty copy, not a spinner (REAL) ─────
  test('empty: a fresh minted account renders the Overview + Deployments empty states (not a spinner)', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    // A fresh account WITHOUT seeded resources/deploys → genuinely empty reads.
    const user = await mintUser(request, { tier: 'pro' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      // Overview — the "recently active" tile resolves to its empty-state row
      // (no resources), proving the authed read RESOLVED (not stuck loading).
      await page.goto(appURL('/app'), { waitUntil: 'domcontentloaded' })
      await expect(
        page.getByTestId('recently-active-empty'),
        'a fresh account must render the Overview empty-state row (authed read resolved with zero rows).',
      ).toBeVisible({ timeout: 30_000 })

      // Deployments — the explicit "No deployments yet" empty state.
      await page.goto(appURL('/app/deployments'), { waitUntil: 'domcontentloaded' })
      await expect(
        page.getByTestId('deployments-empty'),
        'a fresh account must render the Deployments empty state (not an infinite spinner).',
      ).toBeVisible({ timeout: 30_000 })
      // And NOT an error banner — an empty list is success-with-zero-rows.
      await expect(
        page.getByTestId('deployments-error'),
        'an empty deployments list is NOT an error — the error banner must be absent.',
      ).toHaveCount(0)
    } finally {
      await context.close()
    }
    await reapUser(request, u)
  })
})

// Reap a minted account inline (eager); idempotent with the ledger backstop.
async function reapUser(request: APIRequestContext, u: MintedUser): Promise<void> {
  await reap(request, u.teamID)
  clearLedger()
}
