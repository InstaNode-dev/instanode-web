import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession } from './helpers/auth';

const sampleStacks = {
  ok: true,
  total: 2,
  items: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      slug: 'stk-myapi01',
      name: 'my-api',
      status: 'running',
      url: 'https://my-api.instant.dev',
      created_at: '2026-04-16T12:00:00.000Z',
      team_id: 'mock-team-id',
      logs_service: 'api',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      slug: 'stk-worker02',
      name: 'worker',
      status: 'building',
      url: '',
      created_at: '2026-04-16T11:30:00.000Z',
      team_id: 'mock-team-id',
      logs_service: '',
    },
  ],
};

test.describe('Deploy page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedSession(page);
    await page.route('**/api/v1/stacks', (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue();
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sampleStacks),
      });
    });
  });

  test('deploy page renders without errors', async ({ page }) => {
    await page.goto('/deploy');
    await expect(page.getByTestId('deploy-page')).toBeVisible();
  });

  test('shows deployments header and new button', async ({ page }) => {
    await page.goto('/deploy');
    await expect(page.getByTestId('deploy-page-title')).toContainText('Deployments');
    await expect(page.getByTestId('deploy-new-btn')).toBeVisible();
  });

  test('lists deployment cards from API', async ({ page }) => {
    await page.goto('/deploy');
    await expect(page.getByTestId('deployments-list')).toBeVisible();
    await expect(page.getByTestId('deployment-card-stk-myapi01')).toBeVisible();
    await expect(page.getByTestId('deployment-card-stk-worker02')).toBeVisible();
    await expect(page.getByTestId('deployment-card-stk-myapi01')).toContainText('my-api');
    await expect(page.getByTestId('deployment-card-stk-myapi01')).toContainText('Running');
    await expect(page.getByTestId('deployment-card-stk-worker02')).toContainText('Building');
  });

  test('opens new deployment modal', async ({ page }) => {
    await page.goto('/deploy');
    await page.getByTestId('deploy-new-btn').click();
    await expect(page.getByTestId('deploy-modal-tab-upload')).toBeVisible();
    await expect(page.getByTestId('deploy-modal-tab-curl')).toBeVisible();
    await page.getByTestId('deploy-modal-tab-curl').click();
    await expect(page.getByTestId('deploy-curl-snippet')).toContainText('curl -X POST');
    await expect(page.getByTestId('deploy-curl-snippet')).toContainText('/stacks/new');
  });

  test('delete triggers API and refreshes list', async ({ page }) => {
    let deleted = false;
    await page.route('**/api/v1/stacks', (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue();
      }
      const items = deleted ? [sampleStacks.items[1]] : sampleStacks.items;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items, total: items.length }),
      });
    });

    await page.route('**/api/v1/stacks/stk-myapi01', (route) => {
      if (route.request().method() === 'DELETE') {
        deleted = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      }
      return route.continue();
    });

    await page.goto('/deploy');
    page.once('dialog', (d) => d.accept());
    await page
      .locator('[data-testid="deployment-card-stk-myapi01"]')
      .getByTestId('deployment-delete-btn')
      .click();
    await expect(page.getByTestId('deployment-card-stk-myapi01')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('deployment-card-stk-worker02')).toBeVisible();
  });

  test('empty state when no stacks', async ({ page }) => {
    await page.route('**/api/v1/stacks', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: [], total: 0 }),
      }),
    );
    await page.goto('/deploy');
    await expect(page.getByTestId('deployments-empty')).toBeVisible();
    await expect(page.getByTestId('deployments-empty')).toContainText('POST /stacks/new');
  });

  test('unauthenticated users are redirected to login', async ({ page }) => {
    await page.route('**/auth/refresh', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'unauthorized', code: 'unauthorized' }),
      }),
    );

    await page.goto('/deploy');
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
