/* index.test.ts — unit coverage for the dashboard's API client.
 *
 * Covers the LIVE endpoints used by BillingPage + ClaimPage + the auth
 * helpers, plus the getAPIBaseURL() resolution paths. The 503 fallbacks
 * for fetchBilling() and listInvoices() are exercised because they are
 * the only thing keeping the page rendering in local dev (where
 * Razorpay isn't configured).
 *
 * Strategy: mock globalThis.fetch — the module's call() helper calls
 * fetch() directly, so this is the lightest possible seam. No msw, no
 * fixture pattern needed. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchBilling,
  listInvoices,
  createCheckout,
  changePlan,
  cancelSubscription,
  claim,
  getAPIBaseURL,
  fetchMe,
  logout,
  getToken,
  setToken,
  clearToken,
  listResources,
  deleteResource,
  listAPIKeys,
  listStacks,
  fetchStackFamily,
  listDeployments,
  getDeployment,
  createDeploy,
  updateDeploymentAccess,
  reportExperimentConverted,
  validatePromotion,
  createStack,
  fetchStackStatus,
  registerLogoutHook,
} from './index'
// §10.21: FIXTURE_BILLING / FIXTURE_INVOICES imports retired. The 503
// fallback paths in fetchBilling() and listInvoices() were removed —
// errors now propagate so consumers can render real error banners.

// ─── Test helpers ────────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn>

/** Build a Response-like object that fetch() returns. */
function jsonResponse(body: any, init: { status?: number; statusText?: string } = {}): Response {
  const status = init.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function textResponse(body: string, init: { status?: number; statusText?: string } = {}): Response {
  const status = init.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    headers: new Headers({ 'content-type': 'text/plain' }),
    json: async () => null,
    text: async () => body,
  } as unknown as Response
}

function installFetch(): FetchMock {
  const m = vi.fn() as FetchMock
  vi.stubGlobal('fetch', m)
  return m
}

beforeEach(() => {
  // Each test starts with a clean token + window override.
  try { localStorage.clear() } catch { /* jsdom */ }
  delete (window as any).__INSTANODE_API_URL__
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ─── getAPIBaseURL() ─────────────────────────────────────────────────────
describe('getAPIBaseURL()', () => {
  it('returns window.__INSTANODE_API_URL__ when set (highest priority)', () => {
    ;(window as any).__INSTANODE_API_URL__ = 'http://localhost:30080'
    expect(getAPIBaseURL()).toBe('http://localhost:30080')
  })

  it('window override beats every other source (smoke)', () => {
    ;(window as any).__INSTANODE_API_URL__ = 'http://override.test'
    expect(getAPIBaseURL()).toBe('http://override.test')
  })

  // VITE_API_URL / DEV branches are inlined by Vite at compile time inside
  // the api module — vitest can't toggle them at runtime, so we don't
  // assert against them here. The fallback chain is exercised end-to-end
  // by the Playwright suite that runs against the built bundle, and by
  // the explicit window override branch above. See test-setup.ts notes.
  it.skip('returns import.meta.env.VITE_API_URL (skipped: Vite inlines at compile time)', () => {})
  it.skip('treats VITE_API_URL="" as valid (skipped: Vite inlines at compile time)', () => {})

  it("returns '' in dev mode (Vite proxy handles routing)", () => {
    // vitest sets DEV=true by default — verify the dev branch.
    expect((import.meta as any).env?.DEV).toBe(true)
    expect(getAPIBaseURL()).toBe('')
  })

  it.skip('returns the prod default when DEV=false and no overrides', () => {
    // Vite transforms `import.meta.env.DEV` to the boolean literal `true`
    // at compile time inside the api module — we can't toggle that from
    // the test side at runtime. The prod-default branch is exercised
    // implicitly by the production build (and explicitly by the
    // Playwright E2E suite that runs against the built bundle). Skipping
    // here to document the gap rather than asserting against an inlined
    // value that always returns ''.
  })
})

// ─── Token storage helpers ───────────────────────────────────────────────
describe('token storage', () => {
  it('getToken returns null when nothing is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('setToken / getToken round-trip', () => {
    setToken('abc.def.ghi')
    expect(getToken()).toBe('abc.def.ghi')
  })

  it('clearToken removes the stored value', () => {
    setToken('zzz')
    clearToken()
    expect(getToken()).toBeNull()
  })

  it('logout() clears the token and returns ok:true', async () => {
    setToken('zzz')
    const r = await logout()
    expect(r).toEqual({ ok: true })
    expect(getToken()).toBeNull()
  })
})

// ─── logout() — server-side invalidation (A03) + bootstrap reset (D08) ───
describe('logout() — A03 + D08', () => {
  it('A03: calls POST /auth/logout before clearing the local token', async () => {
    setToken('my-jwt-token')
    const m = installFetch()
    // Server returns ok
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await logout()

    // Verify the server was called.
    expect(m).toHaveBeenCalledTimes(1)
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/auth/logout')
    expect((init as RequestInit).method).toBe('POST')

    // Token cleared after server call.
    expect(getToken()).toBeNull()
  })

  it('A03: clears local token even when server returns 503 (fail-soft)', async () => {
    setToken('expiring-token')
    const m = installFetch()
    // Server is down
    m.mockRejectedValueOnce(new Error('network error'))

    const r = await logout()
    expect(r).toEqual({ ok: true }) // logout is always "successful" from UX perspective
    expect(getToken()).toBeNull()   // local token must be cleared regardless
  })

  it('A03: sends Authorization header while token is still set (before clearToken)', async () => {
    const token = 'bearer-to-revoke'
    setToken(token)
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await logout()

    const [, init] = m.mock.calls[0]
    const headers = (init as RequestInit).headers
    const authHeader = headers instanceof Headers
      ? headers.get('Authorization')
      : (headers as Record<string, string>)['Authorization']
    expect(authHeader).toBe(`Bearer ${token}`)
  })

  it('D08: registerLogoutHook() callbacks are called on logout', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))

    let called = false
    registerLogoutHook(() => { called = true })
    setToken('tok')
    await logout()

    expect(called).toBe(true)
  })

  it('D08: registerLogoutHook() is idempotent (same fn registered twice → called once)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))

    let callCount = 0
    const fn = () => { callCount++ }
    registerLogoutHook(fn)
    registerLogoutHook(fn) // second registration must not double-count
    setToken('tok')
    await logout()

    expect(callCount).toBe(1)
  })
})

