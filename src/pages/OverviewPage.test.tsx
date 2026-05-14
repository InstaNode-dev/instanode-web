/* OverviewPage.test.tsx — expiry-warning banner coverage.
 *
 * The banner itself is rendered by the layout-level <ExpiryWarningBanner>
 * in AppShell, but the trigger logic (≤ 6h to expiry on any resource) is
 * the load-bearing bit. We test the component directly because that
 * isolates the threshold logic from layout concerns and keeps the test
 * fast. */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ExpiryWarningBanner, formatTimeUntil, expiryLevel } from '../components/Common'
import type { Resource } from '../api'

// ─── Module-level mocks for the OverviewPage quick-prompts tests ──────────
// Mock the api module so the page's useEffect resolves with empty lists; we
// don't care about the resource/activity rows here, just the quick-prompt
// buttons.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listResources: vi.fn().mockResolvedValue({ ok: true, items: [], total: 0 }),
    fetchActivity: vi.fn().mockResolvedValue({ ok: true, items: [] }),
  }
})

// Stub useDashboardCtx so we control the tier interpolated into the prompts.
vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: {
      user: { id: 'u_test', email: 'aanya@acme.dev', tier: 'pro' },
      team: { id: 't_test', slug: 'acme', name: 'acme', tier: 'pro' },
    },
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [],
  }),
}))

import { OverviewPage } from './OverviewPage'
import * as api from '../api'

// A factory for a minimal Resource. Only the fields the banner reads are
// meaningful — the rest match the locked shape.
function res(partial: Partial<Resource> & { expires_at: string | null }): Resource {
  return {
    id: 'r_test',
    token: 'r_test',
    resource_type: 'postgres',
    tier: 'anonymous',
    status: 'active',
    name: 'test-db',
    env: 'production',
    storage_bytes: 0,
    storage_limit_bytes: 1,
    storage_exceeded: false,
    created_at: new Date().toISOString(),
    ...partial,
  } as Resource
}

function withRouter(ui: React.ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>
}

const NOW = new Date('2026-05-12T12:00:00Z').getTime()
const inHours = (h: number) => new Date(NOW + h * 60 * 60 * 1000).toISOString()
const inMinutes = (m: number) => new Date(NOW + m * 60 * 1000).toISOString()
const agoHours = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString()

afterEach(() => cleanup())

// ─── ExpiryWarningBanner — visibility ─────────────────────────────────────
describe('ExpiryWarningBanner — when to show', () => {
  it('renders nothing when no resources are provided', () => {
    const { container } = render(withRouter(<ExpiryWarningBanner resources={[]} now={NOW} />))
    expect(container.querySelector('[data-testid="expiry-warning-banner"]')).toBeNull()
  })

  it('renders nothing when every resource has expires_at: null', () => {
    const items = [
      res({ id: 'a', expires_at: null }),
      res({ id: 'b', expires_at: null }),
    ]
    const { container } = render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    expect(container.querySelector('[data-testid="expiry-warning-banner"]')).toBeNull()
  })

  it('renders nothing when every expiring resource is more than 6h away', () => {
    const items = [
      res({ id: 'a', expires_at: inHours(10) }),
      res({ id: 'b', expires_at: inHours(23) }),
    ]
    const { container } = render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    expect(container.querySelector('[data-testid="expiry-warning-banner"]')).toBeNull()
  })

  it('shows the banner when at least one resource is within 6h', () => {
    const items = [
      res({ id: 'a', expires_at: inHours(10) }),  // safe
      res({ id: 'b', expires_at: inHours(5) }),   // soon
    ]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    expect(screen.getByTestId('expiry-warning-banner')).toBeTruthy()
  })

  it('shows the banner when a resource is urgent (<1h)', () => {
    const items = [res({ id: 'a', expires_at: inMinutes(30) })]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    expect(screen.getByTestId('expiry-warning-banner')).toBeTruthy()
  })

  it('shows the banner when a resource is already expired (clock skew / cron lag)', () => {
    const items = [res({ id: 'a', expires_at: agoHours(1) })]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    expect(screen.getByTestId('expiry-warning-banner')).toBeTruthy()
  })

  it('exactly 6h is treated as at-risk (boundary inclusive)', () => {
    const items = [res({ id: 'a', expires_at: inHours(6) })]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    expect(screen.getByTestId('expiry-warning-banner')).toBeTruthy()
  })

  it('just over 6h is NOT at-risk', () => {
    // +1ms past the 6h boundary should still hide the banner.
    const justOver = new Date(NOW + 6 * 60 * 60 * 1000 + 1).toISOString()
    const items = [res({ id: 'a', expires_at: justOver })]
    const { container } = render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    expect(container.querySelector('[data-testid="expiry-warning-banner"]')).toBeNull()
  })
})

