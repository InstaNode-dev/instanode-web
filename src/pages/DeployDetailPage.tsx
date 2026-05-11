import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ROBanner, ContractBanner, EnvPill, StatusPill, TierPill, ResourceIcon, PromptPill, PromptCard
} from '../components/Common'
import { CustomDomainPanel } from '../components/CustomDomainPanel'
import { useDashboardCtx } from '../hooks/useDashboardCtx'
import * as api from '../api'
import type { DashboardStack, Tier } from '../api'
import { streamSSE } from '../lib/sseStream'

// Tiers that have access to custom domains. Anonymous and hobby see an
// upsell card; everyone else sees the live panel. Source of truth: the
// /api/v1/stacks/:slug/domains endpoint returns 402 upgrade_required
// for anything outside this set.
const CUSTOM_DOMAIN_TIERS: ReadonlySet<Tier> = new Set(['pro', 'team', 'growth'])

// In-app billing route. Mirrors the path used elsewhere in the dashboard
// for the upgrade journey.
const BILLING_PATH = '/app/billing'

// Service name used when streaming logs from a multi-service stack. The stacks
// SSE endpoint is `/stacks/:slug/logs/:svc` — `web` matches the convention used
// for the primary HTTP service of a deploy.
const STACK_LOG_SERVICE = 'web'

// Cap the in-memory log buffer to bound memory on long-running streams. The UI
// only scrolls the most recent ~2000 lines anyway.
const LOG_BUFFER_MAX_LINES = 2000

// SSE end-of-stream sentinel emitted by the API when the upstream pod log
// stream closes (e.g. the build finishes or the pod restarts).
const LOG_END_SENTINEL = '[end]'

// Distance in pixels from the bottom of the log container at which we still
// consider the user "near the bottom" — within this threshold we auto-scroll
// new lines into view; past it we leave the scroll position alone so reading
// older lines isn't interrupted.
const AUTOSCROLL_NEAR_BOTTOM_PX = 40

type StreamState = 'connecting' | 'open' | 'closed' | 'error'

const TABS = ['Overview', 'Logs', 'Env vars', 'Resources', 'Metrics', 'Audit'] as const
type Tab = (typeof TABS)[number]

export function DeployDetailPage() {
  const { id } = useParams()
  const [d, setD] = useState<DashboardStack | null>(null)
  const [tab, setTab] = useState<Tab>('Overview')
  const ctx = useDashboardCtx()
  const tier = (ctx.me?.user.tier ?? 'anonymous') as Tier
  const canUseCustomDomains = CUSTOM_DOMAIN_TIERS.has(tier)

  useEffect(() => {
    if (!id) return
    api.listStacks().then((r) => setD(r.items.find((s) => s.id === id) ?? r.items[0]))
  }, [id])

  if (!d) return <div className="skel" style={{ width: '100%', height: 320 }} />

  return (
    <>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <ResourceIcon type="deploy" size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' }}>{d.name}</h2>
            <StatusPill status={d.status} />
            <EnvPill env={d.env} />
            <TierPill tier={d.tier} />
          </div>
          {d.url && (
            <a href={d.url} target="_blank" rel="noreferrer"
               style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {d.url.replace('https://', '')} <span style={{ opacity: 0.6 }}>↗</span>
            </a>
          )}
        </div>
        <PromptPill label="ask agent" />
      </div>

      <ROBanner>
        Logs and status stream live, but mutations go through the agent. <strong>Common prompts:</strong> redeploy · rollback · stop · update env-vars · scale replicas.
      </ROBanner>

      <ContractBanner kind="blocked" badge="🔒 blocked">
        <strong>Redeploy / Rollback / Stop are partially wired.</strong> <code>POST /api/v1/stacks/:slug/redeploy</code> routes to the agent API. Rollback and Stop don't exist on the agent API yet.
      </ContractBanner>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {(t === 'Logs') && <span className="tag">live</span>}
            {(t === 'Resources') && <span className="tag">3</span>}
            {(t === 'Metrics' || t === 'Audit') && <span className="tag">blocked</span>}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <Overview d={d} />}
      {tab === 'Logs' && <LiveBuild d={d} />}
      {tab === 'Env vars' && <EnvVars />}
      {tab === 'Resources' && <BoundResources />}
      {(tab === 'Metrics' || tab === 'Audit') && (
        <ContractBanner kind="blocked" badge="🔒 blocked">
          <strong>{tab} tab unbuilt.</strong> See Contracts page for proposed shape.
        </ContractBanner>
      )}

      {canUseCustomDomains
        ? <CustomDomainPanel stackSlug={d.slug} />
        : <CustomDomainUpsell />}
    </>
  )
}

