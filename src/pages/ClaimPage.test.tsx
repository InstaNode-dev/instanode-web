/* ClaimPage.test.tsx — coverage for the post-claim payment funnel.
 *
 * The claim flow today is: enter email → POST /claim → session minted.
 * Pay-from-day-one means the session alone doesn't make resources
 * permanent — the Razorpay subscription.charged webhook does. So after
 * /claim succeeds, this page funnels the user into checkout instead of
 * dropping them on the dashboard.
 *
 * Tests target the behaviour with financial consequences:
 *   - submitting the email triggers /claim and shows the payment CTAs
 *   - clicking Hobby calls createCheckout('hobby') and redirects
 *   - clicking Pro calls createCheckout('pro') and redirects
 *   - countdown reflects soonest expires_at across resources
 *   - explainer is dismissable
 *   - checkout errors surface inline (no redirect)
 *
 * We do NOT assert on pixel-level styling — copy and layout are intentional
 * but expected to evolve. Anything that moves money is asserted explicitly. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ClaimPage } from './ClaimPage'

// ─── Module-level mocks ──────────────────────────────────────────────────
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    claim: vi.fn(),
    createAPIKey: vi.fn(),
    createCheckout: vi.fn(),
    listResources: vi.fn(),
    setToken: vi.fn(),
  }
})

import * as api from '../api'

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a deterministic JWT-shaped string whose payload decodes to the
 * claim metadata ClaimPage reads (rt, tok). The signature is irrelevant —
 * the page never verifies it. We just need atob() to work.
 */
function buildClaimJWT(rt: string[] = ['postgres', 'redis'], tok: string[] = ['abc12345xyz', 'def67890uvw']): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({ rt, tok, exp: Math.floor(Date.now() / 1000) + 3600 }))
  return `${header}.${payload}.sig`
}

function renderClaim(jwt: string = buildClaimJWT()) {
  return render(
    <MemoryRouter initialEntries={[`/claim?t=${encodeURIComponent(jwt)}`]}>
      <ClaimPage />
    </MemoryRouter>,
  )
}

// jsdom 24 ships window.location.href as a non-configurable setter — we
// can't intercept it directly without triggering a real navigation. Swap
// window.location wholesale with a plain object we control, then restore
// on teardown. Mirrors the BillingPage.test.tsx approach.
let hrefSetTo: string | null = null
let originalLocation: Location | null = null

function installLocationHrefSpy() {
  hrefSetTo = null
  if (!originalLocation) originalLocation = window.location
  const mock = {
    get href() { return hrefSetTo ?? 'http://localhost/' },
    set href(v: string) { hrefSetTo = v },
    pathname: '/claim',
    search: '',
    origin: 'http://localhost',
    replace: (v: string) => { hrefSetTo = v },
    assign: (v: string) => { hrefSetTo = v },
    reload: () => {},
    toString: () => hrefSetTo ?? 'http://localhost/',
  }
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: mock,
  })
}

function restoreLocation() {
  if (originalLocation) {
    try {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      })
    } catch { /* best-effort */ }
  }
}

