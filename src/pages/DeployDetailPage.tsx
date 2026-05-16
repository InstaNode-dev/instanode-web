import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ROBanner, ContractBanner, EnvPill, StatusPill, TierPill, ResourceIcon, PromptCard, RelTime,
  displayName, isUnnamed
} from '../components/Common'
import { AuditPanel } from '../components/AuditPanel'
import { CustomDomainPanel } from '../components/CustomDomainPanel'
import { UpgradePromptCard } from '../components/UpgradePromptCard'
import { IpAllowList } from '../components/IpAllowList'
import { TtlBadge } from '../components/TtlBadge'
import { useDashboardCtx } from '../hooks/useDashboardCtx'
import * as api from '../api'
import type { DashboardStack, DashboardDeployment, Tier, StackFamilyMember } from '../api'
import { streamSSE } from '../lib/sseStream'

// Tiers that can edit a deployment's private state. Same set as on
// DeploymentsPage's configurator — the API enforces this with a 402 +
// agent_action on PATCH /api/v1/deployments/:id.
const PRIVATE_DEPLOY_EDIT_TIERS: ReadonlySet<Tier> = new Set(['pro', 'team', 'growth'])

// Tiers that have access to custom domains. Anonymous and hobby see an
// upsell card; everyone else sees the live panel. Source of truth: the
// /api/v1/stacks/:slug/domains endpoint returns 402 upgrade_required
// for anything outside this set.
//
// FIX-U11 (W11): hobby_plus has features.custom_domains: true in
// api/plans.yaml — the api unlocks it, the dashboard must mirror or
// hobby_plus users see the upsell card instead of the real panel.
const CUSTOM_DOMAIN_TIERS: ReadonlySet<Tier> = new Set(['hobby_plus', 'pro', 'team', 'growth'])

// Tiers that have access to multi-env workflows (stack promotion + vault
// copy). Matches the API-side allowlist in handlers/stack.go:
// multiEnvTierAllowed — anything outside this set gets 402 + agent_action
// from POST /api/v1/stacks/:slug/promote and POST /api/v1/vault/copy.
//
// FIX-A6 / FIX-Q23 (W11): hobby_plus is now multi-env-enabled because
// plans.yaml gives it vault_envs_allowed: [development, staging,
// production]. The dashboard must match the api's allowlist or hobby_plus
// users see the upsell instead of the live promote/copy flow.
const MULTI_ENV_TIERS: ReadonlySet<Tier> = new Set(['hobby_plus', 'pro', 'team', 'growth'])

// Target env the "Promote staging → production" PromptCard defaults to.
// Matches the convention in the vault env-allowlist and the API-side
// `validatePromoteEnv` helper.
const PROMOTE_DEFAULT_TARGET = 'production'

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

// View-model wrapping the two backing surfaces. The same DeployDetailPage
// renders both single-container `/deploy/new` deployments and legacy
// multi-service `/stacks/new` stacks; the kind discriminator lets the
// page route around the differences (log SSE URL, env vars source,
// bound resources source) without duplicating the chrome.
type DeployView =
  | {
      kind: 'deployment'
      id: string
      /** May be null for legacy deployments — the chrome renders
       *  `(unnamed deploy)` via displayName() and keeps app_id as the
       *  muted secondary identifier. */
      name: string | null
      status: DashboardDeployment['status']
      env: DashboardDeployment['env']
      tier: DashboardDeployment['tier']
      url: string | null
      env_vars: Record<string, string>
      resource_id?: string
      build_duration_s?: number
      last_deploy_at?: string
      // Slug for the (currently disabled) CustomDomainPanel — deployments
      // don't have a stack slug, so we surface the app_id and the panel
      // is hidden in render.
      slug: string
      // Track B (private deploys): the privacy state surfaced on the
      // Overview tab. Older API builds omit these fields entirely; the
      // adapter defaults them to false / [] so the UI never silently
      // inherits state from a stale payload.
      private: boolean
      allowed_ips: string[]
      // Wave FIX-J: the full deployment payload kept around so the
      // TtlBadge banner can render the lifecycle countdown + Make
      // Permanent button without rebuilding a DashboardDeployment shape.
      raw: DashboardDeployment
    }
  | {
      kind: 'stack'
      data: DashboardStack
    }