// ─── fetchBilling() ──────────────────────────────────────────────────────
describe('fetchBilling()', () => {
  it('returns the mapped BillingStateResp on a successful response', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      tier: 'pro',
      subscription_status: 'active',
      next_renewal_at: '2026-06-09T00:00:00Z',
      amount_inr: 4900,
      payment_method: { type: 'card', brand: 'visa', last4: '4242' },
      razorpay_subscription_id: 'sub_abc',
      razorpay_customer_id: 'cust_abc',
    }))
    const r = await fetchBilling()
    expect(r.ok).toBe(true)
    expect(r.plan).toBe('pro')
    expect(r.billing.status).toBe('active')
    expect(r.billing.subscription_status).toBe('active')
    expect(r.billing.payment_last4).toBe('4242')
    expect(r.billing.payment_network).toBe('visa')
    expect(r.billing.current_period_end).toBe('2026-06-09T00:00:00Z')
    expect(r.billing.razorpay_configured).toBe(true)
    expect(r.billing.cancel_at_period_end).toBe(false)
  })

  it('hits GET /api/v1/billing', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, tier: 'hobby', subscription_status: 'none' }))
    await fetchBilling()
    const [url] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/billing')
  })

  it("flags razorpay_configured=false when subscription_status='none'", async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, tier: 'hobby', subscription_status: 'none' }))
    const r = await fetchBilling()
    expect(r.billing.razorpay_configured).toBe(false)
    expect(r.billing.status).toBe('none')
  })

  it("defaults billing.status to 'none' when the agent API omits subscription_status", async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, tier: 'hobby' }))
    const r = await fetchBilling()
    expect(r.billing.status).toBe('none')
  })

  it('propagates 503 errors honestly (no FIXTURE_BILLING fallback) — §10.21.1', async () => {
    // Previously a 503 from /api/v1/billing returned FIXTURE_BILLING — a fake
    // "active Razorpay subscription, ****4242 visa, renews in 9 days" that
    // didn't correspond to any real billing state. Removed. BillingPage now
    // catches the APIError and renders a real error banner.
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'billing_not_configured', message: 'Razorpay is not configured' },
      { status: 503, statusText: 'Service Unavailable' },
    ))
    await expect(fetchBilling()).rejects.toMatchObject({ status: 503 })
  })

  it('propagates auth errors (no FIXTURE_USER fallback chain)', async () => {
    // The old chain was: 503 → fall back to FIXTURE_BILLING via fetchMe. Both
    // fallbacks are gone — the call propagates the 503 directly.
    window.history.pushState({}, '', '/login')
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'billing_not_configured' },
      { status: 503 },
    ))
    await expect(fetchBilling()).rejects.toMatchObject({ status: 503 })
    window.history.pushState({}, '', '/')
  })

  it('propagates non-503 errors (e.g. 500)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'internal_error', message: 'boom' },
      { status: 500, statusText: 'Internal Server Error' },
    ))
    await expect(fetchBilling()).rejects.toMatchObject({ status: 500 })
  })

  it('attaches Authorization: Bearer when a token is set', async () => {
    setToken('jwt.value')
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, tier: 'pro', subscription_status: 'active' }))
    await fetchBilling()
    const headers = m.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer jwt.value')
  })

  it('does NOT set Authorization when no token is stored', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, tier: 'pro', subscription_status: 'active' }))
    await fetchBilling()
    const headers = m.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBeNull()
  })
})

// ─── listInvoices() ──────────────────────────────────────────────────────
describe('listInvoices()', () => {
  it('returns the API invoices on a successful response', async () => {
    const m = installFetch()
    const sample = [
      { id: 'inv_a', period_start: '2026-04-01', period_end: '2026-05-01', plan: 'pro', amount_cents: 4900, currency: 'USD', status: 'paid' },
      { id: 'inv_b', period_start: '2026-03-01', period_end: '2026-04-01', plan: 'pro', amount_cents: 4900, currency: 'USD', status: 'paid' },
    ]
    m.mockResolvedValueOnce(jsonResponse({ ok: true, invoices: sample }))
    const r = await listInvoices()
    expect(r.ok).toBe(true)
    expect(r.invoices).toEqual(sample)
  })

  it('hits GET /api/v1/billing/invoices', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, invoices: [] }))
    await listInvoices()
    const [url] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/billing/invoices')
  })

  it('returns invoices=[] when the API omits the field', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const r = await listInvoices()
    expect(r.invoices).toEqual([])
  })

  it('propagates 503 errors honestly (no FIXTURE_INVOICES fallback) — §10.21.1', async () => {
    // Previously a 503 returned 3 mock "paid" invoices that didn't correspond
    // to any real payment. Removed. BillingPage now surfaces the failure.
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'billing_not_configured' },
      { status: 503, statusText: 'Service Unavailable' },
    ))
    await expect(listInvoices()).rejects.toMatchObject({ status: 503 })
  })

  it('propagates non-503 errors', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'oops' },
      { status: 500 },
    ))
    await expect(listInvoices()).rejects.toMatchObject({ status: 500 })
  })
})

// ─── createCheckout() ────────────────────────────────────────────────────
describe('createCheckout()', () => {
  it('returns {ok, short_url, subscription_id} on success', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      short_url: 'https://rzp.io/i/abc',
      subscription_id: 'sub_123',
    }))
    const r = await createCheckout('pro')
    expect(r).toEqual({ ok: true, short_url: 'https://rzp.io/i/abc', subscription_id: 'sub_123' })
  })

  it('POSTs to /api/v1/billing/checkout with the plan and default monthly frequency', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, short_url: 'https://rzp.io/i/abc' }))
    await createCheckout('pro')
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/billing/checkout')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ plan: 'pro', plan_frequency: 'monthly' }))
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json')
  })

  it('sends plan_frequency: yearly when the caller opts into annual billing', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, short_url: 'https://rzp.io/i/year' }))
    await createCheckout('pro', 'yearly')
    const init = m.mock.calls[0][1]
    expect(init.body).toBe(JSON.stringify({ plan: 'pro', plan_frequency: 'yearly' }))
  })

  it('omits subscription_id when the API does not return one', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, short_url: 'https://rzp.io/i/abc' }))
    const r = await createCheckout('hobby')
    expect(r.subscription_id).toBeUndefined()
    expect(r.short_url).toBe('https://rzp.io/i/abc')
  })

  it('propagates errors (e.g. 502 razorpay unreachable) as APIError', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'razorpay_unreachable', message: 'upstream down' },
      { status: 502, statusText: 'Bad Gateway' },
    ))
    await expect(createCheckout('pro')).rejects.toMatchObject({
      status: 502,
      code: 'razorpay_unreachable',
    })
  })

  it('sends the team-tier plan correctly', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, short_url: 'https://rzp.io/i/xyz' }))
    await createCheckout('team')
    const init = m.mock.calls[0][1]
    expect(init.body).toBe(JSON.stringify({ plan: 'team', plan_frequency: 'monthly' }))
  })

  // P3: opts.promotion_code only appears in the body when actually passed.
  // Merged signature is (plan, planFrequency, opts) — frequency defaults
  // to 'monthly' so plan_frequency always appears in the body.
  it('includes promotion_code in the body when supplied (P3)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, short_url: 'https://rzp.io/i/p3' }))
    await createCheckout('pro', 'monthly', { promotion_code: 'TWITTER15' })
    const init = m.mock.calls[0][1]
    expect(JSON.parse(init.body as string)).toEqual({
      plan: 'pro', plan_frequency: 'monthly', promotion_code: 'TWITTER15',
    })
  })

  it('drops promotion_code from the body when not supplied (P3)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, short_url: 'https://rzp.io/i/p3' }))
    await createCheckout('pro')
    const init = m.mock.calls[0][1]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ plan: 'pro', plan_frequency: 'monthly' })
    expect('promotion_code' in body).toBe(false)
  })

  it('drops an empty / whitespace-only promotion_code (P3)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, short_url: 'https://rzp.io/i/p3' }))
    await createCheckout('pro', 'monthly', { promotion_code: '   ' })
    const init = m.mock.calls[0][1]
    const body = JSON.parse(init.body as string)
    expect('promotion_code' in body).toBe(false)
  })
})

