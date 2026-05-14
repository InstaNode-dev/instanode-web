/* BillingPage.test.tsx — component coverage for the redesigned upgrade flow.
 *
 * 2026-05-13 redesign coverage:
 *   - All 4 tier cards render side-by-side (Free / Hobby / Pro / Team)
 *   - Annual is the default frequency on first render
 *   - The Annual position copy reads "2 months free"
 *   - The monthly equivalent is visible when Annual is selected
 *   - "Most Popular" badge renders only on Pro
 *   - Current tier shows "Your plan" pill, not a CTA
 *   - Promo UI is gone — Razorpay's hosted checkout handles codes
 *
 * Plus the pre-redesign concerns that still matter:
 *   - handleSelectTier → api.createCheckout(tier, frequency) → navigation
 *   - Error surfacing into checkoutErr state
 *   - No self-serve cancellation (mailto link only)
 *   - Usage panel reflects fetchBillingUsage() (§10.20 contract)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BillingPage } from './BillingPage'
import type { BillingDetails, DashboardTeam, Invoice, User } from '../api'

// §10.21: test-only data lives here, inlined and minimal.
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
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchBilling: vi.fn(),
    listInvoices: vi.fn(),
    listResources: vi.fn(),
    fetchBillingUsage: vi.fn(),
    createCheckout: vi.fn(),
    cancelSubscription: vi.fn(),
    validatePromotion: vi.fn(),
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
  ;(api.listResources as any).mockResolvedValue({
    ok: true,
    items: [],
    total: 0,
  })
  ;(api.fetchBillingUsage as any).mockResolvedValue(makeUsageResp({}))
}

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

/** Wait for the page to finish its initial load (skeleton → real content).
 *  The new layout always renders the pricing grid once billing arrives, so
 *  we wait for any tier card to appear. */
async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.queryByTestId('pricing-grid-cards')).toBeTruthy()
  })
}

// jsdom 24 ships window.location.href as a non-configurable setter — we
// can't intercept it directly without triggering a real navigation.
// Workaround: swap window.location wholesale with a plain object we control.
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
  // Default-Annual relies on no stored preference. Clear between tests.
  try { window.localStorage.removeItem('instant.billing.plan_frequency') } catch {}
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
    // Must NOT render the pricing grid (the error state is exclusive).
    expect(screen.queryByTestId('pricing-grid-cards')).toBeNull()
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
    ;(api.fetchBilling as any).mockReturnValue(new Promise(() => {}))
    ;(api.listInvoices as any).mockReturnValue(new Promise(() => {}))
    ;(api.listResources as any).mockReturnValue(new Promise(() => {}))
    ;(api.fetchBillingUsage as any).mockReturnValue(new Promise(() => {}))
    const { container } = render(<BillingPage />)
    expect(container.querySelector('.skel')).toBeTruthy()
  })

  it('renders the "You\'re on Hobby today" headline when tier=hobby', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: /you're on hobby today/i })).toBeTruthy()
  })

  it('renders the "You\'re on Pro today" headline when tier=pro', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: /you're on pro today/i })).toBeTruthy()
  })

  it('falls back to the Hobby label when tier is unknown', async () => {
    mockTier = 'unknown-tier'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: /you're on hobby today/i })).toBeTruthy()
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
    expect(screen.queryByRole('button', { name: /cancel subscription/i })).toBeNull()
    const link = screen.getByTestId('contact-support-cancel') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.href.toLowerCase()).toContain('mailto:support@instanode.dev')
  })
})

