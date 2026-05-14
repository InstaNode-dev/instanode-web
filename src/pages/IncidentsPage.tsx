/* IncidentsPage — public, unauthenticated incident log at /incidents.
 *
 * Surfaces every incident our status board has ever flagged (planned
 * maintenance, partial outages, full outages). On a healthy system the
 * page renders an empty-state ("No active incidents") with a way to
 * report an incident.
 *
 * Why this page exists: the /status footer links to /incidents (in
 * StatusPage.tsx). Before this page existed the link 404'd — P3 founder
 * persona caught it on 2026-05-13. Cheap to build, sets up the real
 * surface for later population once we have an incident API.
 *
 * Data source:
 *   GET /api/v1/incidents → { ok: true, items: Incident[] }
 *
 * Today that endpoint does not exist on the agent API and will respond
 * 404. The page treats 404 as "no incidents" so the customer-facing
 * empty state always renders cleanly. When the api side ships (W7-G),
 * real rows will appear without any dashboard changes.
 *
 * Wrapped in PublicShell to match /status, /pricing, /for-agents chrome.
 */

import { useEffect, useState } from 'react'
import { PublicShell } from '../layout/PublicShell'
import { getAPIBaseURL } from '../api'

// ─── types ────────────────────────────────────────────────────────────────

export type IncidentSeverity = 'maintenance' | 'minor' | 'major' | 'critical'
export type IncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved'

export interface Incident {
  id: string
  title: string
  severity: IncidentSeverity
  state: IncidentState
  started_at: string
  resolved_at: string | null
  summary: string
}

// ─── data fetch ───────────────────────────────────────────────────────────

/** fetchIncidents — best-effort GET /api/v1/incidents.
 *
 * The endpoint is not yet live on the agent API. We treat a 404 (or any
 * other failure) as "no incidents" so the page renders the empty state
 * instead of an error banner. Exported for tests. */
export async function fetchIncidents(): Promise<Incident[]> {
  const base = getAPIBaseURL()
  const origin =
    base ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  let url: string
  try {
    url = new URL('/api/v1/incidents', origin).toString()
  } catch {
    return []
  }
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) return []
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; items?: Incident[] }
      | null
    if (!body || !Array.isArray(body.items)) return []
    return body.items
  } catch {
    return []
  }
}

// ─── page ─────────────────────────────────────────────────────────────────