// ─── changePlan() — in-place tier swap on an existing subscription ──────
describe('changePlan()', () => {
  it('POSTs target_plan + plan_frequency to /api/v1/billing/change-plan', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, new_plan: 'pro', short_url: '' }))
    await changePlan('pro', 'monthly')
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/billing/change-plan')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      target_plan: 'pro',
      plan_frequency: 'monthly',
    })
  })

  it('forwards yearly plan_frequency when the caller picks annual', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, new_plan: 'pro', short_url: '' }))
    await changePlan('pro', 'yearly')
    const body = JSON.parse(m.mock.calls[0][1].body as string)
    expect(body.plan_frequency).toBe('yearly')
  })

  it('returns short_url and immediate:false when the server hands off to Razorpay', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      new_plan: 'pro',
      short_url: 'https://rzp.io/i/upg',
    }))
    const r = await changePlan('pro', 'monthly')
    expect(r.short_url).toBe('https://rzp.io/i/upg')
    expect(r.immediate).toBe(false)
  })

  it('returns immediate:true when short_url is empty (in-place plan swap)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, new_plan: 'pro', short_url: '' }))
    const r = await changePlan('pro', 'monthly')
    expect(r.short_url).toBeUndefined()
    expect(r.immediate).toBe(true)
  })

  it('returns immediate:true when short_url is omitted from the response', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, new_plan: 'pro' }))
    const r = await changePlan('pro', 'monthly')
    expect(r.immediate).toBe(true)
  })

  it('propagates a 400 same_plan error as APIError', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'same_plan', message: 'Already on requested plan' },
      { status: 400, statusText: 'Bad Request' },
    ))
    await expect(changePlan('pro', 'monthly')).rejects.toMatchObject({
      status: 400,
      code: 'same_plan',
    })
  })

  it('propagates a 502 razorpay_error so the modal can surface support fallback', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'razorpay_error', message: 'upstream timeout' },
      { status: 502, statusText: 'Bad Gateway' },
    ))
    await expect(changePlan('team', 'yearly')).rejects.toMatchObject({
      status: 502,
      code: 'razorpay_error',
    })
  })
})

// ─── validatePromotion() (P3) ────────────────────────────────────────────
// Until api ships POST /api/v1/billing/promotion/validate, this helper
// falls back to a small set of seed codes on a 404. The mock + fallback
// path together must:
//   - return a Promotion shape when the api responds 200
//   - return the seed Promotion for a known seed code when the api 404s
//   - throw promotion_not_found for an unknown code when the api 404s
//   - propagate non-404 errors (e.g. 410 expired) untouched
describe('validatePromotion() (P3)', () => {
  it('returns the api Promotion on a 200 response', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      code: 'PARTNER25',
      discount: { kind: 'percent_off', value: 25, applies_to: 6, unit: 'months' },
      valid_until: '2026-12-31T00:00:00Z',
    }))
    const r = await validatePromotion('PARTNER25', 'pro')
    expect(r.promotion.code).toBe('PARTNER25')
    expect(r.promotion.discount).toEqual({ kind: 'percent_off', value: 25, applies_to: 6, unit: 'months' })
    expect(r.promotion.valid_until).toBe('2026-12-31T00:00:00Z')
  })

  it('POSTs {code, plan} to /api/v1/billing/promotion/validate (uppercased + trimmed)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      code: 'TWITTER15',
      discount: { kind: 'percent_off', value: 15, applies_to: 3, unit: 'months' },
      valid_until: '2026-09-01T00:00:00Z',
    }))
    await validatePromotion('  twitter15  ', 'pro')
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/billing/promotion/validate')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ code: 'TWITTER15', plan: 'pro' })
  })

  it('falls back to the seed table when the api 404s on a known seed code', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'not_found', message: 'no such route' },
      { status: 404, statusText: 'Not Found' },
    ))
    const r = await validatePromotion('TWITTER15', 'pro')
    expect(r.promotion.code).toBe('TWITTER15')
    expect(r.promotion.discount.kind).toBe('percent_off')
    expect(r.promotion.discount.value).toBe(15)
  })

  it('throws promotion_not_found on 404 for an unknown code', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'not_found' },
      { status: 404, statusText: 'Not Found' },
    ))
    await expect(validatePromotion('NONEXISTENT', 'pro')).rejects.toMatchObject({
      status: 404,
      code: 'promotion_not_found',
    })
  })

  it('propagates 410 expired errors with the api message', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'promotion_expired', message: 'This code has expired.' },
      { status: 410, statusText: 'Gone' },
    ))
    await expect(validatePromotion('OLDCODE', 'pro')).rejects.toMatchObject({
      status: 410,
      code: 'promotion_expired',
    })
  })

  it('rejects with promotion_invalid for an empty input (no api call)', async () => {
    const m = installFetch()
    await expect(validatePromotion('   ', 'pro')).rejects.toMatchObject({
      status: 400,
      code: 'promotion_invalid',
    })
    expect(m).not.toHaveBeenCalled()
  })
})

// ─── cancelSubscription() ────────────────────────────────────────────────
describe('cancelSubscription()', () => {
  it('returns {ok:true} on success', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const r = await cancelSubscription()
    expect(r).toEqual({ ok: true })
  })

  it('POSTs to /api/v1/billing/cancel', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await cancelSubscription()
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/billing/cancel')
    expect(init.method).toBe('POST')
  })

  it('propagates errors (e.g. 404 no active subscription)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'no_active_subscription' },
      { status: 404, statusText: 'Not Found' },
    ))
    await expect(cancelSubscription()).rejects.toMatchObject({
      status: 404,
      code: 'no_active_subscription',
    })
  })
})

// ─── claim() ─────────────────────────────────────────────────────────────
describe('claim()', () => {
  it('POSTs to /claim with {jwt, email} and returns the ClaimResp', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      team_id: 't_abc',
      user_id: 'u_abc',
      session_token: 'jwt.session.token',
      message: 'welcome',
    }))
    const r = await claim({ jwt: 'eyJ...', email: 'me@test.dev' })
    expect(r.session_token).toBe('jwt.session.token')
    expect(r.team_id).toBe('t_abc')
    expect(r.user_id).toBe('u_abc')
    expect(r.ok).toBe(true)
  })

  it('serializes the body exactly as {jwt, email}', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      team_id: 't',
      user_id: 'u',
      session_token: 'sess',
    }))
    await claim({ jwt: 'A.B.C', email: 'foo@bar' })
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/claim')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ jwt: 'A.B.C', email: 'foo@bar' }))
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json')
  })

  it('propagates a 409 claim-already-converted error', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'already_claimed', message: 'token already used' },
      { status: 409, statusText: 'Conflict' },
    ))
    await expect(claim({ jwt: 'x', email: 'y@z' })).rejects.toMatchObject({
      status: 409,
      code: 'already_claimed',
    })
  })

  it('does NOT redirect on 401 from the marketing homepage (regression for "homepage auto-redirects to /login")', async () => {
    // Root cause of the homepage-redirect bug: the previous SKIP-list only
    // excluded /login + /claim. Any other public page (marketing /, /pricing,
    // /docs, /blog, /use-cases, /status, /incidents) would, on a 401 from a
    // stray api call, get bounced to /login. Fix: redirect only when in
    // /app/*. Pin pathname stability on / as the regression guard.
    window.history.pushState({}, '', '/')
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'unauthorized' },
      { status: 401, statusText: 'Unauthorized' },
    ))
    await expect(fetchMe()).rejects.toMatchObject({ status: 401 })
    expect(window.location.pathname).toBe('/')
    window.history.pushState({}, '', '/')
  })

  it('does NOT redirect on 401 when the current path starts with /claim', async () => {
    // Navigate jsdom to /claim/abc via history.pushState so the auth-skip
    // prefix matches. We can't spy on window.location.replace in jsdom 24
    // (non-configurable property), so we instead rely on the fact that
    // navigation on the auth-skip path is a no-op — the test passes when
    // the rejection surfaces cleanly with no side effects. If the
    // implementation regresses and starts redirecting from /claim, jsdom
    // would emit a navigation event that flips location.pathname; we
    // assert pathname stays on /claim/abc to catch that.
    window.history.pushState({}, '', '/claim/abc')
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'invalid_jwt' },
      { status: 401, statusText: 'Unauthorized' },
    ))
    await expect(claim({ jwt: 'bad', email: 'x@y' })).rejects.toMatchObject({ status: 401 })
    expect(window.location.pathname).toBe('/claim/abc')
    window.history.pushState({}, '', '/')
  })
})

