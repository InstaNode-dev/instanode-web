/* StatusPage — public status board at /status.
 *
 * Replaced (W11, 2026-05-14): no more client-side probes. The browser
 * now fetches the worker-aggregated uptime feed via fetchStatus()
 * (GET /api/v1/status), which writes one row per component per minute
 * from inside the cluster. This eliminates the failure mode caught by
 * P3 — when instanode's edge is down, a browser-side probe was ALSO
 * down, so the page either failed to load or reported green-on-green.
 *
 * The page renders:
 *   - A top banner (operational / degraded / down) derived from each
 *     component's `current_status`.
 *   - One row per component with a 96-segment "last 24h" uptime bar
 *     (green = healthy slot, red = unhealthy slot).
 *   - Rolling uptime percentages over 7d and 30d.
 *   - A "Current incidents" section that maps the (today-empty)
 *     current_incidents array. When the incident-feed worker ships,
 *     real rows appear here without a dashboard change.
 *
 * Polls every 60s (matches the api cache TTL — polling faster yields
 * the same bytes). Wrapped in PublicShell to match /pricing chrome.
 */

import { useCallback, useEffect, useState } from 'react'
import { PublicShell } from '../layout/PublicShell'
import {
  fetchStatus,
  type StatusComponent,
  type StatusIncident,
  type StatusPayload,
} from '../api'

// ─── constants ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000

// ─── page ─────────────────────────────────────────────────────────────────

