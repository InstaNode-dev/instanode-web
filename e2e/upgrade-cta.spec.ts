/**
 * D1: Upgrade CTA — anonymous resource warnings and upgrade prompts.
 *
 * Verifies that:
 *  D1.1 Dashboard with an anonymous resource shows the upgrade banner
 *  D1.2 Anonymous resource card shows expiry countdown
 *  D1.3 Anonymous banner CTA opens plan & billing (not bare /claim without ?t=)
 *  D1.4 Hobby tier user sees "Upgrade to Pro" banner (not expiry warning)
 *  D1.5 Mix of anonymous + hobby resources: only anonymous cards show expiry
 *  D1.6 Upgrade banner can be dismissed
 *  D1.7 Pro tier: no upgrade banner shown
 */

import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession } from './helpers/auth';
import {
  mockResources,
  mockResourcesWithAnonymous,
  mockAnonymousPostgres,
  mockRedis,
  mockAuthHobby,
  mockAuthPro,
} from './helpers/fixtures';
import type { AuthMeResponse } from '../src/types/auth';

// Helper: mock auth + resource list, go to dashboard.
async function setupDashboard(
  page: import('@playwright/test').Page,
  auth: AuthMeResponse,
  resources: import('../src/types/resource').ResourceListResponse,
) {
  await mockAuthenticatedSession(page, auth);
  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resources),
    }),
  );
  await page.goto('/dashboard');
}

// ── D1.1: Anonymous resources → upgrade banner is visible ─────────────────────

test('D1.1: upgrade banner shown for anonymous tier', async ({ page }) => {
  const anonymousAuth: AuthMeResponse = {
    ok: true,
    user: {
      id: 'usr_anon',
      email: 'anon@tmp.instant.dev',
      tier: 'anonymous',
      created_at: '2026-04-09T00:00:00Z',
    },
  };

  await setupDashboard(page, anonymousAuth, mockResourcesWithAnonymous);

  await expect(page.getByTestId('upgrade-banner')).toBeVisible();
  await expect(page.getByTestId('upgrade-banner')).toContainText(/expire|claim/i);
});

// ── D1.2: Anonymous resource card shows expiry countdown ──────────────────────

test('D1.2: anonymous resource card shows expiry countdown', async ({ page }) => {
  const anonymousAuth: AuthMeResponse = {
    ok: true,
    user: {
      id: 'usr_anon',
      email: 'anon@tmp.instant.dev',
      tier: 'anonymous',
      created_at: '2026-04-09T00:00:00Z',
    },
  };

  await setupDashboard(page, anonymousAuth, mockResourcesWithAnonymous);

  // The anonymous postgres card must have an expiry countdown.
  await expect(page.getByTestId('expiry-countdown')).toBeVisible();
  const countdownText = await page.getByTestId('expiry-countdown').innerText();
  // Should mention hours or minutes.
  expect(countdownText).toMatch(/\d+h|\d+m|hour|min/i);
});

// ── D1.3: Anonymous banner CTA → settings billing (no dead /claim link) ───

test('D1.3: anonymous upgrade banner CTA navigates to billing settings', async ({ page }) => {
  const anonymousAuth: AuthMeResponse = {
    ok: true,
    user: {
      id: 'usr_anon',
      email: 'anon@tmp.instant.dev',
      tier: 'anonymous',
      created_at: '2026-04-09T00:00:00Z',
    },
  };

  await setupDashboard(page, anonymousAuth, mockResourcesWithAnonymous);

  const banner = page.getByTestId('upgrade-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/start\?t=/i);

  await banner.getByRole('link').click();

  await expect(page).toHaveURL(/\/settings/, { timeout: 5000 });
  expect(page.url()).toMatch(/billing|section=billing/);
});

// ── D1.4: Hobby tier → "Upgrade to Pro" banner (not expiry warning) ──────────

test('D1.4: hobby tier shows upgrade-to-pro banner, not expiry warning', async ({ page }) => {
  await setupDashboard(page, mockAuthHobby, mockResources);

  const banner = page.getByTestId('upgrade-banner');
  await expect(banner).toBeVisible();

  const bannerText = await banner.innerText();
  // Should mention upgrade to pro, not expiry.
  expect(bannerText.toLowerCase()).toContain('pro');
  expect(bannerText.toLowerCase()).not.toContain('expire');
});

// ── D1.5: Mixed resources — only anonymous cards show expiry ──────────────────

test('D1.5: only anonymous resource cards show expiry countdown', async ({ page }) => {
  const anonymousAuth: AuthMeResponse = {
    ok: true,
    user: {
      id: 'usr_anon',
      email: 'anon@tmp.instant.dev',
      tier: 'anonymous',
      created_at: '2026-04-09T00:00:00Z',
    },
  };

  // Mix: one anonymous postgres + one hobby redis.
  const mixedResources = {
    ok: true,
    items: [mockAnonymousPostgres, mockRedis],
    total: 2,
  };

  await setupDashboard(page, anonymousAuth, mixedResources);

  // Only one expiry countdown should be visible (for the anonymous resource).
  const countdowns = page.getByTestId('expiry-countdown');
  await expect(countdowns.first()).toBeVisible();

  // The hobby Redis card must NOT have an expiry countdown.
  // (There should be exactly 1 countdown for our 1 anonymous resource.)
  await expect(countdowns).toHaveCount(1);
});

// ── D1.6: Upgrade banner can be dismissed ────────────────────────────────────

test('D1.6: upgrade banner can be dismissed', async ({ page }) => {
  await setupDashboard(page, mockAuthHobby, mockResources);

  await expect(page.getByTestId('upgrade-banner')).toBeVisible();

  // Click the dismiss/close button.
  const dismissBtn = page.getByTestId('upgrade-banner').getByRole('button');
  await expect(dismissBtn).toBeVisible();
  await dismissBtn.click();

  // Banner must disappear.
  await expect(page.getByTestId('upgrade-banner')).not.toBeVisible();
});

// ── D1.7: Pro tier user — no upgrade banner ───────────────────────────────────

test('D1.7: pro tier user sees no upgrade banner', async ({ page }) => {
  await setupDashboard(page, mockAuthPro, mockResources);

  // Banner must not be rendered.
  await expect(page.getByTestId('upgrade-banner')).not.toBeVisible();
});