export function DeployDetailPage() {
  const { id } = useParams()
  const [view, setView] = useState<DeployView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('Overview')
  const ctx = useDashboardCtx()
  const tier = (ctx.me?.user.tier ?? 'anonymous') as Tier
  const canUseCustomDomains = CUSTOM_DOMAIN_TIERS.has(tier)

  // Detect /deploy/new deployments first; fall back to legacy /stacks/new
  // multi-service deploys. Both render through the same page chrome — the
  // discriminated union below routes the panels to the right data source.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoaded(false)
    ;(async () => {
      try {
        const r = await api.getDeployment(id)
        if (cancelled) return
        if (r.deployment) {
          const d = r.deployment
          setView({
            kind: 'deployment',
            id: d.id,
            name: d.name,
            status: d.status,
            env: d.env,
            tier: d.tier,
            url: d.url,
            env_vars: d.env_vars,
            resource_id: d.resource_id,
            build_duration_s: d.build_duration_s,
            last_deploy_at: d.last_deploy_at,
            slug: d.app_id,
            private: d.private ?? false,
            allowed_ips: d.allowed_ips ?? [],
            raw: d,
          })
          setLoaded(true)
          return
        }
      } catch {
        /* fall through to stack lookup */
      }
      // Fall back to listStacks() for legacy multi-service deploys. The
      // dashboard surface keeps supporting both paths so users mid-
      // migration don't lose access to their stack-mode deploys.
      try {
        const r = await api.listStacks()
        if (cancelled) return
        const stack = r.items.find((s) => s.id === id) ?? null
        if (stack) {
          setView({ kind: 'stack', data: stack })
        } else {
          setView(null)
        }
      } catch {
        if (!cancelled) setView(null)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (!loaded || !view) return <div className="skel" style={{ width: '100%', height: 320 }} />

  // Raw (possibly empty / null) name straight off the backing surface —
  // used to drive the `(unnamed deploy)` fallback + italic muted styling.
  const rawName = view.kind === 'stack' ? view.data.name : view.name
  const nameUnnamed = isUnnamed(rawName)
  // Human-readable label: the name when present, else `(unnamed deploy)`.
  const label = displayName(rawName, 'deploy')

  // Project the discriminated view into the flat fields the chrome
  // already consumes. The Overview / EnvVars / Resources / log panels
  // below switch on `view.kind` to pick the right data source. `name` is
  // projected through displayName() so every PromptCard interpolation
  // reads a real label rather than a blank string for legacy deploys.
  const d: DashboardStack =
    view.kind === 'stack'
      ? { ...view.data, name: label }
      : ({
          id: view.id,
          slug: view.slug,
          name: label,
          // 'deploying' is mapped through StatusPill (renders like
          // 'building'); 'healthy' stays as 'running' in shared chrome.
          status: (view.status === 'deploying'
            ? 'building'
            : view.status === 'healthy'
            ? 'running'
            : (view.status as DashboardStack['status'])),
          url: view.url,
          created_at: '',
          team_id: '',
          env: view.env,
          tier: view.tier,
          build_duration_s: view.build_duration_s,
          last_deploy_at: view.last_deploy_at,
        } as DashboardStack)

  return (
    <>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <ResourceIcon type="deploy" size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2
              data-testid="deploy-detail-name"
              style={{
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                ...(nameUnnamed ? { fontStyle: 'italic', color: 'var(--text-dim)' } : {}),
              }}
            >
              {d.name}
            </h2>
            <StatusPill status={d.status} />
            <EnvPill env={d.env} />
            <TierPill tier={d.tier} />
            {view.kind === 'deployment' && view.private && (
              <span
                data-testid="privacy-badge"
                className="tag"
                title={`IP allow-list: ${view.allowed_ips.length} entr${view.allowed_ips.length === 1 ? 'y' : 'ies'}`}
                style={{ background: 'rgba(255,200,80,0.08)', color: 'var(--text)' }}
              >
                private
              </span>
            )}
          </div>
          {d.url && (
            <a href={d.url} target="_blank" rel="noreferrer"
               style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {d.url.replace('https://', '')} <span style={{ opacity: 0.6 }}>↗</span>
            </a>
          )}
          {/* Muted secondary identifier — app_id (deployment) or stack slug.
              Users still need it to reference the deploy in agent prompts,
              so it stays visible but de-emphasised below the name + URL. */}
          <div
            data-testid="deploy-detail-id"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}
          >
            {view.kind === 'deployment' ? view.slug : view.data.slug}
          </div>
        </div>
      </div>

      <ROBanner>
        Logs and status stream live, but mutations go through the agent. <strong>Common prompts:</strong> redeploy · rollback · stop · update env-vars · scale replicas.
      </ROBanner>

      {/* Wave FIX-J: TTL banner. Shows the auto-expire countdown + a
          single Keep button on auto_24h / custom deploys; renders nothing
          on permanent deploys. Lives above the tab content so the user
          can't navigate away without seeing the countdown. */}
      {view.kind === 'deployment' && (
        <TtlBadge
          deployment={view.raw}
          variant="banner"
          onPermanent={(updated) => {
            // Replace the local raw payload so the banner re-renders as
            // "Permanent" without a refetch. setView triggers a re-render.
            setView({ ...view, raw: updated })
          }}
        />
      )}


      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {(t === 'Logs') && <span className="tag">live</span>}
            {/* W12 H12: Metrics tab still ships as a soft "soon" surface
                because deploy-specific metrics live behind a design
                review. Audit now renders the real AuditPanel — drop the
                stale "blocked" tag so users aren't told a working surface
                is unavailable. */}
            {t === 'Metrics' && <span className="tag">soon</span>}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <Overview d={d} tier={tier} view={view} />}
      {tab === 'Logs' && <LiveBuild d={d} view={view} />}
      {tab === 'Env vars' && <EnvVars view={view} />}
      {tab === 'Resources' && <BoundResources view={view} />}
      {tab === 'Metrics' && <DeployMetricsEmpty view={view} />}
      {tab === 'Audit' && <DeployAudit view={view} /> }
      {/* Custom domains panel is stack-scoped; deployments don't expose a
          stack slug. Hide the panel entirely for deployment view; legacy
          stacks keep the tier-gated panel/upsell pair. */}
      {view.kind === 'stack' && (canUseCustomDomains
        ? <CustomDomainPanel stackSlug={view.data.slug} />
        : <CustomDomainUpsell />)}
    </>
  )
}

// ─── Tier-gated upsell shown to hobby/anonymous users ─────────────────────
// Pro+ tier gets the full CustomDomainPanel. Everyone else sees the
// feature-specific UpgradePromptCard (Track U2). Copy lives in
// src/components/upgradeCopy.ts.
function CustomDomainUpsell() {
  return (
    <div style={{ marginTop: 24 }}>
      <UpgradePromptCard feature="custom_domain" />
    </div>
  )
}

function Overview({ d, tier, view }: { d: DashboardStack; tier: Tier; view: DeployView }) {
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
      <LiveBuild d={d} view={view} />
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

      {/* Environments section — Pro+ feature. Renders a live grid of every
          env-sibling of the current stack (production · staging · dev) above
          the Promote / Copy-vault prompt cards. For non-Pro tiers, render an
          inline upsell that mirrors the custom-domains pattern. */}
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
          <>
            <EnvironmentsGrid slug={d.slug} stackName={d.name} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
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
          </>
        ) : (
          <PromoteUpsell />
        )}
      </section>

      {/* Privacy panel — only renders for /deploy/new deployments (stacks
          don't yet have a privacy state). Always shows the deploy's
          private flag + allowed_ips; the inline editor is gated on Pro+
          and a feature flag because Track A's PATCH endpoint is still in
          flight. */}
      {view.kind === 'deployment' && (
        <PrivacyPanel view={view} tier={tier} />
      )}
    </>
  )
}

