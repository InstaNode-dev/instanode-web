/* StatusPage — public, unauthenticated status board at /status.
   Eventually also lives at status.instanode.dev. Pure client-side probe
   page; no backend status aggregator (future sprint). Polls every 30 s.

   For each service we run a lightweight fetch with a 5 s timeout and
   measure RTT via performance.now(). The customer-deployments probe uses
   `mode: 'no-cors'` — the response is opaque and unreadable, but a clean
   resolution (no network error) confirms the wildcard ingress / TLS is up.
   cert-manager has no public probe and renders as a static "auto-issuing"
   tag.

   Wrapped in PublicShell to match /pricing and /for-agents chrome. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PublicShell } from '../layout/PublicShell'

// ─── constants ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000
const PROBE_TIMEOUT_MS = 5_000

const API_HEALTH_URL = 'https://api.instanode.dev/healthz'
const MARKETING_PROBE_PATH = '/sitemap.xml'
const DEPLOY_PROBE_URL = 'https://_probe-not-real_.deployment.instanode.dev/'

// ─── types ────────────────────────────────────────────────────────────────

type Status = 'ok' | 'degraded' | 'down' | 'pending'

type ServiceState = {
  name: string
  url?: string
  status: Status
  latencyMs?: number
  note?: string
}

type ServiceKey = 'api' | 'marketing' | 'deploy' | 'cert'

// ─── probe helpers ────────────────────────────────────────────────────────

/** Race a fetch against a hard timeout. Returns null on abort/error. */
async function probeFetch(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; latencyMs: number } | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  const start = performance.now()
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const latencyMs = Math.round(performance.now() - start)
    // For opaque responses (mode: 'no-cors') status is 0 but type === 'opaque';
    // a successful resolution itself is the signal that ingress is reachable.
    const ok = res.type === 'opaque' ? true : res.ok
    return { ok, latencyMs }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function probeApi(): Promise<ServiceState> {
  const r = await probeFetch(API_HEALTH_URL)
  if (!r) {
    return { name: 'API', url: 'api.instanode.dev', status: 'down', note: 'unreachable' }
  }
  return {
    name: 'API',
    url: 'api.instanode.dev',
    status: r.ok ? 'ok' : 'degraded',
    latencyMs: r.latencyMs
  }
}

async function probeMarketing(): Promise<ServiceState> {
  const url = window.location.origin + MARKETING_PROBE_PATH
  const r = await probeFetch(url)
  if (!r) {
    return { name: 'Marketing site', url: 'instanode.dev', status: 'down', note: 'unreachable' }
  }
  return {
    name: 'Marketing site',
    url: 'instanode.dev',
    status: r.ok ? 'ok' : 'degraded',
    latencyMs: r.latencyMs
  }
}

async function probeDeploy(): Promise<ServiceState> {
  // Wildcard ingress probe. Opaque response is fine — successful TCP/TLS
  // handshake is observable via the absence of a network error.
  const r = await probeFetch(DEPLOY_PROBE_URL, { mode: 'no-cors' })
  if (!r) {
    return {
      name: 'Customer deployments',
      url: '*.deployment.instanode.dev',
      status: 'degraded',
      note: 'wildcard ingress probe failed'
    }
  }
  return {
    name: 'Customer deployments',
    url: '*.deployment.instanode.dev',
    status: 'ok',
    note: 'wildcard ingress · TLS auto-renew',
    latencyMs: r.latencyMs
  }
}

function staticCertManager(): ServiceState {
  return {
    name: 'cert-manager / TLS',
    status: 'ok',
    note: 'auto-issuing'
  }
}

// ─── uptime hint ──────────────────────────────────────────────────────────

/** Lightweight in-page uptime estimate over the last 24h, computed from the
    rolling probe history. With a 30 s cadence we'd see 2880 ticks/day; we
    cap the buffer so the hint stays stable in long-lived tabs. */
const UPTIME_BUFFER_CAP = 2880

type ProbeOutcome = { ts: number; allOk: boolean }

// ─── page ─────────────────────────────────────────────────────────────────

