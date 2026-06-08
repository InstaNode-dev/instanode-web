/* claim-conversion.spec.ts — mocked-contract Playwright gate for the ClaimPage
 * conversion journey (the anonymous→claimed→checkout money path), driven through
 * the REAL SPA route + REAL api client (src/api) with the network mocked at the
 * page.route() boundary.
 *
 * ── Why this exists alongside the tests we already have ───────────────────────
 * Three layers cover the claim flow today; this spec fills the one gap between
 * them, and is deliberately scoped NOT to duplicate any of them:
 *
 *   1. src/pages/ClaimPage.test.tsx (vitest + Testing Library) — mocks the
 *      `../api` MODULE wholesale (claim/createCheckout/listResources are vi.fn()).
 *      It proves the component's state machine, but the real fetch wiring (URL
 *      shape, method, request body, the response→error mapping in api/index.ts
 *      call()) is stubbed out. A rename of the /claim path or the checkout body
 *      contract would NOT red that test.
 *
 *   2. e2e/live-claim-deploy.spec.ts (Playwright, LIVE cohort) — drives the REAL
 *      api via the `request` fixture (api-direct: POST /claim, GET
 *      /api/v1/resources). It never renders ClaimPage in a browser; it mints real
 *      resources and only runs on the scheduled/on-demand live suite.
 *
 *   3. e2e/auth-roundtrip.spec.ts — the magic-link cookie-exchange seam, not the
 *      claim conversion UI.
 *
 * THE GAP THIS SPEC CLOSES: the full ClaimPage conversion journey rendered in a
 * REAL browser against the REAL src/api client, with the network mocked — so it
 * runs on EVERY web PR (mocked playwright.config.ts, VITE_NO_PROXY=1, no minted
 * resources) and reds the PR if the SPA→api wiring breaks: the email→/claim POST
 * body, the post-claim PAT mint + resource fetch, the checkout POST + redirect,
 * AND the user-visible error states (409 already_claimed, account_exists, empty
 * email). This is the layer between "component logic with a stubbed module"
 * (layer 1) and "real backend, no UI" (layer 2).
 *
 * ── Mode ──────────────────────────────────────────────────────────────────────
 * Runs under the DEFAULT mocked config (playwright.config.ts), which boots the
 * Vite dev server with VITE_NO_PROXY=1. In dev mode getAPIBaseURL() returns ''
 * (same-origin), so every api call is http://localhost:5173/<path> and the
 * page.route() globs below intercept them. No upstream api is contacted.
 */

import { expect, test, type Page, type Route } from '@playwright/test'

// ─── Constants (named, not scattered literals) ───────────────────────────────

const CLAIM_PATH = '**/claim'
const RESOURCES_PATH = /\/api\/v1\/resources(\?[^/]*)?$/
const API_KEYS_PATH = '**/api/v1/auth/api-keys'
const CHECKOUT_PATH = '**/api/v1/billing/checkout'

const CLAIM_EMAIL = 'founder@example.com'
const HOBBY_SHORT_URL = 'https://rzp.io/i/claim-hobby'
const PRO_SHORT_URL = 'https://rzp.io/i/claim-pro'
const SESSION_TOKEN = 'sess_jwt_from_claim'
const PAT_KEY = 'ink_dashboard_session_pat'

// Error-state contract (mirrors api/internal/handlers/onboarding.go + the api
// client's call() error mapping: code = body.error, message = body.message).
const STATUS_CONFLICT = 409
const STATUS_BAD_REQUEST = 400
const ERR_ALREADY_CLAIMED = 'already_claimed'
const ERR_ACCOUNT_EXISTS = 'account_exists'
const MSG_ALREADY_CLAIMED = 'This claim link has already been used.'
const MSG_ACCOUNT_EXISTS = 'An account already exists for this email. Sign in instead.'