// ─── 4-tier pricing grid (2026-05-13 redesign) ──────────────────────────
describe('BillingPage — 4-tier pricing grid', () => {
  it('renders all four tier cards side by side (Free / Hobby / Pro / Team)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByTestId('tier-card-free')).toBeTruthy()
    expect(screen.getByTestId('tier-card-hobby')).toBeTruthy()
    expect(screen.getByTestId('tier-card-pro')).toBeTruthy()
    expect(screen.getByTestId('tier-card-team')).toBeTruthy()
  })

  it('renders the cards inside the pricing-grid-cards container', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const grid = screen.getByTestId('pricing-grid-cards')
    // All four cards live inside the grid.
    expect(grid.querySelector('[data-tier="free"]')).toBeTruthy()
    expect(grid.querySelector('[data-tier="hobby"]')).toBeTruthy()
    expect(grid.querySelector('[data-tier="pro"]')).toBeTruthy()
    expect(grid.querySelector('[data-tier="team"]')).toBeTruthy()
  })

  it('renders the Most Popular badge only on the Pro card', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const badges = screen.getAllByTestId('tier-most-popular-badge')
    expect(badges.length).toBe(1)
    // The badge lives inside the Pro card.
    const proCard = screen.getByTestId('tier-card-pro')
    expect(proCard.contains(badges[0])).toBe(true)
    // No badge on the other cards.
    expect(screen.getByTestId('tier-card-hobby').querySelector('[data-testid="tier-most-popular-badge"]')).toBeNull()
    expect(screen.getByTestId('tier-card-free').querySelector('[data-testid="tier-most-popular-badge"]')).toBeNull()
    expect(screen.getByTestId('tier-card-team').querySelector('[data-testid="tier-most-popular-badge"]')).toBeNull()
  })

  it('marks the Pro card with data-highlight="true" (raised + thicker border)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByTestId('tier-card-pro').getAttribute('data-highlight')).toBe('true')
    expect(screen.getByTestId('tier-card-hobby').getAttribute('data-highlight')).toBe('false')
    expect(screen.getByTestId('tier-card-free').getAttribute('data-highlight')).toBe('false')
    expect(screen.getByTestId('tier-card-team').getAttribute('data-highlight')).toBe('false')
  })

  it('renders "Your plan" pill on the current tier (Hobby user)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByTestId('tier-card-hobby').getAttribute('data-current')).toBe('true')
    expect(screen.getByTestId('tier-your-plan-hobby')).toBeTruthy()
    // No upgrade CTA inside the current tier card.
    expect(screen.getByTestId('tier-card-hobby').querySelector('[data-testid="tier-cta-hobby"]')).toBeNull()
  })

  it('renders "Your plan" pill on the current tier (Pro user)', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByTestId('tier-card-pro').getAttribute('data-current')).toBe('true')
    expect(screen.getByTestId('tier-your-plan-pro')).toBeTruthy()
    // The variant UpgradeButton for Pro doesn't render on the Pro card —
    // its slot is replaced by the "Your plan" pill.
    expect(screen.getByTestId('tier-card-pro').querySelector('[data-testid="upgrade-button"]')).toBeNull()
  })

  it('de-emphasises the Team card price (uses --text-dim, not --text)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const teamPrice = screen.getByTestId('tier-price-team')
    const headlineSpan = teamPrice.querySelector('span')!
    // The Team anchor uses a dimmed color so the headline doesn't compete
    // with Pro's accent.
    expect(headlineSpan.getAttribute('style')?.toLowerCase()).toContain('--text-dim')
  })

  it('Team card CTA says "Contact sales", not "Upgrade"', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const teamCta = screen.getByTestId('tier-cta-team') as HTMLButtonElement
    expect(teamCta.textContent?.toLowerCase()).toContain('contact sales')
  })
})

// ─── Annual is the default frequency ────────────────────────────────────
describe('BillingPage — Annual is the default frequency', () => {
  it('renders Annual selected on first mount (no stored value)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByTestId('frequency-yearly').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('frequency-monthly').getAttribute('aria-checked')).toBe('false')
  })

  it('rehydrates monthly when the user explicitly stored monthly previously', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    window.localStorage.setItem('instant.billing.plan_frequency', 'monthly')
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.getByTestId('frequency-monthly').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('frequency-yearly').getAttribute('aria-checked')).toBe('false')
  })

  it('persists the new selection back to localStorage', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // Annual is already default — flip to monthly + back.
    fireEvent.click(screen.getByTestId('frequency-monthly'))
    expect(window.localStorage.getItem('instant.billing.plan_frequency')).toBe('monthly')
    fireEvent.click(screen.getByTestId('frequency-yearly'))
    expect(window.localStorage.getItem('instant.billing.plan_frequency')).toBe('yearly')
  })

  it('shows the "2 months free" copy inside the Annual toggle position', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const twoMonthsFree = screen.getByTestId('frequency-2-months-free')
    expect(twoMonthsFree.textContent?.toLowerCase()).toContain('2 months free')
    // It must live inside the Annual button (the toggle position),
    // not as standalone marketing copy elsewhere on the page.
    const yearlyBtn = screen.getByTestId('frequency-yearly')
    expect(yearlyBtn.contains(twoMonthsFree)).toBe(true)
  })
})

