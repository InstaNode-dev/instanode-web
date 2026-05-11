/* BillingPage.test.tsx — component coverage for the upgrade flow.
 *
 * Focused on the three handlers that move money:
 *   - handleChangePlan → api.createCheckout(nextTier) → window.location.href
 *   - handleCancel → window.confirm → api.cancelSubscription → re-fetch
 *   - error surfacing into checkoutErr state
 *
 * Renderer concerns (price formatting, usage rows) are not asserted —
 * those are intentional fixed strings and would burn on every visual
 * tweak. We assert on the behaviour that has financial consequences. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BillingPage } from './BillingPage'
import { FIXTURE_BILLING, FIXTURE_INVOICES, FIXTURE_USER, FIXTURE_TEAM } from '../api/fixtures'

// ─── Module-level mocks ──────────────────────────────────────────────────
// We mock the api module so tests never hit fetch(); each test sets up
// the response shape it cares about.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchBilling: vi.fn(),
    listInvoices: vi.fn(),
    createCheckout: vi.fn(),
    cancelSubscription: vi.fn(),
  }
})

// Stub useDashboardCtx so we control the tier displayed on the page.
let mockTier: string = 'hobby'
vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: {
      user: { ...FIXTURE_USER, tier: mockTier },
      team: { ...FIXTURE_TEAM, tier: mockTier },
    },
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
  }),
}))

import * as api from '../api'

// ─── Test helpers ────────────────────────────────────────────────────────

/** Default happy-path billing + invoices response. */
function mockHappyBilling() {
  ;(api.fetchBilling as any).mockResolvedValue({
    ok: true,
    plan: mockTier,
    billing: FIXTURE_BILLING,
  })
  ;(api.listInvoices as any).mockResolvedValue({
    ok: true,
    invoices: FIXTURE_INVOICES,
  })
}

/** Wait for the page to finish its initial load (skeleton → real content). */
async function waitForLoaded() {
  // The page shows a .skel div while billing is null. Once billing
  // resolves it renders the plan label. Wait for the upgrade button.
  await waitFor(() => {
    const btn = screen.queryByRole('button', { name: /upgrade to/i })
    expect(btn).toBeTruthy()
  })
}

// jsdom 24 ships window.location.href as a non-configurable setter — we
// can't intercept it directly without triggering a real navigation.
// Workaround: swap window.location wholesale with a plain object we
// control, then restore on teardown. The replacement implements only
// the surface BillingPage touches (href getter/setter).
let hrefSetTo: string | null = null
let originalLocation: Location | null = null
function installLocationHrefSpy() {
  hrefSetTo = null
  if (!originalLocation) originalLocation = window.location
  const mock = {
    get href() { return hrefSetTo ?? 'http://localhost/' },
    set href(v: string) { hrefSetTo = v },
    pathname: '/billing',
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

beforeEach(() => {
  mockTier = 'hobby'
  installLocationHrefSpy()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  restoreLocation()
})

// ─── Initial render ──────────────────────────────────────────────────────
describe('BillingPage — initial render', () => {
  it('shows a skeleton while billing is loading', () => {
    ;(api.fetchBilling as any).mockReturnValue(new Promise(() => {}))   // never resolves
    ;(api.listInvoices as any).mockReturnValue(new Promise(() => {}))
    const { container } = render(<BillingPage />)
    expect(container.querySelector('.skel')).toBeTruthy()
  })

  it('renders the Hobby plan label when tier=hobby', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: 'Hobby' })).toBeTruthy()
  })

  it('renders the Pro plan label when tier=pro', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: 'Pro' })).toBeTruthy()
  })

  it('falls back to the Hobby plan when tier is unknown', async () => {
    mockTier = 'unknown-tier'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: 'Hobby' })).toBeTruthy()
  })

  it('shows the upgrade-to-next-tier label (hobby → Pro)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeTruthy()
  })

  it('shows the upgrade-to-next-tier label (pro → Team)', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('button', { name: /upgrade to team/i })).toBeTruthy()
  })

  it('renders the payment method line from billing.payment_last4', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    expect(container.textContent).toContain('4242')
    expect(container.textContent?.toLowerCase()).toContain('visa')
  })

  it('renders each invoice from listInvoices()', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    for (const inv of FIXTURE_INVOICES) {
      expect(container.textContent).toContain(inv.id)
    }
  })

  it('calls fetchBilling and listInvoices exactly once on mount', async () => {
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(api.fetchBilling).toHaveBeenCalledTimes(1)
    expect(api.listInvoices).toHaveBeenCalledTimes(1)
  })

  it('renders the Cancel subscription button', async () => {
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('button', { name: /cancel subscription/i })).toBeTruthy()
  })
})