// ─── ExpiryWarningBanner — content ────────────────────────────────────────
describe('ExpiryWarningBanner — copy', () => {
  it('uses the singular form when exactly 1 resource is at risk', () => {
    const items = [res({ id: 'a', expires_at: inHours(2) })]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    const banner = screen.getByTestId('expiry-warning-banner')
    expect(banner.textContent).toMatch(/1 resource expires/i)
  })

  it('uses the plural form when 2+ resources are at risk', () => {
    const items = [
      res({ id: 'a', expires_at: inHours(2) }),
      res({ id: 'b', expires_at: inHours(4) }),
    ]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    const banner = screen.getByTestId('expiry-warning-banner')
    expect(banner.textContent).toMatch(/2 resources expire /i)
  })

  it('counts only at-risk resources (mixes safe and at-risk)', () => {
    const items = [
      res({ id: 'a', expires_at: inHours(2) }),
      res({ id: 'b', expires_at: inHours(20) }),   // safe — not counted
      res({ id: 'c', expires_at: null }),          // permanent — not counted
      res({ id: 'd', expires_at: inMinutes(30) }), // urgent — counted
    ]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    const banner = screen.getByTestId('expiry-warning-banner')
    expect(banner.getAttribute('data-count')).toBe('2')
  })

  it('links to /app/billing for payment', () => {
    const items = [res({ id: 'a', expires_at: inHours(2) })]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    const banner = screen.getByTestId('expiry-warning-banner')
    const link = within(banner).getByRole('link') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/app/billing')
  })

  it('surfaces the soonest-to-expire time in the banner copy', () => {
    const items = [
      res({ id: 'a', expires_at: inHours(5) }),
      res({ id: 'b', expires_at: inHours(2) }),   // soonest
      res({ id: 'c', expires_at: inHours(4) }),
    ]
    render(withRouter(<ExpiryWarningBanner resources={items} now={NOW} />))
    const banner = screen.getByTestId('expiry-warning-banner')
    // 2h exactly → "2h"
    expect(banner.textContent).toContain('2h')
  })
})

// ─── formatTimeUntil — the six thresholds from the spec ───────────────────
describe('formatTimeUntil — countdown copy across thresholds', () => {
  it('formats <1h as "Xm"', () => {
    expect(formatTimeUntil(inMinutes(37), NOW)).toBe('37m')
    expect(formatTimeUntil(inMinutes(1), NOW)).toBe('1m')
  })

  it('formats 1-3h as "Xh Ym"', () => {
    expect(formatTimeUntil(inMinutes(60 + 14), NOW)).toBe('1h 14m')
    expect(formatTimeUntil(inMinutes(60 * 2 + 30), NOW)).toBe('2h 30m')
  })

  it('formats 3-6h as "Xh Ym"', () => {
    expect(formatTimeUntil(inMinutes(60 * 5 + 15), NOW)).toBe('5h 15m')
  })

  it('formats 6-12h as "Xh Ym"', () => {
    expect(formatTimeUntil(inMinutes(60 * 9 + 45), NOW)).toBe('9h 45m')
  })

  it('formats 12-24h as "Xh Ym"', () => {
    expect(formatTimeUntil(inMinutes(60 * 18 + 5), NOW)).toBe('18h 5m')
  })

  it('formats exactly-on-the-hour without a trailing 0m', () => {
    expect(formatTimeUntil(inHours(3), NOW)).toBe('3h')
    expect(formatTimeUntil(inHours(18), NOW)).toBe('18h')
  })

  it('formats >24h as "Xd Yh"', () => {
    // The 24h TTL is the common case; >24h covers paid users on
    // grace-period workflows we may add in v2.
    const oneDayThreeHours = new Date(NOW + (24 + 3) * 60 * 60 * 1000).toISOString()
    expect(formatTimeUntil(oneDayThreeHours, NOW)).toBe('1d 3h')
  })

  it('formats <60s as "Xs"', () => {
    const t = new Date(NOW + 45 * 1000).toISOString()
    expect(formatTimeUntil(t, NOW)).toBe('45s')
  })

  it('returns "expired" for past timestamps', () => {
    expect(formatTimeUntil(agoHours(1), NOW)).toBe('expired')
  })

  it('returns the empty string for null / undefined', () => {
    expect(formatTimeUntil(null, NOW)).toBe('')
    expect(formatTimeUntil(undefined, NOW)).toBe('')
  })

  it('returns the empty string for unparseable timestamps', () => {
    expect(formatTimeUntil('not-a-date', NOW)).toBe('')
  })
})