// ─── fetchMe() ───────────────────────────────────────────────────────────
describe('fetchMe()', () => {
  it('maps the agent API /auth/me into the dashboard AuthMeResponse shape', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      user_id: 'u_xyz',
      team_id: 't_xyz',
      email: 'agent@instanode.dev',
      tier: 'pro',
    }))
    const r = await fetchMe()
    expect(r.user.id).toBe('u_xyz')
    expect(r.user.email).toBe('agent@instanode.dev')
    expect(r.user.tier).toBe('pro')
    expect(r.team.id).toBe('t_xyz')
    expect(r.team.tier).toBe('pro')
    expect(r.team.slug).toBe('agent')
    expect(r.team.name).toBe('agent')
  })

  it('rethrows 401 (so AuthGate can redirect)', async () => {
    // Navigate to /login so the auth-redirect-skip prefix matches and the
    // implementation doesn't try to call window.location.replace (which
    // jsdom 24 doesn't allow us to spy on).
    window.history.pushState({}, '', '/login')
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'unauthorized' },
      { status: 401, statusText: 'Unauthorized' },
    ))
    await expect(fetchMe()).rejects.toMatchObject({ status: 401 })
    window.history.pushState({}, '', '/')
  })

  it('propagates errors on 5xx instead of silently serving a fixture identity (§10.21.1)', async () => {
    // Previously fetchMe() fell back to FIXTURE_USER on 500 so the chrome
    // silently rendered "acme-corp / aanya@acme.dev" mock data when the
    // backend was down. Removed — errors propagate; useDashboardCtx
    // records meErr and chrome shows the workspace placeholder.
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    await expect(fetchMe()).rejects.toBeDefined()
  })

  it('passes through the experiments map from the agent API', async () => {
    // P1 pricing experiment — /auth/me now embeds a server-bucketed
    // experiments map. The dashboard's UpgradeButton component reads
    // `me.experiments.upgrade_button` to decide which variant to render.
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      user_id: 'u_xyz',
      team_id: 't_xyz',
      email: 'agent@instanode.dev',
      tier: 'pro',
      experiments: { upgrade_button: 'urgent' },
    }))
    const r = await fetchMe()
    expect(r.experiments).toEqual({ upgrade_button: 'urgent' })
  })

  it('omits experiments cleanly when the agent API does not return the field', async () => {
    // Older API builds (pre-P1) don't return an experiments field.
    // The dashboard must handle that without throwing — UpgradeButton
    // falls back to "control" via normalizeVariant().
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      user_id: 'u_xyz',
      team_id: 't_xyz',
      email: 'agent@instanode.dev',
      tier: 'pro',
    }))
    const r = await fetchMe()
    expect(r.experiments).toBeUndefined()
  })
})

// ─── listResources() / deleteResource() (smoke for shape adaptation) ─────
describe('listResources()', () => {
  it('adapts the agent API resource shape and returns total', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      total: 1,
      items: [{
        id: 'r1',
        token: 'r1',
        resource_type: 'postgres',
        tier: 'pro',
        status: 'active',
        connections_in_use: 2,
        connections_limit: 5,
        created_at: '2026-05-10T00:00:00Z',
      }],
    }))
    const r = await listResources()
    expect(r.ok).toBe(true)
    expect(r.total).toBe(1)
    expect(r.items[0].id).toBe('r1')
    expect(r.items[0].env).toBe('production')  // default
    expect(r.items[0].storage_bytes).toBe(0)   // default
    expect(r.items[0].storage_exceeded).toBe(false)
  })

  it('returns total=items.length when total is missing', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      items: [
        { id: 'a', token: 'a', resource_type: 'redis', tier: 'pro', status: 'active', created_at: 'x' },
        { id: 'b', token: 'b', resource_type: 'redis', tier: 'pro', status: 'active', created_at: 'x' },
      ],
    }))
    const r = await listResources()
    expect(r.total).toBe(2)
  })
})

describe('deleteResource()', () => {
  it('DELETEs /api/v1/resources/:id', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await deleteResource('r_abc')
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/resources/r_abc')
    expect(init.method).toBe('DELETE')
  })
})

// ─── listAPIKeys() (smoke to keep PATs covered) ─────────────────────────
describe('listAPIKeys()', () => {
  it('returns the API response verbatim', async () => {
    const m = installFetch()
    const sample = { ok: true, items: [{ id: 'pat_1', name: 'ci', scopes: ['*'], created_at: 'x', last_used_at: null, revoked: false }] }
    m.mockResolvedValueOnce(jsonResponse(sample))
    const r = await listAPIKeys()
    expect(r).toEqual(sample)
  })
})

// ─── Custom origin via window.__INSTANODE_API_URL__ ─────────────────────
describe('origin override', () => {
  it("uses window.__INSTANODE_API_URL__ as the base when set", async () => {
    ;(window as any).__INSTANODE_API_URL__ = 'http://localhost:30080'
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, tier: 'pro', subscription_status: 'active' }))
    await fetchBilling()
    const [url] = m.mock.calls[0]
    expect(String(url)).toBe('http://localhost:30080/api/v1/billing')
  })
})

// ─── Content-type robustness ────────────────────────────────────────────
describe('non-JSON response bodies', () => {
  it("handles a text/plain 502 without crashing", async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(textResponse('upstream timeout', { status: 502, statusText: 'Bad Gateway' }))
    await expect(cancelSubscription()).rejects.toMatchObject({ status: 502 })
  })
})

// ─── listStacks() — env field plumbed through ────────────────────────────
// Verifies the §10.17 follow-up: dashboard reads real `env` from the API
// response instead of hardcoding 'production'. Locks in the contract the
// agent API now serves (GET /api/v1/stacks includes env + parent_stack_id).
describe('listStacks() env field', () => {
  it('returns the real env value from the API', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      total: 2,
      items: [
        {
          stack_id: 'stk-prod', name: 'demo', status: 'running', tier: 'pro',
          namespace: 'ns', env: 'production', parent_stack_id: '',
          created_at: '2026-05-12T00:00:00Z',
        },
        {
          stack_id: 'stk-staging', name: 'demo', status: 'running', tier: 'pro',
          namespace: 'ns', env: 'staging', parent_stack_id: 'root-id',
          created_at: '2026-05-12T00:01:00Z',
        },
      ],
    }))
    const r = await listStacks()
    expect(r.items[0].env).toBe('production')
    expect(r.items[1].env).toBe('staging')
  })

  it("falls back to 'production' when the API omits env (legacy stack rows)", async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      items: [{ stack_id: 'stk-old', name: 'legacy', status: 'running', tier: 'pro', namespace: 'ns', created_at: 'x' }],
    }))
    const r = await listStacks()
    expect(r.items[0].env).toBe('production')
  })
})

