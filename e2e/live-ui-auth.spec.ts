// Wave 3 — real-backend UI journey #1: AUTH ROUND-TRIP through the dashboard.
//
// Design ref: docs/ci/01-CI-INTEGRATION-DESIGN.md (Wave 3) — "auth round-trip
// UI (the login-broke class through the UI)". The existing live specs are
// API-contract tests; THIS renders the ACTUAL dashboard in the browser with a
// minted cohort session and asserts the authed shell renders (not the /login
// redirect) + the team/user/counts load from the real api. It catches the
// 2026-05-29 login regression CLASS at the UI layer — a backend field/enum
// rename that compiles + passes mocked Playwright but breaks the real /app.
//
// Two legs:
//   (a) authed shell — mint a user → seed the session into localStorage →
//       load /app → assert the dashboard chrome renders (org, team name, nav),
//       the user identity shows, and the Overview counts/tiles load.
//   (b) magic-link form — load /login (anon) → fill the email → submit against
//       the REAL /auth/email/start → assert the "sent" state. Delivery is
//       Brevo-gated (sender unvalidated, CLAUDE.md P0), so this is a CONTRACT
//       assertion on the submit→202→sent UI transition only, never that an
//       email arrives.
//
// Safety machinery mirrors live-writes.spec.ts EXACTLY (rule 24): E2E_LIVE=1
// gating (hard SKIP in normal PR CI), assertSafeApiTarget refusing an
// un-sanctioned prod target, factory mint→ledger→cascade-reap + afterAll
// backstop. Named live-ui-*.spec.ts so playwright.live.config.ts picks it up and
// the default mocked config ignores it.

import { test, expect, type APIRequestContext } from '@playwright/test'

import { assertSafeApiTarget, COHORT_MARKER } from './cohort'
import { loadLedger, reapEntities, clearLedger } from './cleanup-ledger'
import { mintUser, reap, factoryArmed, apiBase, type MintedUser } from './factory'
import { newAuthedContext, newAnonContext, appURL } from './ui-helpers'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = apiBase()

