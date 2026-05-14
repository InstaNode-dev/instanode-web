// MetricsPanel.test.tsx — unit tests for the Metrics tab on
// ResourceDetailPage. Three behaviours worth pinning:
//
//   1. Happy path: a non-stub response renders three charts + no banner.
//   2. Stub mode: the yellow "metrics will populate" banner renders + the
//      data_source-stub branch does NOT swap layout (charts still mount).
//   3. 402 upgrade-required: the upgrade prompt renders instead of charts.
//
// We mock `api.getResourceMetrics` directly because that's where the wire
// shape lives — pulling in MSW or fetch-mock for one endpoint would add
// more setup than the test surface justifies.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MetricsPanel } from './MetricsPanel'
import * as api from '../api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeFakeMetrics(overrides: Partial<api.ResourceMetricsResponse> = {}): api.ResourceMetricsResponse {
  // Deterministic synthetic series — sample values are fine because the
  // chart code only normalises against min/max.
  const sixty = Array.from({ length: 60 }, (_, i) => i + 1)
  return {
    ok: true,
    resource_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    resource_type: 'postgres',
    window_seconds: 3600,
    samples_count: 60,
    sample_interval_seconds: 60,
    metrics: {
      latency_p50_ms: sixty.map((v) => v * 0.05),
      latency_p95_ms: sixty.map((v) => v * 0.13),
      latency_p99_ms: sixty.map((v) => v * 0.30),
      connections_active: sixty.map((v) => 3 + (v % 3)),
      storage_bytes: sixty.map((v) => 1_000_000 + v * 50_000),
      error_rate_pct: sixty.map(() => 0),
    },
    data_source: 'newrelic',
    ...overrides,
  }
}

describe('MetricsPanel — happy path (real data)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getResourceMetrics').mockResolvedValue(makeFakeMetrics())
  })

  it('renders all three charts after the fetch resolves', async () => {
    render(<MetricsPanel resourceId="aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee" />)
    await waitFor(() => {
      expect(screen.getByTestId('metrics-panel')).toBeTruthy()
    })

    // Latency chart + connections chart = 2 SVG line charts.
    // Storage tile is a number tile, not a chart.
    expect(screen.getAllByTestId('metrics-chart').length).toBe(2)
    expect(screen.getByTestId('metrics-storage-tile')).toBeTruthy()
  })

  it('does NOT render the stub banner when data_source is not "stub"', async () => {
    render(<MetricsPanel resourceId="aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee" />)
    await waitFor(() => {
      expect(screen.getByTestId('metrics-panel')).toBeTruthy()
    })
    expect(screen.queryByTestId('metrics-stub-banner')).toBeNull()
  })

  it('renders three p50/p95/p99 series inside the latency chart', async () => {
    render(<MetricsPanel resourceId="aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee" />)
    await waitFor(() => {
      expect(screen.getByTestId('metrics-panel')).toBeTruthy()
    })

    const charts = screen.getAllByTestId('metrics-chart')
    const latencyChart = charts[0] // First Card is Latency
    // Each series is a <path data-series="..."/>. Three series → three paths.
    const seriesPaths = latencyChart.querySelectorAll('path[data-series]')
    expect(seriesPaths.length).toBe(3)
    expect(seriesPaths[0].getAttribute('data-series')).toBe('p50')
    expect(seriesPaths[1].getAttribute('data-series')).toBe('p95')
    expect(seriesPaths[2].getAttribute('data-series')).toBe('p99')
  })

  it('storage tile renders a positive delta when storage grew across the window', async () => {
    render(<MetricsPanel resourceId="aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee" />)
    await waitFor(() => {
      expect(screen.getByTestId('metrics-storage-delta')).toBeTruthy()
    })
    const delta = screen.getByTestId('metrics-storage-delta')
    // Synthetic data starts at 1_050_000 and ends at 4_000_000 (~). The sign
    // must be "+" because the series is strictly increasing.
    expect(delta.textContent).toContain('+')
  })
})

describe('MetricsPanel — stub mode', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getResourceMetrics').mockResolvedValue(
      makeFakeMetrics({ data_source: 'stub' }),
    )
  })

  it('renders the yellow "metrics will populate" banner', async () => {
    render(<MetricsPanel resourceId="aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee" />)
    await waitFor(() => {
      expect(screen.getByTestId('metrics-stub-banner')).toBeTruthy()
    })
    const banner = screen.getByTestId('metrics-stub-banner')
    expect(banner.textContent).toContain('Metrics will populate')
    expect(banner.textContent).toContain('5 minutes')
  })

  it('still renders the charts (layout does not shift when stub flips off)', async () => {
    render(<MetricsPanel resourceId="aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee" />)
    await waitFor(() => {
      expect(screen.getByTestId('metrics-panel')).toBeTruthy()
    })
    expect(screen.getAllByTestId('metrics-chart').length).toBe(2)
    expect(screen.getByTestId('metrics-storage-tile')).toBeTruthy()
  })
})

describe('MetricsPanel — tier wall (402)', () => {
  beforeEach(() => {
    // Simulate the APIError shape thrown by the api/index.ts call() wrapper.
    // The wrapper sets `.status` and `.code` on Error before rejecting.
    const err = Object.assign(new Error('Resource metrics require the Pro plan or higher.'), {
      status: 402,
      code: 'upgrade_required',
    })
    vi.spyOn(api, 'getResourceMetrics').mockRejectedValue(err)
  })

  it('renders the upgrade prompt instead of charts', async () => {
    render(<MetricsPanel resourceId="aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee" />)
    await waitFor(() => {
      expect(screen.getByTestId('metrics-upgrade-required')).toBeTruthy()
    })
    // No chart elements rendered on the 402 path — calmer surface.
    expect(screen.queryAllByTestId('metrics-chart').length).toBe(0)
    expect(screen.queryByTestId('metrics-storage-tile')).toBeNull()

    const card = screen.getByTestId('metrics-upgrade-required')
    expect(card.textContent).toContain('Pro')
    expect(card.textContent).toContain('Upgrade')
  })
})

describe('MetricsPanel — generic error', () => {
  beforeEach(() => {
    const err = Object.assign(new Error('boom'), { status: 503, code: 'fetch_failed' })
    vi.spyOn(api, 'getResourceMetrics').mockRejectedValue(err)
  })

  it('renders the error message in an alert region', async () => {
    render(<MetricsPanel resourceId="aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee" />)
    await waitFor(() => {
      expect(screen.getByTestId('metrics-error')).toBeTruthy()
    })
    const err = screen.getByTestId('metrics-error')
    expect(err.textContent).toContain('boom')
    expect(err.getAttribute('role')).toBe('alert')
  })
})
