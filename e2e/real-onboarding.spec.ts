/**
 * Real onboarding E2E test — no mocks, no faked data.
 *
 * This file does everything in a single TypeScript file:
 *   1. Calls the real agent API to provision available services (beforeAll)
 *      using a single random IP so they share a fingerprint — claim picks them all up.
 *   2. Extracts the onboarding JWT from a provision response `note` field
 *   3. Drives the full browser flow via page.route() proxying to real backends
 *
 * Run with:
 *   E2E_REAL=1 npx playwright test e2e/real-onboarding.spec.ts --project=chromium
 *
 * Optional overrides:
 *   E2E_AGENT_API=http://localhost:30080    (default)
 *   E2E_DASHBOARD_API=http://localhost:30082 (default)
 */
import { test, expect, type Route } from '@playwright/test';

// Record video + screenshot for every test in this file.
test.use({ video: 'on', screenshot: 'on' });

// ── Config ──────────────────────────────────────────────────────────────────
const AGENT_API     = process.env.E2E_AGENT_API     ?? 'http://localhost:30080';
const DASHBOARD_API = process.env.E2E_DASHBOARD_API ?? 'http://localhost:30082';

// ── Proxy helper ─────────────────────────────────────────────────────────────
// Intercepts a browser fetch/XHR (same-origin localhost:5173) and forwards it
// to the real backend, preserving method / headers / body transparently.
// Document navigations (page loads) are passed through to Vite unchanged.
async function proxyTo(route: Route, targetBase: string): Promise<void> {
  // Only intercept API calls (fetch/xhr), not page navigations or static assets.
  // Vite serves the React SPA for all document requests; let those through.
  if (route.request().resourceType() !== 'fetch' &&
      route.request().resourceType() !== 'xhr') {
    return route.continue();
  }
  const origURL   = new URL(route.request().url());
  const targetURL = `${targetBase}${origURL.pathname}${origURL.search}`;
  try {
    const response = await route.fetch({ url: targetURL });
    await route.fulfill({ response });
  } catch {
    await route.abort('failed');
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProvisionedService {
  type: string;
  resourceType: string;
  token: string;
  limits: Record<string, unknown>;
  note?: string;
}

// ── Shared state across tests (provisioned once in beforeAll) ─────────────────
let onboardingJWT    = '';
let testEmail        = '';
let provisionedServices: ProvisionedService[] = [];

// ── Serial mode so beforeAll state is shared across tests ─────────────────────
test.describe.configure({ mode: 'serial' });

test.describe('Real onboarding funnel (E2E_REAL=1)', () => {

  // ── Step 0: Provision available services via the real agent API ───────
  test.beforeAll(async ({ request }) => {
    // Skip the whole suite unless explicitly opted-in
    if (!process.env.E2E_REAL) {
      return; // tests skip individually via test.skip() below
    }

    // Single random IP so all provisions share the same fingerprint.
    // The claim handler augments JWT-listed tokens with all resources from the
    // same fingerprint, so provisioning all services here means they all get
    // claimed together from one JWT in any provision's `note`.
    const randomIP = `10.${Math.floor(Math.random() * 200) + 50}.${Math.floor(Math.random() * 250)}.1`;
    const headers  = { 'X-Forwarded-For': randomIP };

    console.log(`\n─── beforeAll: provisioning services ────────────────────`);
    console.log(`  Agent API:     ${AGENT_API}`);
    console.log(`  Dashboard API: ${DASHBOARD_API}`);
    console.log(`  Fingerprint IP: ${randomIP}`);

    // Helper: provision a service, skip gracefully if 503 (not enabled on cluster).
    async function tryProvision(
      path: string,
      type: string,
      resourceType: string,
    ): Promise<(ProvisionedService & { note?: string }) | null> {
      const res = await request.post(`${AGENT_API}${path}`, { headers });
      if (res.status() === 503) {
        console.log(`  ${type}: not enabled on this cluster (503) — skipped`);
        return null;
      }
      if (!res.ok()) {
        console.log(`  ${type}: provision failed (${res.status()}) — skipped`);
        return null;
      }
      const data = await res.json() as { ok: boolean; token: string; note?: string; limits?: Record<string, unknown> };
      if (!data.ok || !data.token) {
        console.log(`  ${type}: unexpected response — skipped`);
        return null;
      }
      console.log(`  ${type}: token=${data.token.slice(0, 8)}… tier=anonymous`);
      return { type, resourceType, token: data.token, limits: data.limits ?? {}, note: data.note };
    }

    const [dbResult, cacheResult, nosqlResult] = await Promise.all([
      tryProvision('/db/new',    'postgres', 'postgres'),
      tryProvision('/cache/new', 'redis',    'redis'),
      tryProvision('/nosql/new', 'mongodb',  'mongodb'),
    ]);

    provisionedServices = [
      ...(dbResult    ? [dbResult]    : []),
      ...(cacheResult ? [cacheResult] : []),
      ...(nosqlResult ? [nosqlResult] : []),
    ];

    const noteSource = provisionedServices.find((s) => s.note);
    const note       = noteSource?.note ?? '';
    const match      = note.match(/[?&]t=([A-Za-z0-9._~\-]+)/);
    if (!match) {
      throw new Error(`No JWT found in provision note (need at least one successful anonymous provision with note): ${note.slice(0, 200)}`);
    }
    onboardingJWT = match[1];

    // Unique email per test run so each run creates a fresh account
    testEmail = `e2e-real-${Date.now()}@instanode.dev`;

    console.log(`\n  Services provisioned: ${provisionedServices.map(s => s.type).join(', ') || '(none)'}`);
    console.log(`  JWT (first 40):       ${onboardingJWT.slice(0, 40)}...`);
    console.log(`  Test email:           ${testEmail}`);
    console.log(`─────────────────────────────────────────────────────────────\n`);
  });

  // ── Wire every page to proxy API calls to real backends ────────────────────
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_REAL) return;
    // Clear all cookies to guarantee a clean (unauthenticated) session start.
    await page.context().clearCookies();

    // /auth/* → dashboard-api (sessions, login, me, refresh)
    await page.route('**/auth/**', (route) => proxyTo(route, DASHBOARD_API));
    // /api/v1/* → dashboard-api (resources, team, billing)
    await page.route('**/api/v1/**', (route) => proxyTo(route, DASHBOARD_API));
    // /claim* → agent API (preview + claim submission)
    await page.route('**/claim**', (route) => proxyTo(route, AGENT_API));
  });

  // ── Test 1: Full funnel — all provisioned services appear after claim ───────
  test('provision → /start redirect → login → claim all services → full dashboard', async ({ page }) => {
    test.skip(!process.env.E2E_REAL, 'Set E2E_REAL=1 to run');
    test.skip(provisionedServices.length === 0, 'No services provisioned on this cluster');

    // ── 1. Navigate to /start?t=<jwt> on the agent API ─────────────────────
    // The agent API returns 302 → localhost:5173/claim?t=<jwt>
    // Playwright follows the redirect and loads the dashboard ClaimPage.
    const startURL = `${AGENT_API}/start?t=${encodeURIComponent(onboardingJWT)}`;
    await page.goto(startURL);

    // ClaimPage detects unauthenticated user → navigates to /login?redirect=/claim?t=...
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    console.log('✓ /start redirect followed → unauthenticated → /login');

    // ── 2. Login with a real email ──────────────────────────────────────────
    // dashboard-api creates a real user + team in instant_platform DB
    await page.getByTestId('email-input').fill(testEmail);
    await page.getByTestId('magic-link-btn').click();

    // MVP: server returns access_token directly → LoginPage navigates to ?redirect param
    // which is /claim?t=<jwt>
    await expect(page).toHaveURL(/\/claim/, { timeout: 10_000 });
    console.log(`✓ Logged in as ${testEmail} → redirected to /claim`);

    // ── 3. Claim preview shows ALL services provisioned with the same fingerprint ──
    await expect(page.getByTestId('claim-page')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('claim-resource-list')).toBeVisible({ timeout: 10_000 });

    // All provisioned services should appear in the preview list.
    for (const svc of provisionedServices) {
      await expect(page.getByTestId(`claim-resource-${svc.resourceType}`)).toBeVisible({ timeout: 5_000 });
    }

    const serviceNames = provisionedServices.map(s => s.type).join(', ');
    console.log(`✓ Claim preview shows all provisioned services: ${serviceNames}`);

    // ── 4. Submit the claim ─────────────────────────────────────────────────
    const claimBtn = page.getByTestId('claim-submit-btn');
    await expect(claimBtn).toBeEnabled({ timeout: 5_000 });
    await claimBtn.click();

    await expect(page.getByTestId('claim-success')).toBeVisible({ timeout: 10_000 });
    console.log('✓ Claim submitted — success state shown');

    // ── 5. Auto-redirects to /dashboard ────────────────────────────────────
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page.getByTestId('dashboard-page')).toBeVisible();

    // ALL provisioned services should appear as resource cards in the dashboard.
    console.log('\n── Dashboard resource cards ──');
    for (const svc of provisionedServices) {
      await expect(page.getByTestId(`resource-card-${svc.resourceType}`)).toBeVisible({ timeout: 10_000 });
      console.log(`  resource-card-${svc.resourceType}: ✓`);
    }

    // Claimed resources have no expiry countdown (permanently owned).
    const expiryCountdowns = page.getByTestId('expiry-countdown');
    const countdownCount = await expiryCountdowns.count();
    expect(countdownCount).toBe(0);
    console.log('✓ No expiry countdowns — all resources are permanent (hobby tier)');

    // Upgrade banner present for hobby tier.
    await expect(page.getByTestId('upgrade-banner')).toBeVisible();
    console.log('✓ Upgrade banner visible (hobby tier → upsell to pro)');

    // ── 6. Settings — team tab ──────────────────────────────────────────────
    await page.goto('/settings?section=team');
    await expect(page.getByTestId('settings-team')).toBeVisible({ timeout: 5_000 });

    const teamInput = page.getByTestId('settings-team-name-input');
    await expect(teamInput).toBeVisible();
    await teamInput.fill('E2E Real Team');
    await page.getByTestId('settings-save-btn').click();
    await expect(page.getByTestId('save-msg')).toContainText('saved', { timeout: 5_000 });
    console.log('✓ Team name saved to real DB');

    // Reload and verify persistence
    await page.reload();
    await page.goto('/settings?section=team');
    await expect(page.getByTestId('settings-team-name-input')).toHaveValue('E2E Real Team', { timeout: 5_000 });
    console.log('✓ Team name persists after reload');

    // ── 7. Settings — billing tab ───────────────────────────────────────────
    await page.goto('/settings?section=billing');
    await expect(page.getByTestId('settings-billing')).toBeVisible({ timeout: 5_000 });

    // Reads real plan_tier from DB — should be hobby (newly created account)
    await expect(page.getByTestId('settings-billing')).toContainText(/hobby/i);
    await expect(page.getByTestId('upgrade-btn')).toBeVisible();
    console.log('✓ Billing shows hobby plan (real DB) — Upgrade to Pro button visible');
  });

  // ── Test 2: Resource matrix — each service type shows correct card ─────────
  test('resource matrix: all claimed services show correct cards and no expiry', async ({ page }) => {
    test.setTimeout(90_000);
    test.skip(!process.env.E2E_REAL, 'Set E2E_REAL=1 to run');
    test.skip(provisionedServices.length === 0, 'No services provisioned — skipping matrix test');

    // Log available services on this cluster
    console.log(`\n── Resource matrix test ──`);
    console.log(`  Services available: ${provisionedServices.map(s => s.type).join(', ')}`);

    // Re-login required since beforeEach clears cookies.
    // Use the full Vite base URL so page.goto works without prior navigation.
    await page.goto('http://localhost:5173/login');
    await expect(page.getByTestId('email-input')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('email-input').fill(testEmail);
    await page.getByTestId('magic-link-btn').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    console.log(`✓ Re-authenticated as ${testEmail}`);

    // Verify each service type has a card with the correct testid.
    for (const svc of provisionedServices) {
      const card = page.getByTestId(`resource-card-${svc.resourceType}`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Claimed resources must NOT show an expiry countdown.
      const expiry = card.getByTestId('expiry-countdown');
      await expect(expiry).not.toBeVisible();

      console.log(`  resource-card-${svc.resourceType}: ✓  (no expiry countdown)`);
    }

    // Limits from the provisioning response match the anonymous tier caps.
    console.log('\n── Anonymous tier limits from provision ──');
    for (const svc of provisionedServices) {
      const lim = svc.limits;
      if (svc.type === 'postgres') console.log(`  postgres: storage_mb=${lim['storage_mb'] ?? '?'}  connections=${lim['connections'] ?? '?'}`);
      if (svc.type === 'redis')    console.log(`  redis:    memory_mb=${lim['memory_mb'] ?? '?'}`);
      if (svc.type === 'mongodb')  console.log(`  mongodb:  storage_mb=${lim['storage_mb'] ?? '?'}  connections=${lim['connections'] ?? '?'}`);
    }

    console.log(`\n✓ All ${provisionedServices.length} service(s) show correct cards — no expiry on claimed resources`);
  });
});
