import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession } from './helpers/auth';
import {
  mockResources,
  mockResourcesWithAnonymous,
  mockEmptyResources,
  mockAuthHobby,
  mockAuthAnonymous,
  mockPostgres,
} from './helpers/fixtures';

test.describe('Dashboard page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedSession(page, mockAuthHobby);

    await page.route('**/api/v1/resources', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResources),
      }),
    );
  });

  test('renders all resource cards', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-page')).toBeVisible();

    await expect(page.getByTestId('resource-card-postgres')).toBeVisible();
    await expect(page.getByTestId('resource-card-redis')).toBeVisible();
    await expect(page.getByTestId('resource-card-mongodb')).toBeVisible();
    await expect(page.getByTestId('resource-card-queue')).toBeVisible();
  });

  test('resource cards show service emoji and name', async ({ page }) => {
    await page.goto('/dashboard');
    const postgresCard = page.getByTestId('resource-card-postgres');
    await expect(postgresCard).toContainText('🐘');
    await expect(postgresCard).toContainText('My Postgres');

    const redisCard = page.getByTestId('resource-card-redis');
    await expect(redisCard).toContainText('⚡');
    await expect(redisCard).toContainText('Session Cache');
  });

  test('status badges show correct status for active resources', async ({ page }) => {
    await page.goto('/dashboard');
    const postgresCard = page.getByTestId('resource-card-postgres');
    await expect(postgresCard.getByTestId('status-badge-active')).toBeVisible();
  });

  test('hobby tier shows upgrade banner', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('upgrade-banner')).toBeVisible();
  });

  test('upgrade banner is not shown for pro tier', async ({ page }) => {
    // Override auth to pro tier
    await page.route('**/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: { ...mockAuthHobby.user, tier: 'pro' },
        }),
      }),
    );
    await page.goto('/dashboard');
    await expect(page.getByTestId('upgrade-banner')).not.toBeVisible();
  });

  test('copy URL button copies connection_url to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/dashboard');
    const postgresCard = page.getByTestId('resource-card-postgres');
    await expect(postgresCard.getByTestId('copy-url-btn')).toContainText('Copy URL');
    await postgresCard.getByTestId('copy-url-btn').click();
    await expect(postgresCard.getByTestId('copy-url-btn')).toContainText('Copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(mockPostgres.connection_url);
    await expect(postgresCard.getByTestId('copy-url-btn')).toContainText('Copy URL', { timeout: 3000 });
  });

  test('delete button shows confirmation flow', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockPostgres.token}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );

    await page.goto('/dashboard');
    const postgresCard = page.getByTestId('resource-card-postgres');

    // First click shows confirmation
    await postgresCard.getByTestId('delete-btn').click();
    await expect(postgresCard.getByTestId('confirm-delete-btn')).toBeVisible();

    // Cancel hides confirmation
    await postgresCard.getByRole('button', { name: 'Cancel' }).click();
    await expect(postgresCard.getByTestId('delete-btn')).toBeVisible();
    await expect(postgresCard.getByTestId('confirm-delete-btn')).not.toBeVisible();
  });

  test('confirming delete removes the card', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockPostgres.token}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );

    await page.goto('/dashboard');
    const postgresCard = page.getByTestId('resource-card-postgres');
    await expect(postgresCard).toBeVisible();

    // Register reduced list AFTER initial load so the first fetch uses beforeEach's full list.
    await page.route('**/api/v1/resources', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: mockResources.items.filter(r => r.token !== mockPostgres.token), total: 3 }),
      }),
    );

    await postgresCard.getByTestId('delete-btn').click();
    await postgresCard.getByTestId('confirm-delete-btn').click();

    // Postgres card should disappear via optimistic update + refetch
    await expect(page.getByTestId('resource-card-postgres')).not.toBeVisible({ timeout: 5000 });
  });

  test('anonymous resources show expiry countdown', async ({ page }) => {
    await mockAuthenticatedSession(page, mockAuthAnonymous);
    await page.route('**/api/v1/resources', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResourcesWithAnonymous),
      }),
    );

    await page.goto('/dashboard');
    await expect(page.getByTestId('expiry-countdown').first()).toBeVisible();
    await expect(page.getByTestId('expiry-countdown').first()).toContainText(/remaining/);
  });

  test('empty state is shown when no resources', async ({ page }) => {
    await page.route('**/api/v1/resources', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockEmptyResources),
      }),
    );

    await page.goto('/dashboard');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('resource-grid')).not.toBeVisible();
  });

  test('error state is shown on API failure', async ({ page }) => {
    await page.route('**/api/v1/resources', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Internal server error', code: 'server_error' }),
      }),
    );

    await page.goto('/dashboard');
    await expect(page.getByTestId('resources-error')).toBeVisible();
  });

  test('postgres cards have rotate credentials button', async ({ page }) => {
    await page.goto('/dashboard');
    const postgresCard = page.getByTestId('resource-card-postgres');
    await expect(postgresCard.getByTestId('rotate-credentials-btn')).toBeVisible();
  });

  test('non-postgres cards do not have rotate credentials button', async ({ page }) => {
    await page.goto('/dashboard');
    const redisCard = page.getByTestId('resource-card-redis');
    await expect(redisCard.getByTestId('rotate-credentials-btn')).not.toBeVisible();
  });

  test('sidebar navigation is visible', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('top-nav')).toBeVisible();
  });
});
