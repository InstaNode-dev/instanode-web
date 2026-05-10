import { expect, test } from '@playwright/test'
import { installAPIFake, signIn } from './fixtures'

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
  })

  test('every nav link reaches its page', async ({ page }) => {
    await page.goto('/')
    const targets: { name: RegExp; pathFragment?: string }[] = [
      { name: /Resources/i, pathFragment: '/resources' },
      { name: /Deployments/i, pathFragment: '/deployments' },
      { name: /Stacks/i, pathFragment: '/stacks' },
      { name: /Vault/i, pathFragment: '/vault' },
      { name: /Team/i, pathFragment: '/team' },
      { name: /Billing/i, pathFragment: '/billing' },
      { name: /Settings/i, pathFragment: '/settings' },
      { name: /Overview/i, pathFragment: '/' },
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
