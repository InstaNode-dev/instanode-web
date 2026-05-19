// MetricsPanel.tsx — renders the Metrics tab on ResourceDetailPage.
//
// Replaces the prior `status="gap"` placeholder. Fetches
// /api/v1/resources/:id/metrics?window=1h on mount and re-polls every 60s
// while the panel is mounted. Three tiles:
//
//   1. Latency (p50 / p95 / p99 line chart — three series, shared axis)
//   2. Active connections (single-series line chart)
//   3. Storage (big-number + delta-since-window-start)
//
// When the API returns `data_source: "stub"` we render a yellow banner
// explaining "metrics will populate as your resource sees traffic". The
// charts still render with the (empty / synthetic) data so the layout
// doesn't shift when the real data source lands.
//
// Charts are inline SVG (matches the Sparkline pattern in Common.tsx).
// No external chart library — the dashboard doesn't ship one today, and
// adding `recharts` for three small tiles would inflate the bundle by
// ~150KB.

import { useEffect, useState } from 'react'
import * as api from '../api'
import type { ResourceMetricsResponse } from '../api'
import { Card } from './Common'

const POLL_INTERVAL_MS = 60_000

interface MetricsPanelProps {
  resourceId: string
  /** Tier of the team that owns this resource — surfaced so the panel can
   *  pick an appropriate default window (Hobby = 1h, Pro = 1h still
   *  ergonomic, Growth/Team could surface 24h). For v1 we always default
   *  to 1h regardless of tier; the per-tier default is a future fast-follow. */
  ownerTier?: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; status?: number }
  | { kind: 'ready'; data: ResourceMetricsResponse }

