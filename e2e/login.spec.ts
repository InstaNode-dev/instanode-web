import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession, mockUnauthenticatedSession } from './helpers/auth';
import { mockResources } from './helpers/fixtures';

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await mockUnauthenticatedSession(page);
  });

  test('login page renders without errors', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('instanode.dev');
  });

  test('email input and magic link button are visible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('email-input')).toBeVisible();
    await expect(page.getByTestId('magic-link-btn')).toBeVisible();
  });

  test('GitHub OAuth button is visible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('github-oauth-btn')).toBeVisible();
    await expect(page.getByTestId('github-oauth-btn')).toContainText('GitHub');
  });

  test('magic link button is disabled with empty email', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('magic-link-btn')).toBeDisabled();
  });

  test('magic link button enables when email is entered', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('email-input').fill('test@example.com');
    await expect(page.getByTestId('magic-link-btn')).toBeEnabled();
  });

  test('magic link sent state appears after submission', async ({ page }) => {
    await page.route('**/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'magic link sent' }),
      }),
    );

    await page.goto('/login');
    await page.getByTestId('email-input').fill('test@example.com');
    await page.getByTestId('magic-link-btn').click();

    await expect(page.getByTestId('magic-link-sent')).toBeVisible();
    await expect(page.locator('text=Check your inbox')).toBeVisible();
  });

  test('error message appears on API failure', async ({ page }) => {
    await page.route('**/auth/login', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Too many requests', code: 'rate_limited' }),
      }),
    );

    await page.goto('/login');
    await page.getByTestId('email-input').fill('test@example.com');
    await page.getByTestId('magic-link-btn').click();

    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText('Too many requests');
  });

  test('authenticated users are redirected to dashboard', async ({ page }) => {
    // Override to authenticated
    await mockAuthenticatedSession(page);
    await page.route('**/api/v1/resources', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResources),
      }),
    );

    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 });
  });

  test('terms and privacy links are visible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Terms' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
  });
});
