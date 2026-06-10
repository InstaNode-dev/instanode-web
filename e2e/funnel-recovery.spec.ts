/* funnel-recovery.spec.ts — mocked-contract Playwright gate for the
 * auth/claim funnel-recovery surfaces shipped 2026-06-10:
 *
 *   F4 — the magic-link "we sent a link" state is no longer a silent
 *        dead-end: it offers a Resend affordance + a GitHub-OAuth fallback
 *        (email delivery is 100%-failing while the Brevo sender is
 *        unvalidated, so this is the only path off the screen).
 *   F6 — the /claim dead-ends (tokenless "Missing claim link" + invalid/
 *        expired token) surface GitHub OAuth as a primary recovery CTA.
 *   D2 — the CLI device-flow: /login?cli_session=<id> forwards the id
 *        through the OAuth/magic-link return_to so LoginCallbackPage can
 *        POST /auth/cli/{id}/complete after sign-in.
 *
 * Runs under the DEFAULT mocked config (playwright.config.ts → VITE_NO_PROXY=1,
 * same-origin), so every page.route() glob below intercepts the SPA's fetch and
 * no upstream api is contacted. This is the browser-rendered, real-src/api layer
 * that complements the vitest component tests (which stub the api module).
 */

import { expect, test, type Page, type Route } from '@playwright/test'

// ─── Constants ───────────────────────────────────────────────────────────────
const EMAIL_START_PATH = '**/auth/email/start'
const AUTH_ME_PATH = '**/auth/me'
const CLI_COMPLETE_PATH = /\/auth\/cli\/[^/]+\/complete$/
const TEST_EMAIL = 'founder@acme.dev'
const CLI_SESSION_ID = 'cli_sess_abc123'
const SESSION_TOKEN = 'sess_jwt_callback'

/** Mock POST /auth/email/start → 202 (the api returns 202 regardless of
 *  whether the email exists). Captures the request body so the test can assert
 *  the return_to carries the cli_session when present. */
async function mockEmailStart(page: Page, captured: { body?: any; count: number }) {
  await page.route(EMAIL_START_PATH, (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    captured.count += 1
    captured.body = JSON.parse(route.request().postData() ?? '{}')
    return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' })
  })
}

/** Mock GET /auth/me → 200 so the callback page's post-token verification
 *  succeeds and it proceeds to navigation. The tier is EXPLICIT because the
 *  COMMERCE-FIRST REDIRECT (2026-06-10) routes the post-auth landing by it:
 *  free → /pricing, paid+eligible → /app/billing, team → /app. */
async function mockAuthMe(page: Page, tier: string) {
  await page.route(AUTH_ME_PATH, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user_id: 'u1', team_id: 't1', email: TEST_EMAIL, tier }),
    }),
  )
}

// ─── F4: magic-link sent state is not a dead-end ─────────────────────────────

test.describe('F4 — magic-link recovery affordances', () => {
  async function reachSentState(page: Page) {
    await page.getByTestId('email-input').fill(TEST_EMAIL)
    await page.getByTestId('email-submit').click()
    await expect(page.getByTestId('magic-link-sent')).toBeVisible()
  }

  test('the sent state renders Resend + GitHub-fallback controls', async ({ page }) => {
    const cap = { count: 0 } as { body?: any; count: number }
    await mockEmailStart(page, cap)
    await page.goto('/login')
    await reachSentState(page)
    await expect(page.getByTestId('magic-link-resend')).toBeVisible()
    await expect(page.getByTestId('magic-link-github-fallback')).toBeVisible()
  })

  test('Resend re-fires POST /auth/email/start', async ({ page }) => {
    const cap = { count: 0 } as { body?: any; count: number }
    await mockEmailStart(page, cap)
    await page.goto('/login')
    await reachSentState(page)
    expect(cap.count).toBe(1)
    await page.getByTestId('magic-link-resend').click()
    await expect.poll(() => cap.count).toBe(2)
  })

  test('the GitHub fallback navigates to the OAuth start handler', async ({ page }) => {
    const cap = { count: 0 } as { body?: any; count: number }
    await mockEmailStart(page, cap)
    // The github/start redirect leaves the SPA — intercept it so the test
    // doesn't navigate to the real api. Asserting the URL we were sent to.
    await page.route('**/auth/github/start*', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html>oauth start</html>' }),
    )
    await page.goto('/login')
    await reachSentState(page)
    await Promise.all([
      page.waitForURL(/\/auth\/github\/start\?return_to=/),
      page.getByTestId('magic-link-github-fallback').click(),
    ])
  })
})

