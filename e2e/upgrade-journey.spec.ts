/* upgrade-journey.spec.ts — Chrome-MCP suite S5 (Payments & Upgrade),
 * automated as the HEADLINE coverage of this gate.
 *
 * S5 is the only money path in the product. Before this spec, Playwright
 * had ZERO automated coverage of it — every checkout regression (a broken
 * createCheckout call, a dropped short_url redirect, an invoice render
 * crash, a mis-handled 409) shipped on manual Chrome-MCP spot-checks alone.
 * The Chrome-MCP S5 run is itself BLOCKED in production (the Razorpay
 * account isn't recurring-enabled — S5-F1), so the automated layer here is
 * the *only* gate standing between a dashboard change and a silently
 * broken payment funnel.
 *
 * What a hermetic Playwright spec CAN cover (and does, below):
 *   - the dashboard's half of the checkout contract: it calls
 *     POST /api/v1/billing/checkout and navigates to the returned
 *     Razorpay short_url;
 *   - every honest failure branch — 503 billing_not_configured,
 *     409 already_on_plan, 500 generic — renders a real error, not a
 *     blank page or a spinner;
 *   - the in-dashboard Change-plan modal: immediate success, short_url
 *     redirect, already_on_plan 409, and 5xx → Contact-support fallback;
 *   - invoice rendering with paid / pending-zero / unknown-status rows
 *     (the S5-F3 "Invalid Date / $NaN" regression).
 *
 * What it CANNOT cover (stays manual Chrome-MCP, S5): the real Razorpay
 * hosted page, 3DS/OTP, card decline, the webhook→tier-elevation round
 * trip. Those need a live recurring-enabled Razorpay account.
 *
 * Hermetic: every route is page.route()-mocked. The Razorpay short_url is
 * a fake (rzp.io/i/FAKE...) and is itself intercepted — the browser never
 * loads a real checkout page. Nothing is created on any backend; no
 * teardown required.
 */

import { expect, test, type Route } from '@playwright/test'
import {
  FAKE_RAZORPAY_SHORT_URL,
  installAPIFake,
  installBillingAPIFake,
  mockChangePlan,
  mockCheckoutFailure,
  mockCheckoutSuccess,
  signIn,
} from './fixtures'