// ─── Tier-gated upsell shown to hobby/anonymous users ─────────────────────
// Pro+ tier gets the full CustomDomainPanel. Everyone else sees this small
// card with a link into the in-app billing flow.
function CustomDomainUpsell() {
  return (
    <section className="card" style={{ padding: '14px 18px', marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text)' }}>
          <strong style={{ fontWeight: 500 }}>Custom domains</strong>{' '}
          <span style={{ color: 'var(--text-dim)' }}>
            are a Pro feature. Bring your own hostname (e.g. <code>app.acme.com</code>) and
            keep your free <code>*.deployment.instanode.dev</code> URL alongside it.
          </span>
        </div>
      </div>
      <a href={BILLING_PATH} className="btn btn-primary btn-sm">Upgrade →</a>
    </section>
  )
}

function Overview({ d }: { d: DashboardStack }) {
  return (
    <>
      <LiveBuild d={d} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, margin: '24px 0' }}>
        <PromptCard
          title="Redeploy"
          prompt={<>Redeploy <em>{d.name}</em> from the latest commit</>}
          method="POST"
          endpoint={`/stacks/${d.slug}/redeploy`}
        />
        <PromptCard
          title="Rollback"
          prompt={<>Roll <em>{d.name}</em> back to the last healthy build</>}
          method="POST"
          endpoint={`/stacks/${d.slug}/rollback`}
        />
        <PromptCard
          danger
          title="Stop"
          prompt={<>Stop the <em>{d.name}</em> deployment</>}
          method="POST"
          endpoint={`/stacks/${d.slug}/stop`}
        />
      </div>
    </>
  )
}