// ─── handleChangePlan ────────────────────────────────────────────────────
describe('BillingPage — handleChangePlan (upgrade flow)', () => {
  it('calls api.createCheckout("pro") when user is on hobby and clicks Upgrade', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/abc',
    })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledTimes(1))
    expect(api.createCheckout).toHaveBeenCalledWith('pro')
  })

  it('calls api.createCheckout("team") when user is on pro', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/xyz',
    })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /upgrade to team/i }))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('team'))
  })

  it('redirects via window.location.href when short_url is returned', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/abc',
    })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/abc'))
  })

  it('surfaces "checkout returned no url" when short_url is missing', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({ ok: true, short_url: '' })
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    await waitFor(() => expect(container.textContent).toContain('checkout returned no url'))
    expect(hrefSetTo).toBeNull()
  })

  it('surfaces the thrown error message in the checkoutErr UI', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockRejectedValue(new Error('razorpay unreachable'))
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    await waitFor(() => expect(container.textContent).toContain('razorpay unreachable'))
    expect(hrefSetTo).toBeNull()
  })

  it('falls back to "checkout failed" when the thrown error has no message', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockRejectedValue({ /* no message */ })
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    await waitFor(() => expect(container.textContent).toContain('checkout failed'))
  })

  it('disables the Upgrade button while checkout is in flight', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    let resolveCheckout: (v: any) => void = () => {}
    ;(api.createCheckout as any).mockReturnValue(
      new Promise((r) => { resolveCheckout = r }),
    )
    render(<BillingPage />)
    await waitForLoaded()
    const btn = screen.getByRole('button', { name: /upgrade to pro/i }) as HTMLButtonElement
    fireEvent.click(btn)
    await waitFor(() => expect(btn.disabled).toBe(true))
    resolveCheckout({ ok: true, short_url: 'https://rzp.io/i/abc' })
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/abc'))
  })

  it('clears a previous checkoutErr on a new click', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any)
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce({ ok: true, short_url: 'https://rzp.io/i/ok' })
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    await waitFor(() => expect(container.textContent).toContain('first fail'))
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/ok'))
    // Error message cleared once redirect fires
    expect(container.textContent).not.toContain('first fail')
  })

  it('does nothing when the team-tier user (no nextTier) clicks the disabled button', async () => {
    // On team-tier the button label is "Change plan" and disabled — but
    // double-check the guard inside handleChangePlan also short-circuits.
    mockTier = 'team'
    mockHappyBilling()
    render(<BillingPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change plan/i })).toBeTruthy()
    })
    const btn = screen.getByRole('button', { name: /change plan/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    // Programmatic click anyway — the early return should hold.
    fireEvent.click(btn)
    // No createCheckout call.
    expect(api.createCheckout).not.toHaveBeenCalled()
  })
})

// ─── handleCancel ────────────────────────────────────────────────────────
describe('BillingPage — handleCancel (cancellation flow)', () => {
  it('prompts via window.confirm before calling cancelSubscription', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(api.cancelSubscription).not.toHaveBeenCalled()
  })

  it('aborts when the user clicks Cancel in the confirm dialog', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }))
    // No cancel call AND no re-fetch on the page after the initial load.
    expect(api.cancelSubscription).not.toHaveBeenCalled()
    expect((api.fetchBilling as any).mock.calls.length).toBe(1)
  })

  it('calls api.cancelSubscription when confirm returns true', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    ;(api.cancelSubscription as any).mockResolvedValue({ ok: true })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }))
    await waitFor(() => expect(api.cancelSubscription).toHaveBeenCalledTimes(1))
  })

  it('re-fetches billing after a successful cancel', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    ;(api.cancelSubscription as any).mockResolvedValue({ ok: true })
    render(<BillingPage />)
    await waitForLoaded()
    expect((api.fetchBilling as any).mock.calls.length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }))
    await waitFor(() => expect((api.fetchBilling as any).mock.calls.length).toBe(2))
  })

  it('shows the post-cancel alert message', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    ;(api.cancelSubscription as any).mockResolvedValue({ ok: true })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }))
    await waitFor(() => expect(alertSpy).toHaveBeenCalled())
    expect(alertSpy.mock.calls[0][0]).toMatch(/cancellation requested/i)
  })

  it('surfaces a cancel error in checkoutErr', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(api.cancelSubscription as any).mockRejectedValue(new Error('no active subscription'))
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }))
    await waitFor(() => expect(container.textContent).toContain('no active subscription'))
  })

  it('falls back to "cancel failed" when the thrown error has no message', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(api.cancelSubscription as any).mockRejectedValue({ /* no message */ })
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }))
    await waitFor(() => expect(container.textContent).toContain('cancel failed'))
  })

  it('does NOT re-fetch billing on a cancel error', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(api.cancelSubscription as any).mockRejectedValue(new Error('boom'))
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }))
    await waitFor(() => expect(api.cancelSubscription).toHaveBeenCalled())
    // fetchBilling called once on mount only, never re-fetched on error.
    expect((api.fetchBilling as any).mock.calls.length).toBe(1)
  })
})

// ─── userEvent end-to-end smoke (real keyboard/pointer) ─────────────────
describe('BillingPage — userEvent integration', () => {
  it('a real click on Upgrade kicks off createCheckout', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/ue',
    })
    const user = userEvent.setup()
    render(<BillingPage />)
    await waitForLoaded()
    await user.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('pro'))
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/ue'))
  })
})