export function StatusPage() {
  const [services, setServices] = useState<Record<ServiceKey, ServiceState>>({
    api:       { name: 'API',                  url: 'api.instanode.dev',           status: 'pending' },
    marketing: { name: 'Marketing site',       url: 'instanode.dev',               status: 'pending' },
    deploy:    { name: 'Customer deployments', url: '*.deployment.instanode.dev',  status: 'pending' },
    cert:      staticCertManager()
  })
  const [lastChecked, setLastChecked] = useState<number | null>(null)
  const [history, setHistory] = useState<ProbeOutcome[]>([])

  const tick = useCallback(async () => {
    const [api, marketing, deploy] = await Promise.all([
      probeApi(),
      probeMarketing(),
      probeDeploy()
    ])
    const cert = staticCertManager()
    setServices({ api, marketing, deploy, cert })
    const now = Date.now()
    setLastChecked(now)
    const allOk = [api, marketing, deploy, cert].every((s) => s.status === 'ok')
    setHistory((h) => {
      const next = [...h, { ts: now, allOk }]
      return next.length > UPTIME_BUFFER_CAP ? next.slice(-UPTIME_BUFFER_CAP) : next
    })
  }, [])

  useEffect(() => {
    void tick()
    const id = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [tick])

  const ordered: ServiceState[] = useMemo(
    () => [services.api, services.marketing, services.deploy, services.cert],
    [services]
  )

  const downCount = ordered.filter((s) => s.status === 'down' || s.status === 'degraded').length
  const allOk = downCount === 0 && ordered.every((s) => s.status === 'ok')
  const bannerCopy = allOk
    ? 'All systems operational.'
    : `Degraded · ${downCount} service${downCount === 1 ? '' : 's'} affected`
  const bannerTone: 'ok' | 'degraded' = allOk ? 'ok' : 'degraded'

  const uptimePct = useMemo(() => computeUptime(history), [history])

  return (
    <PublicShell>
      <StatusStyles />

      <section className="status-header">
        <span className="public-eyebrow">Status · live · client-side probes</span>
        <h1 className="public-h1">
          Status<span className="dot">.</span>
        </h1>
        <p className="public-sub">
          Live health of every public instanode subsystem. Probed from your browser every 30 s.
        </p>
      </section>

      <section className="public-section">
        <div className={`status-banner status-banner--${bannerTone}`}>
          <span className="status-banner-left">
            <span className={`status-dot status-dot--${bannerTone}`} />
            {bannerCopy}
          </span>
          <span className="status-banner-right">
            last checked {formatRelative(lastChecked)}
          </span>
        </div>

        <div className="status-grid" role="list">
          {ordered.map((s) => (
            <ServiceRow key={s.name} svc={s} />
          ))}
        </div>

        <div className="status-uptime">
          <span className="status-uptime-label">Last 24h uptime</span>
          <span className="status-uptime-value">
            {uptimePct === null ? '—' : `${uptimePct.toFixed(2)}%`}
          </span>
          <span className="status-uptime-note">
            (computed from {history.length} probe{history.length === 1 ? '' : 's'} this session)
          </span>
        </div>
      </section>

      <section className="public-section status-links">
        <a href="/status.rss" className="status-link">Subscribe via RSS</a>
        <span className="status-link-sep">·</span>
        <a href="https://github.com/instanode" className="status-link">GitHub status</a>
        <span className="status-link-sep">·</span>
        <a href="/incidents" className="status-link">Incident log</a>
      </section>
    </PublicShell>
  )
}

// ─── subcomponents ────────────────────────────────────────────────────────

function ServiceRow({ svc }: { svc: ServiceState }) {
  const right = svc.note
    ? svc.note
    : svc.latencyMs != null
    ? `${svc.latencyMs} ms`
    : '—'
  return (
    <div className="status-row" role="listitem">
      <span className={`status-dot status-dot--${svc.status}`} aria-label={svc.status} />
      <span className="status-row-name">
        {svc.name}
        {svc.url ? <span className="status-row-url"> ({svc.url})</span> : null}
      </span>
      <span className={`status-row-right status-row-right--${svc.status}`}>
        {right}
      </span>
    </div>
  )
}

// ─── utilities ────────────────────────────────────────────────────────────

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

function computeUptime(history: ProbeOutcome[]): number | null {
  if (history.length === 0) return null
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const recent = history.filter((p) => p.ts >= cutoff)
  if (recent.length === 0) return null
  const ok = recent.filter((p) => p.allOk).length
  return (ok / recent.length) * 100
}

// ─── styles ───────────────────────────────────────────────────────────────

function StatusStyles() {
  return (
    <style>{`
      .status-header { padding-top: 8px; }

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
      .status-banner--ok        { border-color: rgba(0,228,142,0.3);  box-shadow: 0 0 0 1px rgba(0,228,142,0.08) inset; }
      .status-banner--degraded  { border-color: rgba(255,192,105,0.4); box-shadow: 0 0 0 1px rgba(255,192,105,0.08) inset; }
      .status-banner-left  { display: inline-flex; align-items: center; gap: 10px; color: var(--text); font-weight: 500; }
      .status-banner-right { font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }

      /* grid */
      .status-grid {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
        overflow: hidden;
      }
      .status-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 14px;
        padding: 14px 18px;
        border-top: 1px solid var(--border-soft);
        font-size: 14px;
      }
      .status-row:first-child { border-top: none; }
      .status-row-name { color: var(--text); }
      .status-row-url {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-faint);
        margin-left: 6px;
      }
      .status-row-right {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-dim);
      }
      .status-row-right--ok       { color: var(--accent); }
      .status-row-right--degraded { color: var(--amber); }
      .status-row-right--down     { color: var(--rose); }
      .status-row-right--pending  { color: var(--text-faint); }

      /* dot */
      .status-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: var(--text-faint);
        box-shadow: 0 0 0 0 transparent;
        flex-shrink: 0;
      }
      .status-dot--ok       { background: var(--accent); box-shadow: 0 0 8px var(--accent-glow); }
      .status-dot--degraded { background: var(--amber);  box-shadow: 0 0 8px rgba(255,192,105,0.55); }
      .status-dot--down     { background: var(--rose);   box-shadow: 0 0 8px rgba(255,122,138,0.55); }
      .status-dot--pending  { background: var(--text-faint); }

      /* uptime */
      .status-uptime {
        margin-top: 14px;
        padding: 12px 18px;
        display: flex; align-items: baseline; gap: 12px;
        border: 1px dashed var(--border);
        border-radius: 12px;
        background: transparent;
      }
      .status-uptime-label {
        font-family: var(--font-mono);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-faint);
      }
      .status-uptime-value {
        font-family: var(--font-mono);
        font-size: 16px;
        color: var(--accent);
      }
      .status-uptime-note {
        font-size: 12px;
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
        .status-row { grid-template-columns: auto 1fr; }
        .status-row-right { grid-column: 2 / 3; }
        .status-row-url { display: block; margin-left: 0; }
      }
    `}</style>
  )
}