// ─── expiryLevel classification ───────────────────────────────────────────
describe('expiryLevel — classification', () => {
  it('returns "none" when expires_at is null', () => {
    expect(expiryLevel(null, NOW)).toBe('none')
  })
  it('returns "expired" when in the past', () => {
    expect(expiryLevel(agoHours(1), NOW)).toBe('expired')
  })
  it('returns "urgent" when ≤1h', () => {
    expect(expiryLevel(inMinutes(30), NOW)).toBe('urgent')
    expect(expiryLevel(inMinutes(59), NOW)).toBe('urgent')
  })
  it('returns "soon" when ≤6h but >1h', () => {
    expect(expiryLevel(inHours(2), NOW)).toBe('soon')
    expect(expiryLevel(inHours(6), NOW)).toBe('soon')
  })
  it('returns "safe" when >6h', () => {
    expect(expiryLevel(inHours(10), NOW)).toBe('safe')
    expect(expiryLevel(inHours(23), NOW)).toBe('safe')
  })
})

// ─── Quick-prompt buttons (§10.4) ────────────────────────────────────────
describe('OverviewPage — quick prompts', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    writeText.mockReset()
    // jsdom does not implement navigator.clipboard, so install a minimal stub.
    // Use defineProperty because navigator.clipboard is a read-only getter.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  it('renders 3 quick-prompt buttons, each with a non-empty aria-label', async () => {
    render(withRouter(<OverviewPage />))
    await waitFor(() => {
      expect(screen.getByTestId('quick-prompt-provision-postgres')).toBeTruthy()
    })
    const ids = ['provision-postgres', 'deploy-app', 'invite-teammate']
    for (const id of ids) {
      const btn = screen.getByTestId(`quick-prompt-${id}`) as HTMLButtonElement
      expect(btn.tagName).toBe('BUTTON')
      const label = btn.getAttribute('aria-label') ?? ''
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('clicking the first button calls navigator.clipboard.writeText with a tier-aware prompt', async () => {
    render(withRouter(<OverviewPage />))
    await waitFor(() => {
      expect(screen.getByTestId('quick-prompt-provision-postgres')).toBeTruthy()
    })
    const btn = screen.getByTestId('quick-prompt-provision-postgres')
    fireEvent.click(btn)
    expect(writeText).toHaveBeenCalledTimes(1)
    const arg = writeText.mock.calls[0][0] as string
    // Tier comes from the stubbed useDashboardCtx → 'pro'.
    expect(arg).toContain('pro')
    // Endpoint hint should be present so the agent has the call site.
    expect(arg).toContain('POST https://api.instanode.dev/db/new')
  })
})

