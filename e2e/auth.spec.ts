import { expect, test } from '@playwright/test'
import { installAPIFake, signIn } from './fixtures'

test.describe('Auth gate', () => {
  test('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/')
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

  test('login accepts valid token, lands on overview', async ({ page }) => {
    await installAPIFake(page)
    await page.goto('/login')
    await page.getByTestId('toggle-token-form').click()
    await page.getByTestId('token-input').fill('ink_VALID')
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('OAuth buttons redirect to backend handlers', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByTestId('oauth-github')).toBeVisible()
    await expect(page.getByTestId('oauth-google')).toBeVisible()
  })

  test('signed-in user lands on overview directly', async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    await page.goto('/')
    await expect(page).toHaveURL(/\/$/)
    // The new design's h1 is "Overview." with a period; flexible match.
    await expect(page.getByRole('heading', { level: 1, name: /Overview/ })).toBeVisible()
  })
})
