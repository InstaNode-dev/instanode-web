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
import type { BillingDetails, DashboardTeam, Invoice, User } from '../api'

// §10.21: the runtime `api/fixtures.ts` module is gone — test-only data
// lives here, inlined and minimal. These shapes match the api types and
// exist solely so the BillingPage tests can pin expected rendering.
const FIXTURE_USER: User = {
  id: 'u_test',
  email: 'aanya@acme.dev',
  tier: 'pro',
  team_id: 't_test',
  created_at: new Date(Date.now() - 42 * 86_400_000).toISOString(),
  display_name: 'Aanya Patel',
  role: 'owner',
}

const FIXTURE_TEAM: DashboardTeam = {
  id: 't_test',
  name: 'acme-corp',
  slug: 'acme-corp',
  owner_id: 'u_test',
  member_count: 1,
  tier: 'pro',
  created_at: new Date(Date.now() - 42 * 86_400_000).toISOString(),
  display_name: 'acme-corp',
  default_env: 'production',
}

const FIXTURE_BILLING: BillingDetails = {
  status: 'active',
  current_period_end: new Date(Date.now() + 9 * 86_400_000).toISOString(),
  razorpay_configured: true,
  subscription_status: 'active',
  payment_last4: '4242',
  payment_exp_month: 9,
  payment_exp_year: 27,
  payment_network: 'visa',
  cancel_at_period_end: false,
}

const FIXTURE_INVOICES: Invoice[] = [
  { id: 'inv_QzN8bD', period_start: '2026-04-22', period_end: '2026-05-22', plan: 'pro',   amount_cents: 4900, currency: 'USD', status: 'paid' },
  { id: 'inv_Pp7K2c', period_start: '2026-03-22', period_end: '2026-04-22', plan: 'pro',   amount_cents: 4900, currency: 'USD', status: 'paid' },
  { id: 'inv_Lm4F9a', period_start: '2026-02-20', period_end: '2026-03-22', plan: 'hobby', amount_cents:  900, currency: 'USD', status: 'paid' },
]

// ─── Module-level mocks ──────────────────────────────────────────────────
// We mock the api module so tests never hit fetch(); each test sets up
// the response shape it cares about.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchBilling: vi.fn(),
    listInvoices: vi.fn(),
    listResources: vi.fn(),
    // §10.20: BillingPage's Usage panel now reads fetchBillingUsage() (a
    // server-side cached aggregate) instead of listResources(). The
    // listResources mock above stays in the module-level mock for the
    // pre-§10.20 tests that still reference it; new tests should drive
    // fetchBillingUsage.
    fetchBillingUsage: vi.fn(),
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
  // Pre-§10.20 tests still mock listResources; new code path doesn't
  // call it, so this resolves to an unused empty list.
  ;(api.listResources as any).mockResolvedValue({
    ok: true,
    items: [],
    total: 0,
  })
  // §10.20: default zero-usage server response. Tests that pin specific
  // usage figures override this with a payload carrying real bytes/counts.
  ;(api.fetchBillingUsage as any).mockResolvedValue(makeUsageResp({}))
}

/** §10.20 test helper — build a BillingUsage response with optional overrides
 *  per metric. Unspecified metrics default to {bytes:0, limit_bytes:-1} or
 *  {count:0, limit:-1} matching the server's "no row" shape. */
