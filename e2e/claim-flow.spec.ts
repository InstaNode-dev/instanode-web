/* claim-flow.spec.ts — Chrome-MCP suite S3 (Claim flow), automated.
 *
 * The claim flow is the anonymous→owned funnel: an agent provisions a
 * 24h-TTL resource, the user opens /claim?t=<jwt>, sees a preview, enters
 * an email, and is dropped into the post-claim payment funnel. Before this
 * spec there was ZERO Playwright coverage of /claim — a regression in the
 * JWT decode, the preview render, the single-use 409 path, or the funnel
 * countdown would have shipped silently.
 *
 * All API calls are page.route()-mocked (CLAUDE.md convention 10) so the
 * suite is hermetic — it creates nothing on any backend and needs no
 * teardown. The claim JWT is a hand-built unsigned token: ClaimPage only
 * base64-decodes the payload client-side to render the preview; the real
 * signature check happens server-side on POST /claim, which we mock.
 */

import { expect, test, type Route } from '@playwright/test'
import { FAKE_RAZORPAY_SHORT_URL, FAKE_TEAM } from './fixtures'

// buildClaimJWT — assembles an unsigned 3-segment JWT whose payload carries
// the resource-type + token arrays ClaimPage.decodeJWT() reads. The page
// never verifies the signature, so a literal "sig" third segment is fine.
function buildClaimJWT(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

const VALID_CLAIM_JWT = buildClaimJWT({
  rt: ['postgres', 'redis'],
  tok: ['11111111aaaa', '22222222bbbb'],
  exp: Math.floor(Date.now() / 1000) + 3600,
})

test.describe('Claim flow (S3)', () => {
  test('S3.0 — missing token renders the "Missing claim link" guard', async ({ page }) => {
    await page.goto('/claim')
    await expect(page.getByRole('heading', { name: /missing claim link/i })).toBeVisible()
  })

  test('S3.1 — claim preview shows resource types before claiming', async ({ page }) => {
    await page.goto(`/claim?t=${VALID_CLAIM_JWT}`)
    // The preview card lists each resource decoded from the JWT.
    const preview = page.getByTestId('claim-preview')
    await expect(preview).toBeVisible()
    await expect(preview.getByText('postgres')).toBeVisible()
    await expect(preview.getByText('redis')).toBeVisible()
    // Email entry form is present — claim hasn't happened yet.
    await expect(page.getByTestId('claim-email')).toBeVisible()
  })

  test('S3.5 — malformed/expired token surfaces the invalid-link banner', async ({ page }) => {
    // A non-JWT string fails decodeJWT() → previewErr branch. Before §10.21
    // this rendered a blank email form looking like a normal claim.
    await page.goto('/claim?t=not-a-real-jwt')
    await expect(page.getByTestId('claim-invalid')).toBeVisible()
    await expect(page.getByTestId('claim-invalid-error')).toBeVisible()
    await expect(page.getByTestId('claim-invalid-pricing')).toBeVisible()
  })

  test('S3.4 — successful claim drops the user into the payment funnel', async ({ page }) => {
    // POST /claim → session token. The page then mints a PAT and lists
    // resources to drive the countdown. Mock all three.
    await page.route('**/claim', (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, session_token: 'sess_FAKE_JWT', team_id: FAKE_TEAM }),
      })
    })
    await page.route('**/api/v1/auth/api-keys', (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 'k_new', name: 'dashboard-session', key: 'ink_CLAIMED' }),
      })
    })
    await page.route(/\/api\/v1\/resources(\?[^/]*)?$/, (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          total: 1,
          items: [
            {
              id: '11111111-aaaa-bbbb-cccc-000000000001',
              token: '11111111-aaaa-bbbb-cccc-000000000001',
              resource_type: 'postgres',
              name: 'agent-db',
              env: 'production',
              tier: 'anonymous',
              status: 'active',
              storage_bytes: 0,
              storage_limit_bytes: 10_000_000,
              storage_exceeded: false,
              connections_in_use: 0,
              connections_limit: 2,
              created_at: new Date().toISOString(),
              team_id: FAKE_TEAM,
              // 24h TTL — drives the funnel countdown.
              expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(),
            },
          ],
        }),
      })
    })

    await page.goto(`/claim?t=${VALID_CLAIM_JWT}`)
    await page.getByTestId('claim-email').fill('founder@example.com')
    await page.getByTestId('claim-submit').click()

    // Post-claim funnel: countdown banner + both checkout CTAs.
    await expect(page.getByTestId('claim-funnel')).toBeVisible()
    await expect(page.getByTestId('claim-countdown')).toBeVisible()
    // The countdown shows a real HH:MM:SS, not the "—" no-data placeholder.
    await expect(page.getByTestId('claim-countdown-value')).not.toHaveText('—')
    await expect(page.getByTestId('claim-checkout-hobby')).toBeVisible()
    await expect(page.getByTestId('claim-checkout-pro')).toBeVisible()
  })

  test('S3.3 — single-use claim: a 409 replay surfaces the conflict error', async ({ page }) => {
    // POST /claim returns 409 — the JWT was already consumed (atomic
    // single-use claim, CLAUDE.md convention 7).
    await page.route('**/claim', (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'already_claimed', message: 'This claim link was already used.' }),
      })
    })

    await page.goto(`/claim?t=${VALID_CLAIM_JWT}`)
    await page.getByTestId('claim-email').fill('founder@example.com')
    await page.getByTestId('claim-submit').click()

    // The error stage surfaces the 409 message — no crash, no funnel.
    await expect(page.getByTestId('claim-error')).toBeVisible()
    await expect(page.getByTestId('claim-error')).toContainText(/already used/i)
  })

  test('S3.6 — funnel "Keep my resources" CTA opens Razorpay checkout', async ({ page }) => {
    await page.route('**/claim', (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, session_token: 'sess_FAKE_JWT', team_id: FAKE_TEAM }),
      })
    })
    await page.route('**/api/v1/auth/api-keys', (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 'k_new', name: 'dashboard-session', key: 'ink_CLAIMED' }),
      }),
    )
    await page.route(/\/api\/v1\/resources(\?[^/]*)?$/, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, total: 0, items: [] }),
      }),
    )
    // The checkout call returns a Razorpay short_url. We intercept the
    // navigation to the mock URL so the test stays hermetic — it asserts
    // the redirect was attempted without ever loading rzp.io.
    let navigatedTo: string | null = null
    await page.route('**/api/v1/billing/checkout', (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, short_url: FAKE_RAZORPAY_SHORT_URL }),
      })
    })
    await page.route(FAKE_RAZORPAY_SHORT_URL + '**', (route: Route) => {
      navigatedTo = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>razorpay stub</body></html>' })
    })

    await page.goto(`/claim?t=${VALID_CLAIM_JWT}`)
    await page.getByTestId('claim-email').fill('founder@example.com')
    await page.getByTestId('claim-submit').click()
    await expect(page.getByTestId('claim-funnel')).toBeVisible()

    await page.getByTestId('claim-checkout-hobby').click()
    await expect.poll(() => navigatedTo).toContain('rzp.io')
  })
})