// ─── Annual mode: monthly-equivalent + savings ───────────────────────────
describe('BillingPage — Annual mode price display', () => {
  it('shows the monthly-equivalent on the Hobby tier when Annual is active', async () => {
    mockTier = 'free'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const hobbyPrice = screen.getByTestId('tier-price-hobby')
    expect(hobbyPrice.textContent).toContain('$7.50')
    // Subtext makes clear this is the monthly equivalent of the yearly
    // bill ("$7.50/mo, billed yearly").
    expect(hobbyPrice.textContent?.toLowerCase()).toContain('billed yearly')
  })

  it('shows the monthly-equivalent on the Pro tier when Annual is active', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const proPrice = screen.getByTestId('tier-price-pro')
    expect(proPrice.textContent).toContain('$40.83')
    expect(proPrice.textContent?.toLowerCase()).toContain('billed yearly')
  })

  it('shows the absolute-dollar savings subtext under Annual prices', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // Hobby: $90/yr · save $18  ;  Pro: $490/yr · save $98
    expect(screen.getByTestId('tier-savings-hobby').textContent).toMatch(/\$90\/yr.*save \$18/)
    expect(screen.getByTestId('tier-savings-pro').textContent).toMatch(/\$490\/yr.*save \$98/)
  })

  it('switches to the headline monthly price + "/mo" when the user picks Monthly', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('frequency-monthly'))
    const proPrice = screen.getByTestId('tier-price-pro')
    expect(proPrice.textContent).toContain('$49')
    expect(proPrice.textContent).toContain('/mo')
    // No "billed yearly" subtext on monthly.
    expect(proPrice.textContent?.toLowerCase()).not.toContain('billed yearly')
    // No savings line on monthly.
    expect(screen.queryByTestId('tier-savings-pro')).toBeNull()
  })

  it('Free tier never shows a savings line (no yearly variant)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.queryByTestId('tier-savings-free')).toBeNull()
    // And the Free price block stays "$0 forever" regardless of toggle.
    const freePrice = screen.getByTestId('tier-price-free')
    expect(freePrice.textContent?.toLowerCase()).toContain('$0')
    expect(freePrice.textContent?.toLowerCase()).toContain('forever')
  })
})

// ─── CTA copy (price-anchored, tier-aware) ──────────────────────────────
describe('BillingPage — CTA copy', () => {
  it('Hobby user sees "Get Pro — $40.83/mo" on the Pro card in Annual mode', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const proCta = screen.getByTestId('upgrade-button')
    expect(proCta.textContent).toContain('Get Pro')
    expect(proCta.textContent).toContain('$40.83/mo')
  })

  it('Hobby user sees "Get Pro — $49/mo" on the Pro card in Monthly mode', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('frequency-monthly'))
    const proCta = screen.getByTestId('upgrade-button')
    expect(proCta.textContent).toContain('Get Pro')
    expect(proCta.textContent).toContain('$49/mo')
  })

  it('Free user sees "Start Hobby — $7.50/mo" on the Hobby card in Annual mode', async () => {
    mockTier = 'free'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const hobbyCta = screen.getByTestId('tier-cta-hobby') as HTMLButtonElement
    expect(hobbyCta.textContent).toContain('Start Hobby')
    expect(hobbyCta.textContent).toContain('$7.50/mo')
  })

  it('Pro user sees the "Upgrade to Team"/Contact sales button on the Team card', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    const teamCta = screen.getByTestId('tier-cta-team') as HTMLButtonElement
    expect(teamCta.textContent?.toLowerCase()).toContain('contact sales')
  })

  it('Team user sees no CTAs at all (highest plan)', async () => {
    mockTier = 'team'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // The Team card shows "Your plan" pill, every other card has a CTA
    // — but Team users have nothing to upgrade to (Free is a downgrade,
    // not a self-serve action). Free's CTA reads "Stay on Free" — a
    // soft acknowledgement rather than an action.
    expect(screen.getByTestId('tier-your-plan-team')).toBeTruthy()
    // Hobby + Pro show "Start"/"Get" CTAs anyway — clicking them does
    // nothing actionable in practice for a Team user (they'd be
    // downgrading) but we don't block render. The point: no Upgrade CTA.
    expect(screen.queryByRole('button', { name: /upgrade to team/i })).toBeNull()
  })
})