// Tier-gated panel that renders the deploy's privacy state (public vs
// private + allowed_ips list). On Pro+ tiers it also exposes an inline
// editor backed by updateDeploymentAccess() — but the editor stays
// read-only until Track A ships PATCH /api/v1/deployments/:id. We detect
// "not yet shipped" via a 404 on submit and surface an honest hint
// instead of pretending the change landed.
function PrivacyPanel({
  view,
  tier,
}: {
  view: Extract<DeployView, { kind: 'deployment' }>
  tier: Tier
}) {
  const canEdit = PRIVATE_DEPLOY_EDIT_TIERS.has(tier)
  // Editable local state; resets whenever the upstream view changes (the
  // detail page re-loads on id change, which produces a new view object).
  const [editing, setEditing] = useState(false)
  const [draftPrivate, setDraftPrivate] = useState(view.private)
  const [draftIps, setDraftIps] = useState<string[]>(view.allowed_ips)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const [submitOk, setSubmitOk] = useState(false)

  function startEdit() {
    setDraftPrivate(view.private)
    setDraftIps(view.allowed_ips)
    setSubmitErr(null)
    setSubmitOk(false)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setSubmitErr(null)
  }
  async function save() {
    setSubmitting(true)
    setSubmitErr(null)
    setSubmitOk(false)
    try {
      await api.updateDeploymentAccess(view.id, draftPrivate, draftIps)
      setSubmitOk(true)
      setEditing(false)
    } catch (e: any) {
      // 404 here means Track A hasn't shipped PATCH yet — surface the
      // friendly "edits pending backend" copy rather than a raw error.
      if (e?.status === 404) {
        setSubmitErr(
          'Editing access settings requires the backend PATCH endpoint, which is still rolling out. Ask your agent to redeploy with the updated allow-list for now.',
        )
      } else if (e?.status === 402) {
        setSubmitErr('Your plan does not include private deploys. Upgrade to Pro.')
      } else {
        setSubmitErr(e?.message ?? 'Failed to update access settings.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section data-testid="privacy-panel" style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', margin: 0 }}>
          Access
        </h3>
        <span
          data-testid="privacy-state"
          style={{
            fontSize: 11.5,
            color: view.private ? 'var(--text)' : 'var(--text-faint)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {view.private
            ? `private · ${view.allowed_ips.length} IP${view.allowed_ips.length === 1 ? '' : 's'} allowed`
            : 'public'}
        </span>
        {canEdit && !editing && (
          <button
            data-testid="privacy-edit-btn"
            className="cp"
            onClick={startEdit}
            style={{ marginLeft: 'auto' }}
          >
            edit
          </button>
        )}
      </div>

      {!editing && (
        <div className="card" style={{ padding: 14 }}>
          {view.private ? (
            view.allowed_ips.length > 0 ? (
              <IpAllowList
                value={view.allowed_ips}
                onChange={() => {
                  /* read-only display in non-edit mode */
                }}
                disabled
              />
            ) : (
              <div
                data-testid="privacy-empty-allowlist"
                style={{ fontSize: 12.5, color: 'var(--text-dim)' }}
              >
                Private deploy with an empty allow-list — no requests can reach
                the app. Edit the list to grant access.
              </div>
            )
          ) : (
            <div
              data-testid="privacy-public-hint"
              style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}
            >
              <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
                Public deploy.
              </strong>{' '}
              Anyone with the URL can reach this app.{' '}
              {canEdit
                ? 'Turn on Private below to gate it by an IP allow-list.'
                : 'Private deploys with IP allow-lists are a Pro feature.'}
            </div>
          )}
          {submitOk && (
            <div
              data-testid="privacy-save-ok"
              role="status"
              style={{
                marginTop: 10,
                fontSize: 11.5,
                color: 'var(--accent, #00e48e)',
              }}
            >
              Access settings updated.
            </div>
          )}
        </div>
      )}

      {editing && canEdit && (
        <div className="card" style={{ padding: 14 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              cursor: 'pointer',
              marginBottom: draftPrivate ? 14 : 0,
            }}
          >
            <input
              type="checkbox"
              data-testid="privacy-edit-private-toggle"
              checked={draftPrivate}
              onChange={(e) => setDraftPrivate(e.target.checked)}
            />
            <span>
              <strong style={{ fontWeight: 500 }}>Private deploy</strong>
              <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: 12 }}>
                Gate the deploy by an IP allow-list at the edge.
              </span>
            </span>
          </label>
          {draftPrivate && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--text-faint)',
                  marginBottom: 6,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                allowed_ips
              </div>
              <IpAllowList value={draftIps} onChange={setDraftIps} />
            </div>
          )}
          {submitErr && (
            <div
              data-testid="privacy-edit-error"
              role="alert"
              style={{
                marginBottom: 10,
                fontSize: 11.5,
                color: 'var(--red, #ff7a8a)',
                lineHeight: 1.5,
              }}
            >
              {submitErr}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="privacy-edit-save"
              className="cp"
              onClick={save}
              disabled={submitting || (draftPrivate && draftIps.length === 0)}
              title={
                draftPrivate && draftIps.length === 0
                  ? 'Add at least one IP/CIDR to enable private deploy'
                  : undefined
              }
            >
              {submitting ? 'saving…' : 'save'}
            </button>
            <button
              data-testid="privacy-edit-cancel"
              className="cp"
              onClick={cancelEdit}
              disabled={submitting}
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// Loading skeleton shown while fetchStackFamily is in flight. Matches the
// 3-tile production/staging/dev grid layout so the page doesn't reflow
// when data arrives.
function EnvironmentsGridSkeleton() {
  return (
    <div
      data-testid="env-grid-skeleton"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="skel" style={{ height: 96 }} />
      ))}
    </div>
  )
}

