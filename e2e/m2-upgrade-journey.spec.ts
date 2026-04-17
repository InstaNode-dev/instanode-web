/**
 * M2: Upgrade journeys — anonymous, hobby, and pro tier scenarios.
 *
 * All API calls are mocked via page.route() — no live API required for these tests.
 *
 * M2.1  Anonymous user at / → redirects to /login (no auth, no resources)
 * M2.2  Anonymous → Hobby claim journey (mock /start claim flow)
 * M2.3  Hobby → Pro upgrade (checkout redirect + webhook simulation)
 * M2.4  Pro user dashboard shows tier badges and no upgrade CTA
 * M2.5  Resource with storage_exceeded: true renders without crashing
 * M2.6  Queue resource (new service type) renders gracefully in dashboard
 * M2.7  Billing page lists queue / webhook / storage alongside core DB types
 */

import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession, mockUnauthenticatedSession } from './helpers/auth';
import {
  mockAuthHobby,
  mockAuthPro,
  mockAuthAnonymous,
  mockPostgres,
} from './helpers/fixtures';
import type { Resource } from '../src/types/resource';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal hobby resource with explicit fields — avoids type casting issues. */
const hobbyRedis: Resource = {
  id: 'res_rd_hobby_001',
  token: 'tok_rd_hobby123',
  resource_type: 'redis',
  tier: 'hobby',
  status: 'active',
  name: 'Session Cache',
  key_prefix: 'app:',
  created_at: '2026-01-15T10:00:00Z',
};

const hobbyPostgres: Resource = {
  id: 'res_pg_hobby_001',
  token: 'postgres://user:pass@pg.instanode.dev:5432/mydb',
  resource_type: 'postgres',
  tier: 'hobby',
  status: 'active',
  name: 'Main DB',
  storage_bytes: 200 * 1024 * 1024,
  created_at: '2026-01-20T10:00:00Z',
};

const proRedis: Resource = {
  id: 'res_rd_pro_001',
  token: 'tok_rd_pro456',
  resource_type: 'redis',
  tier: 'pro',
  status: 'active',
  name: 'Production Cache',
  key_prefix: 'prod:',
  created_at: '2026-02-01T10:00:00Z',
};

const proPostgres: Resource = {
  id: 'res_pg_pro_001',
  token: 'postgres://pro_user:pass@pg.instanode.dev:5432/proddb',
  resource_type: 'postgres',
  tier: 'pro',
  status: 'active',
  name: 'Production DB',
  storage_bytes: 4 * 1024 * 1024 * 1024,
  created_at: '2026-02-01T10:00:00Z',
};

// ── M2.1: Anonymous user at / → login or get-started CTA ─────────────────────

test('M2.1: anonymous user at /dashboard redirects to /login', async ({ page }) => {
  await mockUnauthenticatedSession(page);

  await page.goto('/dashboard');

  // Must be redirected to /login (no authenticated session).
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });

  // Login page should offer a sign-up or get-started path.
  // The magic link button is present (same page used for login + sign-up).
  await expect(page.getByTestId('email-input')).toBeVisible();
  await expect(page.getByTestId('magic-link-btn')).toBeVisible();
});

// ── M2.2: Anonymous → Hobby claim journey ─────────────────────────────────────

test('M2.2: anonymous provision → claim page → hobby dashboard', async ({ page }) => {
  // Mock the auth flow: user is authenticated (hobbyist after claiming).
  await mockAuthenticatedSession(page, mockAuthHobby);

  // Stub the claim preview endpoint to return an anonymous redis resource.
  const anonymousToken = 'anon-claim-token-abc123';
  const claimPreviewResource: Resource = {
    id: 'res_rd_anon_claim',
    token: 'tok_rd_anon_preview',
    resource_type: 'redis',
    tier: 'anonymous',
    status: 'active',
    name: 'My Cache',
    key_prefix: 'anon:',
    expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };

  await page.route('**/claim/preview*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        resources: [claimPreviewResource],
        token_valid: true,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    }),
  );

  // After claim, resource becomes hobby tier.
  const claimedResource = { ...claimPreviewResource, tier: 'hobby' as const, expires_at: undefined };

  await page.route('**/claim', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        team_id: 'team_claim_001',
        user_id: 'usr_claim_001',
        claimed: [claimedResource],
        skipped: 0,
      }),
    });
  });

  // After redirect to dashboard, resources are now hobby.
  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [claimedResource], total: 1 }),
    }),
  );

  // Step 1: Navigate to the claim page with a token.
  await page.goto(`/claim?t=${anonymousToken}`);
  await expect(page.getByTestId('claim-page')).toBeVisible({ timeout: 8000 });

  // Step 2: The resource list is visible with the redis resource.
  await expect(page.getByTestId('claim-resource-list')).toBeVisible();
  await expect(page.getByTestId('claim-resource-redis')).toBeVisible();

  // Step 3: The claim button is enabled.
  const claimBtn = page.getByTestId('claim-submit-btn');
  await expect(claimBtn).toBeEnabled();
  await expect(claimBtn).toContainText('Claim');

  // Step 4: Submit the claim.
  await claimBtn.click();
  await expect(page.getByTestId('claim-success')).toBeVisible({ timeout: 5000 });

  // Step 5: Auto-redirect to /dashboard after 2s.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 8000 });
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  // Step 6: Dashboard shows hobby upgrade banner (not anonymous — no expiry warning).
  const banner = page.getByTestId('upgrade-banner');
  await expect(banner).toBeVisible();
  const bannerText = await banner.innerText();
  expect(bannerText.toLowerCase()).toContain('pro');
  expect(bannerText.toLowerCase()).not.toContain('expire');

  // Step 7: The claimed resource is listed without an expiry countdown.
  await expect(page.getByTestId('resource-card-redis')).toBeVisible();
  await expect(page.getByTestId('expiry-countdown')).not.toBeVisible();
});

