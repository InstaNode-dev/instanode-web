/* auth-guards.spec.ts — Chrome-MCP suite S2 (Authentication), automated.
 *
 * auth.spec.ts already covers login render / 401 reject / valid token /
 * OAuth button / signed-in landing. This spec extends S2 to the parts a
 * dashboard change is most likely to break silently:
 *   - EVERY gated /app/* route bounces an unauthenticated visitor to
 *     /login (a new route added without AuthGate is the classic leak);
 *   - the deep-linked checkout intent survives the login bounce — the
 *     user lands back at /app/checkout?plan=pro, not a generic dashboard
 *     (the funnel-drop the Chrome-MCP S1-F3 finding flagged).
 *
 * Hermetic: page.route()-mocked. Creates nothing; no teardown.
 */

import { expect, test } from '@playwright/test'
import { installAPIFake } from './fixtures'

// Every authenticated surface. A route added to App.tsx without AuthGate
// would let an unauthenticated visitor through — this list is the guard.
const GATED_ROUTES = [
  '/app',
  '/app/resources',
  '/app/deployments',
  '/app/vault',
  '/app/team',
  '/app/billing',
  '/app/settings',
  '/app/checkout?plan=pro&frequency=monthly',
  '/app/admin/customers',
]

test.describe('Auth guards — gated routes (S2.6)', () => {
  for (const route of GATED_ROUTES) {
    test(`unauthenticated visit to ${route} redirects to /login`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login(\?.*)?$/)
      await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible()
    })
  }
})

test.describe('Checkout intent survives the login bounce (S1.4 / S5)', () => {
  test('deep-linked /app/checkout?plan=pro returns there after login', async ({ page }) => {
    await installAPIFake(page)
    // An unauthenticated user follows a marketing CTA to the Pro checkout.
    await page.goto('/app/checkout?plan=pro&frequency=monthly')
    // AuthGate bounces to /login, carrying the intent in router state.
    await expect(page).toHaveURL(/\/login(\?.*)?$/)

    // Log in with a token. LoginPage reads loc.state.from and navigates
    // back to the original checkout deep link — the funnel is preserved.
    await page.getByTestId('toggle-token-form').click()
    await page.getByTestId('token-input').fill('ink_VALID')
    await page.getByTestId('login-submit').click()

    // Lands back on the checkout page for the Pro plan — NOT a generic
    // /app dashboard. This is the S1-F3 funnel-drop guard.
    await expect(page).toHaveURL(/\/app\/checkout\?plan=pro/)
  })
})