// ─── F6: claim dead-ends surface GitHub OAuth ────────────────────────────────

test.describe('F6 — claim funnel recovery via GitHub OAuth', () => {
  test('the tokenless "Missing claim link" state surfaces a GitHub CTA', async ({ page }) => {
    await page.goto('/claim')
    await expect(page.getByText(/missing claim link/i)).toBeVisible()
    await expect(page.getByTestId('claim-github-oauth')).toBeVisible()
  })

  test('the invalid/expired-link state surfaces a GitHub CTA', async ({ page }) => {
    await page.goto('/claim?t=not-a-valid-jwt-blob')
    await expect(page.getByTestId('claim-invalid')).toBeVisible()
    await expect(page.getByTestId('claim-github-oauth')).toBeVisible()
  })

  test('the GitHub CTA navigates to the OAuth start handler', async ({ page }) => {
    await page.route('**/auth/github/start*', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html>oauth start</html>' }),
    )
    await page.goto('/claim')
    await Promise.all([
      page.waitForURL(/\/auth\/github\/start\?return_to=/),
      page.getByTestId('claim-github-oauth').click(),
    ])
  })
})

// ─── D2: CLI device-flow — cli_session preserved + completed ─────────────────

test.describe('D2 — CLI device-flow completion', () => {
  test('LoginPage forwards cli_session into the magic-link return_to', async ({ page }) => {
    const cap = { count: 0 } as { body?: any; count: number }
    await mockEmailStart(page, cap)
    await page.goto(`/login?cli_session=${CLI_SESSION_ID}`)
    await page.getByTestId('email-input').fill(TEST_EMAIL)
    await page.getByTestId('email-submit').click()
    await expect(page.getByTestId('magic-link-sent')).toBeVisible()
    // The return_to the SPA sent the api must carry the cli_session so the
    // post-auth callback can complete the device flow.
    expect(cap.body?.return_to).toContain(`/login/callback?cli_session=${CLI_SESSION_ID}`)
  })

  // The post-completion landing follows the COMMERCE-FIRST REDIRECT
  // (2026-06-10, memory project_commerce_first_redirect_at_interactions):
  // the CLI got its token via POST /auth/cli/{id}/complete, so the browser
  // tab is a scarce free interaction — a free-tier user is pushed to
  // /pricing (NOT /app). The cli_session is not a deep-link; only an
  // explicit ?next= / saved return_to overrides the tier rule.

  test('the callback POSTs /auth/cli/{id}/complete then lands a free user on /pricing', async ({ page }) => {
    await mockAuthMe(page, 'free')
    const completeCap = { id: '', count: 0 }
    await page.route(CLI_COMPLETE_PATH, (route: Route) => {
      completeCap.count += 1
      // Pull the session id out of the path: /auth/cli/<id>/complete
      const m = new URL(route.request().url()).pathname.match(/\/auth\/cli\/([^/]+)\/complete$/)
      completeCap.id = m ? decodeURIComponent(m[1]) : ''
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    // The callback uses the legacy ?session_token path (no cookie exchange
    // needed for the mock) + ?cli_session to trigger completion.
    await page.goto(`/login/callback?session_token=${SESSION_TOKEN}&cli_session=${CLI_SESSION_ID}`)
    // free tier → commerce-first push to /pricing after the device flow
    // completes; the CLI itself is already unblocked by the POST below.
    await expect(page).toHaveURL(/\/pricing$/)
    expect(completeCap.count).toBe(1)
    expect(completeCap.id).toBe(CLI_SESSION_ID)
  })

  test('a cli-completion failure does NOT block the user sign-in (still lands post-auth)', async ({ page }) => {
    await mockAuthMe(page, 'free')
    await page.route(CLI_COMPLETE_PATH, (route: Route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'session_not_found' }) }),
    )
    await page.goto(`/login/callback?session_token=${SESSION_TOKEN}&cli_session=${CLI_SESSION_ID}`)
    // completeCliSession swallows the error; the browser user must still
    // reach the signed-in landing (free tier → /pricing, commerce-first).
    await expect(page).toHaveURL(/\/pricing$/)
  })

  test('no cli_session → the callback never calls /auth/cli/.../complete', async ({ page }) => {
    await mockAuthMe(page, 'free')
    let completeCalled = false
    await page.route(CLI_COMPLETE_PATH, (route: Route) => {
      completeCalled = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.goto(`/login/callback?session_token=${SESSION_TOKEN}`)
    // free tier → /pricing (commerce-first post-auth landing).
    await expect(page).toHaveURL(/\/pricing$/)
    expect(completeCalled).toBe(false)
  })

  // D2-authed: an ALREADY-signed-in user who runs `instant login` lands on
  // /login?cli_session=<id> with a live token in localStorage. They never take
  // the OAuth/magic-link callback path, so LoginPage itself must POST
  // /auth/cli/{id}/complete on mount and show a terminal-return confirmation
  // instead of the sign-in form.
  const TOKEN_LS_KEY = 'instanode.token'

  test('already-authed: LoginPage completes the CLI session and confirms', async ({ page }) => {
    const completeCap = { id: '', count: 0 }
    await page.route(CLI_COMPLETE_PATH, (route: Route) => {
      completeCap.count += 1
      const m = new URL(route.request().url()).pathname.match(/\/auth\/cli\/([^/]+)\/complete$/)
      completeCap.id = m ? decodeURIComponent(m[1]) : ''
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    // Seed a live session token BEFORE the app bundle runs so getToken() returns it.
    await page.addInitScript(([k, v]) => {
      try { localStorage.setItem(k, v) } catch {}
    }, [TOKEN_LS_KEY, 'ink_live_session'] as const)

    await page.goto(`/login?cli_session=${CLI_SESSION_ID}`)
    await expect(page.getByTestId('cli-approved-ok')).toBeVisible()
    await expect(page.getByTestId('cli-approved-ok')).toContainText('return to your terminal')
    // The sign-in form must NOT render — the user came from a terminal.
    await expect(page.getByTestId('oauth-github')).toHaveCount(0)
    await expect.poll(() => completeCap.count).toBe(1)
    expect(completeCap.id).toBe(CLI_SESSION_ID)
  })

  test('already-authed: a completion failure shows the non-blocking failure note', async ({ page }) => {
    await page.route(CLI_COMPLETE_PATH, (route: Route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'session_not_found' }) }),
    )
    await page.addInitScript(([k, v]) => {
      try { localStorage.setItem(k, v) } catch {}
    }, [TOKEN_LS_KEY, 'ink_live_session'] as const)

    await page.goto(`/login?cli_session=${CLI_SESSION_ID}`)
    await expect(page.getByTestId('cli-approved-failed')).toBeVisible()
    await expect(page.getByTestId('cli-approved-failed')).toContainText('instant login')
  })
})