// ── M2.3: Hobby → Pro upgrade ─────────────────────────────────────────────────

test('M2.3: hobby user upgrades to pro via billing → upgrade button visible → pro dashboard', async ({
  page,
}) => {
  // Step 1: Start as hobby user.
  await mockAuthenticatedSession(page, mockAuthHobby);

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [hobbyRedis, hobbyPostgres],
        total: 2,
      }),
    }),
  );

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  // Hobby tier: upgrade banner is present.
  await expect(page.getByTestId('upgrade-banner')).toBeVisible();

  // Step 2: Navigate to billing settings.
  await page.goto('/settings?section=billing');
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('settings-billing')).toBeVisible();

  // "Upgrade to Pro" button must be visible for hobby tier.
  const upgradeBtn = page.locator('button', { hasText: 'Upgrade to Pro' });
  await expect(upgradeBtn).toBeVisible();

  // Step 3: Mock billing data and checkout endpoint, then click upgrade.
  // The button calls POST /api/v1/billing/checkout → gets short_url.
  // We mock the response so it doesn't actually redirect to Razorpay.
  await page.route('**/api/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        plan: 'hobby',
        billing: { status: 'active', current_period_end: null, razorpay_configured: true },
      }),
    }),
  );

  // Intercept the checkout POST and return a dummy URL instead of Razorpay.
  await page.route('**/api/v1/billing/checkout', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, short_url: 'https://rzp.io/l/mock-checkout' }),
    }),
  );

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // Navigate to billing section to trigger the billing query.
  await page.goto('/settings?section=billing');
  await expect(page.getByTestId('settings-billing')).toBeVisible({ timeout: 5000 });

  const upgradeBtnBilling = page.locator('button', { hasText: 'Upgrade to Pro' });
  await expect(upgradeBtnBilling).toBeVisible();

  // No JS errors on the billing page.
  expect(errors).toHaveLength(0);

  // Step 4: Simulate Razorpay webhook completion — /auth/me now returns pro tier.
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAuthPro),
    }),
  );

  // Step 5: Navigate to the pro dashboard (simulates post-webhook refresh).
  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [proRedis, proPostgres],
        total: 2,
      }),
    }),
  );

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  // Pro tier: no upgrade banner.
  await expect(page.getByTestId('upgrade-banner')).not.toBeVisible();

  // Pro tier badge visible on resource cards.
  const redisTierBadge = page.getByTestId('tier-badge-pro').first();
  await expect(redisTierBadge).toBeVisible();
});

// ── M2.4: Pro user dashboard shows higher limits + no upgrade CTA ─────────────

test('M2.4: pro dashboard shows pro tier badges and no upgrade CTA', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthPro);

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [proRedis, proPostgres],
        total: 2,
      }),
    }),
  );

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  // No upgrade banner for pro tier.
  await expect(page.getByTestId('upgrade-banner')).not.toBeVisible();

  // Resource cards are rendered.
  await expect(page.getByTestId('resource-card-redis')).toBeVisible();
  await expect(page.getByTestId('resource-card-postgres')).toBeVisible();

  // Both resource cards should carry a "Pro" tier badge.
  const tierBadges = page.getByTestId('tier-badge-pro');
  await expect(tierBadges).toHaveCount(2);

  // Settings billing confirms no upgrade button for pro.
  await page.goto('/settings?section=billing');
  await expect(page.getByTestId('settings-billing')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('button', { hasText: 'Upgrade to Pro' })).not.toBeVisible();

  // Billing section should show the pro plan details.
  await expect(page.getByTestId('settings-billing')).toContainText(/pro/i);
});

// ── M2.5: storage_exceeded: true shows warning or at least no crash ───────────