export function StatusPage() {
  const [payload, setPayload] = useState<StatusPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<number | null>(null)

  const tick = useCallback(async () => {
    try {
      const next = await fetchStatus()
      setPayload(next)
      setError(next.ok ? null : 'Status feed unreachable — showing last-known state.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status feed unreachable.')
    }
    setLastChecked(Date.now())
  }, [])

  useEffect(() => {
    void tick()
    const id = window.setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [tick])

  const components = payload?.components ?? []
  const incidents = payload?.current_incidents ?? []

  // Aggregate banner: any non-operational component shifts the headline.
  // `down` wins over `degraded`, both win over `operational`.
  const aggregateStatus = computeAggregateStatus(components)
  const downCount = components.filter((c) => c.current_status !== 'operational').length
  const bannerCopy =
    aggregateStatus === 'operational'
      ? 'All systems operational.'
      : `${capitalize(aggregateStatus)} · ${downCount} service${downCount === 1 ? '' : 's'} affected`

  return (
    <PublicShell>
      <StatusStyles />

      <section className="status-header">
        <span className="public-eyebrow">Status · live · server-aggregated</span>
        <h1 className="public-h1">
          Status<span className="dot">.</span>
        </h1>
        <p className="public-sub">
          Live health of every public instanode subsystem. Aggregated from
          intra-cluster probes every 60 s.
        </p>
      </section>

      <section className="public-section">
        <div className={`status-banner status-banner--${aggregateStatus}`}>
          <span className="status-banner-left">
            <span className={`status-dot status-dot--${aggregateStatus}`} />
            {bannerCopy}
          </span>
          <span className="status-banner-right">
            last checked {formatRelative(lastChecked)}
          </span>
        </div>

        {error && (
          <div className="status-banner status-banner--degraded" role="alert">
            <span className="status-banner-left">{error}</span>
          </div>
        )}

        {components.length === 0 ? (
          <div className="status-empty">
            No telemetry yet. The worker has not written its first probe
            row — give it a minute and refresh.
          </div>
        ) : (
          <div className="status-grid" role="list" data-testid="status-components">
            {components.map((c) => (
              <ComponentRow key={c.slug} comp={c} />
            ))}
          </div>
        )}
      </section>

      <section className="public-section">
        <h2 className="status-section-title">Current incidents</h2>
        {incidents.length === 0 ? (
          <div className="status-empty" data-testid="incidents-empty">
            No active incidents.
          </div>
        ) : (
          <div className="status-incidents" data-testid="status-incidents">
            {incidents.map((i) => (
              <IncidentRow key={i.id} inc={i} />
            ))}
          </div>
        )}
      </section>

      {/* FIX-G (2026-05-14): "Subscribe via RSS" link removed — /status.rss
          404s on the API. See IncidentsPage for the matching cleanup. */}
      <section className="public-section status-links">
        {/* Display-detail accuracy (2026-06-11): github.com/instanode is an
            unrelated third-party org — ours is InstaNode-dev. */}
        <a href="https://github.com/InstaNode-dev" className="status-link">GitHub status</a>
        <span className="status-link-sep">·</span>
        <a href="/incidents" className="status-link">Incident log</a>
      </section>
    </PublicShell>
  )
}

// ─── subcomponents ────────────────────────────────────────────────────────

function ComponentRow({ comp }: { comp: StatusComponent }) {
  const status = comp.current_status
  const uptime7d = formatUptimePct(comp.uptime_7d_pct)
  const uptime30d = formatUptimePct(comp.uptime_30d_pct)
  return (
    <div className="status-row" role="listitem" data-testid={`status-row-${comp.slug}`}>
      <div className="status-row-header">
        <span className={`status-dot status-dot--${status}`} aria-label={status} />
        <span className="status-row-name">
          {comp.name}
          {comp.description ? (
            <span className="status-row-desc"> · {comp.description}</span>
          ) : null}
        </span>
        <span className={`status-row-right status-row-right--${status}`}>
          {capitalize(status)}
        </span>
      </div>
      <div
        className="status-bar"
        aria-label={`Last 24h uptime: ${uptime7d ?? '—'}`}
        data-testid={`uptime-bar-${comp.slug}`}
      >
        {comp.last_24h_samples.map((healthy, i) => (
          <span
            key={i}
            className={`status-bar-slot ${healthy ? 'status-bar-slot--ok' : 'status-bar-slot--bad'}`}
          />
        ))}
      </div>
      <div className="status-row-footer">
        <span>7d uptime: <strong>{uptime7d ?? '—'}</strong></span>
        <span>30d uptime: <strong>{uptime30d ?? '—'}</strong></span>
      </div>
    </div>
  )
}

function IncidentRow({ inc }: { inc: StatusIncident }) {
  return (
    <div className="status-incident-row">
      <div className="status-incident-row-top">
        <span className={`status-incident-sev status-incident-sev--${inc.severity}`}>
          {inc.severity}
        </span>
        <span className="status-incident-title">{inc.title}</span>
        <span className="status-incident-status">{inc.status}</span>
      </div>
      {inc.summary ? <p className="status-incident-summary">{inc.summary}</p> : null}
      <div className="status-incident-meta">
        <span>started {inc.started_at}</span>
        {inc.resolved_at ? <span>resolved {inc.resolved_at}</span> : null}
        {inc.url ? (
          <a href={inc.url} className="status-link">details</a>
        ) : null}
      </div>
    </div>
  )
}

// ─── utilities ────────────────────────────────────────────────────────────

function computeAggregateStatus(rows: StatusComponent[]): 'operational' | 'degraded' | 'down' {
  if (rows.length === 0) return 'operational'
  if (rows.some((r) => r.current_status === 'down')) return 'down'
  if (rows.some((r) => r.current_status === 'degraded')) return 'degraded'
  return 'operational'
}

function formatRelative(ts: number | null): string {
  if (ts == null) return 'never'
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

function formatUptimePct(pct: number): string | null {
  // -1 is the api's sentinel for "no data in this window".
  if (pct < 0) return null
  return `${pct.toFixed(2)}%`
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

// ─── styles ───────────────────────────────────────────────────────────────

function StatusStyles() {
  return (
    <style>{`
      .status-header { padding-top: 8px; }
      .status-section-title {
        font-size: 18px;
        font-weight: 600;
        margin: 0 0 12px;
        color: var(--text);
      }

      /* banner */
      .status-banner {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
        margin-bottom: 18px;
        font-size: 14px;
      }
      .status-banner--operational { border-color: rgba(0,228,142,0.3);  box-shadow: 0 0 0 1px rgba(0,228,142,0.08) inset; }
      .status-banner--degraded    { border-color: rgba(255,192,105,0.4); box-shadow: 0 0 0 1px rgba(255,192,105,0.08) inset; }
      .status-banner--down        { border-color: rgba(255,122,138,0.4); box-shadow: 0 0 0 1px rgba(255,122,138,0.08) inset; }
      .status-banner-left  { display: inline-flex; align-items: center; gap: 10px; color: var(--text); font-weight: 500; }
      .status-banner-right { font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }

      /* component grid */
      .status-grid {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
        overflow: hidden;
      }
      .status-row {
        padding: 16px 18px;
        border-top: 1px solid var(--border-soft);
      }
      .status-row:first-child { border-top: none; }
      .status-row-header {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 10px;
        font-size: 14px;
      }
      .status-row-name { flex: 1; color: var(--text); }
      .status-row-desc { color: var(--text-faint); font-weight: 400; }
      .status-row-right {
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .status-row-right--operational { color: var(--accent); }
      .status-row-right--degraded    { color: var(--amber); }
      .status-row-right--down        { color: var(--rose); }
      .status-row-footer {
        margin-top: 8px;
        display: flex; gap: 18px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-faint);
      }

      /* uptime bar */
      .status-bar {
        display: grid;
        grid-template-columns: repeat(96, 1fr);
        gap: 2px;
        height: 28px;
        align-items: stretch;
      }
      .status-bar-slot {
        border-radius: 1px;
        background: var(--text-faint);
        opacity: 0.45;
      }
      .status-bar-slot--ok  { background: var(--accent); opacity: 0.65; }
      .status-bar-slot--bad { background: var(--rose);   opacity: 0.85; }

      /* dot */
      .status-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: var(--text-faint);
        flex-shrink: 0;
      }
      .status-dot--operational { background: var(--accent); box-shadow: 0 0 8px var(--accent-glow); }
      .status-dot--degraded    { background: var(--amber);  box-shadow: 0 0 8px rgba(255,192,105,0.55); }
      .status-dot--down        { background: var(--rose);   box-shadow: 0 0 8px rgba(255,122,138,0.55); }

      /* empty + incidents */
      .status-empty {
        padding: 18px;
        border: 1px dashed var(--border);
        border-radius: 12px;
        color: var(--text-faint);
        font-size: 13px;
      }
      .status-incidents {
        display: flex; flex-direction: column; gap: 10px;
      }
      .status-incident-row {
        padding: 14px 18px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
      }
      .status-incident-row-top {
        display: flex; align-items: center; gap: 10px;
        font-size: 14px;
      }
      .status-incident-sev {
        font-family: var(--font-mono);
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--border-soft);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .status-incident-sev--critical { color: var(--rose); }
      .status-incident-sev--major    { color: var(--amber); }
      .status-incident-title { flex: 1; color: var(--text); font-weight: 500; }
      .status-incident-status { font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }
      .status-incident-summary { margin: 8px 0 0; font-size: 13px; color: var(--text-dim); }
      .status-incident-meta {
        margin-top: 8px;
        display: flex; gap: 12px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-faint);
      }

      /* links footer */
      .status-links {
        display: flex; align-items: center; gap: 10px;
        font-size: 13px;
      }
      .status-link {
        color: var(--text-dim);
        transition: color 120ms;
      }
      .status-link:hover { color: var(--accent); }
      .status-link-sep   { color: var(--text-faint); }

      @media (max-width: 560px) {
        .status-banner { flex-direction: column; align-items: flex-start; gap: 6px; }
        .status-bar { grid-template-columns: repeat(48, 1fr); }
      }
    `}</style>
  )
}
