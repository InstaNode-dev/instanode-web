/* commerce-first-redirect.spec.ts — mocked-contract Playwright gate for the
 * COMMERCE-FIRST REDIRECT (2026-06-10,
 * memory project_commerce_first_redirect_at_interactions).
 *
 * The product rule: a successful login is a scarce interaction, so the
 * post-auth landing routes by plan tier to push commerce —
 *   free                  → /pricing       (drive the first purchase)
 *   paid + upgrade-eligible → /app/billing  (show the next tier)
 *   top tier (team)       → /app            (no upsell — NEVER a Team checkout)
 * — UNLESS the user carried an explicit deep-link (a saved /app/* return_to
 * or a /login?next=), which always wins (and prevents pricing→login→pricing
 * loops).
 *
 * This drives the REAL SPA route (LoginCallbackPage) through the REAL src/api
 * client with the network mocked at the page.route() boundary, so it runs on
 * every web PR (mocked playwright.config.ts, VITE_NO_PROXY=1) and reds the PR
 * if the tier→destination wiring breaks. It complements:
 *   - src/lib/postAuthDestination.test.ts (the pure decision matrix, vitest)
 *   - src/pages/LoginCallbackPage.test.tsx (component, ../api stubbed)
 * by exercising the browser-rendered redirect against the real api client.
 */

import { expect, test, type Page, type Route } from '@playwright/test'

const AUTH_ME_PATH = '**/auth/me'
const SESSION_TOKEN = 'sess_jwt_commerce'

// Catch-all for the dependent dashboard bootstrap fetches that fire once the
// SPA lands on an /app/* route (counts + billing). We don't assert on them —
// we only care WHERE the user was routed — so we stub them to harmless empties
// so the destination page doesn't error mid-render.
const RESOURCES_PATH = /\/api\/v1\/resources(\?[^/]*)?$/
const DEPLOYMENTS_PATH = /\/api\/v1\/deployments(\?[^/]*)?$/
const VAULT_PATH = /\/api\/v1\/vault(\?[^/]*)?$/
const BILLING_PATH = '**/api/v1/billing'

/** Mock GET /auth/me to report the given plan tier. The wire shape is the FLAT
 *  agent payload ({ ok, user_id, team_id, email, tier }); fetchMe() adapts it
 *  into { user: { tier } } which postAuthDestination reads. */
async function mockAuthMe(page: Page, tier: string) {
  await page.route(AUTH_ME_PATH, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user_id: 'u1', team_id: 't1', email: 'founder@acme.dev', tier }),
    }),
  )
}

/** Stub the dashboard bootstrap fetches so an /app/* destination renders. */
async function mockDashboardBootstrap(page: Page) {
  await page.route(RESOURCES_PATH, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], total: 0 }) }),
  )
  await page.route(DEPLOYMENTS_PATH, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], total: 0 }) }),
  )
  await page.route(VAULT_PATH, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, entries: [] }) }),
  )
  await page.route(BILLING_PATH, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, billing: { tier: 'free', subscription_status: 'none' } }) }),
  )
}

test.describe('commerce-first redirect — post-auth landing by tier', () => {
  test('free tier lands on /pricing (drive the first purchase)', async ({ page }) => {
    await mockAuthMe(page, 'free')
    await mockDashboardBootstrap(page)
    await page.goto(`/login/callback?session_token=${SESSION_TOKEN}`)
    await expect(page).toHaveURL(/\/pricing$/)
  })

  test('paid+eligible tier (pro) lands on /app/billing (show the next tier)', async ({ page }) => {
    await mockAuthMe(page, 'pro')
    await mockDashboardBootstrap(page)
    await page.goto(`/login/callback?session_token=${SESSION_TOKEN}`)
    await expect(page).toHaveURL(/\/app\/billing$/)
  })

  test('top tier (team) lands on /app — never a Team checkout', async ({ page }) => {
    await mockAuthMe(page, 'team')
    await mockDashboardBootstrap(page)
    await page.goto(`/login/callback?session_token=${SESSION_TOKEN}`)
    await expect(page).toHaveURL(/\/app\/?$/)
    // Hard guard: a team user must NOT be pushed to a commerce surface.
    await expect(page).not.toHaveURL(/\/pricing$/)
    await expect(page).not.toHaveURL(/\/app\/billing$/)
  })

  test('an explicit /app deep-link (saved return_to) overrides the free-tier pricing push', async ({ page }) => {
    await mockAuthMe(page, 'free')
    await mockDashboardBootstrap(page)
    // Seed the 401-interceptor's saved destination before the callback runs.
    // We use /app/resources (a stable page that just lists the empty resource
    // set we mocked) so the test asserts the deep-link wins without depending
    // on a page that itself redirects (e.g. CheckoutPage auto-fires checkout).
    await page.addInitScript(() => {
      try { localStorage.setItem('instanode.return_to', '/app/resources') } catch {}
    })
    await page.goto(`/login/callback?session_token=${SESSION_TOKEN}`)
    // Deep-link wins — the user lands on the saved destination, NOT /pricing.
    await expect(page).toHaveURL(/\/app\/resources$/)
    await expect(page).not.toHaveURL(/\/pricing$/)
  })
})