// ─── account_exists claim recovery — login CTA on the 409 dead-end ───────────

test.describe('account_exists claim recovery via login CTA', () => {
  const CLAIM_PATH = '**/claim'

  function buildClaimJWT(rt: string[] = ['postgres'], tok: string[] = ['abc12345xyz']): string {
    const b64url = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const header = b64url({ alg: 'HS256', typ: 'JWT' })
    const payload = b64url({ rt, tok, exp: Math.floor(Date.now() / 1000) + 3600 })
    return `${header}.${payload}.sig`
  }

  test('account_exists (409) renders a "Log in to claim" CTA carrying the token through next=', async ({ page }) => {
    const jwt = buildClaimJWT()
    await page.route(CLAIM_PATH, (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'account_exists', message: 'An account already exists for this email. Sign in instead.' }),
      })
    })
    await page.goto(`/claim?t=${jwt}`)
    await page.getByTestId('claim-email').fill('taken@acme.dev')
    await page.getByTestId('claim-submit').click()
    const cta = page.getByTestId('claim-account-exists-login')
    await expect(cta).toBeVisible()
    const href = await cta.getAttribute('href')
    expect(href).toContain('/login?next=')
    expect(decodeURIComponent(href ?? '')).toContain(`/claim?t=${jwt}`)
    // The claim is still refused — no funnel mounted.
    await expect(page.getByTestId('claim-funnel')).toHaveCount(0)
  })
})
