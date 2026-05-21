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
    // Deployments"). Team was orphaned from the sidebar between the route
    // landing and 2026-05-20; BugBash T15-P1-1 restored it. The Team entry
    // below now functions as the regression gate against re-orphaning.
    await page.goto('/app')
    const targets: { name: RegExp; pathFragment?: string }[] = [
      { name: /Resources/i, pathFragment: '/app/resources' },
      { name: /Deployments/i, pathFragment: '/app/deployments' },
      { name: /Vault/i, pathFragment: '/app/vault' },
      // BugBash T15-P1-1 (2026-05-20): /app/team must be reachable from the
      // sidebar — the previous regression was that the route rendered but
      // no NavRow existed, so the entire invite/remove-teammates surface was
      // URL-typing-only. Failing here means somebody removed the NavRow.
      { name: /^Team$/i, pathFragment: '/app/team' },
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
})
