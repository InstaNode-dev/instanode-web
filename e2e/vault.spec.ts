import { expect, test } from '@playwright/test'
import { installAPIFake, signIn } from './fixtures'

test.describe('Vault', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
  })

  test('lists keys for the active env', async ({ page }) => {
    await page.goto('/vault')
    await expect(page.getByRole('heading', { name: /Vault/i, level: 1 }).first()).toBeVisible()
    await expect(page.getByText('RAZORPAY_KEY_SECRET')).toBeVisible()
    await expect(page.getByText('OPENAI_API_KEY')).toBeVisible()
    // Plaintext values are NEVER shown on the list view.
    await expect(page.getByText('rzp_live')).toHaveCount(0)
  })
})
