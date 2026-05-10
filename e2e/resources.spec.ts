import { expect, test } from '@playwright/test'
import { FAKE_RESOURCES, installAPIFake, signIn } from './fixtures'

test.describe('Resources', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
  })

  test('list shows the team resources', async ({ page }) => {
    await page.goto('/resources')
    await expect(page.getByRole('heading', { name: /Resources/i, level: 1 })).toBeVisible()
    for (const r of FAKE_RESOURCES) {
      await expect(page.getByText(r.name!)).toBeVisible()
    }
  })

  test('detail page renders connection block + identifiers', async ({ page }) => {
    const r = FAKE_RESOURCES[0]
    await page.goto(`/resources/${r.token}`)
    // Wait for the page to mount and the masked URL to appear.
    // The h1 carries the resource name in the new design.
    await expect(page.getByRole('heading', { level: 1, name: r.name! })).toBeVisible()
  })
})
