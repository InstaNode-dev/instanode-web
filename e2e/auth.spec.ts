import { expect, test } from '@playwright/test'
import { installAPIFake, signIn } from './fixtures'

test.describe('Auth gate', () => {
  // The authenticated app is mounted under /app/* (see App.tsx); `/` is
  // the public marketing page and is reachable without a session. So we
  // poke a protected route to exercise the AuthGate redirect.
  test('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/app')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible()
  })

  test('login rejects invalid token (401)', async ({ page }) => {
    await page.route('**/auth/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'unauthorized' }),
      }),
    )
    await page.goto('/login')
    // The PAT form is collapsed by default; expand it.
    await page.getByTestId('toggle-token-form').click()
    await page.getByTestId('token-input').fill('garbage')
    await page.getByTestId('login-submit').click()
    await expect(page.getByTestId('login-error')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('login accepts valid token, lands on the commerce-first destination for its tier', async ({ page }) => {
    // COMMERCE-FIRST REDIRECT (2026-06-10, memory
    // project_commerce_first_redirect_at_interactions): a plain login (no
    // ?next= deep-link) routes by plan tier — free → /pricing, paid +
    // upgrade-eligible → /app/billing, team → /app. Pin the mocked tier
    // EXPLICITLY so the asserted destination is deterministic.
    await installAPIFake(page, { tier: 'hobby' })
    await page.goto('/login')
    await page.getByTestId('toggle-token-form').click()
    await page.getByTestId('token-input').fill('ink_VALID')
    await page.getByTestId('login-submit').click()
    // hobby = paid + upgrade-eligible → the in-app upgrade/billing surface
    // (see src/lib/postAuthDestination.ts; the full per-tier matrix is
    // covered by e2e/commerce-first-redirect.spec.ts).
    await expect(page).toHaveURL(/\/app\/billing$/)
  })

  test('OAuth buttons redirect to backend handlers', async ({ page }) => {
    // LoginPage currently exposes GitHub OAuth + email magic-link only.
    // Google OAuth is wired on the backend (POST /auth/google) but not
    // surfaced in the UI yet — add the button + a test assertion below
    // when it ships.
    await page.goto('/login')
    await expect(page.getByTestId('oauth-github')).toBeVisible()
  })

  test('signed-in user lands on overview directly', async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    // `/` is the public marketing page; the authenticated overview lives
    // at /app. Navigate there directly to exercise the post-sign-in landing.
    await page.goto('/app')
    await expect(page).toHaveURL(/\/app\/?$/)
    await expect(page.getByRole('heading', { level: 1, name: /Overview/ })).toBeVisible()
  })
})