/** Standard happy-path: claim succeeds, createAPIKey works, two TTL resources. */
function mockHappyClaim(expiresInMs: number = 23 * 60 * 60 * 1000) {
  ;(api.claim as any).mockResolvedValue({
    ok: true,
    team_id: 'team_1',
    user_id: 'user_1',
    session_token: 'sess_jwt_abc',
  })
  ;(api.createAPIKey as any).mockResolvedValue({
    id: 'pat_1',
    name: 'dashboard-session',
    scopes: ['read', 'write'],
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked: false,
    key: 'pat_real_token',
    note: '',
  })
  ;(api.listResources as any).mockResolvedValue({
    ok: true,
    items: [
      {
        id: 'res_1',
        token: 'tok_1',
        resource_type: 'postgres' as const,
        tier: 'anonymous' as const,
        status: 'active' as const,
        name: null,
        env: 'production',
        storage_bytes: 0,
        storage_limit_bytes: 1024 * 1024 * 10,
        storage_exceeded: false,
        expires_at: new Date(Date.now() + expiresInMs).toISOString(),
        created_at: new Date().toISOString(),
      },
      {
        id: 'res_2',
        token: 'tok_2',
        resource_type: 'redis' as const,
        tier: 'anonymous' as const,
        status: 'active' as const,
        name: null,
        env: 'production',
        storage_bytes: 0,
        storage_limit_bytes: 1024 * 1024 * 5,
        storage_exceeded: false,
        // Slightly later — soonest should still be res_1.
        expires_at: new Date(Date.now() + expiresInMs + 60_000).toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
    total: 2,
  })
}

/** Submit the email form and wait for the funnel to mount. */
async function claimAndReachFunnel() {
  fireEvent.change(screen.getByTestId('claim-email'), { target: { value: 'founder@example.com' } })
  fireEvent.click(screen.getByTestId('claim-submit'))
  await waitFor(() => {
    expect(screen.queryByTestId('claim-funnel')).toBeTruthy()
  })
}

beforeEach(() => {
  installLocationHrefSpy()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  restoreLocation()
})

// ─── Pre-claim email entry (regression: pre-existing form still works) ──
describe('ClaimPage — email entry (pre-claim)', () => {
  it('renders the email input + Claim all button when a token is present', () => {
    renderClaim()
    expect(screen.getByTestId('claim-email')).toBeTruthy()
    expect(screen.getByTestId('claim-submit')).toBeTruthy()
  })

  it('renders the preview list parsed from the JWT', () => {
    renderClaim(buildClaimJWT(['postgres', 'redis', 'mongodb']))
    const preview = screen.getByTestId('claim-preview')
    expect(preview.textContent).toContain('postgres')
    expect(preview.textContent).toContain('redis')
    expect(preview.textContent).toContain('mongodb')
  })

  it('surfaces "Email is required" when the form is submitted empty', () => {
    renderClaim()
    fireEvent.click(screen.getByTestId('claim-submit'))
    expect(screen.getByTestId('claim-error').textContent).toContain('Email is required')
    expect(api.claim).not.toHaveBeenCalled()
  })

  it('renders the missing-token state when ?t= is absent', () => {
    render(
      <MemoryRouter initialEntries={['/claim']}>
        <ClaimPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/missing claim link/i)).toBeTruthy()
  })
})

// ─── Submit → funnel transition ─────────────────────────────────────────
describe('ClaimPage — submitting the email funnels into checkout', () => {
  it('calls api.claim with the JWT and entered email', async () => {
    mockHappyClaim()
    renderClaim()
    await claimAndReachFunnel()
    expect(api.claim).toHaveBeenCalledTimes(1)
    const [args] = (api.claim as any).mock.calls
    expect(args[0].email).toBe('founder@example.com')
    expect(typeof args[0].jwt).toBe('string')
    expect(args[0].jwt.length).toBeGreaterThan(0)
  })

  it('shows both payment CTAs after a successful claim', async () => {
    mockHappyClaim()
    renderClaim()
    await claimAndReachFunnel()
    expect(screen.getByTestId('claim-checkout-hobby')).toBeTruthy()
    expect(screen.getByTestId('claim-checkout-pro')).toBeTruthy()
  })

  it('fetches the resource list to drive the countdown', async () => {
    mockHappyClaim()
    renderClaim()
    await claimAndReachFunnel()
    expect(api.listResources).toHaveBeenCalledTimes(1)
  })

  it('renders the dismissable explainer below the CTAs', async () => {
    mockHappyClaim()
    renderClaim()
    await claimAndReachFunnel()
    const exp = screen.getByTestId('claim-explainer')
    expect(exp.textContent).toContain('24 hours')
    fireEvent.click(screen.getByTestId('claim-explainer-dismiss'))
    expect(screen.queryByTestId('claim-explainer')).toBeNull()
  })

  it('surfaces the claim error and stays on the email screen when /claim fails', async () => {
    ;(api.claim as any).mockRejectedValue(new Error('Link already used'))
    renderClaim()
    fireEvent.change(screen.getByTestId('claim-email'), { target: { value: 'founder@example.com' } })
    fireEvent.click(screen.getByTestId('claim-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('claim-error').textContent).toContain('Link already used')
    })
    expect(screen.queryByTestId('claim-funnel')).toBeNull()
  })

  it('does not block the funnel if listResources fails', async () => {
    ;(api.claim as any).mockResolvedValue({
      ok: true, team_id: 't', user_id: 'u', session_token: 's',
    })
    ;(api.createAPIKey as any).mockResolvedValue({
      id: 'pat_1', name: 'x', scopes: [], created_at: '', last_used_at: null,
      revoked: false, key: 'k', note: '',
    })
    ;(api.listResources as any).mockRejectedValue(new Error('redis down'))
    renderClaim()
    await claimAndReachFunnel()
    // Countdown placeholder — no timer, but CTAs still render.
    expect(screen.getByTestId('claim-countdown-value').textContent).toBe('—')
    expect(screen.getByTestId('claim-checkout-hobby')).toBeTruthy()
  })

  it('survives a createAPIKey failure (falls back to session token)', async () => {
    ;(api.claim as any).mockResolvedValue({
      ok: true, team_id: 't', user_id: 'u', session_token: 'sess',
    })
    ;(api.createAPIKey as any).mockRejectedValue(new Error('PAT minting offline'))
    ;(api.listResources as any).mockResolvedValue({ ok: true, items: [], total: 0 })
    renderClaim()
    await claimAndReachFunnel()
    // Session token must still have been stored even though PAT minting failed.
    expect(api.setToken).toHaveBeenCalledWith('sess')
  })
})

// ─── Countdown ──────────────────────────────────────────────────────────
describe('ClaimPage — countdown', () => {
  it('shows a HH:MM:SS countdown derived from the soonest expires_at', async () => {
    // Pin a value just under 1h so we know what to expect.
    mockHappyClaim(59 * 60 * 1000 + 30_000)   // 59m30s
    renderClaim()
    await claimAndReachFunnel()
    const val = screen.getByTestId('claim-countdown-value').textContent ?? ''
    // Should be 00:59:30 give-or-take a second of test latency.
    expect(val).toMatch(/^00:5[89]:\d{2}$/)
  })

  it('shows the placeholder "—" when no resource has an expires_at', async () => {
    ;(api.claim as any).mockResolvedValue({
      ok: true, team_id: 't', user_id: 'u', session_token: 's',
    })
    ;(api.createAPIKey as any).mockResolvedValue({
      id: 'p', name: 'x', scopes: [], created_at: '', last_used_at: null,
      revoked: false, key: 'k', note: '',
    })
    ;(api.listResources as any).mockResolvedValue({
      ok: true,
      items: [{
        id: 'res_3', token: 't', resource_type: 'postgres' as const,
        tier: 'pro' as const, status: 'active' as const, name: null,
        env: 'production', storage_bytes: 0, storage_limit_bytes: 0,
        storage_exceeded: false, expires_at: null,
        created_at: new Date().toISOString(),
      }],
      total: 1,
    })
    renderClaim()
    await claimAndReachFunnel()
    expect(screen.getByTestId('claim-countdown-value').textContent).toBe('—')
  })
})

// ─── Checkout CTAs ──────────────────────────────────────────────────────
describe('ClaimPage — checkout CTAs', () => {
  it('clicking the Hobby CTA calls createCheckout("hobby") and redirects to short_url', async () => {
    mockHappyClaim()
    ;(api.createCheckout as any).mockResolvedValue({ ok: true, short_url: 'https://rzp.io/i/hobby' })
    renderClaim()
    await claimAndReachFunnel()
    fireEvent.click(screen.getByTestId('claim-checkout-hobby'))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('hobby'))
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/hobby'))
  })

  it('clicking the Pro CTA calls createCheckout("pro") and redirects to short_url', async () => {
    mockHappyClaim()
    ;(api.createCheckout as any).mockResolvedValue({ ok: true, short_url: 'https://rzp.io/i/pro' })
    renderClaim()
    await claimAndReachFunnel()
    fireEvent.click(screen.getByTestId('claim-checkout-pro'))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('pro'))
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/pro'))
  })

  it('surfaces "Checkout returned no URL" inline when short_url is missing', async () => {
    mockHappyClaim()
    ;(api.createCheckout as any).mockResolvedValue({ ok: true, short_url: '' })
    renderClaim()
    await claimAndReachFunnel()
    fireEvent.click(screen.getByTestId('claim-checkout-hobby'))
    await waitFor(() => {
      expect(screen.getByTestId('claim-checkout-error').textContent).toContain('Checkout returned no URL')
    })
    expect(hrefSetTo).toBeNull()
    // CTAs should be re-enabled so the user can retry.
    expect((screen.getByTestId('claim-checkout-hobby') as HTMLButtonElement).disabled).toBe(false)
  })

  it('surfaces the thrown error message inline on createCheckout failure', async () => {
    mockHappyClaim()
    ;(api.createCheckout as any).mockRejectedValue(new Error('razorpay unreachable'))
    renderClaim()
    await claimAndReachFunnel()
    fireEvent.click(screen.getByTestId('claim-checkout-hobby'))
    await waitFor(() => {
      expect(screen.getByTestId('claim-checkout-error').textContent).toContain('razorpay unreachable')
    })
    expect(hrefSetTo).toBeNull()
  })

  it('disables both CTAs while checkout is in flight', async () => {
    mockHappyClaim()
    let resolve: (v: any) => void = () => {}
    ;(api.createCheckout as any).mockReturnValue(new Promise((r) => { resolve = r }))
    renderClaim()
    await claimAndReachFunnel()
    const hobby = screen.getByTestId('claim-checkout-hobby') as HTMLButtonElement
    const pro = screen.getByTestId('claim-checkout-pro') as HTMLButtonElement
    fireEvent.click(hobby)
    await waitFor(() => expect(hobby.disabled).toBe(true))
    expect(pro.disabled).toBe(true)
    await act(async () => {
      resolve({ ok: true, short_url: 'https://rzp.io/i/x' })
    })
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/x'))
  })
})
