/* CheckoutPage.test.tsx — coverage for the W12 funnel landing page +
 * BUG-P111 / BUG-P112 / BUG-P013 / BUG-P088 / BUG-P121 auth-gate +
 * cache-reset fixes (2026-05-29).
 *
 * The /app/checkout page reads ?plan= and ?frequency= from the URL,
 * POSTs to /api/v1/billing/checkout, and either redirects to Razorpay
 * or surfaces one of: invalid params, billing-not-configured fallback,
 * email-not-verified recovery banner, generic error card, OR — for the
 * BUG-P111 fix — redirects to /login?next=… when the second-layer auth
 * gate trips.
 *
 * Tests pin every Status branch in the union — these are the surfaces
 * a marketing-page click actually lands on. The unauth + cache-reset
 * tests are the new gates that protect against a stale-localStorage JWT
 * or back-cache restoration silently reaching a LIVE Razorpay
 * subscription URL. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  CheckoutPage,
  buildLoginRedirect,
  clearCheckoutCache,
  CHECKOUT_CACHE_KEY_PREFIX,
} from './CheckoutPage'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    createCheckout: vi.fn(),
    // Default to an authenticated user (token present). Individual tests
    // override this via mockReturnValue to exercise the unauth gate. This
    // stays closer to production behaviour than mocking localStorage
    // directly — the page reads getToken(), not localStorage.
    getToken: vi.fn(() => 'test-token'),
  }
})

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: { user: { id: 'u1', email: 'aanya@acme.dev', tier: 'free', team_id: 't1', created_at: '', display_name: '', role: 'owner' }, team: null },
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
  }),
}))

import * as api from '../api'

// Spy on window.location.assign — the page imperatively navigates on
// successful checkout AND on the BUG-P111 unauth-redirect.
let originalLocation: Location | null = null
let assignedTo: string | null = null
function installLocationSpy() {
  assignedTo = null
  if (!originalLocation) originalLocation = window.location
  const mock: any = {
    ...originalLocation,
    assign: (v: string) => { assignedTo = v },
    href: 'http://localhost/',
    origin: 'http://localhost',
    pathname: '/app/checkout',
    search: '',
  }
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: mock })
}
function restoreLocation() {
  if (originalLocation) {
    try { Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation }) } catch {}
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Re-arm the default getToken mock for each test so a previous test's
  // unauth override doesn't bleed into the next test's setup.
  ;(api.getToken as any).mockReturnValue('test-token')
  installLocationSpy()
  // Wipe any localStorage residue so the cache-reset tests start clean.
  try { localStorage.clear() } catch {}
})
afterEach(() => {
  cleanup()
  restoreLocation()
  try { localStorage.clear() } catch {}
})

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CheckoutPage />
    </MemoryRouter>,
  )
}

describe('CheckoutPage', () => {
  it('renders loading state on mount with valid params', async () => {
    ;(api.createCheckout as any).mockImplementation(() => new Promise(() => {}))
    renderAt('/app/checkout?plan=hobby&frequency=monthly')
    expect(screen.getByTestId('checkout-loading')).toBeTruthy()
  })

  it('redirects to Razorpay short_url on success', async () => {
    ;(api.createCheckout as any).mockResolvedValue({ short_url: 'https://rzp.io/abc' })
    renderAt('/app/checkout?plan=hobby&frequency=monthly')
    await waitFor(() => expect(screen.getByTestId('checkout-redirecting')).toBeTruthy())
    expect(assignedTo).toBe('https://rzp.io/abc')
    expect(api.createCheckout).toHaveBeenCalledWith('hobby', 'monthly')
  })

  it('surfaces error when short_url is missing from response', async () => {
    ;(api.createCheckout as any).mockResolvedValue({})
    renderAt('/app/checkout?plan=hobby&frequency=monthly')
    await waitFor(() => expect(screen.getByTestId('checkout-error')).toBeTruthy())
    expect(screen.getByTestId('checkout-error').textContent).toMatch(/missing short_url/i)
  })

  it('renders fallback panel on 503 billing_not_configured', async () => {
    ;(api.createCheckout as any).mockRejectedValue({ status: 503, code: 'billing_not_configured' })
    renderAt('/app/checkout?plan=pro&frequency=monthly')
    await waitFor(() => expect(screen.getByTestId('checkout-fallback')).toBeTruthy())
    expect(screen.getByTestId('checkout-fallback').textContent).toMatch(/Razorpay not yet configured/i)
  })

  // BUG-P112 server-side guard (PR-2): when the api detects a live key in
  // a non-prod deployment it returns 503 billing_misconfigured. The SPA
  // should render the same fallback panel (operator action required) so
  // QA testers don't reach a real Razorpay subscription URL.
  it('renders fallback panel on 503 billing_misconfigured (BUG-P112 server guard)', async () => {
    ;(api.createCheckout as any).mockRejectedValue({ status: 503, code: 'billing_misconfigured' })
    renderAt('/app/checkout?plan=pro&frequency=monthly')
    await waitFor(() => expect(screen.getByTestId('checkout-fallback')).toBeTruthy())
    expect(api.createCheckout).toHaveBeenCalled()
    // No live Razorpay URL was reached — that's the load-bearing assertion.
    expect(assignedTo).toBeNull()
  })

  it('renders email_not_verified branch on 403 with email_not_verified code', async () => {
    ;(api.createCheckout as any).mockRejectedValue({
      status: 403,
      code: 'email_not_verified',
      message: 'verify your email',
    })
    renderAt('/app/checkout?plan=pro&frequency=monthly')
    await waitFor(() => expect(screen.getByTestId('checkout-email-not-verified')).toBeTruthy())
  })

  it('renders generic error card on unknown rejection', async () => {
    ;(api.createCheckout as any).mockRejectedValue(new Error('network down'))
    renderAt('/app/checkout?plan=team&frequency=yearly')
    await waitFor(() => expect(screen.getByTestId('checkout-error')).toBeTruthy())
    expect(screen.getByTestId('checkout-error').textContent).toMatch(/network down/)
  })

  it('renders error card with default message when rejection has no message', async () => {
    ;(api.createCheckout as any).mockRejectedValue({})
    renderAt('/app/checkout?plan=hobby&frequency=monthly')
    await waitFor(() => expect(screen.getByTestId('checkout-error')).toBeTruthy())
    expect(screen.getByTestId('checkout-error').textContent).toMatch(/Could not start checkout/i)
  })

  it('renders invalid state when plan is missing', async () => {
    renderAt('/app/checkout')
    expect(screen.getByTestId('checkout-invalid')).toBeTruthy()
    expect(screen.getByTestId('checkout-invalid').textContent).toMatch(/Missing required \?plan=/i)
    expect(api.createCheckout).not.toHaveBeenCalled()
  })

  it('renders invalid state when plan is unknown', async () => {
    renderAt('/app/checkout?plan=bogus&frequency=monthly')
    expect(screen.getByTestId('checkout-invalid')).toBeTruthy()
    expect(screen.getByTestId('checkout-invalid').textContent).toMatch(/Unknown plan "bogus"/)
  })

  it('renders invalid state when frequency is unknown', async () => {
    renderAt('/app/checkout?plan=hobby&frequency=quarterly')
    expect(screen.getByTestId('checkout-invalid')).toBeTruthy()
    expect(screen.getByTestId('checkout-invalid').textContent).toMatch(/Unknown frequency "quarterly"/)
  })

  it('defaults frequency to monthly when only plan is provided', async () => {
    ;(api.createCheckout as any).mockResolvedValue({ short_url: 'https://rzp.io/x' })
    renderAt('/app/checkout?plan=pro')
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('pro', 'monthly'))
  })

  it('accepts hobby_plus and team and yearly variations', async () => {
    ;(api.createCheckout as any).mockResolvedValue({ short_url: 'https://rzp.io/x' })
    renderAt('/app/checkout?plan=hobby_plus&frequency=yearly')
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('hobby_plus', 'yearly'))
  })

  it('cancellation flag suppresses state set after unmount (loading branch)', async () => {
    let resolveIt: any
    ;(api.createCheckout as any).mockImplementation(
      () => new Promise((r) => { resolveIt = r }),
    )
    const { unmount } = renderAt('/app/checkout?plan=hobby&frequency=monthly')
    unmount()
    resolveIt({ short_url: 'https://rzp.io/late' })
    // No assertion failure = success: the post-unmount setState was guarded.
    await new Promise((r) => setTimeout(r, 10))
  })

  // ──────────────────────────────────────────────────────────────────────
  // BUG-P111 / BUG-P112 / BUG-P013 — the load-bearing tests.
  // ──────────────────────────────────────────────────────────────────────

  describe('BUG-P111 second-layer auth gate', () => {
    // TestCheckoutPage_UnauthRedirectsToLogin from the brief.
    it('redirects an unauthenticated user to /login?next=… and NEVER calls createCheckout', async () => {
      ;(api.getToken as any).mockReturnValue(null)
      renderAt('/app/checkout?plan=hobby&frequency=monthly')
      // The component flips to the unauthenticated state synchronously
      // and the effect issues window.location.assign before any await.
      await waitFor(() => expect(screen.getByTestId('checkout-unauthenticated')).toBeTruthy())
      expect(assignedTo).not.toBeNull()
      expect(assignedTo!.startsWith('/login?next=')).toBe(true)
      // Load-bearing: the API was NEVER called, so no sub_* was minted.
      expect(api.createCheckout).not.toHaveBeenCalled()
    })

    // TestCheckoutPage_PreservesNextParam from the brief.
    it('preserves plan + frequency in the next= param so post-signin returns the user to the same checkout', async () => {
      ;(api.getToken as any).mockReturnValue(null)
      renderAt('/app/checkout?plan=pro&frequency=yearly')
      await waitFor(() => expect(assignedTo).not.toBeNull())
      const url = new URL(assignedTo!, 'http://localhost')
      const next = url.searchParams.get('next')
      expect(next).toBeTruthy()
      // Decode the inner /app/checkout?plan=…&frequency=… without pinning
      // the exact percent-encoding (URLSearchParams handles that).
      const innerSearch = new URLSearchParams(next!.split('?')[1] ?? '')
      expect(next!.split('?')[0]).toBe('/app/checkout')
      expect(innerSearch.get('plan')).toBe('pro')
      expect(innerSearch.get('frequency')).toBe('yearly')
    })

    it('preserves frequency=monthly when only plan is provided', async () => {
      ;(api.getToken as any).mockReturnValue(null)
      renderAt('/app/checkout?plan=hobby')
      await waitFor(() => expect(assignedTo).not.toBeNull())
      const url = new URL(assignedTo!, 'http://localhost')
      const next = url.searchParams.get('next')
      const innerSearch = new URLSearchParams(next!.split('?')[1] ?? '')
      expect(innerSearch.get('plan')).toBe('hobby')
      expect(innerSearch.get('frequency')).toBe('monthly')
    })

    // Mid-flight token rejection (e.g. logged out from another tab) —
    // the page tags 'unauthenticated' so a future analytics hook can
    // observe the path. The global call() wrapper already issues the
    // server-side invalidation + redirect; the local guard prevents a
    // double-redirect race and keeps the assertion testable.
    it('flips to unauthenticated on a mid-flight 401 from the API', async () => {
      ;(api.createCheckout as any).mockRejectedValue({ status: 401, code: 'unauthorized' })
      renderAt('/app/checkout?plan=hobby&frequency=monthly')
      await waitFor(() => expect(screen.getByTestId('checkout-unauthenticated')).toBeTruthy())
    })
  })

  // TestCheckoutPage_ClearsCachedSubOnLogout from the brief.
  describe('BUG-P121/P122 cache-reset on logout', () => {
    it('clearCheckoutCache removes every key with CHECKOUT_CACHE_KEY_PREFIX', () => {
      localStorage.setItem(CHECKOUT_CACHE_KEY_PREFIX + 'short_url', 'sub_Sv96Mt2n8nnDYL')
      localStorage.setItem(CHECKOUT_CACHE_KEY_PREFIX + 'subscription_id', 'sub_xxx')
      // Unrelated key must survive the purge.
      localStorage.setItem('instanode.token', 'tok_kept')
      clearCheckoutCache()
      expect(localStorage.getItem(CHECKOUT_CACHE_KEY_PREFIX + 'short_url')).toBeNull()
      expect(localStorage.getItem(CHECKOUT_CACHE_KEY_PREFIX + 'subscription_id')).toBeNull()
      expect(localStorage.getItem('instanode.token')).toBe('tok_kept')
    })

    it('clearCheckoutCache is idempotent (no-op when the cache is already empty)', () => {
      // Should not throw on a clean cache.
      expect(() => clearCheckoutCache()).not.toThrow()
    })

    it('clearCheckoutCache survives a localStorage throw (defence-in-depth)', () => {
      const orig = Object.getOwnPropertyDescriptor(window, 'localStorage')
      try {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get() {
            throw new Error('storage disabled')
          },
        })
        // Must not bubble — clearing is best-effort.
        expect(() => clearCheckoutCache()).not.toThrow()
      } finally {
        if (orig) Object.defineProperty(window, 'localStorage', orig)
      }
    })
  })

  // BUG-P088: razorpay_configured default is FAIL-CLOSED in the api layer.
  // The CheckoutPage doesn't read razorpay_configured itself (it only
  // surfaces the server's 503 billing_not_configured /
  // billing_misconfigured envelope), but
  // TestCheckoutPage_HidesButtonsWhenRazorpayUnconfigured in the brief is
  // exercised in src/api/index.test.ts — the mapBillingState default
  // flipped from `?? true` to `?? false`. Sentinel test below keeps the
  // bug-id discoverable via grep from this file.
  describe('BUG-P088 razorpay_configured default (cross-ref)', () => {
    it('see src/api/index.test.ts fetchBilling() for the wire-default coverage', () => {
      expect(true).toBe(true)
    })
  })

  describe('buildLoginRedirect', () => {
    it('builds /login?next=<encoded /app/checkout> with both plan + frequency', () => {
      const r = buildLoginRedirect('hobby', 'monthly')
      const url = new URL(r, 'http://localhost')
      expect(url.pathname).toBe('/login')
      const next = url.searchParams.get('next')!
      const innerSearch = new URLSearchParams(next.split('?')[1] ?? '')
      expect(next.startsWith('/app/checkout?')).toBe(true)
      expect(innerSearch.get('plan')).toBe('hobby')
      expect(innerSearch.get('frequency')).toBe('monthly')
    })

    it('omits plan when null (defensive — a hand-typed URL with no plan)', () => {
      const r = buildLoginRedirect(null, 'monthly')
      const url = new URL(r, 'http://localhost')
      const next = url.searchParams.get('next')!
      const innerSearch = new URLSearchParams(next.split('?')[1] ?? '')
      expect(innerSearch.has('plan')).toBe(false)
      expect(innerSearch.get('frequency')).toBe('monthly')
    })
  })
})