function makeUsageResp(over: Partial<{
  postgres_bytes: number
  redis_bytes: number
  mongodb_bytes: number
  deployments: number
  webhooks: number
  vault: number
  members: number
}>) {
  return {
    ok: true,
    freshness_seconds: 30,
    // Pin as_of so the "as of Ns ago" footnote renders deterministically.
    as_of: new Date(Date.now() - 5000).toISOString(),
    usage: {
      postgres: { bytes: over.postgres_bytes ?? 0, limit_bytes: 1024 * 1024 * 1024 },
      redis: { bytes: over.redis_bytes ?? 0, limit_bytes: 50 * 1024 * 1024 },
      mongodb: { bytes: over.mongodb_bytes ?? 0, limit_bytes: 100 * 1024 * 1024 },
      deployments: { count: over.deployments ?? 0, limit: 1 },
      webhooks: { count: over.webhooks ?? 0, limit: 1000 },
      vault: { count: over.vault ?? 0, limit: 20 },
      members: { count: over.members ?? 1, limit: 1 },
    },
  }
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

// ─── §10.21: backend-down error state (no fixture fallback) ──────────────
describe('BillingPage — backend-down error state (§10.21)', () => {
  it('renders the billing-error banner when fetchBilling rejects (no fixture fallback)', async () => {
    ;(api.fetchBilling as any).mockRejectedValue(Object.assign(new Error('Razorpay is not configured'), { status: 503 }))
    ;(api.listInvoices as any).mockResolvedValue({ ok: true, invoices: [] })
    ;(api.fetchBillingUsage as any).mockResolvedValue(makeUsageResp({}))
    render(<BillingPage />)
    await waitFor(() => {
      expect(screen.getByTestId('billing-error')).toBeTruthy()
    })
    // Critical: must NOT render the upgrade CTA (which would imply a working
    // billing surface). The error state is exclusive.
    expect(screen.queryByRole('button', { name: /upgrade to/i })).toBeNull()
  })

  it('surfaces the error message on the billing-error banner', async () => {
    ;(api.fetchBilling as any).mockRejectedValue(new Error('Razorpay is not configured'))
    ;(api.listInvoices as any).mockResolvedValue({ ok: true, invoices: [] })
    ;(api.fetchBillingUsage as any).mockResolvedValue(makeUsageResp({}))
    const { container } = render(<BillingPage />)
    await waitFor(() => {
      expect(screen.getByTestId('billing-error')).toBeTruthy()
    })
    expect(container.textContent).toContain('Razorpay is not configured')
  })
})

// ─── Initial render ──────────────────────────────────────────────────────
describe('BillingPage — initial render', () => {
  it('shows a skeleton while billing is loading', () => {
    ;(api.fetchBilling as any).mockReturnValue(new Promise(() => {}))   // never resolves
    ;(api.listInvoices as any).mockReturnValue(new Promise(() => {}))
    ;(api.listResources as any).mockReturnValue(new Promise(() => {}))
    // §10.20: BillingPage calls fetchBillingUsage now; it must return a
    // pending promise (never resolves) so the skeleton state holds.
    ;(api.fetchBillingUsage as any).mockReturnValue(new Promise(() => {}))
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

  it('renders a Contact support link instead of a self-serve cancel button', async () => {
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // Cancellation is intentionally not self-serve — must contact support.
    expect(screen.queryByRole('button', { name: /cancel subscription/i })).toBeNull()
    const link = screen.getByTestId('contact-support-cancel') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.href.toLowerCase()).toContain('mailto:support@instanode.dev')
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

// ─── No self-serve cancel ─────────────────────────────────────────────────
// Cancellation must be support-mediated. The page must not call
// api.cancelSubscription on any click — there is no in-product path.
describe('BillingPage — cancellation is support-only', () => {
  it('never calls api.cancelSubscription', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // Click every button on the page; none of them should fire cancelSubscription.
    screen.queryAllByRole('button').forEach((b) => fireEvent.click(b))
    expect(api.cancelSubscription).not.toHaveBeenCalled()
  })

  it('exposes a mailto contact-support link in place of the cancel button', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const link = screen.getByTestId('contact-support-cancel') as HTMLAnchorElement
    expect(link.href.toLowerCase()).toContain('mailto:support@instanode.dev')
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

// ─── Usage panel — server-side cached aggregate (§10.20) ────────────────
// The Usage panel reads /api/v1/billing/usage (cached 30s in Redis with
// singleflight on the server). These tests pin the contract:
//   (a) values reflect the server response, not a client-side aggregate,
//   (b) BillingPage does NOT call listResources() for usage data,
//   (c) the `as_of` footnote renders so the eventual-consistency tradeoff
//       is visible to users.
describe('BillingPage — Usage panel reflects fetchBillingUsage() (§10.20)', () => {
  it('renders postgres bytes (100 MB / 1 GB) from the server response', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.fetchBillingUsage as any).mockResolvedValue(makeUsageResp({
      postgres_bytes: 100 * 1024 * 1024,
    }))
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    await waitFor(() => {
      const text = container.textContent ?? ''
      expect(text).toContain('100')
      expect(text).toContain('1 GB')
    })
  })

  it('renders zeroes when the server reports no usage', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    await waitFor(() => {
      const rows = container.querySelectorAll('.usage-row')
      // 6 usage rows: postgres, redis, mongo, deployments, webhooks, team seats.
      expect(rows.length).toBe(6)
      const resourceRowKeys = ['postgres', 'redis', 'mongo', 'deployments', 'webhooks']
      resourceRowKeys.forEach((key) => {
        const row = Array.from(rows).find((r) => r.querySelector('.k')?.textContent === key)
        expect(row, `missing usage row for ${key}`).toBeTruthy()
        const num = row?.querySelector('.num')?.textContent ?? ''
        expect(num.trim().startsWith('0')).toBe(true)
      })
    })
  })

  it('never renders the old hardcoded "47" Postgres fixture number', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    expect(container.textContent).not.toMatch(/\b47\b/)
  })

  // §10.20 / §14: critical contract — the page must NOT round-trip to
  // /resources for usage data anymore. Catches accidental reintroductions
  // of the client-side aggregate.
  it('does not call listResources() for usage data', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // Wait a tick to make sure any in-flight effect has a chance to fire.
    await new Promise((r) => setTimeout(r, 50))
    expect((api.listResources as any).mock?.calls?.length ?? 0).toBe(0)
    // The new cached aggregate, on the other hand, must be called exactly once.
    expect((api.fetchBillingUsage as any).mock?.calls?.length ?? 0).toBe(1)
  })

  // §10.20 / §13: the eventual-consistency footnote must render so users
  // can see when the snapshot was computed.
  it('renders the "as of Ns ago" footnote when the cached payload arrives', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    const { getByTestId } = render(<BillingPage />)
    await waitForLoaded()
    await waitFor(() => {
      const footnote = getByTestId('billing-usage-as-of')
      expect(footnote.textContent).toMatch(/as of/)
      expect(footnote.textContent).toMatch(/cached 30s/)
    })
  })
})

// ─── §10.8 cleanups: card expiry leak, invoice status, update mailto ────
describe('BillingPage — §10.8 leak fixes', () => {
  it('does not render the fabricated 9/27 card-expiry string', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    expect(container.textContent).not.toContain('9/27')
  })

  it('renders the real invoice status (paid), not a hardcoded "running" pill', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    // FIXTURE_INVOICES has three "paid" invoices — none are "running".
    expect(container.textContent?.toLowerCase()).toContain('paid')
    expect(container.textContent?.toLowerCase()).not.toContain('running')
  })

  it('exposes the Update payment-method action as a mailto link, not a dead button', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const link = screen.getByTestId('contact-support-update-payment') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.href.toLowerCase()).toContain('mailto:support@instanode.dev')
  })
})