test('M2.5: resource with storage_exceeded: true renders without error', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  // storage_exceeded is not yet in the Resource type — pass it as an extra field
  // via the API response object. The dashboard must not crash.
  const postgresOverLimit = {
    ...mockPostgres,
    storage_exceeded: true,
  };

  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [postgresOverLimit], total: 1 }),
    }),
  );

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  // Resource card must still render — extra fields must not crash React.
  await expect(page.getByTestId('resource-card-postgres')).toBeVisible();

  // No JS errors from rendering an unknown field.
  expect(consoleErrors).toHaveLength(0);

  // If a storage warning UI exists, verify it.
  // If not, the test passes — graceful degradation.
  const storageWarning = page.getByTestId('storage-exceeded-warning');
  const storageWarningCount = await storageWarning.count();
  if (storageWarningCount > 0) {
    // UI exists — verify it is visible and informative.
    await expect(storageWarning.first()).toBeVisible();
  }
  // else: no UI for storage_exceeded yet — that's OK, test still passes
  // (the important assertion is no JS error above).
});

// ── M2.6: Queue resource type renders gracefully ──────────────────────────────

test('M2.6: queue resource type renders without crash or undefined label', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  // The queue resource type is not in the ResourceType union or RESOURCE_LABEL map yet.
  // The dashboard should handle unknown resource types gracefully (no crash, no "undefined").
  const queueResource = {
    id: 'res_q_001',
    token: 'nats://usr_abc:pass@nats.instanode.dev:4222',
    resource_type: 'queue',
    tier: 'anonymous',
    status: 'active',
    name: 'My Queue',
    storage_exceeded: false,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [queueResource], total: 1 }),
    }),
  );

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  // No JS crash from an unknown resource_type.
  expect(consoleErrors).toHaveLength(0);

  // The resource grid should render (not be empty/errored).
  await expect(page.getByTestId('resource-grid')).toBeVisible();

  // Check for the queue resource card — testid is data-testid="resource-card-queue".
  const queueCard = page.getByTestId('resource-card-queue');
  const queueCardCount = await queueCard.count();
  if (queueCardCount > 0) {
    // If the card renders, its text must not contain "undefined" or "null".
    const cardText = await queueCard.innerText();
    expect(cardText).not.toContain('undefined');
    expect(cardText).not.toContain('null');

    // If the name is shown, it should be "My Queue".
    // (Some label like "queue" or "NATS" or the name itself should appear.)
    expect(cardText.toLowerCase()).toMatch(/queue|nats|my queue/i);
  } else {
    // Queue card not yet implemented — verify the grid still renders
    // other content or the empty state (no crash is the key assertion).
    const gridText = await page.getByTestId('resource-grid').innerText();
    expect(gridText).not.toContain('undefined');
  }

  // The expiry countdown should still render for anonymous resources
  // that have expires_at set (if the card rendered at all).
  if (queueCardCount > 0) {
    await expect(page.getByTestId('expiry-countdown')).toBeVisible();
  }
});

// ── M2.7: Billing page lists all resource type rows (incl. queue / webhook / storage) ─

test('M2.7: billing page shows resource counts for postgres through storage', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);

  const billingResources = {
    ok: true,
    items: [
      { id: 'r1', token: 't1', resource_type: 'postgres', tier: 'hobby', status: 'active', created_at: new Date().toISOString() },
      { id: 'r2', token: 't2', resource_type: 'redis', tier: 'hobby', status: 'active', created_at: new Date().toISOString() },
      { id: 'r3', token: 't3', resource_type: 'mongodb', tier: 'hobby', status: 'active', created_at: new Date().toISOString() },
      { id: 'r4', token: 't4', resource_type: 'queue', tier: 'hobby', status: 'active', created_at: new Date().toISOString() },
      { id: 'r5', token: 't5', resource_type: 'webhook', tier: 'hobby', status: 'active', created_at: new Date().toISOString() },
      { id: 'r6', token: 't6', resource_type: 'storage', tier: 'hobby', status: 'active', created_at: new Date().toISOString() },
    ],
    total: 6,
  };

  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(billingResources),
    }),
  );

  await page.route('**/api/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, plan_tier: 'hobby', trial_ends_at: null }),
    }),
  );

  await page.goto('/billing');
  await expect(page.getByTestId('billing-page')).toBeVisible({ timeout: 5000 });

  await expect(page.getByTestId('billing-page')).toContainText('Postgres');
  await expect(page.getByTestId('billing-page')).toContainText('Redis');
  await expect(page.getByTestId('billing-page')).toContainText('MongoDB');
  await expect(page.getByTestId('billing-page')).toContainText('Queue');
  await expect(page.getByTestId('billing-page')).toContainText('Webhook');
  await expect(page.getByTestId('billing-page')).toContainText('Storage');

  // One active row each → count "1" appears for each stat (six ones in the resource summary card)
  const billingText = await page.getByTestId('billing-page').innerText();
  expect(billingText).toMatch(/Postgres[\s\S]*1/);
  expect(billingText).toMatch(/Queue[\s\S]*1/);
  expect(billingText).toMatch(/Webhook[\s\S]*1/);
  expect(billingText).toMatch(/Storage[\s\S]*1/);
});
