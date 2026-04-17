/**
 * D3: Resource Actions — copy, delete, rotate credentials.
 *
 *  D3.1  Click Postgres card → navigate to /resources/{id}
 *  D3.2  Resource detail page shows connection URL area and actions
 *  D3.3  Copy URL button shows "Copied!" feedback
 *  D3.4  Delete button shows confirm button before deleting
 *  D3.5  Confirm delete → resource disappears from list
 *  D3.6  Rotate credentials → new URL shown in rotated-url section
 *  D3.7  Card on dashboard: rotate credentials button visible
 *  D3.8  Deleted resource card: actions disabled
 */

import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession } from './helpers/auth';
import {
  mockResources,
  mockPostgres,
  mockDeletedRedis,
  mockAuthHobby,
} from './helpers/fixtures';

const MOCK_ROTATE_RESPONSE = {
  ok: true,
  connection_url: 'postgres://user:newpassword@pg.instanode.dev:5432/mydb',
  token: mockPostgres.token,
};

// Common setup: authenticated session + resource list.
async function setupDashboard(page: import('@playwright/test').Page) {
  await mockAuthenticatedSession(page, mockAuthHobby);
  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResources),
    }),
  );
}

async function setupResourceDetail(
  page: import('@playwright/test').Page,
  resourceToken = mockPostgres.token,
) {
  await mockAuthenticatedSession(page, mockAuthHobby);
  // fetchResource expects { ok: true, resource: Resource }
  await page.route(`**/api/v1/resources/${resourceToken}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, resource: mockPostgres }),
    }),
  );
}

// ── D3.1: Click resource card → navigate to detail page ──────────────────────

test('D3.1: clicking resource card navigates to detail page', async ({ page }) => {
  await setupDashboard(page);
  await page.goto('/dashboard');

  await expect(page.getByTestId('resource-card-postgres')).toBeVisible();

  // Click the resource name link inside the card to navigate to the detail page.
  await page.getByTestId('resource-card-postgres').getByRole('link').click();

  // Must navigate to /dashboard/resources/{id}.
  await expect(page).toHaveURL(/\/dashboard\/resources\//, { timeout: 5000 });
});

// ── D3.2: Resource detail page shows actions ─────────────────────────────────

test('D3.2: resource detail page shows rotate and delete buttons', async ({ page }) => {
  await setupResourceDetail(page);
  await page.goto(`/dashboard/resources/${mockPostgres.token}`);

  await expect(page.getByTestId('resource-detail-page')).toBeVisible();
  await expect(page.getByTestId('rotate-credentials-btn')).toBeVisible();
  await expect(page.getByTestId('delete-resource-btn')).toBeVisible();
});

// ── D3.3: Copy URL button shows "Copied!" feedback ───────────────────────────

test('D3.3: copy URL button copies connection_url and shows copied feedback', async ({ page }) => {
  await setupDashboard(page);
  await page.goto('/dashboard');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  const copyBtn = page.getByTestId('resource-card-postgres').getByTestId('copy-url-btn');
  await expect(copyBtn).toContainText('Copy URL');
  await copyBtn.click();

  await expect(copyBtn).toContainText(/copied|✓|done/i, { timeout: 3000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(mockPostgres.connection_url);
});

// ── D3.4: Delete button shows confirm step ────────────────────────────────────

test('D3.4: delete button shows confirm step before deleting', async ({ page }) => {
  await setupDashboard(page);
  await page.goto('/dashboard');

  const deleteBtn = page.getByTestId('delete-btn').first();
  await expect(deleteBtn).toBeVisible();
  await deleteBtn.click();

  // Confirm button must appear.
  await expect(page.getByTestId('confirm-delete-btn')).toBeVisible({ timeout: 3000 });
});

// ── D3.5: Confirm delete → resource removed from list ────────────────────────

test('D3.5: confirmed delete removes resource from list', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  // First request: full list.
  let deleteCount = 0;
  await page.route('**/api/v1/resources', (route) => {
    if (deleteCount === 0) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResources),
      });
    }
    // After delete, return list without postgres.
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: mockResources.items.filter((r) => r.id !== mockPostgres.id),
        total: mockResources.total - 1,
      }),
    });
  });

  // Mock delete endpoint.
  await page.route(`**/api/v1/resources/${mockPostgres.token}`, (route) => {
    if (route.request().method() === 'DELETE') {
      deleteCount++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    }
    return route.continue();
  });

  await page.goto('/dashboard');

  const postgresCard = page.getByTestId('resource-card-postgres');
  await expect(postgresCard).toBeVisible();

  // Click delete, then confirm.
  await postgresCard.getByTestId('delete-btn').click();
  await page.getByTestId('confirm-delete-btn').click();

  // After delete, the postgres card must disappear.
  await expect(postgresCard).not.toBeVisible({ timeout: 5000 });
});

// ── D3.6: Rotate credentials → new URL shown ─────────────────────────────────

test('D3.6: rotate credentials shows new connection URL', async ({ page }) => {
  await setupDashboard(page);

  // Mock the rotate endpoint.
  await page.route(`**/api/v1/resources/${mockPostgres.token}/rotate`, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ROTATE_RESPONSE),
      });
    }
    return route.continue();
  });

  await page.goto('/dashboard');

  const postgresCard = page.getByTestId('resource-card-postgres');
  await expect(postgresCard).toBeVisible();

  // Click rotate credentials.
  await postgresCard.getByTestId('rotate-credentials-btn').click();

  // New URL section must appear.
  await expect(page.getByTestId('rotated-url')).toBeVisible({ timeout: 5000 });
  const rotatedText = await page.getByTestId('rotated-url').innerText();
  expect(rotatedText).toContain('newpassword');
});

// ── D3.7: Resource detail page: rotate credentials works ─────────────────────

test('D3.7: resource detail page rotate credentials shows new URL', async ({ page }) => {
  await setupResourceDetail(page);

  await page.route(`**/api/v1/resources/${mockPostgres.token}/rotate`, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ROTATE_RESPONSE),
      });
    }
    return route.continue();
  });

  await page.goto(`/dashboard/resources/${mockPostgres.token}`);
  await expect(page.getByTestId('rotate-credentials-btn')).toBeVisible();

  await page.getByTestId('rotate-credentials-btn').click();

  // Wait for rotated URL section.
  await expect(page.getByTestId('rotated-url')).toBeVisible({ timeout: 5000 });
});

// ── D3.8: Deleted resource card actions are disabled ─────────────────────────

test('D3.8: deleted resource card has disabled actions', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);
  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [mockDeletedRedis],
        total: 1,
      }),
    }),
  );

  await page.goto('/dashboard');

  const redisCard = page.getByTestId('resource-card-redis');
  await expect(redisCard).toBeVisible();

  // Copy button must be disabled for deleted resources.
  const copyBtn = redisCard.getByTestId('copy-url-btn');
  if (await copyBtn.isVisible()) {
    await expect(copyBtn).toBeDisabled();
  }
});
