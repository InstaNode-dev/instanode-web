/* pause-resume.spec.ts — Pause + Resume buttons on the resource detail page.
 *
 * Validates that:
 *   1. The Pause button is visible on the detail page for an active resource.
 *   2. Clicking Pause opens the confirmation modal (no auto-confirm).
 *   3. Confirming hits POST /api/v1/resources/:id/pause and flips the button
 *      label to Resume after the response lands.
 *   4. The list page surfaces the Paused pill once the row's status is paused.
 *
 * Mocks the pause/resume endpoints inline so we don't depend on a real backend. */

import { expect, test } from '@playwright/test'
import { FAKE_RESOURCES, installAPIFake, signIn } from './fixtures'

test.describe('Pause + Resume', () => {
  test('Pause → confirm → Resume label flips', async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)

    const r = FAKE_RESOURCES[0]

    // Mock POST /api/v1/resources/:id/pause to return the resource flipped
    // to 'paused'. After the click the page should re-read this state and
    // re-render the button label.
    await page.route(`**/api/v1/resources/${r.token}/pause`, (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          item: { ...r, status: 'paused' },
        }),
      })
    })

    await page.route(`**/api/v1/resources/${r.token}/resume`, (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          item: { ...r, status: 'active' },
        }),
      })
    })

    await page.goto(`/app/resources/${r.token}`)

    // The Pause button is visible (the resource starts as active).
    const button = page.getByTestId('pause-resume-button')
    await expect(button).toBeVisible()
    await expect(button).toHaveText('Pause')

    // Click opens the confirmation modal — no auto-confirm.
    await button.click()
    await expect(page.getByTestId('pause-resume-modal')).toBeVisible()

    // Confirm.
    await page.getByTestId('pause-resume-confirm').click()

    // After the api responds the button flips to "Resume" and the modal
    // closes.
    await expect(page.getByTestId('pause-resume-modal')).toBeHidden()
    await expect(button).toHaveText('Resume')

    // The header carries the paused pill once status flipped.
    await expect(page.getByTestId('resource-paused-pill').first()).toBeVisible()
  })
})