test.describe('Upgrade journey — Billing page (S5)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    await installBillingAPIFake(page)
  })

  test('S5.0 — Billing page renders current plan + usage + invoices', async ({ page }) => {
    await page.goto('/app/billing')
    // The upgrade grid renders (hobby team → can pick a higher tier).
    await expect(page.getByTestId('billing-upgrade-section')).toBeVisible()
    await expect(page.getByText(/You're on Hobby today/i)).toBeVisible()
    // Usage panel reflects the server-cached aggregate, with the
    // eventual-consistency footnote (caching+consistency memory).
    await expect(page.getByTestId('billing-usage-as-of')).toBeVisible()
  })

  test('S5.1 — "Get Pro" → POST /billing/checkout → navigate to Razorpay', async ({ page }) => {
    await mockCheckoutSuccess(page)
    // Intercept the Razorpay short_url so the redirect is observable
    // without the browser ever loading rzp.io.
    let navigatedTo: string | null = null
    await page.route(FAKE_RAZORPAY_SHORT_URL + '**', (route: Route) => {
      navigatedTo = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>rzp stub</html>' })
    })

    await page.goto('/app/billing')
    // The Pro CTA composes with the A/B UpgradeButton — testid `upgrade-button`.
    await page.getByTestId('upgrade-button').click()
    await expect.poll(() => navigatedTo).toContain('rzp.io')
  })

  test('S5.6 — checkout 500 surfaces an inline error, not a blank page', async ({ page }) => {
    await mockCheckoutFailure(page, 'generic')
    await page.goto('/app/billing')
    await page.getByTestId('upgrade-button').click()
    // The BillingPage catches the APIError into checkoutErr → checkout-error.
    await expect(page.getByTestId('checkout-error')).toBeVisible()
    await expect(page.getByTestId('checkout-error')).toContainText(/checkout could not be created/i)
  })

  test('S5.6b — already_on_plan 409 surfaces the conflict, no redirect', async ({ page }) => {
    // already_on_plan / checkout-reuse: the user clicks upgrade for a plan
    // their team already holds. The dashboard must surface the 409 honestly
    // and must NOT navigate anywhere.
    await mockCheckoutFailure(page, 'already_on_plan')
    let navigated = false
    await page.route(FAKE_RAZORPAY_SHORT_URL + '**', (route: Route) => {
      navigated = true
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'x' })
    })
    await page.goto('/app/billing')
    await page.getByTestId('upgrade-button').click()
    await expect(page.getByTestId('checkout-error')).toBeVisible()
    await expect(page.getByTestId('checkout-error')).toContainText(/already on this plan/i)
    expect(navigated).toBe(false)
    // The page stays on /app/billing — no half-completed navigation.
    await expect(page).toHaveURL(/\/app\/billing$/)
  })

  test('S5.3 — invoices render paid / pending-zero / unknown-status rows cleanly', async ({ page }) => {
    // S5-F3 regression: a Razorpay invoice payload with a zero amount, a
    // missing pdf_url, or an unknown status used to render "Invalid Date"
    // and "$NaN". installBillingAPIFake() seeds exactly those shapes.
    await page.goto('/app/billing')
    await expect(page.getByText('inv_PAID001')).toBeVisible()
    await expect(page.getByText('inv_PENDING002')).toBeVisible()
    await expect(page.getByText('inv_ISSUED003')).toBeVisible()
    // No row renders the broken parser output.
    await expect(page.getByText('Invalid Date')).toHaveCount(0)
    await expect(page.getByText('$NaN')).toHaveCount(0)
    // The paid row shows a real dollar amount; the pending-zero row shows $0.00.
    await expect(page.getByText('$49.00')).toBeVisible()
    await expect(page.getByText('$0.00')).toBeVisible()
    // The unknown 'issued' status collapsed to a neutral 'pending' — the
    // status column never renders the raw upstream string. Scope the
    // assertion to the inv_ISSUED003 row's status cell (its id literally
    // contains "issued", so a page-wide getByText would false-positive).
    const issuedRow = page.locator('.invoice-row', { hasText: 'inv_ISSUED003' })
    await expect(issuedRow.getByText('pending', { exact: true })).toBeVisible()
    await expect(issuedRow.getByText(/^issued$/)).toHaveCount(0)
  })

  test('S5.7 — Annual frequency toggle persists and re-anchors the Pro price', async ({ page }) => {
    await page.goto('/app/billing')
    // Annual is the default (billing redesign 2026-05-13).
    await expect(page.getByTestId('frequency-yearly')).toBeChecked()
    // Switching to monthly re-anchors the Pro CTA copy to the monthly price.
    await page.getByTestId('frequency-monthly').click()
    await expect(page.getByTestId('upgrade-button')).toContainText('$49/mo')
    // Switch back to annual — the anchored monthly-equivalent copy returns.
    await page.getByTestId('frequency-yearly').click()
    await expect(page.getByTestId('upgrade-button')).toContainText('$40.83/mo')
  })

  test('S5-cancel — no self-serve cancel; only a support mailto', async ({ page }) => {
    // Policy memory project_no_self_serve_cancel_downgrade.md — the
    // dashboard must never offer a self-serve cancel button.
    await page.goto('/app/billing')
    const cancelLink = page.getByTestId('contact-support-cancel')
    await expect(cancelLink).toBeVisible()
    expect(await cancelLink.getAttribute('href')).toMatch(/^mailto:support@instanode\.dev/)
  })
})