// Resource expiry used to drive the post-claim countdown banner. ~23h so the
// HH:MM:SS banner renders a real (non-placeholder) value.
const EXPIRES_IN_MS = 23 * 60 * 60 * 1000

// ─── JWT minting (client-side preview is built by decoding ?t=, no network) ──
//
// ClaimPage.tsx decodeJWT() reads the `rt` (resource types) + `tok` arrays from
// the JWT payload to render the preview list — it never verifies the signature
// and never calls /claim/preview (that endpoint is exercised api-direct in
// live-writes.spec.ts). So a structurally-valid base64url JWT with the right
// payload is all we need; mirrors ClaimPage.test.tsx buildClaimJWT().
function buildClaimJWT(
  rt: string[] = ['postgres', 'redis'],
  tok: string[] = ['abc12345xyz', 'def67890uvw'],
): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({ rt, tok, exp: Math.floor(Date.now() / 1000) + 3600 })
  return `${header}.${payload}.sig`
}

// ─── Network mocks ───────────────────────────────────────────────────────────

/** A successful POST /claim → session minted. Captures the request body so the
 *  test can assert the {jwt,email} contract the SPA actually sends. */
async function mockClaimSuccess(page: Page, captured: { body?: any }) {
  await page.route(CLAIM_PATH, (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    captured.body = JSON.parse(route.request().postData() ?? '{}')
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        team_id: 'team_claimed_1',
        user_id: 'user_claimed_1',
        session_token: SESSION_TOKEN,
      }),
    })
  })
}

/** A failing POST /claim with a specific error contract (409 already_claimed,
 *  400 account_exists, …). */
async function mockClaimError(page: Page, status: number, error: string, message: string) {
  await page.route(CLAIM_PATH, (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error, message }),
    })
  })
}

/** POST /api/v1/auth/api-keys — the post-claim PAT mint (best-effort in the
 *  page; we return a real key so the happy path exercises the success branch). */
async function mockAPIKeyMint(page: Page) {
  await page.route(API_KEYS_PATH, (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        id: 'pat_1',
        name: 'dashboard-session',
        scopes: ['read', 'write'],
        created_at: new Date().toISOString(),
        last_used_at: null,
        revoked: false,
        key: PAT_KEY,
        note: 'Save this key now — it will not be shown again.',
      }),
    })
  })
}

/** GET /api/v1/resources — drives the post-claim countdown banner. Two TTL
 *  resources, soonest ~23h out. */
async function mockResources(page: Page) {
  await page.route(RESOURCES_PATH, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        total: 2,
        items: [
          {
            id: 'res_pg',
            token: 'tok_pg',
            resource_type: 'postgres',
            tier: 'anonymous',
            status: 'active',
            name: null,
            env: 'production',
            storage_bytes: 0,
            storage_limit_bytes: 1024 * 1024 * 10,
            storage_exceeded: false,
            expires_at: new Date(Date.now() + EXPIRES_IN_MS).toISOString(),
            created_at: new Date().toISOString(),
          },
          {
            id: 'res_redis',
            token: 'tok_redis',
            resource_type: 'redis',
            tier: 'anonymous',
            status: 'active',
            name: null,
            env: 'production',
            storage_bytes: 0,
            storage_limit_bytes: 1024 * 1024 * 5,
            storage_exceeded: false,
            expires_at: new Date(Date.now() + EXPIRES_IN_MS + 60_000).toISOString(),
            created_at: new Date().toISOString(),
          },
        ],
      }),
    })
  })
}

/** POST /api/v1/billing/checkout → a Razorpay short_url. Captures the plan so
 *  the test asserts the Hobby vs Pro CTA wiring. */
async function mockCheckout(page: Page, shortURL: string, captured: { plan?: string }) {
  await page.route(CHECKOUT_PATH, (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    captured.plan = JSON.parse(route.request().postData() ?? '{}').plan
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, short_url: shortURL }),
    })
  })
}

