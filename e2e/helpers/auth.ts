import type { Page } from '@playwright/test';
import type { AuthMeResponse } from '../../src/types/auth';
import { mockAuthHobby } from './fixtures';

/**
 * Mock an authenticated session on the given page.
 * Intercepts /auth/refresh and /auth/me so the app thinks the user is signed in.
 */
export async function mockAuthenticatedSession(
  page: Page,
  authData: AuthMeResponse = mockAuthHobby,
): Promise<void> {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, access_token: 'mock-jwt-token' }),
    }),
  );

  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(authData),
    }),
  );

  // Mock billing endpoint — plan tier matches the auth data tier
  const tier = authData.user?.tier ?? 'hobby';
  await page.route('**/api/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        plan: tier,
        billing: { status: 'active', current_period_end: null, razorpay_configured: false },
      }),
    }),
  );

  // Mock team endpoint
  await page.route('**/api/v1/team', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          team: {
            id: authData.team?.id ?? 'mock-team-id',
            name: authData.team?.name ?? 'Test Team',
            slug: 'test-team',
            owner_id: authData.user?.id ?? 'mock-user-id',
            member_count: authData.team?.member_count ?? 1,
            tier,
            created_at: authData.team?.created_at ?? new Date().toISOString(),
          },
        }),
      });
    }
    // PATCH — return success
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, msg: 'Team settings updated', team: {} }),
    });
  });
}

/**
 * Mock an unauthenticated state — refresh returns 401.
 */
export async function mockUnauthenticatedSession(page: Page): Promise<void> {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'no refresh token', code: 'unauthorized' }),
    }),
  );

  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'unauthorized', code: 'unauthorized' }),
    }),
  );
}

/**
 * Mock the logout endpoint.
 */
export async function mockLogout(page: Page): Promise<void> {
  await page.route('**/auth/logout', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );
}
