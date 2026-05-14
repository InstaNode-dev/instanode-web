/* StatusPage.test.tsx — wire shape from fetchStatus() drives the page.
 *
 * What we assert:
 *   1. Components render in the order returned by the api (no
 *      browser-side re-sort).
 *   2. Each component's `last_24h_samples` becomes 96 slot elements.
 *   3. The aggregate banner reflects the worst component status.
 *   4. current_incidents=[] renders the "No active incidents" empty
 *      state.
 *   5. current_incidents=[…] renders one row per incident with title
 *      + severity + status pills.
 *   6. fetch failure (fetchStatus rejects / returns ok=false) renders
 *      the degraded banner — never a crash.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock the api module — the page imports fetchStatus as a named export.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchStatus: vi.fn(),
  }
})

import { StatusPage } from './StatusPage'
import * as api from '../api'
import type { StatusPayload } from '../api'

const mockFetchStatus = api.fetchStatus as unknown as ReturnType<typeof vi.fn>

function payload(overrides: Partial<StatusPayload> = {}): StatusPayload {
  return {
    ok: true,
    freshness_seconds: 60,
    as_of: '2026-05-14T05:30:00Z',
    components: [
      {
        slug: 'api',
        name: 'API',
        category: 'core',
        description: 'instanode API',
        current_status: 'operational',
        uptime_7d_pct: 99.95,
        uptime_30d_pct: 99.92,
        last_24h_samples: Array(96).fill(true),
      },
      {
        slug: 'marketing',
        name: 'Marketing',
        category: 'edge',
        description: 'instanode.dev',
        current_status: 'operational',
        uptime_7d_pct: 100,
        uptime_30d_pct: 100,
        last_24h_samples: Array(96).fill(true),
      },
    ],
    current_incidents: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockFetchStatus.mockReset()
  mockFetchStatus.mockResolvedValue(payload())
})
afterEach(() => cleanup())

function withRouter(ui: React.ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>
}

describe('StatusPage', () => {
  it('renders one row per component from fetchStatus, in api order', async () => {
    render(withRouter(<StatusPage />))
    await waitFor(() => {
      expect(screen.getByTestId('status-row-api')).toBeTruthy()
      expect(screen.getByTestId('status-row-marketing')).toBeTruthy()
    })
    // Order matches the api response — api row appears before
    // marketing row in document order.
    const rows = screen.getAllByRole('listitem')
    expect(rows[0].getAttribute('data-testid')).toBe('status-row-api')
    expect(rows[1].getAttribute('data-testid')).toBe('status-row-marketing')
  })

  it('renders 96 slot elements per component (24h × 15min)', async () => {
    render(withRouter(<StatusPage />))
    await waitFor(() => {
      const bar = screen.getByTestId('uptime-bar-api')
      expect(bar.children.length).toBe(96)
    })
  })

  it('flips the banner to degraded when any component is not operational', async () => {
    mockFetchStatus.mockResolvedValue(
      payload({
        components: [
          {
            slug: 'api',
            name: 'API',
            category: 'core',
            current_status: 'degraded',
            uptime_7d_pct: 98.5,
            uptime_30d_pct: 99.0,
            last_24h_samples: Array(96).fill(true),
          },
        ],
      }),
    )
    const { container } = render(withRouter(<StatusPage />))
    await waitFor(() => {
      const banner = container.querySelector('.status-banner--degraded')
      expect(banner).toBeTruthy()
      expect(banner?.textContent || '').toMatch(/1 service affected/)
    })
  })

  it('flips the banner to "down" when any component is down', async () => {
    mockFetchStatus.mockResolvedValue(
      payload({
        components: [
          {
            slug: 'api',
            name: 'API',
            category: 'core',
            current_status: 'down',
            uptime_7d_pct: 50,
            uptime_30d_pct: 90,
            last_24h_samples: Array(96).fill(false),
          },
        ],
      }),
    )
    const { container } = render(withRouter(<StatusPage />))
    await waitFor(() => {
      const banner = container.querySelector('.status-banner--down')
      expect(banner).toBeTruthy()
    })
  })

  it('shows the "no active incidents" empty state when current_incidents is empty', async () => {
    render(withRouter(<StatusPage />))
    await waitFor(() => {
      expect(screen.getByTestId('incidents-empty')).toBeTruthy()
    })
  })

  it('renders one row per incident when current_incidents is non-empty', async () => {
    mockFetchStatus.mockResolvedValue(
      payload({
        current_incidents: [
          {
            id: 'inc-1',
            title: 'Provisioner gRPC dropping connections',
            severity: 'major',
            status: 'investigating',
            started_at: '2026-05-14T04:00:00Z',
            summary: 'Customer database provisioning is failing intermittently.',
          },
          {
            id: 'inc-2',
            title: 'Marketing site slow',
            severity: 'minor',
            status: 'monitoring',
            started_at: '2026-05-14T03:00:00Z',
          },
        ],
      }),
    )
    render(withRouter(<StatusPage />))
    await waitFor(() => {
      const list = screen.getByTestId('status-incidents')
      // Two incidents → two .status-incident-row children.
      expect(list.children.length).toBe(2)
      expect(screen.getByText(/Provisioner gRPC dropping/)).toBeTruthy()
      expect(screen.getByText(/Marketing site slow/)).toBeTruthy()
    })
  })

  it('surfaces an error banner when fetchStatus returns ok=false', async () => {
    mockFetchStatus.mockResolvedValue({
      ok: false,
      freshness_seconds: 60,
      as_of: new Date().toISOString(),
      components: [],
      current_incidents: [],
    })
    render(withRouter(<StatusPage />))
    await waitFor(() => {
      // The error banner uses role="alert".
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })

  it('does NOT crash when fetchStatus rejects', async () => {
    mockFetchStatus.mockRejectedValue(new Error('boom'))
    render(withRouter(<StatusPage />))
    // The page must render even before / despite a fetch failure.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })
})