/** Wire the full happy-path backend (claim + PAT + resources). */
async function mockHappyBackend(page: Page, captured: { body?: any }) {
  await mockResources(page)
  await mockAPIKeyMint(page)
  await mockClaimSuccess(page, captured)
}

async function gotoClaim(page: Page, jwt: string = buildClaimJWT()) {
  await page.goto(`/claim?t=${encodeURIComponent(jwt)}`)
}

async function submitEmail(page: Page, email: string = CLAIM_EMAIL) {
  await page.getByTestId('claim-email').fill(email)
  await page.getByTestId('claim-submit').click()
}

// ─── Pre-claim: token preview rendered from the JWT (no network) ─────────────

test.describe('ClaimPage conversion (mocked contract) — preview + email entry', () => {
  test('renders the preview list of resources parsed from the upgrade token', async ({ page }) => {
    await gotoClaim(page, buildClaimJWT(['postgres', 'redis', 'mongodb']))
    const preview = page.getByTestId('claim-preview')
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('postgres')
    await expect(preview).toContainText('redis')
    await expect(preview).toContainText('mongodb')
    // The email form is the entry point of the conversion.
    await expect(page.getByTestId('claim-email')).toBeVisible()
    await expect(page.getByTestId('claim-submit')).toBeVisible()
  })

  test('a malformed token surfaces the invalid-link state with a pricing CTA', async ({ page }) => {
    await page.goto('/claim?t=not-a-valid-jwt-blob')
    await expect(page.getByTestId('claim-invalid')).toBeVisible()
    await expect(page.getByTestId('claim-invalid')).toContainText(/invalid or expired/i)
    const pricing = page.getByTestId('claim-invalid-pricing')
    await expect(pricing).toHaveAttribute('href', '/pricing')
    // No email form on the dead-end state.
    await expect(page.getByTestId('claim-email')).toHaveCount(0)
  })

  test('empty email is rejected client-side without firing POST /claim', async ({ page }) => {
    let claimFired = false
    await page.route(CLAIM_PATH, (route: Route) => {
      claimFired = true
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
    })
    await gotoClaim(page)
    await page.getByTestId('claim-submit').click()
    await expect(page.getByTestId('claim-error')).toContainText(/email is required/i)
    expect(claimFired).toBe(false)
  })
})

// ─── The conversion: email → /claim → funnel → checkout ──────────────────────

