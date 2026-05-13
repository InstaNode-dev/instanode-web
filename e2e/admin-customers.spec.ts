// admin-customers.spec.ts — Playwright coverage for the AdminCustomersPage
// founder console at /app/admin/customers. The unit tests
// (src/pages/AdminCustomersPage.test.tsx) already cover render-level branches
// against vi-mocked api modules; this suite locks in the full browser surface:
// router gate, real fetch wiring through buildAdminURL(), drawer + modal
// flows, and the cross-mount currency preference in real localStorage.
//
// Every backend call is mocked via page.route() — see fixtures.ts. No real
// agent API contact.

import { expect, test } from '@playwright/test'
import {
  FAKE_ADMIN_CUSTOMERS,
  FAKE_ADMIN_PATH_PREFIX,
  installAPIFake,
  installAdminAPIFake,
  signIn,
} from './fixtures'

const ADMIN_ROUTE = '/app/admin/customers'

test.describe('AdminCustomersPage', () => {
  test.beforeEach(async ({ page }) => {
    // Each Playwright test runs in its own browser context — localStorage
    // starts empty by default, so we don't need to clear the currency key
    // here. (We deliberately avoid an addInitScript that would also fire on
    // reload, which would wipe the INR preference test 8 just persisted.)
    await signIn(page)
  })

  // ─── 1. non-admin route gating ─────────────────────────────────────────
  test('non-admin user gets redirected (route does not leak)', async ({ page }) => {
    // installAPIFake's /auth/me returns is_platform_admin absent →
    // AdminCustomersPage renders <Navigate to="/" /> and we end up on the
    // public marketing page. The admin surface never paints.
    await installAPIFake(page)
    await page.goto(ADMIN_ROUTE)
    // The page-level testid never appears.
    await expect(page.getByTestId('admin-customers-page')).toHaveCount(0)
    // We land on "/" (the marketing page) — assert URL, not content, so a
    // future copy refresh doesn't break the gate test.
    await expect(page).toHaveURL(/\/$/)
  })

  // ─── 2. admin user lands on page with table ────────────────────────────
  test('admin user sees the customers table with sortable headers', async ({
    page,
  }) => {
    await installAPIFake(page)
    await installAdminAPIFake(page)
    await page.goto(ADMIN_ROUTE)

    await expect(page.getByTestId('admin-customers-page')).toBeVisible()
    await expect(page.getByTestId('admin-customers-table')).toBeVisible()
    await expect(page.getByTestId('admin-customers-count')).toContainText(
      String(FAKE_ADMIN_CUSTOMERS.length),
    )
    // Sortable headers expose aria-sort + testid-prefixed by column key.
    for (const k of [
      'email',
      'tier',
      'mrr',
      'storage',
      'deployments',
      'last_active',
      'created_at',
    ]) {
      await expect(page.getByTestId(`admin-sort-${k}`)).toBeVisible()
    }
    // Default sort is mrr desc — verify the aria-sort attribute reflects it.
    await expect(page.getByTestId('admin-sort-mrr')).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    // Clicking the email header re-sorts ascending; the alphabetically-first
    // row (agent@temp.dev → t_agent) bubbles up to the top.
    await page.getByTestId('admin-sort-email').click()
    await expect(page.getByTestId('admin-sort-email')).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    const firstRow = page
      .locator('[data-testid^="admin-customer-row-"]')
      .first()
    await expect(firstRow).toHaveAttribute(
      'data-testid',
      'admin-customer-row-t_agent',
    )
  })

  // ─── 3. search by email (debounced refetch) ────────────────────────────
  test('search filters to founder@x.com when typing "fou"', async ({ page }) => {
    await installAPIFake(page)
    await installAdminAPIFake(page)
    await page.goto(ADMIN_ROUTE)
    await expect(
      page.getByTestId('admin-customer-row-t_founder'),
    ).toBeVisible()

    // The page debounces by re-firing listAdminCustomers on each keystroke
    // (the unit test verifies the search param). We wait for the request to
    // land + the rows to re-render.
    const searchReq = page.waitForRequest((req) =>
      req
        .url()
        .includes(`/api/v1/${FAKE_ADMIN_PATH_PREFIX}/customers`) &&
      req.url().includes('q=fou'),
    )
    await page.getByTestId('admin-customers-search').fill('fou')
    await searchReq

    // Only the founder row remains.
    await expect(
      page.getByTestId('admin-customer-row-t_founder'),
    ).toBeVisible()
    await expect(page.getByTestId('admin-customer-row-t_dev')).toHaveCount(0)
    await expect(page.getByTestId('admin-customer-row-t_agent')).toHaveCount(0)
  })

  // ─── 4. filter pills (tier filter) ─────────────────────────────────────
  test('filter pill "Pro" narrows to pro-tier rows then "All" restores', async ({
    page,
  }) => {
    await installAPIFake(page)
    await installAdminAPIFake(page)
    await page.goto(ADMIN_ROUTE)
    await expect(
      page.getByTestId('admin-customer-row-t_founder'),
    ).toBeVisible()

    // Click Pro pill → only the pro-tier row survives the server-side filter.
    const proReq = page.waitForRequest((req) =>
      req.url().includes(`/customers`) && req.url().includes('tier=pro'),
    )
    await page.getByTestId('admin-filter-pro').click()
    await proReq
    await expect(
      page.getByTestId('admin-customer-row-t_founder'),
    ).toBeVisible()
    await expect(page.getByTestId('admin-customer-row-t_dev')).toHaveCount(0)
    await expect(page.getByTestId('admin-customer-row-t_agent')).toHaveCount(0)

    // Click All pill → no tier query param, all rows return.
    await page.getByTestId('admin-filter-all').click()
    await expect(
      page.getByTestId('admin-customer-row-t_founder'),
    ).toBeVisible()
    await expect(page.getByTestId('admin-customer-row-t_dev')).toBeVisible()
    await expect(page.getByTestId('admin-customer-row-t_agent')).toBeVisible()
  })

  // ─── 5. row click opens detail drawer ──────────────────────────────────
  test('clicking a row opens the detail drawer with email + tier + tabs', async ({
    page,
  }) => {
    await installAPIFake(page)
    await installAdminAPIFake(page)
    await page.goto(ADMIN_ROUTE)
    await expect(
      page.getByTestId('admin-customer-row-t_founder'),
    ).toBeVisible()

    await page.getByTestId('admin-customer-row-t_founder').click()

    const drawer = page.getByTestId('customer-drawer')
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('drawer-email')).toContainText('founder@x.com')
    // Tabs render after detail fetch resolves.
    for (const t of ['overview', 'resources', 'activity', 'promos']) {
      await expect(page.getByTestId(`drawer-tab-${t}`)).toBeVisible()
    }
    // Default tab is overview — the overview grid shows up.
    await expect(page.getByTestId('drawer-overview')).toBeVisible()
    // Switch to resources tab — the resources table renders the mocked row.
    await page.getByTestId('drawer-tab-resources').click()
    await expect(page.getByTestId('drawer-resources')).toBeVisible()
  })

  // ─── 6. issue promo modal + copy button ────────────────────────────────
  test('"Issue promo" submits with percent_off=15 and surfaces a code', async ({
    page,
  }) => {
    await installAPIFake(page)
    await installAdminAPIFake(page)
    await page.goto(ADMIN_ROUTE)

    await page.getByTestId('admin-customer-row-t_founder').click()
    await expect(page.getByTestId('customer-drawer')).toBeVisible()
    await page.getByTestId('drawer-issue-promo').click()

    const modal = page.getByTestId('issue-promo-modal')
    await expect(modal).toBeVisible()

    // Defaults already set kind=percent_off, value=15. Reset just to be explicit.
    await page.getByTestId('promo-kind').selectOption('percent_off')
    await page.getByTestId('promo-value').fill('15')
    await page.getByTestId('promo-applies-to').fill('1')
    await page.getByTestId('promo-valid-days').fill('30')

    // Capture the POST body so we lock in the contract.
    const promoReq = page.waitForRequest((req) =>
      req.url().endsWith(`/customers/t_founder/promo`) &&
      req.method() === 'POST',
    )
    await page.getByTestId('promo-submit').click()
    const req = await promoReq
    expect(req.postDataJSON()).toMatchObject({
      kind: 'percent_off',
      value: 15,
      applies_to: 1,
      valid_for_days: 30,
    })

    // Issued state — code appears with a Copy button.
    await expect(page.getByTestId('promo-issued')).toBeVisible()
    await expect(page.getByTestId('promo-issued-code')).toContainText(
      'FOUNDER-MAY26',
    )
    await expect(page.getByTestId('promo-copy')).toBeVisible()
  })

  // ─── 7. tier change modal with typed PROMOTE confirmation ──────────────
  test('"Promote tier" requires typing PROMOTE before submit enables', async ({
    page,
  }) => {
    await installAPIFake(page)
    await installAdminAPIFake(page)
    await page.goto(ADMIN_ROUTE)

    // Open the drawer on the founder row. The mocked detail response carries
    // team.tier='pro' (which overrides the summary tier on display), so any
    // promotion needs to target a tier above 'pro' — we pick 'team' so the
    // confirmation word resolves to PROMOTE.
    await page.getByTestId('admin-customer-row-t_founder').click()
    await expect(page.getByTestId('customer-drawer')).toBeVisible()
    // Wait for the detail fetch to resolve before opening the tier modal —
    // currentTier is sourced from detail.team.tier as soon as it lands.
    await expect(page.getByTestId('drawer-overview')).toBeVisible()
    await page.getByTestId('drawer-change-tier').click()

    const modal = page.getByTestId('tier-change-modal')
    await expect(modal).toBeVisible()

    // Pick "team" — up-tier from "pro", so the confirm input renders with
    // the PROMOTE word.
    await page.getByTestId('tier-select').selectOption('team')
    await expect(page.getByTestId('tier-confirm-word')).toContainText('PROMOTE')

    // Reason field is mandatory.
    await page.getByTestId('tier-reason').fill('founder demo upgrade')

    // Submit is disabled until the confirm word matches.
    await expect(page.getByTestId('tier-submit')).toBeDisabled()
    await page.getByTestId('tier-confirm-input').fill('PROMOT') // not yet
    await expect(page.getByTestId('tier-submit')).toBeDisabled()
    await page.getByTestId('tier-confirm-input').fill('PROMOTE')
    await expect(page.getByTestId('tier-submit')).toBeEnabled()

    // Submit fires the POST; drawer refetches detail after onChanged().
    const tierReq = page.waitForRequest((req) =>
      req.url().endsWith(`/customers/t_founder/tier`) && req.method() === 'POST',
    )
    await page.getByTestId('tier-submit').click()
    const req = await tierReq
    expect(req.postDataJSON()).toMatchObject({
      tier: 'team',
      reason: 'founder demo upgrade',
    })

    // Modal closes on success.
    await expect(page.getByTestId('tier-change-modal')).toHaveCount(0)
  })

  // ─── 8. currency toggle (USD default, INR switch, localStorage persist) ──
  test('currency toggle defaults to USD, switches to INR, persists on reload', async ({
    page,
  }) => {
    await installAPIFake(page)
    await installAdminAPIFake(page)
    await page.goto(ADMIN_ROUTE)

    // USD is the default — the founder row's MRR cell shows a $-prefixed value.
    const mrr = page.getByTestId('admin-customer-mrr-t_founder')
    await expect(mrr).toContainText('$')

    // Switch to INR — every MRR cell flips to ₹.
    await page.getByTestId('admin-currency-INR').click()
    await expect(page.getByTestId('admin-currency-INR')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(mrr).toContainText('₹')

    // Persisted in localStorage — write was synchronous on click.
    const stored = await page.evaluate(() =>
      localStorage.getItem('instant.admin.currency'),
    )
    expect(stored).toBe('INR')

    // Reload — currency preference survives. The MRR cell is still ₹.
    await page.reload()
    await expect(
      page.getByTestId('admin-customer-row-t_founder'),
    ).toBeVisible()
    await expect(
      page.getByTestId('admin-currency-INR'),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByTestId('admin-customer-mrr-t_founder'),
    ).toContainText('₹')
  })
})
