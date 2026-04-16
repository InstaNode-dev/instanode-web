import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession } from './helpers/auth';
import { mockClaimPreview, mockClaimSuccess } from './helpers/fixtures';

const VALID_TOKEN = 'valid-claim-token-abc123';

test.describe('Claim page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedSession(page);
  });

  test('renders resource list for valid claim token', async ({ page }) => {
    await page.route(`**/claim/preview*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockClaimPreview),
      }),
    );

    await page.goto(`/claim?t=${VALID_TOKEN}`);
    await expect(page.getByTestId('claim-page')).toBeVisible();
    await expect(page.getByTestId('claim-resource-list')).toBeVisible();
    await expect(page.getByTestId('claim-resource-postgres')).toBeVisible();
  });

  test('claim button shows correct resource count', async ({ page }) => {
    await page.route(`**/claim/preview*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockClaimPreview),
      }),
    );

    await page.goto(`/claim?t=${VALID_TOKEN}`);
    await expect(page.getByTestId('claim-submit-btn')).toContainText('1 resource');
  });

  test('claim form submits and shows success state', async ({ page }) => {
    await page.route(`**/claim/preview*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockClaimPreview),
      }),
    );
    await page.route('**/claim', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockClaimSuccess),
        });
      }
      return route.continue();
    });
    // Mock resources for post-claim dashboard redirect
    await page.route('**/api/v1/resources', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: [], total: 0 }),
      }),
    );

    await page.goto(`/claim?t=${VALID_TOKEN}`);
    await page.getByTestId('claim-submit-btn').click();

    await expect(page.getByTestId('claim-success')).toBeVisible();
    await expect(page.locator('text=Resources claimed!')).toBeVisible();
  });

  test('shows error message for invalid claim token', async ({ page }) => {
    await page.route(`**/claim/preview*`, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Invalid or expired claim token', code: 'not_found' }),
      }),
    );

    await page.goto(`/claim?t=invalid-token`);
    await expect(page.getByTestId('claim-page-error')).toBeVisible();
  });

  test('no-token state shown when ?t param is missing', async ({ page }) => {
    await page.goto('/claim');
    await expect(page.getByTestId('claim-page-no-token')).toBeVisible();
  });

  test('unauthenticated users are redirected to login', async ({ page }) => {
    // Override to unauthenticated
    await page.route('**/auth/refresh', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'unauthorized', code: 'unauthorized' }),
      }),
    );

    await page.goto(`/claim?t=${VALID_TOKEN}`);
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