// ─── Recently-active rows (§10.21) ───────────────────────────────────────
// Previously the section could render 0 rows even when listResources returned
// 2+ items, leaving the largest panel of the Overview page visually empty.
// Pin the contract: 2 resources mocked → at least 1 row in the table.
describe('OverviewPage — Recently active', () => {
  function mockTwoResources() {
    const now = new Date().toISOString()
    ;(api.listResources as any).mockResolvedValueOnce({
      ok: true,
      total: 2,
      items: [
        {
          id: 'res_a', token: 'res_a', resource_type: 'postgres',
          tier: 'pro', status: 'active', name: 'analytics-db',
          env: 'production', storage_bytes: 1_000_000,
          storage_limit_bytes: 500_000_000, storage_exceeded: false,
          connections_in_use: 1, connections_limit: 5,
          expires_at: null, created_at: now,
        },
        {
          id: 'res_b', token: 'res_b', resource_type: 'redis',
          tier: 'pro', status: 'active', name: 'cache',
          env: 'production', storage_bytes: 500_000,
          storage_limit_bytes: 50_000_000, storage_exceeded: false,
          connections_in_use: 2, connections_limit: 20,
          expires_at: null, created_at: now,
        },
      ],
    })
    ;(api.fetchActivity as any).mockResolvedValueOnce({ ok: true, items: [] })
  }

  it('renders at least 1 row when 2 resources are returned by listResources', async () => {
    mockTwoResources()
    render(withRouter(<OverviewPage />))
    await waitFor(() => {
      expect(screen.getByTestId('recently-active-row-res_a')).toBeTruthy()
    })
    expect(screen.getByTestId('recently-active-row-res_b')).toBeTruthy()
  })

  it('renders the row name + resource_type inside each row', async () => {
    mockTwoResources()
    render(withRouter(<OverviewPage />))
    await waitFor(() => {
      const row = screen.getByTestId('recently-active-row-res_a')
      expect(row.textContent).toContain('analytics-db')
      expect(row.textContent).toContain('postgres')
    })
  })

  it('renders the link to /app/resources/:id (not the legacy /resources/:id)', async () => {
    mockTwoResources()
    render(withRouter(<OverviewPage />))
    await waitFor(() => {
      const row = screen.getByTestId('recently-active-row-res_a')
      const link = row.querySelector('a.res-name') as HTMLAnchorElement
      expect(link.getAttribute('href')).toBe('/app/resources/res_a')
    })
  })
})

// ─── Stat tiles must NOT show fake sparkline data ─────────────────────────
// The Stat helper used to synthesize hardcoded series (e.g. [22,20,18,...])
// from a `spark` shape hint, which displayed as a real trend to customers
// (P3 founder persona caught this on 2026-05-13). The component now requires
// a real `series` prop and renders no sparkline when it's omitted. The page
// passes series={undefined} from every call site until real time-series
// data is wired up — pin that contract so a regression can't reintroduce
// fake series without breaking this test.
describe('OverviewPage — Stat sparklines (no fake trend data)', () => {
  it('renders no <svg class="sparkline"> elements when the page mounts with the default no-series wiring', async () => {
    ;(api.listResources as any).mockResolvedValueOnce({ ok: true, total: 0, items: [] })
    ;(api.fetchActivity as any).mockResolvedValueOnce({ ok: true, items: [] })
    const { container } = render(withRouter(<OverviewPage />))
    await waitFor(() => {
      // Page has rendered at least one stat tile.
      expect(container.querySelector('.stat')).not.toBeNull()
    })
    // No sparkline SVGs anywhere on the page.
    const sparklines = container.querySelectorAll('svg.sparkline')
    expect(sparklines.length).toBe(0)
  })

  it('still renders the stat number + label tiles (sparkline-free is fine, empty is not)', async () => {
    ;(api.listResources as any).mockResolvedValueOnce({ ok: true, total: 0, items: [] })
    ;(api.fetchActivity as any).mockResolvedValueOnce({ ok: true, items: [] })
    const { container } = render(withRouter(<OverviewPage />))
    await waitFor(() => {
      const tiles = container.querySelectorAll('.stat')
      // The page renders 6 stat tiles (resources, storage, conn, deployments,
      // webhooks, vault entries). Pin that the tiles still render even with
      // no series.
      expect(tiles.length).toBe(6)
    })
  })
})