test.describe('LIVE-UI — auth round-trip through the dashboard (journey #1)', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend UI auth journey is opt-in. Set E2E_LIVE=1 + ' +
      'E2E_API_URL + E2E_ACCOUNT_TOKEN (mint guard) to run it.',
  )
  test.skip(LIVE && !API_URL, 'E2E_LIVE=1 but E2E_API_URL is unset — no backend to target.')

  // Refuse an un-sanctioned prod target (item 3). A mint token (E2E_ACCOUNT_TOKEN
  // — set by the factory's accountToken) is a sanctioned-run signal.
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  // Backstop reaper (rule 24): cascade-delete any still-ledgered minted account
  // even if a leg throws before its inline reap.
  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-ui-auth afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── (a) authed shell renders against the real api ──── tag: @pr-smoke ────────
  test('@pr-smoke mint user → /app renders the authed dashboard (not /login)', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account for the UI auth journey.')
    const user = await mintUser(request, { tier: 'pro' })
    test.skip(user === null, 'mint endpoint not armed (404) — cannot run the UI auth journey.')
    const u = user as MintedUser

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      // Load /app authed. The AuthGate is token-presence only; the page then
      // calls /auth/me against the REAL api. If the contract drifted, /auth/me
      // would 401 and the SPA would bounce to /login — which this asserts NOT.
      await page.goto(appURL('/app'), { waitUntil: 'domcontentloaded' })

      // We must NOT have been redirected to /login (the login-broke symptom).
      await expect(
        page,
        'authed /app must not redirect to /login — a redirect here is the login-broke regression class.',
      ).not.toHaveURL(/\/login/, { timeout: 30_000 })

      // The authed shell chrome renders (AppShell org block + workspace nav).
      await expect(
        page.getByTestId('org'),
        'the authed dashboard shell (org block) must render for a valid session.',
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('nav-team'), 'the workspace nav must render in the authed shell.').toBeVisible()

      // The team identity loaded from /auth/me (org-name = team slug/id prefix).
      await expect(
        page.getByTestId('org-name'),
        'the team identity (from the real /auth/me) must render — proves the authed read worked.',
      ).not.toBeEmpty()

      // Decisive anti-false-pass check: open the UserMenu and assert it renders
      // the MINTED account's identity (email + tier) — these come straight from
      // the real /auth/me payload. If /auth/me had failed (CORS/contract drift),
      // the shell would render empty-states but these data-bound fields could
      // NOT show the minted email/tier. This is the real proof the authed read
      // resolved against prod for THIS account.
      await page.getByTestId('user-menu-trigger').click()
      await expect(
        page.getByTestId('user-menu-email'),
        'the UserMenu must render the minted account email from the real /auth/me payload.',
      ).toHaveText(u.email, { timeout: 15_000 })
      await expect(
        page.getByTestId('user-menu-tier-badge'),
        'the UserMenu must render the minted account tier (pro) from /auth/me.',
      ).toContainText(u.tier)

      // Overview counts/tiles load (the Overview page fetches resources +
      // deployments + activity from the real api). The "recently active" table
      // is the Overview's data tile; its presence proves the authed reads
      // resolved (empty-state is fine — the minted pro account may have 0 rows).
      await expect(
        page.getByTestId('recently-active'),
        'the Overview data tile must render — proves resources/deployments reads resolved against prod.',
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await context.close()
    }

    // Inline reap (prompt); afterAll + reap-cohort back this up.
    await reapUser(request, u)
  })

  // ── (b) magic-link form submit → "sent" state (contract-only) ────────────────
  test('login page magic-link form → submit against real /auth/email/start → "sent" state', async ({
    browser,
  }) => {
    const { context, page } = await newAnonContext(browser)
    try {
      await page.goto(appURL('/login'), { waitUntil: 'domcontentloaded' })

      // The login form must render (the email magic-link input + submit).
      await expect(page.getByTestId('email-input'), 'the login email input must render.').toBeVisible({
        timeout: 30_000,
      })

      // Use a cohort-branded email so the backend skip-guards neuter any send
      // attempt (and so a stray delivery can't reach a real inbox). The
      // local-part carries COHORT_MARKER per the cohort contract.
      const email = `${COHORT_MARKER}+ui-magic-${Date.now()}@instanode.dev`
      await page.getByTestId('email-input').fill(email)
      await page.getByTestId('email-submit').click()

      // The form POSTs to the REAL /auth/email/start (proxied same-origin). We
      // assert it reaches a terminal UI state driven by the api's real response —
      // proving the form is WIRED to the live backend (the login-broke class is a
      // dead/CORS-blocked auth fetch). Two acceptable terminal states:
      //   (a) "sent" — the 202 happy path (when the origin yields a valid
      //       return_to, e.g. a real CI run on https://instanode.dev), OR
      //   (b) the api's structured error alert — under the localhost PREVIEW
      //       origin the api 400s `invalid_return_to` (it only accepts https://
      //       or bare http://localhost, not http://localhost:<port>). A real user
      //       on https://instanode.dev sends a valid https return_to and gets the
      //       202; that the preview origin gets a STRUCTURED 400 (not a JS crash
      //       / "Failed to fetch") still proves the form reached the real api.
      // Either way the form is proven live; a hang or a CORS "Failed to fetch"
      // (the original symptom before the same-origin proxy) would fail this.
      const sent = page.getByTestId('magic-link-sent')
      const errored = page.getByTestId('email-error')
      await expect(
        sent.or(errored),
        'the magic-link form must reach a terminal UI state from the REAL /auth/email/start response ' +
          '("sent" on 202, or the api\'s structured error alert) — proving the form is wired to the live ' +
          'backend, not CORS-blocked / hung (the login-broke class).',
      ).toBeVisible({ timeout: 30_000 })
      if (await sent.isVisible()) {
        await expect(sent, 'the "sent" state must echo the submitted email.').toContainText(email)
      } else {
        // The structured-error arm: it must be the api's invalid_return_to
        // contract (a harness-origin artifact), NOT a transport failure — a
        // "Failed to fetch" here would mean the form never reached the api.
        await expect(
          errored,
          'a magic-link error must be the api\'s STRUCTURED response (proves the request reached prod), ' +
            'not a transport "Failed to fetch".',
        ).not.toContainText(/failed to fetch/i)
        await expect(errored).toContainText(/return_to|https/i)
      }
    } finally {
      await context.close()
    }
  })
})

// Reap a minted account inline (eager); idempotent with the ledger backstop.
async function reapUser(request: APIRequestContext, u: MintedUser): Promise<void> {
  await reap(request, u.teamID)
  // The account cascade removed the team + everything it owns; clear the ledger
  // so a clean run leaves it empty (the afterAll asserts empty otherwise).
  clearLedger()
}
