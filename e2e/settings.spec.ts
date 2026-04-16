import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession } from './helpers/auth';
import { mockAuthPro } from './helpers/fixtures';

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedSession(page);
  });

  test('settings page renders without errors', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test('account section is visible by default', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-account')).toBeVisible();
  });

  test('all three tab buttons are visible', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-tab-account')).toBeVisible();
    await expect(page.getByTestId('settings-tab-team')).toBeVisible();
    await expect(page.getByTestId('settings-tab-billing')).toBeVisible();
  });

  test('clicking team tab shows team section', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-tab-team').click();
    await expect(page.getByTestId('settings-team')).toBeVisible();
    await expect(page).toHaveURL(/section=team/);
  });

  test('clicking billing tab shows billing section', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-tab-billing').click();
    await expect(page.getByTestId('settings-billing')).toBeVisible();
    await expect(page).toHaveURL(/section=billing/);
  });

  test('account section shows user email', async ({ page }) => {
    await page.goto('/settings');
    const emailInput = page.getByLabel('Email address');
    await expect(emailInput).toHaveValue('test@example.com');
  });

  test('billing section shows upgrade button for hobby tier', async ({ page }) => {
    await page.goto('/settings?section=billing');
    await expect(page.locator('button', { hasText: 'Upgrade to Pro' })).toBeVisible();
  });

  test('billing section does not show upgrade button for pro tier', async ({ page }) => {
    await mockAuthenticatedSession(page, mockAuthPro);
    await page.goto('/settings?section=billing');
    await expect(page.locator('button', { hasText: 'Upgrade to Pro' })).not.toBeVisible();
  });

  test('unauthenticated users are redirected to login', async ({ page }) => {
    await page.route('**/auth/refresh', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'unauthorized', code: 'unauthorized' }),
      }),
    );

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
