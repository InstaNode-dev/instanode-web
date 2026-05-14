/* persona-bugs.spec.ts — coverage for the four P3 (Pro founder) persona
 * regressions found on 2026-05-13.
 *
 * Bug 1 — instanode.dev/app returned 404. The SPA shell now ships at
 *         dist/app/index.html so GH Pages serves the entry path with
 *         HTTP 200 and the React Router takes over. We verify the route
 *         loads cleanly in dev (no 404, response is 200, AuthGate is
 *         reachable).
 *
 * Bug 3 — /incidents link from /status was dead. The new IncidentsPage
 *         renders an empty-state ("No active incidents") when the
 *         /api/v1/incidents endpoint is missing.
 */

import { expect, test, type Route } from '@playwright/test'

test.describe('P3 persona bug fixes', () => {
  // Bug 1: /app must not 404.
  test('GET /app responds 200 and mounts the SPA (no 404)', async ({ page }) => {
    // The Vite dev server returns the SPA shell for any route via the
    // middleware mode. A pre-fix regression would either 404 here (in
    // production this surfaced via GH Pages) or render an empty page
    // with no <div id="root"> mount.
    const response = await page.goto('/app')
    expect(response).not.toBeNull()
    // dev server may return 200 directly; in any case the SPA must mount.
    expect(response!.status()).toBeLessThan(400)

    // SPA root mount node must be present (the build pipeline now writes
    // this template to dist/app/index.html, so GH Pages serves it too).
    await expect(page.locator('#root')).toBeAttached()

    // With no auth token, AuthGate redirects to /login — that's fine,
    // it means the SPA booted and reacted to the route. The opposite
    // failure mode (regression) is a static 404 page with no router.
    await page.waitForURL(/\/(login|app).*$/)
  })

  // Bug 3: /incidents must render (empty-state by default).
  test('GET /incidents renders "No active incidents" empty state', async ({ page }) => {
    // The page calls fetchIncidents() → GET /api/v1/incidents on mount.
    // That endpoint doesn't exist on the agent API yet; in MOCKED mode
    // (default in this repo) page.route lets us stub it. We return 404
    // because that's what the live API does today, and the page should
    // tolerate it and render the empty state.
    await page.route('**/api/v1/incidents', (route: Route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'not_found' }),
      }),
    )

    const response = await page.goto('/incidents')
    expect(response).not.toBeNull()
    expect(response!.status()).toBeLessThan(400)

    // The page renders the empty-state — the literal "No active incidents"
    // headline plus a mailto for reporting.
    await expect(page.getByTestId('incidents-empty')).toBeVisible()
    await expect(
      page.getByTestId('incidents-empty').getByText(/no active incidents/i),
    ).toBeVisible()
    // Report-an-incident link in the empty state.
    await expect(
      page.getByRole('link', { name: /report an incident/i }).first(),
    ).toBeVisible()
  })

  // Sanity check: /status footer link still points at /incidents.
  test('GET /status footer "Incident log" link targets /incidents', async ({ page }) => {
    await page.goto('/status')
    const link = page.getByRole('link', { name: /incident log/i })
    await expect(link).toBeVisible()
    expect(await link.getAttribute('href')).toBe('/incidents')
  })
})
