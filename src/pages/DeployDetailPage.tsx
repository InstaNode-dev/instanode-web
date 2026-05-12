import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ROBanner, ContractBanner, EnvPill, StatusPill, TierPill, ResourceIcon, PromptCard
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

// Tiers that have access to multi-env workflows (stack promotion + vault
// copy). Matches the API-side allowlist in handlers/stack.go:
// multiEnvTierAllowed — anything outside this set gets 402 + agent_action
// from POST /api/v1/stacks/:slug/promote and POST /api/v1/vault/copy.
//
// Hobby is intentionally excluded: multi-env is the differentiator that
// justifies the Pro tier (RETRO-2026-05-12 §4 / §10.17).
const MULTI_ENV_TIERS: ReadonlySet<Tier> = new Set(['pro', 'team', 'growth'])

// Target env the "Promote staging → production" PromptCard defaults to.
// Matches the convention in the vault env-allowlist and the API-side
// `validatePromoteEnv` helper.
const PROMOTE_DEFAULT_TARGET = 'production'

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
      </div>

      <ROBanner>
        Logs and status stream live, but mutations go through the agent. <strong>Common prompts:</strong> redeploy · rollback · stop · update env-vars · scale replicas.
      </ROBanner>


      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {(t === 'Logs') && <span className="tag">live</span>}
            {(t === 'Metrics' || t === 'Audit') && <span className="tag">blocked</span>}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <Overview d={d} tier={tier} />}
      {tab === 'Logs' && <LiveBuild d={d} />}
      {tab === 'Env vars' && <EnvVars />}
      {tab === 'Resources' && <BoundResources />}
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