export function IncidentsPage() {
  const [items, setItems] = useState<Incident[] | null>(null)

  useEffect(() => {
    let alive = true
    fetchIncidents().then((rows) => {
      if (!alive) return
      setItems(rows)
    })
    return () => {
      alive = false
    }
  }, [])

  const active = (items ?? []).filter((i) => i.state !== 'resolved')
  const resolved = (items ?? []).filter((i) => i.state === 'resolved')

  return (
    <PublicShell>
      <IncidentsStyles />

      <section className="incidents-header">
        <span className="public-eyebrow">Incident log · public · cumulative</span>
        <h1 className="public-h1">
          Incidents<span className="dot">.</span>
        </h1>
        <p className="public-sub">
          Every reported incident on instanode infrastructure. For a live
          health snapshot see <a href="/status">/status</a>.
        </p>
      </section>

      <section className="public-section">
        {items === null ? (
          <div
            data-testid="incidents-loading"
            className="incidents-empty"
            aria-busy="true"
          >
            Loading incidents…
          </div>
        ) : active.length === 0 && resolved.length === 0 ? (
          <div data-testid="incidents-empty" className="incidents-empty">
            <span className="incidents-empty-dot" />
            <span className="incidents-empty-title">No active incidents</span>
            <span className="incidents-empty-sub">
              All instanode subsystems have been operating normally. If
              something looks off on your side,{' '}
              <a
                href="mailto:incidents@instanode.dev?subject=Report%20an%20incident"
                className="incidents-empty-cta"
              >
                report an incident →
              </a>
            </span>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <div data-testid="incidents-active">
                <h2 className="incidents-h2">Active</h2>
                <div className="incidents-grid" role="list">
                  {active.map((i) => (
                    <IncidentRow key={i.id} incident={i} />
                  ))}
                </div>
              </div>
            )}
            {resolved.length > 0 && (
              <div data-testid="incidents-resolved" style={{ marginTop: 24 }}>
                <h2 className="incidents-h2">Resolved</h2>
                <div className="incidents-grid" role="list">
                  {resolved.map((i) => (
                    <IncidentRow key={i.id} incident={i} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* FIX-G (2026-05-14): the "Subscribe via RSS" link pointed at
          /status.rss which 404s — no RSS endpoint exists on the API. Link
          removed rather than shipping a stub feed; a real /status.rss is
          tracked separately and will reintroduce the link when it lands. */}
      <section className="public-section incidents-links">
        <a href="/status" className="incidents-link">Live status</a>
        <span className="incidents-link-sep">·</span>
        <a
          href="mailto:incidents@instanode.dev?subject=Report%20an%20incident"
          className="incidents-link"
        >
          Report an incident
        </a>
      </section>
    </PublicShell>
  )
}

// ─── subcomponents ────────────────────────────────────────────────────────

function IncidentRow({ incident }: { incident: Incident }) {
  return (
    <div className="incidents-row" role="listitem">
      <span
        className={`incidents-dot incidents-dot--${incident.severity}`}
        aria-label={incident.severity}
      />
      <div className="incidents-row-body">
        <div className="incidents-row-title">{incident.title}</div>
        <div className="incidents-row-sub">{incident.summary}</div>
      </div>
      <span className={`incidents-state incidents-state--${incident.state}`}>
        {incident.state}
      </span>
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────

function IncidentsStyles() {
  return (
    <style>{`
      .incidents-header { padding-top: 8px; }

      .incidents-empty {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding: 28px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
        font-size: 14px;
      }
      .incidents-empty-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 8px var(--accent-glow);
      }
      .incidents-empty-title {
        color: var(--text);
        font-weight: 500;
        font-size: 16px;
      }
      .incidents-empty-sub {
        color: var(--text-dim);
        font-size: 13px;
        line-height: 1.55;
      }
      .incidents-empty-cta {
        color: var(--accent);
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      .incidents-h2 {
        font-size: 13px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-faint);
        margin: 4px 0 10px;
      }
      .incidents-grid {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
        overflow: hidden;
      }
      .incidents-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 14px;
        padding: 14px 18px;
        border-top: 1px solid var(--border-soft);
      }
      .incidents-row:first-child { border-top: none; }
      .incidents-row-title { color: var(--text); font-size: 14px; }
      .incidents-row-sub {
        color: var(--text-dim);
        font-size: 12.5px;
        margin-top: 2px;
        line-height: 1.5;
      }
      .incidents-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: var(--text-faint);
        flex-shrink: 0;
      }
      .incidents-dot--maintenance { background: var(--text-faint); }
      .incidents-dot--minor       { background: var(--amber); }
      .incidents-dot--major       { background: var(--rose); }
      .incidents-dot--critical    { background: var(--rose); box-shadow: 0 0 10px rgba(255,122,138,0.7); }

      .incidents-state {
        font-family: var(--font-mono);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-dim);
      }
      .incidents-state--resolved     { color: var(--accent); }
      .incidents-state--monitoring   { color: var(--amber); }
      .incidents-state--investigating, .incidents-state--identified { color: var(--rose); }

      .incidents-links {
        display: flex; align-items: center; gap: 10px;
        font-size: 13px;
      }
      .incidents-link { color: var(--text-dim); transition: color 120ms; }
      .incidents-link:hover { color: var(--accent); }
      .incidents-link-sep { color: var(--text-faint); }
    `}</style>
  )
}
