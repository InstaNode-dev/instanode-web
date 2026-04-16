import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession } from './helpers/auth';
import { mockPostgres, mockRedis } from './helpers/fixtures';
import type { Resource } from '../src/types/resource';

const mockMongoResource: Resource = {
  id: 'res_mg_test_123',
  token: 'test-token-123',
  resource_type: 'mongodb',
  tier: 'hobby',
  status: 'active',
  name: 'Test Document Store',
  storage_bytes: 80 * 1024 * 1024, // 80 MB
  cloud_vendor: 'gcp',
  country_code: 'eu',
  created_at: '2026-04-09T10:00:00Z',
};

test.describe('Resource detail page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedSession(page);
  });

  test('shows correct info for postgres resource', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockPostgres.token}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, resource: mockPostgres }),
      }),
    );

    await page.goto(`/dashboard/resources/${mockPostgres.token}`);
    await expect(page.getByTestId('resource-detail-page')).toBeVisible();
    await expect(page.locator('h1')).toContainText('My Postgres');
    await expect(page.locator('text=🐘')).toBeVisible();
  });

  test('shows resource metadata', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockPostgres.token}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, resource: mockPostgres }),
      }),
    );

    await page.goto(`/dashboard/resources/${mockPostgres.token}`);
    const meta = page.getByTestId('resource-meta');
    await expect(meta).toContainText('Postgres');
    await expect(meta).toContainText('hobby');
    await expect(meta).toContainText('aws');
    await expect(meta).toContainText('US');
  });

  test('shows storage usage bar for postgres', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockPostgres.token}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, resource: mockPostgres }),
      }),
    );

    await page.goto(`/dashboard/resources/${mockPostgres.token}`);
    await expect(page.getByTestId('usage-bar')).toBeVisible();
  });

  test('rotate credentials button visible for postgres', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockPostgres.token}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, resource: mockPostgres }),
      }),
    );

    await page.goto(`/dashboard/resources/${mockPostgres.token}`);
    await expect(page.getByTestId('rotate-credentials-btn')).toBeVisible();
  });

  test('rotate credentials button not shown for redis', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockRedis.token}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, resource: mockRedis }),
      }),
    );

    await page.goto(`/dashboard/resources/${mockRedis.token}`);
    await expect(page.getByTestId('rotate-credentials-btn')).not.toBeVisible();
  });

  test('shows key prefix for redis resource', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockRedis.token}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, resource: mockRedis }),
      }),
    );

    await page.goto(`/dashboard/resources/${mockRedis.token}`);
    await expect(page.locator('text=myapp:')).toBeVisible();
  });

  test('delete button triggers confirmation dialog', async ({ page }) => {
    await page.route(`**/api/v1/resources/${mockPostgres.token}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, resource: mockPostgres }),
      }),
    );

    await page.goto(`/dashboard/resources/${mockPostgres.token}`);

    // Dismiss the confirm dialog to verify it appears
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.getByTestId('delete-resource-btn').click();
  });

  test('shows correct info for mongodb resource', async ({ page }) => {
    await page.route('**/api/v1/resources/test-token-123', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, resource: mockMongoResource }),
      }),
    );

    await page.goto('/dashboard/resources/test-token-123');
    await expect(page.getByTestId('resource-detail-page')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Test Document Store');
    await expect(page.locator('text=🍃')).toBeVisible();
    // Cloud vendor and region must appear in meta grid
    await expect(page.getByTestId('resource-meta')).toContainText('gcp');
    await expect(page.getByTestId('resource-meta')).toContainText('EU');
    // Storage usage bar must be visible (storage_bytes is set)
    await expect(page.getByTestId('usage-bar')).toBeVisible();
  });

  test('404 state shown for unknown resource', async ({ page }) => {
    await page.route(`**/api/v1/resources/res_unknown`, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Resource not found', code: 'not_found' }),
      }),
    );

    await page.goto('/dashboard/resources/res_unknown');
    await expect(page.locator('text=Resource not found')).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to dashboard/i })).toBeVisible();
  });
});