// ─── listDeployments() — GET /api/v1/deployments adapter ─────────────────
// The dashboard's /app/deployments surface previously queried listStacks(),
// which only returned multi-service stacks and therefore showed an empty
// list for any team that had only ever called POST /deploy/new. The new
// listDeployments() adapter is the load-bearing fix — it must:
//   1. hit GET /api/v1/deployments,
//   2. normalise the server's 'healthy' status → 'running' so the shared
//      StatusPill renders the live state correctly,
//   3. swap `env` (env_vars map) and `environment` (scope name) into the
//      dashboard's vocabulary (env_vars + env), and
//   4. surface `app_id` / `id` / `url` faithfully so DeployDetailPage can
//      link back to the row.
describe('listDeployments()', () => {
  it('adapts the API response — env_vars + env scope swap, status normalisation', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      total: 2,
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          app_id: '6fffcc21',
          token: '6fffcc21',
          url: 'https://6fffcc21.deployment.instanode.dev',
          status: 'healthy',
          port: 8080,
          tier: 'pro',
          env: { DATABASE_URL: 'postgres://...', NODE_ENV: 'production' },
          environment: 'production',
          created_at: '2026-05-12T11:00:00Z',
          updated_at: '2026-05-12T11:30:00Z',
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          app_id: 'abc123',
          url: 'https://abc123.deployment.instanode.dev',
          status: 'building',
          port: 3000,
          tier: 'hobby',
          env: { PORT: '3000' },
          environment: 'staging',
          created_at: '2026-05-12T11:10:00Z',
          updated_at: '2026-05-12T11:11:00Z',
        },
      ],
    }))
    const r = await listDeployments()
    expect(r.ok).toBe(true)
    expect(r.total).toBe(2)
    expect(r.items.length).toBe(2)

    const a = r.items[0]
    expect(a.id).toBe('11111111-1111-1111-1111-111111111111')
    expect(a.app_id).toBe('6fffcc21')
    // 'healthy' on the wire maps to 'running' for the dashboard's StatusPill.
    expect(a.status).toBe('running')
    expect(a.url).toBe('https://6fffcc21.deployment.instanode.dev')
    // Env scope from `environment`; env_vars from `env`.
    expect(a.env).toBe('production')
    expect(a.env_vars).toEqual({ DATABASE_URL: 'postgres://...', NODE_ENV: 'production' })
    expect(a.port).toBe(8080)
    expect(a.tier).toBe('pro')
    // last_deploy_at falls back to updated_at when the API doesn't yet
    // expose a dedicated last-deploy field.
    expect(a.last_deploy_at).toBe('2026-05-12T11:30:00Z')
    // Display name is `null` when the server doesn't supply one — the UI
    // renders `(unnamed deploy)` and keeps app_id as muted secondary text
    // rather than promoting the hash into the primary `name` slot.
    expect(a.name).toBeNull()

    expect(r.items[1].env).toBe('staging')
    expect(r.items[1].status).toBe('building')
  })

  it('hits GET /api/v1/deployments', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, items: [], total: 0 }))
    await listDeployments()
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/deployments')
    // GET (default method) — no body, no method override.
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('falls back to items.length when total is omitted', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      items: [
        { id: 'd1', app_id: 'd1', status: 'building', port: 80, tier: 'free', env: {}, environment: 'production', created_at: 'x', updated_at: 'x' },
      ],
    }))
    const r = await listDeployments()
    expect(r.total).toBe(1)
  })

  it('returns env_vars: {} when env_vars / env map are omitted', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      items: [{
        id: 'd1', app_id: 'd1', status: 'running', port: 80, tier: 'free',
        environment: 'production', created_at: 'x', updated_at: 'x',
      }],
    }))
    const r = await listDeployments()
    expect(r.items[0].env_vars).toEqual({})
  })

  it('accepts the dedicated env_vars field (forward compat)', async () => {
    // The audit doc spec listed `env_vars` directly. The live API still
    // returns env-map under `env`, so we accept either to insulate the
    // dashboard from the field rename whenever the API ships it.
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      items: [{
        id: 'd1', app_id: 'd1', status: 'running', port: 80, tier: 'pro',
        environment: 'production',
        env_vars: { FOO: 'bar' },
        env: 'production', // string env scope alongside env_vars (forward compat)
        created_at: 'x', updated_at: 'x',
      }],
    }))
    const r = await listDeployments()
    expect(r.items[0].env_vars).toEqual({ FOO: 'bar' })
    expect(r.items[0].env).toBe('production')
  })

  it('defaults env to "production" when the API omits both fields', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      items: [{ id: 'd1', app_id: 'd1', status: 'running', port: 80, tier: 'pro', created_at: 'x', updated_at: 'x' }],
    }))
    const r = await listDeployments()
    expect(r.items[0].env).toBe('production')
  })

  it('propagates errors so the page can surface them honestly', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ error: 'list_failed' }, { status: 503 }))
    await expect(listDeployments()).rejects.toMatchObject({ status: 503 })
  })
})

// ─── getDeployment() — single-deploy detail loader ───────────────────────
describe('getDeployment()', () => {
  it('returns {ok, deployment} on success', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      item: {
        id: 'd1', app_id: 'd1', status: 'healthy', port: 8080, tier: 'pro',
        url: 'https://d1.deployment.instanode.dev',
        env: { DATABASE_URL: 'vault://env/DATABASE_URL' },
        environment: 'production',
        created_at: 'x', updated_at: 'y',
      },
    }))
    const r = await getDeployment('d1')
    expect(r.ok).toBe(true)
    expect(r.deployment?.id).toBe('d1')
    expect(r.deployment?.status).toBe('running')
    expect(r.deployment?.env_vars).toEqual({ DATABASE_URL: 'vault://env/DATABASE_URL' })
  })

  it('hits GET /api/v1/deployments/:id (URI-encoded)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, item: { id: 'd weird', app_id: 'd', status: 'running', port: 1, tier: 'free', env: {}, environment: 'production', created_at: 'x', updated_at: 'x' } }))
    await getDeployment('d weird')
    expect(String(m.mock.calls[0][0])).toContain('/api/v1/deployments/d%20weird')
  })

  it('returns {ok:true, deployment: null} on 404 so the page can fall back to the stack lookup', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ error: 'not_found' }, { status: 404 }))
    const r = await getDeployment('missing-id')
    expect(r.ok).toBe(true)
    expect(r.deployment).toBeNull()
  })

  it('propagates non-404 errors (e.g. 500)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    await expect(getDeployment('d1')).rejects.toMatchObject({ status: 500 })
  })

  it('surfaces private + allowed_ips when the API returns them', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      item: {
        id: 'd1', app_id: 'd1', status: 'running', port: 8080, tier: 'pro',
        env: {}, environment: 'production', created_at: 'x', updated_at: 'x',
        private: true,
        allowed_ips: ['8.8.8.8', '10.0.0.0/8'],
      },
    }))
    const r = await getDeployment('d1')
    expect(r.deployment?.private).toBe(true)
    expect(r.deployment?.allowed_ips).toEqual(['8.8.8.8', '10.0.0.0/8'])
  })

  it('defaults private=false and allowed_ips=[] when the API omits both', async () => {
    // Older Track A builds don't expose the privacy fields. The adapter
    // must NOT silently inherit `private` from a stale frontend cache —
    // it should normalise to false.
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      item: {
        id: 'd1', app_id: 'd1', status: 'running', port: 8080, tier: 'pro',
        env: {}, environment: 'production', created_at: 'x', updated_at: 'x',
      },
    }))
    const r = await getDeployment('d1')
    expect(r.deployment?.private).toBe(false)
    expect(r.deployment?.allowed_ips).toEqual([])
  })
})

