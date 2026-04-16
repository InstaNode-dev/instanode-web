/**
 * Billing page and Settings page — core UI tests.
 *
 *  BS1  Billing page shows plan tier badge
 *  BS2  Billing page shows upgrade CTA for hobby tier
 *  BS3  Billing page hides upgrade CTA for pro tier
 *  BS4  Billing page shows trial-ends badge when trial_ends_at is set
 *  BS5  Settings page shows team name input pre-filled
 *  BS6  Settings page shows logged-in user email
 *  BS7  Settings page logout button redirects to /login
 */

import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession, mockLogout, mockUnauthenticatedSession } from './helpers/auth';
import { mockAuthHobby, mockAuthPro } from './helpers/fixtures';

// ── Shared helpers ────────────────────────────────────────────────────────────

const MOCK_RESOURCES = {
  ok: true,
  items: [],
  total: 0,
};

const MOCK_TEAM = {
  ok: true,
  team: {
    id: 'team_001',
    name: 'My Team',
    slug: 'my-team',
    owner_id: 'usr_001',
    member_count: 1,
    tier: 'hobby',
    created_at: '2026-01-01T00:00:00Z',
  },
};

// ── BS1: Billing page shows plan tier ────────────────────────────────────────

test('BS1: billing page shows plan tier badge', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  await page.route('**/api/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, plan_tier: 'hobby', trial_ends_at: null }),
    }),
  );

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_RESOURCES),
    }),
  );

  await page.goto('/billing');

  await expect(page.getByTestId('billing-plan-tier')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('billing-plan-tier')).toContainText('hobby');
});

// ── BS2: Billing page shows upgrade CTA for hobby tier ───────────────────────

test('BS2: billing page shows upgrade CTA for hobby tier', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  await page.route('**/api/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, plan_tier: 'hobby', trial_ends_at: null }),
    }),
  );

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_RESOURCES),
    }),
  );

  await page.goto('/billing');

  await expect(page.getByTestId('billing-upgrade-cta')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('billing-upgrade-cta')).toContainText('Upgrade to Pro');
});

// ── BS3: Billing page hides upgrade CTA for pro tier ─────────────────────────

test('BS3: billing page hides upgrade CTA for pro tier', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthPro);

  await page.route('**/api/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, plan_tier: 'pro', trial_ends_at: null }),
    }),
  );

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_RESOURCES),
    }),
  );

  await page.goto('/billing');

  // Wait for the page to be rendered (plan tier badge must appear)
  await expect(page.getByTestId('billing-plan-tier')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('billing-upgrade-cta')).not.toBeVisible();
});

// ── BS4: Billing page shows trial-ends badge ─────────────────────────────────

test('BS4: billing page shows trial-ends badge when trial_ends_at is set', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  const trialEndsAt = '2026-05-01T00:00:00Z';

  await page.route('**/api/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, plan_tier: 'hobby', trial_ends_at: trialEndsAt }),
    }),
  );

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_RESOURCES),
    }),
  );

  await page.goto('/billing');

  await expect(page.getByTestId('billing-trial-ends')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('billing-trial-ends')).toContainText('Trial ends');
});

// ── BS5: Settings page shows team name pre-filled ────────────────────────────

test('BS5: settings page shows team name and allows edit', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  // Override the team route to return a specific name.
  await page.route('**/api/v1/team', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TEAM),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, team: MOCK_TEAM.team }),
    });
  });

  await page.goto('/settings?section=team');

  // Wait for the section container first (auth + data load), then check inputs.
  await expect(page.getByTestId('settings-team')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('settings-team-name-input')).toBeVisible();
  // The value comes from mockAuthHobby.team.name ("Test Team"), not MOCK_TEAM.
  await expect(page.getByTestId('settings-team-name-input')).toHaveValue('Test Team');
  await expect(page.getByTestId('settings-save-btn')).toBeVisible();
});

// ── BS6: Settings page shows logged-in user email ────────────────────────────

test('BS6: settings page shows logged-in user email', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  await page.goto('/settings');

  // Account section is the default view.
  await expect(page.getByTestId('settings-user-email')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('settings-user-email')).toHaveValue('test@example.com');
});

// ── BS7: Settings logout button redirects to /login ──────────────────────────

test('BS7: settings logout button redirects to /login', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);
  await mockLogout(page);

  await page.goto('/settings');

  await expect(page.getByTestId('settings-logout-btn')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('settings-logout-btn').click();

  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
});

// ── BS8: Billing page redirects unauthenticated users to /login ───────────────

test('BS8: billing page redirects unauthenticated users to /login', async ({ page }) => {
  await mockUnauthenticatedSession(page);

  await page.goto('/billing');

  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
});
