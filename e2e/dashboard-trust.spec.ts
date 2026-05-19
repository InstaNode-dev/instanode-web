/* dashboard-trust.spec.ts — Chrome-MCP suites S4 (Dashboard) + S8 (BugBash
 * regression), automated.
 *
 * Covers the user-facing trust surfaces a dashboard change must not
 * silently break:
 *   - the dashboard renders for an authenticated user (S4.1);
 *   - the deployment count agrees between the Overview tile and the
 *     Billing usage panel — the S5-F4 "0 deployments vs 1/1" drift;
 *   - the 429 rate-limit path renders a human "retry in Ns" hint instead
 *     of a bare error (S4.8 / S8.9, the BugBash PR #97/#98 fix);
 *   - empty states render a friendly message, not a blank page (S4.7).
 *
 * Hermetic: every route is page.route()-mocked. Nothing is created on any
 * backend; no teardown required.
 */

import { expect, test, type Route } from '@playwright/test'
import {
  FAKE_TEAM,
  FAKE_USER,
  installAPIFake,
  installBillingAPIFake,
  signIn,
} from './fixtures'

// One running deployment — both the Overview tile (GET /api/v1/deployments)
// and the Billing usage panel (GET /api/v1/billing/usage → deployments
// count = 1, seeded in installBillingAPIFake) must agree on this number.
const ONE_DEPLOYMENT = {
  ok: true,
  total: 1,
  items: [
    {
      id: 'dep_1',
      name: 'agent-app',
      status: 'running',
      env: 'production',
      url: 'https://agent-app.deployment.instanode.dev',
      created_at: '2026-05-18T00:00:00Z',
      team_id: FAKE_TEAM,
    },
  ],
}

test.describe('Dashboard render + trust surfaces (S4)', () => {
  test('S4.1 — authenticated user lands on the Overview, no blank page', async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    await page.goto('/app')
    await expect(page.getByRole('heading', { level: 1, name: /Overview/ })).toBeVisible()
  })

  test('S5-F4 — deployment count agrees between Overview tile and Billing panel', async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    await installBillingAPIFake(page)
    // Both surfaces source deployments from GET /api/v1/deployments-derived
    // data; seed one running deployment so each must show "1".
    await page.route(/\/api\/v1\/deployments(\?[^/]*)?$/, (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ONE_DEPLOYMENT),
      })
    })

    // Overview tile.
    await page.goto('/app')
    const deployStat = page.locator('.stat', { has: page.locator('.k', { hasText: /^deployments$/ }) })
    await expect(deployStat.locator('.v')).toHaveText('1')

    // Billing usage panel — the deployments UsageRow. installBillingAPIFake
    // seeds /billing/usage with deployments.count = 1; both must agree.
    await page.goto('/app/billing')
    const deployRow = page.locator('.usage-row', { has: page.locator('.k', { hasText: /^deployments$/ }) })
    await expect(deployRow.locator('.num')).toContainText('1 /')
  })

  test('S4.8 / S8.9 — a 429 renders the "retry in Ns" hint, not a hard error', async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    // The TeamPage 429 banner is the user-facing retry-hint surface
    // (src/pages/TeamPage.tsx). listMembers() falls back to /auth/me on a
    // non-401 failure, so to actually surface the rate-limit banner we must
    // 429 BOTH /team/members and the /auth/me fallback. The 30-second
    // Retry-After header drives the human countdown copy.
    const fulfil429 = (route: Route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Retry-After': '30' },
        body: JSON.stringify({ ok: false, error: 'rate_limited', message: 'Too many requests.' }),
      })
    await page.route('**/api/v1/team/members', fulfil429)
    // /auth/me must succeed for AuthGate to mount the page, then 429 on the
    // members fetch fallback. We let the FIRST /auth/me through (AuthGate)
    // and 429 the members route — listMembers' fallback re-calls fetchMe,
    // which we keep succeeding, so the fallback path would mask the 429.
    // To force the banner, 429 /team/members AND make the fallback fetchMe
    // also 429 by counting calls.
    let meCalls = 0
    await page.route('**/auth/me', (route: Route) => {
      meCalls += 1
      // First call: AuthGate boot — succeed. Subsequent calls: the
      // listMembers() catch-path fallback — 429 so the rate-limit banner
      // wins instead of the single-owner fallback row.
      if (meCalls === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            user_id: FAKE_USER,
            team_id: FAKE_TEAM,
            email: 'aanya@example.com',
            tier: 'hobby',
          }),
        })
      }
      return fulfil429(route)
    })

    await page.goto('/app/team')
    const banner = page.getByRole('alert')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(/rate-limited/i)
    // The human retry hint — "retry in 30 seconds" — not a bare error code.
    await expect(banner).toContainText(/retry in 30 second/i)
  })

  test('S4.7 — empty resources list renders a friendly empty state', async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    // Override /resources with an empty list AFTER installAPIFake so this
    // route wins (Playwright matches most-recent-first).
    await page.route(/\/api\/v1\/resources(\?[^/]*)?$/, (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: [], total: 0 }),
      })
    })
    await page.route(/\/api\/v1\/deployments(\?[^/]*)?$/, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: [], total: 0 }),
      }),
    )
    await page.goto('/app')
    // The "recently active" table renders its empty-state row, not a crash.
    await expect(page.getByTestId('recently-active-empty')).toBeVisible()
  })
})