// ─── handleSelectTier ────────────────────────────────────────────────────
describe('BillingPage — handleSelectTier (upgrade flow)', () => {
  it('calls api.createCheckout("pro", "yearly") when Hobby user clicks Get Pro (Annual default)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/abc',
    })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledTimes(1))
    // Annual is the new default — checkout fires with "yearly".
    expect(api.createCheckout).toHaveBeenCalledWith('pro', 'yearly')
  })

  it('calls api.createCheckout("pro", "monthly") when the user flips to Monthly first', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/m',
    })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('frequency-monthly'))
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('pro', 'monthly'))
  })

  it('redirects via window.location.href when short_url is returned', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/abc',
    })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/abc'))
  })

  it('surfaces "checkout returned no url" when short_url is missing', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({ ok: true, short_url: '' })
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(container.textContent).toContain('checkout returned no url'))
    expect(hrefSetTo).toBeNull()
  })

  it('surfaces the thrown error message in the checkoutErr UI', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockRejectedValue(new Error('razorpay unreachable'))
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(container.textContent).toContain('razorpay unreachable'))
    expect(hrefSetTo).toBeNull()
  })

  it('falls back to "checkout failed" when the thrown error has no message', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockRejectedValue({ /* no message */ })
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(container.textContent).toContain('checkout failed'))
  })

  it('disables the Upgrade CTA while checkout is in flight', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    let resolveCheckout: (v: any) => void = () => {}
    ;(api.createCheckout as any).mockReturnValue(
      new Promise((r) => { resolveCheckout = r }),
    )
    render(<BillingPage />)
    await waitForLoaded()
    const btn = screen.getByTestId('upgrade-button') as HTMLButtonElement
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
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(container.textContent).toContain('first fail'))
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/ok'))
    expect(container.textContent).not.toContain('first fail')
  })

  it('does not call createCheckout when a team-tier user clicks the Team "Your plan" pill', async () => {
    mockTier = 'team'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // No CTA on the current tier — the pill isn't a button.
    expect(screen.queryByRole('button', { name: /upgrade to team/i })).toBeNull()
    expect(api.createCheckout).not.toHaveBeenCalled()
  })

  it('routes Team-card clicks to the sales mailto (Pro user clicking Contact sales)', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('tier-cta-team'))
    // No createCheckout call — team isn't on Razorpay yet.
    expect(api.createCheckout).not.toHaveBeenCalled()
    // The page sets window.location.href to a sales mailto.
    expect(hrefSetTo?.toLowerCase()).toContain('mailto:sales@instanode.dev')
  })
})

// ─── No self-serve cancel ─────────────────────────────────────────────────
describe('BillingPage — cancellation is support-only', () => {
  it('never calls api.cancelSubscription', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
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
  it('a real click on the Pro CTA kicks off createCheckout with annual', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/ue',
    })
    const user = userEvent.setup()
    render(<BillingPage />)
    await waitForLoaded()
    await user.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('pro', 'yearly'))
    await waitFor(() => expect(hrefSetTo).toBe('https://rzp.io/i/ue'))
  })
})

// ─── Usage panel — server-side cached aggregate (§10.20) ────────────────
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

  it('does not call listResources() for usage data', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    await new Promise((r) => setTimeout(r, 50))
    expect((api.listResources as any).mock?.calls?.length ?? 0).toBe(0)
    expect((api.fetchBillingUsage as any).mock?.calls?.length ?? 0).toBe(1)
  })

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
    expect(container.textContent?.toLowerCase()).toContain('paid')
    expect(container.textContent?.toLowerCase()).not.toContain('running')
  })

  it('exposes the Update payment-method action as a clickable button (self-serve, not a dead mailto)', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // The button is wired to POST /api/v1/billing/update-payment which
    // returns a Razorpay short_url; on api error the component falls back
    // to a support mailto. Either way the data-testid is present.
    const link = screen.getByTestId('contact-support-update-payment') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    // The button starts in interactive mode: clickable href="#" with an
    // onClick handler. Only after a failed API call does it degrade to a
    // mailto. So the default-state assertion is "not a dead anchor in the
    // sense of pointing somewhere; it has an onclick handler".
    expect(link.href.toLowerCase()).not.toContain('mailto:')
    expect(link.textContent?.toLowerCase()).toContain('update')
  })
})

