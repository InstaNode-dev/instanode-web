/**
 * D2: Auth Guards — route protection and auth lifecycle.
 *
 *  D2.1  Navigate to /dashboard unauthenticated → redirect to /login
 *  D2.2  Navigate to /resources/:id unauthenticated → redirect to /login
 *  D2.3  Navigate to /settings unauthenticated → redirect to /login
 *  D2.4  Login page → fill email → submit (mocked) → redirect to /dashboard
 *  D2.5  Logout → calls /auth/logout → redirects to /login
 *  D2.6  Token refresh on load → if 401 → redirect to /login
 *  D2.7  Login page: GitHub OAuth button is visible
 *  D2.8  Login page: invalid email shows validation error
 */

import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession, mockUnauthenticatedSession, mockLogout } from './helpers/auth';
import { mockResources, mockAuthHobby } from './helpers/fixtures';

// ── D2.1: /dashboard unauthenticated → /login ────────────────────────────────

test('D2.1: /dashboard redirects to /login when unauthenticated', async ({ page }) => {
  await mockUnauthenticatedSession(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
});

// ── D2.2: /dashboard/resources/:id unauthenticated → /login ──────────────────

test('D2.2: /resources/:id redirects to /login when unauthenticated', async ({ page }) => {
  await mockUnauthenticatedSession(page);
  await page.goto('/dashboard/resources/res_pg_001');
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
});

// ── D2.3: /settings unauthenticated → /login ─────────────────────────────────

test('D2.3: /settings redirects to /login when unauthenticated', async ({ page }) => {
  await mockUnauthenticatedSession(page);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
});

// ── D2.4: Login → magic link sent state ──────────────────────────────────────

test('D2.4: login form submits and shows magic link sent state', async ({ page }) => {
  // Mock the login POST.
  await page.route('**/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'magic link sent' }),
    }),
  );

  await page.goto('/login');

  await expect(page.getByTestId('email-input')).toBeVisible();
  await page.getByTestId('email-input').fill('test@example.com');
  await page.getByTestId('magic-link-btn').click();

  // After submission, shows "magic link sent" state.
  await expect(page.getByTestId('magic-link-sent')).toBeVisible({ timeout: 5000 });
});

// ── D2.5: Logout → POST /auth/logout → redirect to /login ────────────────────

test('D2.5: logout button calls /auth/logout and redirects to /login', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);
  await mockLogout(page);
  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResources),
    }),
  );

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  // Click the Sign out button in TopNav.
  // logout sets queryData(AUTH_QUERY_KEY, null) directly, so useRequireAuth
  // redirects to /login immediately without a re-fetch cycle.
  await page.getByTestId('logout-btn').click();

  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
});

// ── D2.6: Token refresh 401 on load → redirect to /login ─────────────────────

test('D2.6: expired session (refresh 401) redirects to /login', async ({ page }) => {
  // Return 401 on refresh — session has expired.
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'token expired', code: 'unauthorized' }),
    }),
  );

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
});

// ── D2.7: Login page: GitHub OAuth button is visible ─────────────────────────

test('D2.7: login page shows GitHub OAuth button', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('github-oauth-btn')).toBeVisible();
});

// ── D2.8: Login page: magic link button disabled with empty email ─────────────

test('D2.8: login form with empty email shows validation error', async ({ page }) => {
  await page.goto('/login');

  // Button must be disabled when email field is empty.
  await expect(page.getByTestId('magic-link-btn')).toBeDisabled();

  // Filling a valid email enables the button.
  await page.getByTestId('email-input').fill('test@example.com');
  await expect(page.getByTestId('magic-link-btn')).toBeEnabled();

  // Clearing it disables again.
  await page.getByTestId('email-input').fill('');
  await expect(page.getByTestId('magic-link-btn')).toBeDisabled();
});

// ── D2.9: Authenticated user visiting /login → redirect to /dashboard ─────────

test('D2.9: authenticated user at /login is redirected to /dashboard', async ({ page }) => {
  await mockAuthenticatedSession(page, mockAuthHobby);
  await page.route('**/api/v1/resources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResources),
    }),
  );

  await page.goto('/login');

  // Should be redirected to dashboard.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 });
});
