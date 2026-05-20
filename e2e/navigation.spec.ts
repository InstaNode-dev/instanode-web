import { expect, test } from '@playwright/test'
import { installAPIFake, signIn } from './fixtures'

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
  })

  test('every nav link reaches its page', async ({ page }) => {
    // The authenticated app is mounted under /app/*; the sidebar nav links
    // point to /app/<section>. The Overview is just /app (or /app/).
    //
    // Tracks the live AppShell sidebar — Stacks was retired (b13b8ee:
    // "/app/stacks duplicate route + StacksPage.tsx deleted, same data as
    // Deployments") and Team has no sidebar nav link in the user-facing
    // sidebar (the route exists but is no longer linked from chrome).
    await page.goto('/app')
    const targets: { name: RegExp; pathFragment?: string }[] = [
      { name: /Resources/i, pathFragment: '/app/resources' },
      { name: /Deployments/i, pathFragment: '/app/deployments' },
      { name: /Vault/i, pathFragment: '/app/vault' },
      { name: /Billing/i, pathFragment: '/app/billing' },
      { name: /Settings/i, pathFragment: '/app/settings' },
      { name: /Overview/i, pathFragment: '/app' },
    ]
    for (const t of targets) {
      // Use the sidebar link by accessible name. The new design renders nav
      // items as <NavLink>; the visible text is the section name.
      await page.getByRole('link', { name: t.name }).first().click()
      if (t.pathFragment) {
        await expect(page).toHaveURL(new RegExp(t.pathFragment + '$'))
      }
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    }
  })

  // T15 P2-2 regression guard: clicking a resource row on /app/resources
  // must land directly on /app/resources/<token> — no intermediate
  // /resources/<token> hop through LegacyResourceRedirect. The previous
  // implementation linked rows at the unprefixed legacy path, which
  // resolved via <Navigate replace> → render→navigate→render, adding
  // a wrong intermediate entry to the browser history.
  test('resource row links go straight to /app/resources/:id (no legacy hop)', async ({ page }) => {
    await page.goto('/app/resources')
    // The first row's `<a class="res-name">` wraps the resource name +
    // identifiers. Its href must already be the /app/-prefixed path.
    const firstRow = page.getByRole('link').filter({ hasText: /flashcards-db/i }).first()
    await expect(firstRow).toBeVisible()
    const href = await firstRow.getAttribute('href')
    expect(href).toMatch(/^\/app\/resources\//)
    expect(href).not.toMatch(/^\/resources\//)
  })
})