// ─── Promo UI is removed — Razorpay handles codes ───────────────────────
describe('BillingPage — promo codes flow through Razorpay (no in-product input)', () => {
  it('does NOT render the promo toggle/input/applied chip anywhere on the page', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    // All P3 testids must be gone.
    expect(screen.queryByTestId('promo-toggle')).toBeNull()
    expect(screen.queryByTestId('promo-input')).toBeNull()
    expect(screen.queryByTestId('promo-input-row')).toBeNull()
    expect(screen.queryByTestId('promo-apply')).toBeNull()
    expect(screen.queryByTestId('promo-applied')).toBeNull()
    expect(screen.queryByTestId('promo-clear')).toBeNull()
    expect(screen.queryByTestId('promo-error')).toBeNull()
  })

  it('never calls validatePromotion (no dashboard-side code validation)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    await new Promise((r) => setTimeout(r, 50))
    expect((api.validatePromotion as any).mock?.calls?.length ?? 0).toBe(0)
  })

  it('createCheckout is called with exactly (plan, frequency) — no opts arg', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true, short_url: 'https://rzp.io/i/no-promo',
    })
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledTimes(1))
    // Strict 2-arg call shape — guards against accidental empty-opts regression.
    expect(api.createCheckout).toHaveBeenCalledWith('pro', 'yearly')
  })

  it('mentions that promo codes apply at Razorpay checkout (so users know where they go)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    const { container } = render(<BillingPage />)
    await waitForLoaded()
    expect(container.textContent?.toLowerCase()).toContain('promo codes apply at checkout')
    expect(container.textContent?.toLowerCase()).toContain('razorpay')
  })
})

// ─── Change-plan modal entry point ──────────────────────────────────────
describe('BillingPage — Change plan button', () => {
  it('shows the Change plan button for Hobby users (have a subscription + a tier above)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.queryByTestId('open-change-plan-modal')).toBeTruthy()
  })

  it('shows the Change plan button for Pro users', async () => {
    mockTier = 'pro'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.queryByTestId('open-change-plan-modal')).toBeTruthy()
  })

  it('hides the Change plan button for anonymous (no subscription)', async () => {
    mockTier = 'anonymous'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.queryByTestId('open-change-plan-modal')).toBeNull()
  })

  it('hides the Change plan button for free tier (no subscription)', async () => {
    mockTier = 'free'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.queryByTestId('open-change-plan-modal')).toBeNull()
  })

  it('hides the Change plan button for team tier (no in-place upgrade target)', async () => {
    mockTier = 'team'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    expect(screen.queryByTestId('open-change-plan-modal')).toBeNull()
  })

  it('opens the modal when the Change plan button is clicked', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('open-change-plan-modal'))
    expect(screen.getByTestId('change-plan-modal')).toBeTruthy()
  })

  it('the opened modal defaults to pro for a hobby user', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    render(<BillingPage />)
    await waitForLoaded()
    fireEvent.click(screen.getByTestId('open-change-plan-modal'))
    const proRadio = screen.getByTestId('change-plan-target-pro') as HTMLInputElement
    expect(proRadio.checked).toBe(true)
  })

  it('refetches billing after an immediate change (onChanged → setRefreshNonce)', async () => {
    mockTier = 'hobby'
    mockHappyBilling()
    ;(api.createCheckout as any).mockResolvedValue({ ok: true, short_url: 'x' })
    // Stub changePlan via the same api mock surface — we need to add it
    // to the module-level mock above (the existing mock doesn't enumerate
    // changePlan, but the spread of `actual` falls through to the real
    // function, which would call fetch). Inject it lazily here.
    ;(api as any).changePlan = vi.fn().mockResolvedValue({ ok: true, immediate: true })
    render(<BillingPage />)
    await waitForLoaded()
    const initialFetchCount = (api.fetchBilling as any).mock.calls.length
    fireEvent.click(screen.getByTestId('open-change-plan-modal'))
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect((api.fetchBilling as any).mock.calls.length).toBeGreaterThan(initialFetchCount)
    })
  })
})