function Overview({ d, tier }: { d: DashboardStack; tier: Tier }) {
  // Pro+ unlocks multi-env workflows. Hobby / anonymous see the upsell card
  // — the API enforces the same gate with a 402 + agent_action, so the UI
  // tier check stays in sync with server policy by design.
  const canPromote = MULTI_ENV_TIERS.has(tier)
  // Determine sensible from/to defaults for the Promote prompt. If the
  // current stack is already production, suggest promoting INTO it from
  // staging; otherwise suggest promoting the current env → production.
  const fromEnv = d.env === PROMOTE_DEFAULT_TARGET ? 'staging' : (d.env || 'staging')
  const toEnv  = d.env === PROMOTE_DEFAULT_TARGET ? d.env : PROMOTE_DEFAULT_TARGET
  return (
    <>
      <LiveBuild d={d} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, margin: '24px 0' }}>
        <PromptCard
          title="Redeploy"
          prompt={
            <>
              Redeploy <em>{d.name}</em> (stack <code>{d.slug}</code>) from the latest commit on
              the configured branch.
            </>
          }
          promptText={
            `Redeploy my instanode stack "${d.name}" from the latest commit.\n` +
            `\n` +
            `- Stack slug: ${d.slug}\n` +
            `- Endpoint: POST https://api.instanode.dev/api/v1/stacks/${d.slug}/redeploy\n` +
            `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
            `\n` +
            `The build pulls HEAD of the configured branch, rebuilds the container, and rolls out with zero downtime. Stream build logs from GET /api/v1/stacks/${d.slug}/logs/:svc if you want to watch it.`
          }
          method="POST"
          endpoint={`/api/v1/stacks/${d.slug}/redeploy`}
        />
        <PromptCard
          title="Rollback"
          prompt={
            <>
              Roll <em>{d.name}</em> back to the last healthy build. Existing
              connections drain over ~10 seconds.
            </>
          }
          promptText={
            `Roll my instanode stack "${d.name}" back to the last healthy build.\n` +
            `\n` +
            `- Stack slug: ${d.slug}\n` +
            `- Endpoint: POST https://api.instanode.dev/api/v1/stacks/${d.slug}/rollback\n` +
            `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
            `\n` +
            `Rollback switches the active deployment back to the previous successful build. Existing in-flight requests drain over ~10 seconds before the old container is stopped. No data loss — only the application binary changes.`
          }
          method="POST"
          endpoint={`/api/v1/stacks/${d.slug}/rollback`}
        />
        <PromptCard
          danger
          title="Stop"
          prompt={
            <>
              Stop the <em>{d.name}</em> deployment. Resources (db, cache, storage) stay claimed —
              only the app container is removed.
            </>
          }
          promptText={
            `Stop my instanode deployment "${d.name}".\n` +
            `\n` +
            `- Stack slug: ${d.slug}\n` +
            `- Endpoint: POST https://api.instanode.dev/api/v1/stacks/${d.slug}/stop\n` +
            `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
            `\n` +
            `This terminates the app container. The attached resources (Postgres, Redis, Mongo, storage, webhooks) remain claimed and reachable via their connection_urls — only the running app goes away. To bring it back up, redeploy from the latest commit.`
          }
          method="POST"
          endpoint={`/api/v1/stacks/${d.slug}/stop`}
        />
      </div>

      {/* Environments section — Pro+ feature. Promote one env to another.
          For non-Pro tiers, render an inline upsell that mirrors the
          custom-domains pattern. */}
      <section style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', margin: 0 }}>
            Environments
          </h3>
          <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            production · staging · dev
          </span>
          {canPromote && (
            <span className="tag" style={{ marginLeft: 'auto' }}>pro</span>
          )}
        </div>

        {canPromote ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PromptCard
              title={`Promote ${fromEnv} → ${toEnv}`}
              prompt={
                <>
                  Promote the <em>{d.name}</em> stack from <code>{fromEnv}</code> to{' '}
                  <code>{toEnv}</code>. Config (image, env-var bindings, resource
                  bindings) is copied to the target env.
                </>
              }
              promptText={
                `Promote my instanode stack "${d.name}" from ${fromEnv} to ${toEnv}.\n` +
                `\n` +
                `- Source stack slug: ${d.slug}\n` +
                `- Endpoint: POST https://api.instanode.dev/api/v1/stacks/${d.slug}/promote\n` +
                `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
                `- Body: {"from":"${fromEnv}","to":"${toEnv}"}\n` +
                `\n` +
                `The promote endpoint copies the stack's config (image binding, resource bindings, name) to a sibling stack in the target env. If the target env already has a sibling, its status is reset to "building" (in-place re-promote); otherwise a new stack row is created with parent_stack_id pointing at the source. Poll GET /stacks/<new-slug> for status. Returns 402 with agent_action on free / hobby tiers.`
              }
              method="POST"
              endpoint={`/api/v1/stacks/${d.slug}/promote`}
            />
            <PromptCard
              title={`Copy vault secrets ${fromEnv} → ${toEnv}`}
              prompt={
                <>
                  Bulk-copy vault entries from <code>{fromEnv}</code> to{' '}
                  <code>{toEnv}</code>. Default: skip existing keys. Use{' '}
                  <code>dry_run:true</code> to preview the plan first.
                </>
              }
              promptText={
                `Copy my instanode vault secrets from ${fromEnv} to ${toEnv}.\n` +
                `\n` +
                `- Endpoint: POST https://api.instanode.dev/api/v1/vault/copy\n` +
                `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
                `- Body: {"from":"${fromEnv}","to":"${toEnv}","dry_run":true}\n` +
                `\n` +
                `Set dry_run=true to preview the per-key plan (copy / overwrite / skip / missing / quota_exceeded). Drop it to actually persist. Use {"overwrite": true} to bump existing target-env keys to a new version. Pro / Team only — returns 402 with agent_action otherwise.`
              }
              method="POST"
              endpoint={`/api/v1/vault/copy`}
            />
          </div>
        ) : (
          <PromoteUpsell />
        )}
      </section>
    </>
  )
}

// Tier-gated upsell shown to hobby / anonymous users on the Environments
// section. Mirrors CustomDomainUpsell so the visual style stays consistent.
function PromoteUpsell() {
  return (
    <section className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text)' }}>
          <strong style={{ fontWeight: 500 }}>Multi-env workflows</strong>{' '}
          <span style={{ color: 'var(--text-dim)' }}>
            (promote staging → production · bulk-copy vault secrets between envs)
            ship with Pro. Hobby is single-env (production only).
          </span>
        </div>
      </div>
      <a href={BILLING_PATH} className="btn btn-primary btn-sm">Upgrade to Pro →</a>
    </section>
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
              ✓ live{d.build_duration_s != null ? ` · ${d.build_duration_s}s` : ''}
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
        <SideKv
          title="build"
          rows={[
            [
              'duration',
              d.build_duration_s != null
                ? `${d.build_duration_s}s`
                : d.status === 'building'
                ? 'in progress'
                : '—',
            ],
            ['status', d.status],
          ]}
        />
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
    <div style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}>
      <strong style={{ color: 'var(--text)', fontWeight: 500 }}>No env vars to show yet.</strong>
      <div style={{ marginTop: 8 }}>
        Env vars come from your Dockerfile + the vault. View them with{' '}
        <code>kubectl get deploy &lt;name&gt; -o yaml</code>. A per-deploy{' '}
        <code>/env</code> endpoint ships in Phase 1.
      </div>
    </div>
  )
}

function BoundResources() {
  return (
    <div style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}>
      <strong style={{ color: 'var(--text)', fontWeight: 500 }}>No bound resources to show yet.</strong>
      <div style={{ marginTop: 8 }}>
        Resources are bound at deploy time. List them via{' '}
        <code>GET /api/v1/stacks/:slug</code> once the endpoint is live.
      </div>
    </div>
  )
}