// ─── createDeploy() — POST /deploy/new multipart (C02 fix) ───────────────
// createDeploy must send multipart/form-data — the server calls
// c.MultipartForm() and returns 400 invalid_form on any JSON body.
// Field names: tarball (file), name, port, env (scope), env_vars (JSON string),
// private, allowed_ips (JSON string).
describe('createDeploy()', () => {
  function fakeTarball(size = 100): File {
    return new File([new ArrayBuffer(size)], 'app.tar.gz', { type: 'application/gzip' })
  }

  it('POSTs to /deploy/new as multipart/form-data with private + allowed_ips', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      item: {
        id: 'd1', app_id: 'd1', status: 'building', port: 8080, tier: 'pro',
        env: { FOO: 'bar' }, environment: 'production',
        created_at: 'x', updated_at: 'x',
        private: true, allowed_ips: ['8.8.8.8'],
      },
    }))
    const tb = fakeTarball()
    const r = await createDeploy(
      {
        name: 'my-app',
        port: 8080,
        env: 'production',
        env_vars: { FOO: 'bar' },
        private: true,
        allowed_ips: ['8.8.8.8'],
      },
      tb,
    )
    expect(r.ok).toBe(true)
    expect(r.deployment.private).toBe(true)
    expect(r.deployment.allowed_ips).toEqual(['8.8.8.8'])

    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/deploy/new')
    expect(init?.method).toBe('POST')
    // Body must be FormData (not a JSON string) — server rejects JSON.
    const body = init!.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('tarball')).toBe(tb)
    expect(body.get('name')).toBe('my-app')
    expect(body.get('port')).toBe('8080')
    expect(body.get('env')).toBe('production')
    expect(body.get('env_vars')).toBe(JSON.stringify({ FOO: 'bar' }))
    expect(body.get('private')).toBe('true')
    expect(body.get('allowed_ips')).toBe(JSON.stringify(['8.8.8.8']))
  })

  it('omits private + allowed_ips fields when caller does not pass them (public deploy)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      item: {
        id: 'd1', app_id: 'd1', status: 'building', port: 8080, tier: 'free',
        env: {}, environment: 'production',
        created_at: 'x', updated_at: 'x',
      },
    }))
    await createDeploy({ name: 'my-app', port: 8080, env: 'production' })
    const body = m.mock.calls[0][1]!.body as FormData
    expect(body.has('private')).toBe(false)
    expect(body.has('allowed_ips')).toBe(false)
  })

  it('propagates 402 (tier gate) so the page can render an upgrade prompt', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'upgrade_required', agent_action: 'upgrade_to_pro' },
      { status: 402 },
    ))
    await expect(
      createDeploy({ private: true, allowed_ips: ['8.8.8.8'] }),
    ).rejects.toMatchObject({ status: 402 })
  })

  it('propagates 400 (validation_error) so the page can show inline IP errors', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'validation_error', message: 'allowed_ips empty when private=true' },
      { status: 400 },
    ))
    await expect(
      createDeploy({ private: true, allowed_ips: [] }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

// ─── updateDeploymentAccess() — PATCH /api/v1/deployments/:id ────────────
// Track A's PATCH endpoint is still in flight. The dashboard helper still
// issues the request — a 404 means "endpoint not yet shipped" and the
// caller (PrivacyPanel on DeployDetailPage) surfaces a friendly hint.
describe('updateDeploymentAccess()', () => {
  it('PATCHes /api/v1/deployments/:id with private + allowed_ips', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      item: {
        id: 'd1', app_id: 'd1', status: 'running', port: 8080, tier: 'pro',
        env: {}, environment: 'production',
        created_at: 'x', updated_at: 'y',
        private: true, allowed_ips: ['1.1.1.1'],
      },
    }))
    const r = await updateDeploymentAccess('d1', true, ['1.1.1.1'])
    expect(r.deployment.private).toBe(true)
    expect(r.deployment.allowed_ips).toEqual(['1.1.1.1'])
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/deployments/d1')
    expect(init?.method).toBe('PATCH')
    const sent = JSON.parse(String(init!.body))
    expect(sent).toEqual({ private: true, allowed_ips: ['1.1.1.1'] })
  })

  it('URI-encodes the deployment id', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      item: { id: 'd weird', app_id: 'd', status: 'running', port: 1, tier: 'pro', env: {}, environment: 'production', created_at: 'x', updated_at: 'y' },
    }))
    await updateDeploymentAccess('d weird', false, [])
    expect(String(m.mock.calls[0][0])).toContain('/api/v1/deployments/d%20weird')
  })

  it('propagates 404 so the page can surface "edits pending backend"', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ error: 'not_found' }, { status: 404 }))
    await expect(updateDeploymentAccess('d1', true, ['8.8.8.8']))
      .rejects.toMatchObject({ status: 404 })
  })

  it('propagates 402 (tier gate)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'upgrade_required', agent_action: 'upgrade_to_pro' },
      { status: 402 },
    ))
    await expect(updateDeploymentAccess('d1', true, ['8.8.8.8']))
      .rejects.toMatchObject({ status: 402 })
  })
})

