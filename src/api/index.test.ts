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
} from './index'
import { FIXTURE_BILLING, FIXTURE_INVOICES } from './fixtures'

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

  it('POSTs to /api/v1/billing/checkout with the plan in the body', async () => {
    const m = installFetch()
    m.mockResolvedValueOnce(jsonResponse({ ok: true, short_url: 'https://rzp.io/i/abc' }))
    await createCheckout('pro')
    const [url, init] = m.mock.calls[0]
    expect(String(url)).toContain('/api/v1/billing/checkout')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ plan: 'pro' }))
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json')
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
    expect(init.body).toBe(JSON.stringify({ plan: 'team' }))
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
      trial_ends_at: null,
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