test.describe('ClaimPage conversion (mocked contract) — claim → checkout journey', () => {
  test('email submit POSTs {jwt,email} to /claim and lands on the payment funnel', async ({
    page,
  }) => {
    const captured: { body?: any } = {}
    await mockHappyBackend(page, captured)
    await gotoClaim(page)
    await submitEmail(page)

    // Funnel mounts — the conversion's success navigation (no dashboard redirect:
    // pay-from-day-one funnels to checkout before the resources are permanent).
    await expect(page.getByTestId('claim-funnel')).toBeVisible()
    await expect(page.getByTestId('claim-checkout-hobby')).toBeVisible()
    await expect(page.getByTestId('claim-checkout-pro')).toBeVisible()

    // The SPA→api request body contract: {jwt, email}. This is what the unit
    // test cannot assert (it stubs the module), and what a /claim rename or a
    // body-field rename would break.
    expect(captured.body?.email).toBe(CLAIM_EMAIL)
    expect(typeof captured.body?.jwt).toBe('string')
    expect((captured.body?.jwt as string).length).toBeGreaterThan(0)
  })

  test('post-claim countdown banner renders a live HH:MM:SS from the resource TTL', async ({
    page,
  }) => {
    const captured: { body?: any } = {}
    await mockHappyBackend(page, captured)
    await gotoClaim(page)
    await submitEmail(page)
    await expect(page.getByTestId('claim-funnel')).toBeVisible()
    // Soonest expiry ~23h → HH:MM:SS in the 22–23h band. Poll: the value is set
    // by a useEffect tick that fires after the funnel paints.
    await expect
      .poll(async () => (await page.getByTestId('claim-countdown-value').textContent()) ?? '', {
        timeout: 5000,
      })
      .toMatch(/^2[23]:\d{2}:\d{2}$/)
  })

  test('Hobby CTA calls checkout with plan="hobby" and redirects to the short_url', async ({
    page,
  }) => {
    const claimCap: { body?: any } = {}
    const checkoutCap: { plan?: string } = {}
    await mockHappyBackend(page, claimCap)
    await mockCheckout(page, HOBBY_SHORT_URL, checkoutCap)
    await gotoClaim(page)
    await submitEmail(page)
    await expect(page.getByTestId('claim-checkout-hobby')).toBeVisible()

    // The page sets window.location.href to the short_url — assert the
    // navigation contract via waitForURL rather than racing the redirect.
    await Promise.all([
      page.waitForURL(HOBBY_SHORT_URL),
      page.getByTestId('claim-checkout-hobby').click(),
    ])
    expect(checkoutCap.plan).toBe('hobby')
  })

  test('Pro CTA calls checkout with plan="pro" and redirects to the short_url', async ({
    page,
  }) => {
    const claimCap: { body?: any } = {}
    const checkoutCap: { plan?: string } = {}
    await mockHappyBackend(page, claimCap)
    await mockCheckout(page, PRO_SHORT_URL, checkoutCap)
    await gotoClaim(page)
    await submitEmail(page)
    await expect(page.getByTestId('claim-checkout-pro')).toBeVisible()

    await Promise.all([
      page.waitForURL(PRO_SHORT_URL),
      page.getByTestId('claim-checkout-pro').click(),
    ])
    expect(checkoutCap.plan).toBe('pro')
  })

  test('a checkout failure surfaces inline and keeps the user on the funnel (no redirect)', async ({
    page,
  }) => {
    const claimCap: { body?: any } = {}
    await mockHappyBackend(page, claimCap)
    await page.route(CHECKOUT_PATH, (route: Route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'razorpay_error', message: 'upstream timeout' }),
      }),
    )
    await gotoClaim(page)
    await submitEmail(page)
    await page.getByTestId('claim-checkout-hobby').click()
    await expect(page.getByTestId('claim-checkout-error')).toBeVisible()
    await expect(page.getByTestId('claim-checkout-error')).toContainText('upstream timeout')
    // Still on /claim, funnel still mounted, CTA re-enabled for retry.
    await expect(page).toHaveURL(/\/claim/)
    await expect(page.getByTestId('claim-checkout-hobby')).toBeEnabled()
  })
})

// ─── Error states: the contract the api emits on a failed claim ──────────────

test.describe('ClaimPage conversion (mocked contract) — claim error states', () => {
  test('409 already_claimed keeps the user on the email screen with the error', async ({
    page,
  }) => {
    await mockClaimError(page, STATUS_CONFLICT, ERR_ALREADY_CLAIMED, MSG_ALREADY_CLAIMED)
    await gotoClaim(page)
    await submitEmail(page)
    await expect(page.getByTestId('claim-error')).toBeVisible()
    await expect(page.getByTestId('claim-error')).toContainText(MSG_ALREADY_CLAIMED)
    // The funnel must NOT mount on a failed claim — no session was minted.
    await expect(page.getByTestId('claim-funnel')).toHaveCount(0)
  })

  test('account_exists (email already registered) surfaces the error, no funnel', async ({
    page,
  }) => {
    await mockClaimError(page, STATUS_BAD_REQUEST, ERR_ACCOUNT_EXISTS, MSG_ACCOUNT_EXISTS)
    await gotoClaim(page)
    await submitEmail(page, 'taken@example.com')
    await expect(page.getByTestId('claim-error')).toBeVisible()
    await expect(page.getByTestId('claim-error')).toContainText(MSG_ACCOUNT_EXISTS)
    await expect(page.getByTestId('claim-funnel')).toHaveCount(0)
  })
})