// ─── fetchStackFamily() — Pro+ env grid loader ───────────────────────────
// The discriminated-union return shape is load-bearing for the dashboard's
// Environments grid: it decides between rendering the grid (ok=true),
// the existing PromoteUpsell card (upgrade_required), or the silent fall-
// through (not_found / unknown). Cover each branch explicitly so a future
// shape change can't silently regress the UI behaviour.
describe('fetchStackFamily()', () => {
  it('adapts the family payload and preserves order', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      slug: 'stk-prod',
      total: 3,
      family: [
        {
          slug: 'stk-prod', name: 'demo', env: 'production', status: 'running', tier: 'pro',
          url: 'https://demo.deployment.instanode.dev', is_root: true, parent_stack_id: '',
          last_deploy_at: '2026-05-12T01:00:00Z', created_at: '2026-05-12T00:00:00Z',
        },
        {
          slug: 'stk-staging', name: 'demo', env: 'staging', status: 'building', tier: 'pro',
          url: '', is_root: false, parent_stack_id: 'root-id',
          last_deploy_at: '2026-05-12T02:00:00Z', created_at: '2026-05-12T00:02:00Z',
        },
        {
          slug: 'stk-dev', name: 'demo', env: 'dev', status: 'running', tier: 'pro',
          url: 'https://dev-demo.deployment.instanode.dev', is_root: false, parent_stack_id: 'root-id',
          last_deploy_at: '2026-05-12T03:00:00Z', created_at: '2026-05-12T00:03:00Z',
        },
      ],
    }))
    const r = await fetchStackFamily('stk-prod')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('typeguard')
    expect(r.slug).toBe('stk-prod')
    expect(r.total).toBe(3)
    expect(r.family.map((m) => m.env)).toEqual(['production', 'staging', 'dev'])
    expect(r.family[0].is_root).toBe(true)
    expect(r.family[1].is_root).toBe(false)
    expect(r.family[1].parent_stack_id).toBe('root-id')
  })

  it('returns upgrade_required on 402 so the UI can render PromoteUpsell', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { ok: false, error: 'upgrade_required', agent_action: 'Tell user to upgrade...' },
      { status: 402 },
    ))
    const r = await fetchStackFamily('stk-hobby')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('typeguard')
    expect(r.reason).toBe('upgrade_required')
  })

  it('returns not_found on 404 so the UI silently falls back', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'not_found' }, { status: 404 }))
    const r = await fetchStackFamily('stk-missing')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('typeguard')
    expect(r.reason).toBe('not_found')
  })

  it("buckets every other failure under reason='unknown'", async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'internal' }, { status: 500 }))
    const r = await fetchStackFamily('stk-x')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('typeguard')
    expect(r.reason).toBe('unknown')
  })

  it('URI-encodes the slug so weird inputs do not bypass the route', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, slug: '', family: [], total: 0 }))
    await fetchStackFamily('stk weird/slug')
    const [url] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/stacks/stk%20weird%2Fslug/family')
  })
})

// ─── reportExperimentConverted() ─────────────────────────────────────────
describe('reportExperimentConverted()', () => {
  it('POSTs the right payload to /api/v1/experiments/converted', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await reportExperimentConverted({
      experiment: 'upgrade_button',
      variant: 'urgent',
      action: 'checkout_started',
    })
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/experiments/converted')
    expect((init as any).method).toBe('POST')
    expect(JSON.parse((init as any).body)).toEqual({
      experiment: 'upgrade_button',
      variant: 'urgent',
      action: 'checkout_started',
    })
  })

  it('swallows network errors (analytics tail must not wag the conversion dog)', async () => {
    const m = installFetch()
    m.mockRejectedValueOnce(new Error('offline'))
    // Must NOT throw. If it does, the test fails by surfacing the rejection.
    await reportExperimentConverted({
      experiment: 'upgrade_button',
      variant: 'control',
      action: 'checkout_started',
    })
  })

  it('swallows 400 from a stale-variant rejection', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { ok: false, error: 'variant_mismatch' },
      { status: 400 },
    ))
    await reportExperimentConverted({
      experiment: 'upgrade_button',
      variant: 'control',
      action: 'checkout_started',
    })
  })
})

// ─── Admin URL prefix wiring (Track A — unguessable path) ──────────────
//
// The admin URL builders must read the prefix the API serves on /auth/me
// and stitch it into the request path. Empty prefix → throw a clear
// error (programmer error: UI should have gated on getAdminPathPrefix
// first). logout() clears the stash so a re-login by a different user
// can't inherit the previous user's admin path.

describe('Admin URL prefix wiring', () => {
  it('fetchMe stashes admin_path_prefix when the API serves it', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      user_id: 'u_admin',
      team_id: 't_admin',
      email: 'founder@instanode.dev',
      tier: 'team',
      is_platform_admin: true,
      admin_path_prefix: 'abcdefghijklmnopqrstuvwxyz012345',
    }))
    // Imported lazily so we get the freshly-mocked module instance.
    const { fetchMe, getAdminPathPrefix } = await import('./index')
    const me = await fetchMe()
    expect(me.admin_path_prefix).toBe('abcdefghijklmnopqrstuvwxyz012345')
    expect(getAdminPathPrefix()).toBe('abcdefghijklmnopqrstuvwxyz012345')
  })

  it('fetchMe leaves the prefix empty when the API omits the field', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      user_id: 'u_user',
      team_id: 't_user',
      email: 'alice@example.com',
      tier: 'hobby',
      // is_platform_admin and admin_path_prefix both absent
    }))
    const { fetchMe, getAdminPathPrefix, setAdminPathPrefix } = await import('./index')
    // Pre-seed a stale prefix to prove fetchMe resets it.
    setAdminPathPrefix('stale_should_be_cleared_xxxxxxxx')
    const me = await fetchMe()
    expect(me.admin_path_prefix).toBeUndefined()
    expect(getAdminPathPrefix()).toBe('')
  })

  it('logout clears the stashed admin prefix', async () => {
    const { setAdminPathPrefix, getAdminPathPrefix } = await import('./index')
    setAdminPathPrefix('prefix_set_by_prior_admin_session_abc')
    expect(getAdminPathPrefix()).not.toBe('')
    await logout()
    expect(getAdminPathPrefix()).toBe('')
  })

  it('admin builders mint /api/v1/<prefix>/customers when the prefix is set', async () => {
    const { setAdminPathPrefix, listAdminCustomers } = await import('./index')
    setAdminPathPrefix('abcdefghijklmnopqrstuvwxyz012345')
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, customers: [], total: 0 }))
    await listAdminCustomers()
    const url = String(m.mock.calls[0][0])
    expect(url).toContain('/api/v1/abcdefghijklmnopqrstuvwxyz012345/customers')
    // The legacy guessable path must NOT appear in the request URL.
    expect(url).not.toContain('/api/v1/admin/customers')
  })

  it('admin builders throw admin_endpoints_unavailable when the prefix is empty', async () => {
    const { setAdminPathPrefix, listAdminCustomers, getAdminCustomer, setAdminCustomerTier, issueAdminCustomerPromo } =
      await import('./index')
    setAdminPathPrefix('') // closed-by-default
    installFetch() // not actually called — every builder throws before fetch.

    await expect(listAdminCustomers()).rejects.toMatchObject({
      status: 403,
      code: 'admin_endpoints_unavailable',
    })
    await expect(getAdminCustomer('t_x')).rejects.toMatchObject({
      status: 403,
      code: 'admin_endpoints_unavailable',
    })
    await expect(
      setAdminCustomerTier('t_x', { tier: 'pro', reason: 'comp' } as any),
    ).rejects.toMatchObject({ status: 403, code: 'admin_endpoints_unavailable' })
    await expect(
      issueAdminCustomerPromo('t_x', {
        kind: 'percent_off',
        value: 10,
        valid_for_days: 30,
      } as any),
    ).rejects.toMatchObject({ status: 403, code: 'admin_endpoints_unavailable' })
  })

  it('admin builders never include /admin/ in the request URL', async () => {
    // Belt-and-braces — even if the prefix happens to contain the
    // substring "admin", the LEGACY path /api/v1/admin/customers must
    // not appear in any request. Concretely: we set a prefix that
    // contains "admin" and check the URL is built around the prefix
    // verbatim, not the literal /api/v1/admin/.
    const { setAdminPathPrefix, listAdminCustomers } = await import('./index')
    const prefixWithAdminSubstring = 'preadminxxxxxxxxxxxxxxxxxxxxxxxx' // 32 chars, contains "admin"
    setAdminPathPrefix(prefixWithAdminSubstring)
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, customers: [], total: 0 }))
    await listAdminCustomers()
    const url = String(m.mock.calls[0][0])
    expect(url).toContain(`/api/v1/${prefixWithAdminSubstring}/customers`)
    // The exact legacy path is /api/v1/admin/customers — i.e. /admin/
    // bounded by slashes. A prefix containing "admin" as substring must
    // NOT produce that exact path.
    expect(url).not.toContain('/api/v1/admin/customers')
  })
})