function LiveBuild({ d }: { d: DashboardStack }) {
  const [logs, setLogs] = useState<string[]>([])
  const [streamState, setStreamState] = useState<StreamState>('connecting')
  const logBoxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!d.slug) return
    setLogs([])
    setStreamState('connecting')
    // The dashboard works on stacks (DashboardStack); the matching SSE endpoint
    // is /api/v1/stacks/:slug/logs/:svc. Single-container `/deploy/:id/logs`
    // can be wired separately when that surface gets its own page.
    const path = `/api/v1/stacks/${encodeURIComponent(d.slug)}/logs/${STACK_LOG_SERVICE}`
    let everOpened = false
    const cleanup = streamSSE(path, {
      onLine: (line) => {
        everOpened = true
        setStreamState('open')
        if (line === LOG_END_SENTINEL) return
        setLogs((prev) => prev.concat(line).slice(-LOG_BUFFER_MAX_LINES))
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.warn('logs stream error', err)
        setStreamState(everOpened ? 'closed' : 'error')
      },
      onClose: () => setStreamState((s) => (s === 'error' ? 'error' : 'closed')),
    })
    return cleanup
  }, [d.slug])

  // Autoscroll lock: only snap to bottom when the user is already near the
  // bottom — keeps scrolled-up reading position stable.
  useEffect(() => {
    const box = logBoxRef.current
    if (!box) return
    const nearBottom = box.scrollHeight - (box.scrollTop + box.clientHeight) < AUTOSCROLL_NEAR_BOTTOM_PX
    if (nearBottom) box.scrollTop = box.scrollHeight
  }, [logs])

  return (
    <div className="build-frame">
      <div className="build-main">
        <div className="phases">
          <span className="phase done">queued</span>
          <span className="phase-sep">─</span>
          <span className="phase done">cloning</span>
          <span className="phase-sep">─</span>
          <span className={`phase ${d.status === 'building' ? 'cur' : 'done'}`}>building</span>
          <span className="phase-sep">─</span>
          <span className={`phase ${d.status === 'running' ? 'done' : 'next'}`}>pushing</span>
          <span className="phase-sep">─</span>
          <span className={`phase ${d.status === 'running' ? 'done' : 'next'}`}>rolling</span>
          {d.status === 'running' && (
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
              ✓ live · {d.build_duration_s ?? 38}s
            </span>
          )}
        </div>
        <div ref={logBoxRef} className="logs">
          {logs.length === 0 && streamState === 'connecting' && (
            <div className="row"><span className="msg" style={{ color: 'var(--text-faint)' }}>connecting to log stream…</span></div>
          )}
          {logs.length === 0 && streamState === 'error' && (
            <div className="row"><span className="msg" style={{ color: 'var(--text-faint)' }}>log stream not available — the deploy may be too old or the build may not be running.</span></div>
          )}
          {logs.length === 0 && streamState === 'closed' && (
            <div className="row"><span className="msg" style={{ color: 'var(--text-faint)' }}>no logs yet — waiting for the first build line.</span></div>
          )}
          {logs.map((l, i) => (
            <div key={i} className="row">
              <span className="msg">{l}</span>
            </div>
          ))}
        </div>
        <div className="logs-foot">
          {streamState === 'open' && <span className="live-pill">live</span>}
          <span>
            {streamState === 'open' && `streaming · ${logs.length} lines`}
            {streamState === 'connecting' && 'connecting…'}
            {streamState === 'closed' && `stream closed · ${logs.length} lines`}
            {streamState === 'error' && 'stream unavailable'}
          </span>
          <span style={{ marginLeft: 'auto' }}>↓ jump to live</span>
        </div>
      </div>
      <aside className="build-side">
        <SideKv title="build" rows={[
          ['started', '14:42:01'], ['duration', d.status === 'running' ? `${d.build_duration_s ?? 38}s` : 'in progress'],
          ['image', '142 MB'], ['exit', d.status === 'running' ? '0' : '—']
        ]} />
        <SideKv title="runtime" rows={[
          ['replicas', '2'], ['memory', '512 MB'], ['cpu', '2 vCPU'], ['port', '3000'], ['region', 'iad-1']
        ]} />
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>commit</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)', lineHeight: 1.7 }}>
            <div style={{ color: 'var(--text-dim)' }}>a31fc8de</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.45 }}>
              "add staging env support &amp; tags column"
            </div>
            <div style={{ marginTop: 6, color: 'var(--text-faint)' }}>marcus · 12m ago</div>
          </div>
        </div>
      </aside>
    </div>
  )
}

function SideKv({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)', lineHeight: 1.7 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-faint)' }}>{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EnvVars() {
  return (
    <>
      <h3 style={{ fontSize: 14, margin: '16px 0 12px', color: 'var(--text)', fontWeight: 500 }}>
        Env vars · 4 · last edit triggered redeploy 12m ago
      </h3>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--ink)' }}>
        <div className="env-row head">
          <span>key</span>
          <span>value</span>
          <span>source</span>
          <span></span>
        </div>
        <div className="env-row">
          <span className="key">DATABASE_URL</span>
          <span className="val">postgres://usr_xY9z2…@db.instanode.dev:5432/d_xY9z2k7m</span>
          <span className="src-pill inline">inline</span>
          <button className="res-action">⋯</button>
        </div>
        <div className="env-row from-vault">
          <span className="key">STRIPE_SECRET_KEY</span>
          <span className="val vault">⚷ vault://prod/STRIPE_SECRET_KEY</span>
          <span className="src-pill vault">vault</span>
          <button className="res-action">⋯</button>
        </div>
        <div className="env-row from-vault">
          <span className="key">OPENAI_API_KEY</span>
          <span className="val vault">⚷ vault://prod/OPENAI_API_KEY</span>
          <span className="src-pill vault">vault</span>
          <button className="res-action">⋯</button>
        </div>
        <div className="env-row">
          <span className="key">NODE_ENV</span>
          <span className="val">production</span>
          <span className="src-pill inline">inline</span>
          <button className="res-action">⋯</button>
        </div>
      </div>
    </>
  )
}

function BoundResources() {
  return (
    <div style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13 }}>
      Resources bound to this deployment — flashcards-db, cache-sessions, render-queue. (mocked)
    </div>
  )
}