// Empty-state hint shown when the API returns ok=true but the family is
// empty. In practice we always include the root, so this only fires on
// degraded responses. Keeping the surface honest beats fabricating a tile.
function EnvironmentsGridEmpty() {
  return (
    <div
      data-testid="env-grid-empty"
      className="card"
      style={{ padding: '14px 18px', fontSize: 12.5, color: 'var(--text-dim)' }}
    >
      No env siblings yet. Use the Promote prompt below to ship this stack to
      another env.
    </div>
  )
}

// Live grid of every env-sibling for the current stack. Pro+ only —
// fetchStackFamily returns {ok:false, reason:'upgrade_required'} on hobby
// teams, in which case we collapse to nothing (the parent already shows
// PromoteUpsell). On 404/unknown we fail quietly to the same single-env
// fallback so we never block the page on a flaky family lookup.
//
// Exported (named) so the env-aware deployments test suite can drive it
// without booting the whole DeployDetailPage (which depends on SSE +
// react-router + useDashboardCtx). Internal-only API — pages should
// continue to use DeployDetailPage as the entry point.
export function EnvironmentsGrid({ slug, stackName }: { slug: string; stackName: string }) {
  const [members, setMembers] = useState<StackFamilyMember[] | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    setErrored(false)
    setMembers(null)
    api
      .fetchStackFamily(slug)
      .then((r) => {
        if (cancelled) return
        if (r.ok) {
          setMembers(r.family)
        } else {
          setErrored(true)
        }
      })
      .catch(() => {
        if (!cancelled) setErrored(true)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (errored) {
    // Silent failure — parent already renders PromptCards below this. The
    // grid is enrichment, not a hard requirement. We log to console for
    // dev visibility but never block the page.
    return null
  }
  if (members === null) return <EnvironmentsGridSkeleton />
  if (members.length === 0) return <EnvironmentsGridEmpty />

  return (
    <div
      data-testid="env-grid"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(members.length, 3)}, 1fr)`, gap: 12 }}
    >
      {members.map((m) => (
        <EnvironmentCard key={m.slug} member={m} stackName={stackName} />
      ))}
    </div>
  )
}

// Single env tile in the grid. Renders env pill + status + URL +
// last-deploy timestamp; non-root members get a "Promote from here"
// PromptCard inline so the agent prose stays adjacent to the source env.
function EnvironmentCard({ member, stackName }: { member: StackFamilyMember; stackName: string }) {
  const isRoot = member.is_root
  // Default promote target: anything that isn't production promotes UP to
  // production. The root (production) doesn't get a per-card promote prompt
  // — that's what the top-level Promote / vault-copy prompts cover.
  const promoteTarget = isRoot ? '' : 'production'
  return (
    <div className="card" data-testid={`env-card-${member.env}`} style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <EnvPill env={member.env} />
        <StatusPill status={member.status} />
        {isRoot && (
          <span
            className="tag"
            style={{ marginLeft: 'auto', fontSize: 9.5 }}
            title="The family root — every other env was promoted from this stack"
          >
            root
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-dim)',
          marginBottom: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={member.slug}
      >
        {member.slug}
      </div>
      {member.url ? (
        <a
          href={member.url}
          target="_blank"
          rel="noreferrer"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--blue)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {member.url.replace(/^https?:\/\//, '')} ↗
        </a>
      ) : (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
          no URL yet
        </div>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 8 }}>
        last deploy <RelTime at={member.last_deploy_at} />
      </div>
      {!isRoot && promoteTarget && (
        <div style={{ marginTop: 10 }}>
          <PromptCard
            title={`Promote ${member.env} → ${promoteTarget}`}
            prompt={
              <>
                Promote <em>{stackName}</em>'s <code>{member.env}</code> env to{' '}
                <code>{promoteTarget}</code>.
              </>
            }
            promptText={
              `Promote my instanode stack "${stackName}" from ${member.env} to ${promoteTarget}.\n` +
              `\n` +
              `- Source stack slug: ${member.slug}\n` +
              `- Endpoint: POST https://api.instanode.dev/api/v1/stacks/${member.slug}/promote\n` +
              `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
              `- Body: {"from":"${member.env}","to":"${promoteTarget}"}\n`
            }
            method="POST"
            endpoint={`/api/v1/stacks/${member.slug}/promote`}
          />
        </div>
      )}
    </div>
  )
}

// Tier-gated upsell shown to hobby / anonymous users on the Environments
// section. Delegates to UpgradePromptCard so the copy lives in one place
// (src/components/upgradeCopy.ts) and the CTA respects the P1 experiment
// variant attached to /auth/me. Track U2 (in-context upgrade prompts).
function PromoteUpsell() {
  return <UpgradePromptCard feature="family_bindings" />
}

function LiveBuild({ d, view }: { d: DashboardStack; view: DeployView }) {
  const [logs, setLogs] = useState<string[]>([])
  const [streamState, setStreamState] = useState<StreamState>('connecting')
  const logBoxRef = useRef<HTMLDivElement | null>(null)

  // Choose the right SSE endpoint for the surface we're rendering. The
  // single-container `/deploy/new` deployment stream lives under
  // GET /deploy/:id/logs (no service segment — there's only one
  // container per deployment). The agent API resolves `:id` against the
  // app_id column, so we use view.slug (= app_id for deployments) here,
  // never the UUID `view.id`. Legacy multi-service stacks keep using
  // /api/v1/stacks/:slug/logs/:svc with the canonical `web` service. We
  // re-compute the path on every view change so switching between deploy
  // and stack on the same id (browser back, etc.) re-subscribes.
  const ssePath = view.kind === 'deployment'
    ? `/deploy/${encodeURIComponent(view.slug)}/logs`
    : `/api/v1/stacks/${encodeURIComponent(view.data.slug)}/logs/${STACK_LOG_SERVICE}`

  useEffect(() => {
    if (!ssePath) return
    setLogs([])
    setStreamState('connecting')
    const path = ssePath
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
  }, [ssePath])

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

// Vault refs look like vault://env/KEY — the deploy injects the
// resolved value at run time. The pattern is anchored so values that
// merely contain the substring (e.g. a documentation example) don't
// accidentally light up the vault badge.
const VAULT_REF_RE = /^vault:\/\/(?:[a-zA-Z0-9_-]+\/)?[A-Z_][A-Z0-9_]*$/

// Lowercase UUID v1-v5. We use it to surface env_var values that look
// like resource tokens (the agent API returns resource IDs as UUIDs) so
// the BoundResources panel can link them.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ENV_VAR_MASK_DISPLAY is the placeholder shown in the value cell when a row
// is masked. Uses bullet characters so screen-readers narrate "masked" rather
// than reading a meaningless string.
const ENV_VAR_MASK_DISPLAY = '••••••••'

// ENV_VAR_REDACTED_SENTINEL is the value the API returns when it has already
// redacted a secret server-side (P0 fix in deploy_env_redact.go). When the
// API returns "***" we know the value is secret; the reveal toggle has
// nothing to show and is disabled.
const ENV_VAR_REDACTED_SENTINEL = '***'

// SECRET_KEY_FRAGMENTS — uppercase substrings that classify an env-var key
// as secret. Mirrors the server-side heuristic in deploy_env_redact.go so
// the two layers agree on which keys are sensitive.
const SECRET_KEY_FRAGMENTS = [
  'SECRET', 'PASSWORD', 'PASSWD', 'PWD', 'TOKEN', '_KEY', 'APIKEY',
] as const

// SECRET_KEY_SUFFIXES — uppercase suffixes that classify an env-var key as
// secret (mirrors deploy_env_redact.go).
const SECRET_KEY_SUFFIXES = ['URL', 'URI', 'DSN'] as const

// isSensitiveEnvKey returns true when the key matches the secret heuristic.
// Defence-in-depth layer 2: even if the API sends a plaintext value for a
// key that should be masked (e.g. during a rollout window or for manually-
// set inline keys that don't go through resource_bindings), the dashboard
// still hides it by default.
function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase()
  for (const frag of SECRET_KEY_FRAGMENTS) {
    if (upper.includes(frag)) return true
  }
  for (const suf of SECRET_KEY_SUFFIXES) {
    if (upper.endsWith(suf)) return true
  }
  return false
}

function EnvVars({ view }: { view: DeployView }) {
  // revealed tracks which env-var keys have had their value revealed via the
  // toggle button. Keyed by env-var key string; absent = masked.
  const [revealed, setReveal] = useState<Record<string, boolean>>({})

  // Stack view doesn't surface env_vars on the listStacks() payload yet;
  // keep the legacy hint for that path. Deployment view parses the real
  // env_vars map from the API response.
  if (view.kind !== 'deployment') {
    return (
      <div
        data-testid="env-vars-stack-hint"
        style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}
      >
        <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
          Env vars for stacks aren't surfaced here yet.
        </strong>
        <div style={{ marginTop: 8 }}>
          List them with <code>GET /api/v1/stacks/{view.data.slug}/env</code> once the endpoint ships.
        </div>
      </div>
    )
  }

  const entries = Object.entries(view.env_vars ?? {}).sort(([a], [b]) => a.localeCompare(b))

  if (entries.length === 0) {
    return (
      <div
        data-testid="env-vars-empty"
        style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}
      >
        <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
          No env vars set.
        </strong>
        <div style={{ marginTop: 8 }}>
          Update them with{' '}
          <code>PATCH /deploy/{view.slug}/env</code> and redeploy to apply.
        </div>
      </div>
    )
  }

  return (
    <div data-testid="env-vars-panel" style={{ padding: '12px 0' }}>
      <div className="table">
        <div
          className="table-row head"
          style={{ gridTemplateColumns: '240px 1fr 90px' }}
        >
          <span>key</span>
          <span>value</span>
          <span>source</span>
        </div>
        {entries.map(([k, v]) => {
          const isVaultRef = VAULT_REF_RE.test(v)
          // A value is already redacted server-side when the API returned "***".
          const isServerRedacted = v === ENV_VAR_REDACTED_SENTINEL
          // Mask by default when the key matches the secret heuristic OR the
          // API has already redacted the value. vault refs are excluded (they
          // have no embedded credentials and need to be readable for debugging).
          const shouldMaskByDefault = !isVaultRef && (isServerRedacted || isSensitiveEnvKey(k))
          const isCurrentlyRevealed = !!revealed[k]
          // A value can only be "revealed" when the API actually returned it
          // (i.e. not server-redacted). For server-redacted values the reveal
          // button is disabled — there is nothing to show.
          const canReveal = shouldMaskByDefault && !isServerRedacted

          const displayValue =
            shouldMaskByDefault && !isCurrentlyRevealed ? ENV_VAR_MASK_DISPLAY : v

          return (
            <div
              key={k}
              className="table-row"
              data-testid={`env-var-row-${k}`}
              style={{ gridTemplateColumns: '240px 1fr 90px', alignItems: 'center' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k}</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  color: 'var(--text-dim)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  // No title tooltip for masked/sensitive rows — avoids over-the-
                  // shoulder leak even when the reveal toggle is not clicked.
                }}
                // Only show the full value as a tooltip when the row is not
                // considered sensitive (e.g. NODE_ENV, PORT). For sensitive rows
                // the title is omitted or shows the masked placeholder.
                title={shouldMaskByDefault ? undefined : v}
                data-testid={`env-var-value-${k}`}
              >
                {displayValue}
              </span>
              {isVaultRef ? (
                <span
                  className="tag"
                  data-testid={`env-var-vault-badge-${k}`}
                  title="Resolved from the vault at deploy time"
                >
                  vault
                </span>
              ) : shouldMaskByDefault ? (
                // Reveal / hide toggle for sensitive non-vault rows.
                <button
                  data-testid={`env-var-reveal-${k}`}
                  disabled={!canReveal}
                  onClick={() =>
                    setReveal((prev) => ({ ...prev, [k]: !prev[k] }))
                  }
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: canReveal ? 'pointer' : 'default',
                    fontSize: 10.5,
                    color: canReveal ? 'var(--text-dim)' : 'var(--text-faint)',
                    padding: '2px 4px',
                  }}
                  title={
                    !canReveal
                      ? 'Value is redacted server-side — use the API or CLI to retrieve it'
                      : isCurrentlyRevealed
                        ? 'Hide value'
                        : 'Reveal value'
                  }
                  aria-label={isCurrentlyRevealed ? `Hide value for ${k}` : `Reveal value for ${k}`}
                >
                  {isCurrentlyRevealed ? 'hide' : 'reveal'}
                </button>
              ) : (
                <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>inline</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BoundResources({ view }: { view: DeployView }) {
  // Stack view: still no GET /api/v1/stacks/:slug detail endpoint exposing
  // bound resources. Keep the honest hint until that ships.
  if (view.kind !== 'stack') {
    return <DeploymentBoundResources view={view} />
  }
  return (
    <div
      data-testid="bound-resources-stack-hint"
      style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}
    >
      <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
        No bound resources to show yet.
      </strong>
      <div style={{ marginTop: 8 }}>
        Resources are bound at deploy time. List them via{' '}
        <code>GET /api/v1/stacks/{view.data.slug}</code> once the endpoint is live.
      </div>
    </div>
  )
}

function DeploymentBoundResources({
  view,
}: {
  view: Extract<DeployView, { kind: 'deployment' }>
}) {
  const [resources, setResources] = useState<Awaited<ReturnType<typeof api.listResources>>['items'] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listResources()
      .then((r) => {
        if (!cancelled) setResources(r.items)
      })
      .catch(() => {
        if (!cancelled) setResources([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Find env-var values that look like resource tokens. The matching
  // strategy is conservative: a value must be a UUID, AND that UUID must
  // appear in the user's listResources() response (matching by id OR by
  // the public token). This avoids fabricating "bound resource" rows for
  // arbitrary user UUIDs that happen to live in env_vars (e.g. a
  // STRIPE_CUSTOMER_ID).
  const bound: Array<{
    envVarKey: string
    resourceID: string
    resourceType: string
    name: string | null
  }> = []
  if (resources) {
    // Direct binding via resource_id field on the deployment.
    if (view.resource_id) {
      const r = resources.find((x) => x.id === view.resource_id || x.token === view.resource_id)
      if (r) {
        bound.push({
          envVarKey: '<resource_id>',
          resourceID: r.id,
          resourceType: r.resource_type,
          name: r.name,
        })
      }
    }
    for (const [k, v] of Object.entries(view.env_vars ?? {})) {
      if (!UUID_RE.test(v)) continue
      const r = resources.find((x) => x.id === v || x.token === v)
      if (!r) continue
      // De-dupe if the same resource was already added via resource_id.
      if (bound.some((b) => b.resourceID === r.id)) continue
      bound.push({
        envVarKey: k,
        resourceID: r.id,
        resourceType: r.resource_type,
        name: r.name,
      })
    }
  }

  if (resources === null) {
    return (
      <div
        data-testid="bound-resources-loading"
        style={{ padding: 24 }}
      >
        <span className="skel" style={{ width: '60%', height: 18 }} />
      </div>
    )
  }

  if (bound.length === 0) {
    return (
      <div
        data-testid="bound-resources-empty"
        style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}
      >
        <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
          No bound resources detected.
        </strong>
        <div style={{ marginTop: 8 }}>
          Resources show up here when an env-var holds a UUID matching one
          of your resources, or when the deployment was created with a{' '}
          <code>resource_id</code>.
        </div>
      </div>
    )
  }

  return (
    <div data-testid="bound-resources-panel" style={{ padding: '12px 0' }}>
      <div className="table">
        <div
          className="table-row head"
          style={{ gridTemplateColumns: '160px 1fr 200px' }}
        >
          <span>env var</span>
          <span>resource</span>
          <span>id</span>
        </div>
        {bound.map((b) => (
          <Link
            key={`${b.envVarKey}-${b.resourceID}`}
            to={`/resources/${b.resourceID}`}
            className="table-row"
            data-testid={`bound-resource-row-${b.envVarKey}`}
            style={{
              gridTemplateColumns: '160px 1fr 200px',
              alignItems: 'center',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{b.envVarKey}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ResourceIcon type={b.resourceType as any} />
              <span style={isUnnamed(b.name) ? { fontStyle: 'italic', color: 'var(--text-dim)' } : undefined}>
                {displayName(b.name, b.resourceType)}
              </span>
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                color: 'var(--text-faint)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={b.resourceID}
            >
              {b.resourceID}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Metrics tab — empty state (W12 H12) ─────────────────────────────────
//
// Pre-W12 this tab rendered nothing — the tab header carried a "blocked"
// pill and clicking it surfaced an empty page body. Deploy-specific
// metrics are still in design (per-deploy CPU/mem/RPS aren't wired
// through to the dashboard yet), but pointing users at the per-resource
// metrics surface on /app/resources/:id is better than a blank screen.
//
// The empty state is intentionally honest: it states what's coming, what
// works today, and gives a deep link to the working surface. No fake
// charts. No mocked "your metrics will appear here once data is
// collected" hand-wave.
function DeployMetricsEmpty({ view }: { view: DeployView }) {
  // For deployments we know the resource_id (when the deployer bound one);
  // for legacy stacks we don't have a single resource to link to, so we
  // fall back to the general /app/resources list.
  const resourceLink =
    view.kind === 'deployment' && view.resource_id
      ? `/app/resources/${view.resource_id}`
      : '/app/resources'
  return (
    <div
      data-testid="deploy-metrics-empty"
      style={{
        padding: 24,
        color: 'var(--text-dim)',
        fontSize: 13,
        lineHeight: 1.7,
      }}
    >
      <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
        Deploy metrics coming soon.
      </strong>
      <div style={{ marginTop: 8 }}>
        Per-deploy CPU / memory / RPS panels are in design. In the
        meantime, per-resource metrics are already wired up — see{' '}
        <Link to={resourceLink} style={{ color: 'var(--blue)' }}>
          {resourceLink}
        </Link>
        .
      </div>
    </div>
  )
}

// ─── Audit tab (W12 H12) ─────────────────────────────────────────────────
//
// Pre-W12 the Audit tab rendered nothing. We now reuse the same
// AuditPanel that lives on ResourceDetailPage. For /deploy/new deployments
// we route the panel at the bound resource_id when one is set —
// resources are what the audit log actually tracks, so that's the row
// the user wants to see. When no resource is bound (legacy stack-mode
// deploys, or a deploy with no resource_id), we render an honest empty
// state pointing at the team-level audit log under /app/audit (currently
// surfaced via the Settings page).
function DeployAudit({ view }: { view: DeployView }) {
  // Stacks don't surface a bound resource_id — neither does a deployment
  // that wasn't created with one. Render the empty state instead of
  // calling AuditPanel with a fake/empty id.
  if (view.kind !== 'deployment' || !view.resource_id) {
    return (
      <div
        data-testid="deploy-audit-empty"
        style={{
          padding: 24,
          color: 'var(--text-dim)',
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
          No bound resource for this deploy.
        </strong>
        <div style={{ marginTop: 8 }}>
          The audit log scopes by resource. Bind a resource via{' '}
          <code>POST /deploy/new</code>'s <code>resource_id</code>{' '}
          parameter to see deploy-related audit events here, or use the
          team-wide audit query:{' '}
          <code>GET /api/v1/audit?resource_id=&lt;id&gt;</code>.
        </div>
      </div>
    )
  }
  return (
    <div data-testid="deploy-audit-panel" style={{ padding: '12px 0' }}>
      <AuditPanel resourceId={view.resource_id} />
    </div>
  )
}