// ─── createStack() — POST /stacks/new multipart upload (C06/D09 fix) ─────
// POST /stacks/new requires a 'manifest' field (instant.yaml text) and a
// tarball keyed by the service name from the manifest. The server returns
// 400 missing_manifest without it. We auto-generate a single-service manifest
// from the caller's opts (service name "app").
describe('createStack()', () => {
  function fakeFile(name: string, size: number): File {
    const f = new File([new ArrayBuffer(size)], name, { type: 'application/gzip' })
    return f
  }

  it('POSTs to /stacks/new with manifest + tarball keyed as "app"', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true, slug: 'sunny-cat-9', status: 'building', url: null, name: 'sunny-cat-9', env: 'development',
    }))
    const f = fakeFile('app.tar.gz', 2048)
    const r = await createStack(f, {
      name: 'my-app',
      port: 3000,
      env: 'staging',
      env_vars: { API_KEY: 'secret' },
    })
    expect(r.ok).toBe(true)
    expect(r.stack.slug).toBe('sunny-cat-9')
    expect(r.stack.status).toBe('building')

    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/stacks/new')
    expect(init?.method).toBe('POST')
    const body = init!.body as FormData
    expect(body).toBeInstanceOf(FormData)
    // manifest field is REQUIRED — server 400s without it.
    const manifestText = body.get('manifest') as string
    expect(typeof manifestText).toBe('string')
    expect(manifestText).toContain('services:')
    expect(manifestText).toContain('app:')
    expect(manifestText).toContain('port: 3000')
    expect(manifestText).toContain("API_KEY: 'secret'")
    // Tarball field key must match the service name in the manifest ("app").
    expect(body.get('app')).toBe(f)
    // name field sets the human-readable stack name.
    expect(body.get('name')).toBe('my-app')
    // env, port, env_vars are embedded in the manifest — NOT separate fields.
    expect(body.has('tarball')).toBe(false)
    expect(body.has('port')).toBe(false)
    expect(body.has('env')).toBe(false)
    expect(body.has('env_vars')).toBe(false)
    // CRITICAL — Content-Type must NOT be set (browser generates boundary).
    const headers = init?.headers as Headers
    expect(headers.has('Content-Type')).toBe(false)
  })

  it('generates a default port of 8080 in the manifest when caller omits port', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, slug: 's', status: 'building', url: null }))
    await createStack(fakeFile('a.tar.gz', 100), {})
    const body = m.mock.calls[0][1]!.body as FormData
    const manifestText = body.get('manifest') as string
    expect(manifestText).toContain('port: 8080')
  })

  it('omits name from the body when not provided', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, slug: 's', status: 'building', url: null }))
    await createStack(fakeFile('a.tar.gz', 100), {})
    const body = m.mock.calls[0][1]!.body as FormData
    expect(body.has('name')).toBe(false)
    // manifest + app tarball are always sent.
    expect(body.has('manifest')).toBe(true)
    expect(body.has('app')).toBe(true)
  })

  it('sends an Authorization: Bearer header when a token is present', async () => {
    const m = installFetch()
    setToken('test-token-xyz')
    m.mockResolvedValueOnce(jsonResponse({ ok: true, slug: 's', status: 'building', url: null }))
    await createStack(fakeFile('a.tar.gz', 100), {})
    const headers = m.mock.calls[0][1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer test-token-xyz')
  })

  it('propagates 402 (tier wall) so the page can show the upgrade banner', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'tier_limit', message: 'upgrade to pro for more stacks', agent_action: 'upgrade_to_pro' },
      { status: 402 },
    ))
    await expect(createStack(fakeFile('a.tar.gz', 100), {}))
      .rejects.toMatchObject({ status: 402 })
  })

  it('propagates 400 (invalid_tarball) so the form can render the message inline', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse(
      { error: 'invalid_tarball', message: 'missing Dockerfile' },
      { status: 400 },
    ))
    await expect(createStack(fakeFile('a.tar.gz', 100), {}))
      .rejects.toMatchObject({ status: 400, message: 'missing Dockerfile' })
  })

  it('propagates 413 (payload too large)', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ error: 'too_large' }, { status: 413 }))
    await expect(createStack(fakeFile('a.tar.gz', 100), {}))
      .rejects.toMatchObject({ status: 413 })
  })

  it('returns slug + status from the 202 response shape', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      slug: 'rainy-tree-3',
      status: 'building',
      url: null,
      name: 'rainy-tree-3',
      env: 'production',
    }, { status: 202 }))
    const r = await createStack(fakeFile('a.tar.gz', 100), {})
    expect(r.stack.slug).toBe('rainy-tree-3')
    expect(r.stack.status).toBe('building')
    expect(r.stack.url).toBeNull()
  })
})

// ─── fetchStackStatus() — GET /api/v1/stacks/:slug polling helper (D09/C06) ──
// The server response is FLAT — fields are at the top level, NOT nested under
// a 'stack' or 'item' key. Shape: { ok, stack_id, status, tier, name, services }.
// stack_id is the slug string. Previously the function polled a non-existent
// endpoint and could never resolve (D09 fix: route now registered + parser fixed).
describe('fetchStackStatus()', () => {
  it('GETs /api/v1/stacks/:slug and adapts the flat response shape', async () => {
    const m = installFetch()
    // Server returns flat fields — no nested 'stack' wrapper.
    m.mockResolvedValueOnce(jsonResponse({
      ok: true,
      stack_id: 's1',
      name: 'my-stack',
      status: 'running',
      tier: 'pro',
      services: [{ name: 'app', url: 'https://s1.deployment.instanode.dev', status: 'healthy' }],
    }))
    const r = await fetchStackStatus('s1')
    expect(r.ok).toBe(true)
    expect(r.stack?.slug).toBe('s1')
    expect(r.stack?.status).toBe('running')
    // url is derived from the first service that has one.
    expect(r.stack?.url).toBe('https://s1.deployment.instanode.dev')
    expect(String(m.mock.calls[0][0])).toContain('/api/v1/stacks/s1')
  })

  it('returns stack=null when stack_id is absent in the response', async () => {
    const m = installFetch()
    // Response with no stack_id = not a valid stack record.
    m.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const r = await fetchStackStatus('missing')
    expect(r.ok).toBe(true)
    expect(r.stack).toBeNull()
  })

  it('returns stack=null on 404 instead of throwing', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ error: 'not_found' }, { status: 404 }))
    const r = await fetchStackStatus('missing')
    expect(r.ok).toBe(true)
    expect(r.stack).toBeNull()
  })

  it('URI-encodes the slug', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, stack_id: 'a b', status: 'building' }))
    await fetchStackStatus('a b')
    expect(String(m.mock.calls[0][0])).toContain('/api/v1/stacks/a%20b')
  })

  it('propagates 5xx (not 404) so the polling caller can decide to retry', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ error: 'internal' }, { status: 500 }))
    await expect(fetchStackStatus('s1')).rejects.toMatchObject({ status: 500 })
  })
})