test.describe('Change-plan modal (S5 — in-dashboard upgrade)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    await installBillingAPIFake(page)
  })

  test('S5.4 — immediate change shows "Plan changed ✓"', async ({ page }) => {
    await mockChangePlan(page, 'immediate')
    await page.goto('/app/billing')
    // hobby team → the "Change plan" button is shown (has an upgrade target).
    await page.getByTestId('open-change-plan-modal').click()
    await expect(page.getByTestId('change-plan-modal')).toBeVisible()
    await page.getByTestId('change-plan-confirm').click()
    await expect(page.getByTestId('change-plan-success')).toBeVisible()
  })

  test('S5.4b — change-plan short_url path redirects to Razorpay', async ({ page }) => {
    await mockChangePlan(page, 'short_url')
    let navigatedTo: string | null = null
    await page.route(FAKE_RAZORPAY_SHORT_URL + '**', (route: Route) => {
      navigatedTo = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'x' })
    })
    await page.goto('/app/billing')
    await page.getByTestId('open-change-plan-modal').click()
    await page.getByTestId('change-plan-confirm').click()
    await expect.poll(() => navigatedTo).toContain('rzp.io')
  })

  test('S5.4c — already_on_plan 409 surfaces inline in the modal', async ({ page }) => {
    await mockChangePlan(page, 'already_on_plan')
    await page.goto('/app/billing')
    await page.getByTestId('open-change-plan-modal').click()
    await page.getByTestId('change-plan-confirm').click()
    await expect(page.getByTestId('change-plan-error')).toBeVisible()
    await expect(page.getByTestId('change-plan-error')).toContainText(/already on this plan/i)
    // A 4xx is the user's to fix — no Contact-support fallback for it.
    await expect(page.getByTestId('change-plan-support-fallback')).toHaveCount(0)
  })

  test('S5.4d — 5xx change-plan failure offers the Contact-support fallback', async ({ page }) => {
    await mockChangePlan(page, 'server_error')
    await page.goto('/app/billing')
    await page.getByTestId('open-change-plan-modal').click()
    await page.getByTestId('change-plan-confirm').click()
    await expect(page.getByTestId('change-plan-error')).toBeVisible()
    // 5xx → the support escalation link appears.
    await expect(page.getByTestId('change-plan-support-fallback')).toBeVisible()
  })
})

test.describe('Checkout page — marketing-funnel deep link (S1.4 / S5.1)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
    await installBillingAPIFake(page)
  })

  test('S5.1b — /app/checkout?plan=pro creates a session and redirects', async ({ page }) => {
    await mockCheckoutSuccess(page)
    let navigatedTo: string | null = null
    await page.route(FAKE_RAZORPAY_SHORT_URL + '**', (route: Route) => {
      navigatedTo = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'x' })
    })
    // CheckoutPage POSTs /billing/checkout on mount and immediately calls
    // window.location.assign(short_url) — so we assert the redirect fired
    // rather than the (racy) checkout-page mount being visible.
    await page.goto('/app/checkout?plan=pro&frequency=monthly')
    await expect.poll(() => navigatedTo).toContain('rzp.io')
  })

  test('S5.x — /app/checkout with a bad plan renders the invalid-link panel', async ({ page }) => {
    await page.goto('/app/checkout?plan=banana&frequency=monthly')
    await expect(page.getByTestId('checkout-invalid')).toBeVisible()
    await expect(page.getByTestId('checkout-invalid')).toContainText(/unknown plan/i)
  })

  test('S5.x — /app/checkout 503 billing_not_configured renders the fallback', async ({ page }) => {
    // 503 billing_not_configured is the documented path before the operator
    // wires the Razorpay plan_id. CheckoutPage must show the friendly
    // fallback panel, not a raw error.
    await mockCheckoutFailure(page, 'billing_not_configured')
    await page.goto('/app/checkout?plan=pro&frequency=monthly')
    await expect(page.getByTestId('checkout-fallback')).toBeVisible()
    await expect(page.getByTestId('checkout-fallback')).toContainText(/not yet configured/i)
  })
})