export function MetricsPanel({ resourceId }: MetricsPanelProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function fetchOnce() {
      try {
        const data = await api.getResourceMetrics(resourceId, '1h')
        if (!cancelled) setState({ kind: 'ready', data })
      } catch (e) {
        if (cancelled) return
        const err = e as { status?: number; message?: string }
        // 402 is the tier wall — surface a precise message instead of a
        // generic "load failed" so the user knows the path forward.
        if (err.status === 402) {
          setState({
            kind: 'error',
            status: 402,
            message: err.message ?? 'Metrics require the Pro plan or higher.',
          })
          return
        }
        setState({
          kind: 'error',
          status: err.status,
          message: err.message ?? 'Failed to load metrics',
        })
      }
    }

    void fetchOnce()
    const handle = window.setInterval(() => void fetchOnce(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [resourceId])

  if (state.kind === 'loading') {
    return (
      <Card title="Metrics · 1h">
        <div data-testid="metrics-loading" className="skel" style={{ width: '100%', height: 220 }} />
      </Card>
    )
  }

  if (state.kind === 'error') {
    // 402 is a designed-for outcome: the team isn't on a tier that allows
    // metrics. Render a calmer upgrade prompt rather than a red error banner.
    if (state.status === 402) {
      return (
        <Card title="Metrics · 1h" right={<span style={{ color: 'var(--rose)' }}>upgrade required</span>}>
          <div data-testid="metrics-upgrade-required" style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}>
            Resource metrics — p50/p95/p99 latency, connections, storage — are a Pro-plan feature.{' '}
            <a href="https://instanode.dev/pricing" style={{ color: 'var(--rose)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              Upgrade to unlock →
            </a>
          </div>
        </Card>
      )
    }
    return (
      <Card title="Metrics · 1h" right={<span style={{ color: 'var(--rose)' }}>error</span>}>
        <div role="alert" data-testid="metrics-error" style={{ padding: 24, color: 'var(--rose)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {state.message}
        </div>
      </Card>
    )
  }

  const { data } = state
  const m = data.metrics
  const isStub = data.data_source === 'stub'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="metrics-panel">
      {isStub && (
        <div
          role="status"
          data-testid="metrics-stub-banner"
          style={{
            padding: '10px 14px',
            background: 'rgba(255, 200, 0, 0.08)',
            border: '1px solid rgba(255, 200, 0, 0.28)',
            borderRadius: 6,
            color: 'var(--text-dim)',
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--text)' }}>Metrics will populate as your resource sees traffic.</strong>{' '}
          First samples typically appear within 5 minutes. The chart layout is final — values fill in
          as the prober collects probes.
        </div>
      )}

      <Card title="Latency · p50 / p95 / p99" right={<LegendLatency />}>
        <MultiSeriesChart
          height={140}
          series={[
            { label: 'p50', values: m.latency_p50_ms, color: 'var(--green)' },
            { label: 'p95', values: m.latency_p95_ms, color: 'var(--amber)' },
            { label: 'p99', values: m.latency_p99_ms, color: 'var(--rose)' },
          ]}
          yUnit="ms"
        />
      </Card>

      <Card title="Active connections">
        <MultiSeriesChart
          height={120}
          series={[{ label: 'connections', values: m.connections_active, color: 'var(--green)' }]}
          yUnit=""
        />
      </Card>

      <Card title="Storage">
        <StorageTile values={m.storage_bytes} />
      </Card>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function LegendLatency() {
  return (
    <span style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-dim)' }}>
      <LegendDot color="var(--green)" label="p50" />
      <LegendDot color="var(--amber)" label="p95" />
      <LegendDot color="var(--rose)" label="p99" />
    </span>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }} />
      {label}
    </span>
  )
}

interface Series {
  label: string
  values: number[]
  color: string
}

// MultiSeriesChart — minimal inline SVG line chart. All series share the
// chart-wide y range so p50/p95/p99 stack visually (which is what the
// reader expects).
//
// Renders even when values is empty: a single horizontal baseline so the
// container height stays stable. That prevents the Metrics tab from
// "jumping" when the stub data starts returning real samples.
export function MultiSeriesChart({
  height,
  series,
  yUnit,
}: {
  height: number
  series: Series[]
  yUnit: string
}) {
  const w = 800
  const padBottom = 22 // axis labels
  const padTop = 6
  const chartH = height - padBottom - padTop

  const allValues = series.flatMap((s) => s.values)
  // Guard against an empty-series response — keep the y range stable so
  // the polyline is renderable instead of producing NaN points.
  let yMin = 0
  let yMax = 1
  if (allValues.length > 0) {
    yMin = Math.min(...allValues)
    yMax = Math.max(...allValues)
    if (yMax === yMin) yMax = yMin + 1
  }
  const yRange = yMax - yMin

  const longestSeriesLen = Math.max(...series.map((s) => s.values.length), 1)
  const step = w / Math.max(longestSeriesLen - 1, 1)

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
      aria-label="metrics line chart"
      data-testid="metrics-chart"
    >
      {series.map((s) => {
        if (s.values.length === 0) return null
        const path = s.values
          .map((v, i) => {
            const x = i * step
            const y = padTop + chartH - ((v - yMin) / yRange) * chartH
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          })
          .join(' ')
        return (
          <path
            key={s.label}
            d={path}
            fill="none"
            stroke={s.color}
            strokeWidth={1.4}
            data-series={s.label}
          />
        )
      })}
      {/* Y-axis range label, bottom-right */}
      <text x={w - 4} y={height - 6} fill="var(--text-faint)" fontSize={10} textAnchor="end">
        {fmt(yMax)}{yUnit && ' ' + yUnit} max · {fmt(yMin)}{yUnit && ' ' + yUnit} min
      </text>
    </svg>
  )
}

// StorageTile — single big-number + delta. Picks the first / last sample so
// the delta covers the entire window. Falls back to a "—" placeholder when
// the series is empty.
function StorageTile({ values }: { values: number[] }) {
  if (values.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>—</div>
    )
  }
  const first = values[0]
  const last = values[values.length - 1]
  const delta = last - first
  const deltaPct = first > 0 ? (delta / first) * 100 : 0
  const sign = delta >= 0 ? '+' : '−'
  const deltaColor = delta > 0 ? 'var(--amber)' : delta < 0 ? 'var(--green)' : 'var(--text-faint)'

  return (
    <div
      data-testid="metrics-storage-tile"
      style={{ display: 'flex', alignItems: 'baseline', gap: 16, padding: '12px 4px', flexWrap: 'wrap' }}
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: 'var(--text)' }}>
        {formatBytes(last)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        <span style={{ color: deltaColor }} data-testid="metrics-storage-delta">
          {sign}{formatBytes(Math.abs(delta))} ({sign}{Math.abs(deltaPct).toFixed(1)}%)
        </span>
        <span style={{ color: 'var(--text-faint)' }}>since window start</span>
      </div>
    </div>
  )
}

// formatBytes — renders a byte count with binary-prefix units. The divisors
// are powers of 1024, so the suffixes must be the binary KiB/MiB/GiB, not
// the decimal-SI KB/MB/GB (D6: the old labels said "MB" for a /1048576
// conversion, which is a MiB).
function formatBytes(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0)
  if (Math.abs(n) >= 10) return n.toFixed(1)
  return n.toFixed(2)
}
