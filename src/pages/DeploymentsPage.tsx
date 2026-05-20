import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EnvPill, StatusPill, ResourceIcon, RelTime, PromptCard, displayName, isUnnamed
} from '../components/Common'
import { QuotaWallBanner } from '../components/QuotaWallBanner'
import { IpAllowList, IP_ALLOW_LIST_MAX } from '../components/IpAllowList'
import { UpgradePromptCard } from '../components/UpgradePromptCard'
import { TtlBadge } from '../components/TtlBadge'
import * as api from '../api'
import type { DashboardDeployment, Tier } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'
import { isRateLimited, retryAfterSeconds, formatRetryHint } from '../lib/retryHint'

// B7-P2 (2026-05-20): status filter + sort chips. The sidebar env switch
// already filters by env on the API side, but a Pro user with 10 deploys
// across {staging,prod} × {building,running,failed} couldn't quickly scan
// "show me only the failing ones in prod" without these client-side
// filters. Keep the surface light: no pagination needed at <=10 rows.
type StatusFilter = 'all' | 'running' | 'building' | 'failed' | 'expired'
const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'building', 'failed', 'expired']
type SortKey = 'recent' | 'name' | 'status'

// healthy/running collapse to the same "live" bucket. expired = TTL hit.
function statusBucket(s: DashboardDeployment['status']): StatusFilter {
  if (s === 'healthy' || s === 'running' || s === 'deploying') return 'running'
  if (s === 'building') return 'building'
  if (s === 'failed') return 'failed'
  if (s === 'expired' || s === 'stopped') return 'expired'
  return 'running'
}

// Tiers that can ship a private deploy (Track B). The agent API enforces
// the same gate via 402 + agent_action on POST /deploy/new — keeping the
// allowlist in lockstep keeps the UI from offering a feature the backend
// will reject.
const PRIVATE_DEPLOY_TIERS: ReadonlySet<Tier> = new Set(['pro', 'team', 'growth'])

// LoadError mirrors TeamPage's shape — the 429 retry-hint pattern is
// shared. A rate-limited or 5xx fetch must NOT collapse to "No deployments
// yet" (which mis-reports the platform state and erodes trust); we surface
// a real error banner instead and honor any Retry-After hint.
type LoadError = { message: string; rateLimited: boolean; retrySeconds: number | null }

export function DeploymentsPage() {
  const ctx = useDashboardCtx()
  const [items, setItems] = useState<DashboardDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [err, setErr] = useState<LoadError | null>(null)
  // T15 P2-3: Tier is a TEAM attribute (billing entity is the team, not
  // the individual user). All other pages — BillingPage, ResourcesPage,
  // VaultPage, OverviewPage, TeamPage, AppShell — read ctx.me?.team.tier.
  // Reading ctx.me?.user.tier here was a latent divergence: today
  // fetchMe() populates both fields from the same `me.tier`, so they
  // agree, but the moment the API splits per-user vs per-team tier the
  // private-deploy gate on this one page silently drifts.
  const tier = (ctx.me?.team?.tier ?? 'anonymous') as Tier
  const canUsePrivateDeploy = PRIVATE_DEPLOY_TIERS.has(tier)

  // Derived view: env is server-filtered (?env= query, see useEffect dep);
  // status + sort are client-side. statusBucket() collapses
  // healthy/running/deploying → 'running' so the user picks "live" without
  // worrying about which underlying status string is in flight.
  const visible = useMemo(() => {
    const filtered = statusFilter === 'all'
      ? items
      : items.filter((d) => statusBucket(d.status) === statusFilter)
    const sorted = [...filtered]
    if (sort === 'name') {
      sorted.sort((a, b) =>
        (a.name ?? a.app_id).localeCompare(b.name ?? b.app_id),
      )
    } else if (sort === 'status') {
      sorted.sort((a, b) => a.status.localeCompare(b.status))
    } else {
      // 'recent' — most recent last_deploy_at first; nulls last.
      sorted.sort((a, b) => {
        const ta = a.last_deploy_at ? Date.parse(a.last_deploy_at) : 0
        const tb = b.last_deploy_at ? Date.parse(b.last_deploy_at) : 0
        return tb - ta
      })
    }
    return sorted
  }, [items, statusFilter, sort])

  // Source of truth: GET /api/v1/deployments (single-container apps via
  // POST /deploy/new). The env switcher in the sidebar drives the ?env=
  // query param; switching envs triggers a refetch via the dep array.
  useEffect(() => {
    let cancelled = false
    setErr(null)
    setLoading(true)
    api
      .listDeployments(ctx.env)
      .then((r) => {
        if (cancelled) return
        setItems(r.items)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        // T15 P2-7: a 429 or 5xx must NOT silently collapse the list to
        // "No deployments yet" — that lies about platform state. Surface
        // the error banner instead (rate-limit aware via retryHint).
        setItems([])
        setErr({
          message: e?.message ?? 'Could not load deployments',
          rateLimited: isRateLimited(e),
          retrySeconds: retryAfterSeconds(e),
        })
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ctx.env])

  return (
    <>
      {/* QuotaWallBanner — Track U1. Deployment-count is one of the
          axes (provisions), and deploys are a frequent landing spot
          for paid-tier consideration. */}
      <QuotaWallBanner teamId={ctx.me?.team?.id} />

      {/* Rate-limit / load-error banner. Sits ABOVE the empty-state row
          so a 429 or 5xx is impossible to mistake for "you have no
          deployments". Matches the TeamPage error-banner pattern so the
          dashboard handles the API's structured error envelope the same
          way across pages. */}
      {err && (
        <div
          role="alert"
          data-testid="deployments-error"
          className="card"
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            borderColor: err.rateLimited ? 'var(--amber)' : 'var(--rose)',
            color: err.rateLimited ? 'var(--amber)' : 'var(--rose)',
            fontSize: 12.5,
          }}
        >
          {err.rateLimited ? (
            <>
              Too many requests — the deployments list is rate-limited.{' '}
              {formatRetryHint(err.retrySeconds)}
            </>
          ) : (
            <>Could not load deployments — {err.message}. Reload the page to try again.</>
          )}
        </div>
      )}

      {/* W9: human-driven "Create stack" entry-point. The dashboard
          stays read-only everywhere else, but POST /stacks/new is
          multipart-only — agents can't tar up source either, so this
          form is the one place we drive a write ourselves. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        {/* B7-P2 (2026-05-20): status filter chips. Mirrors the type-filter
            UX on ResourcesPage. */}
        <div className="filters" data-testid="deployments-status-filter">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              className={`chip ${statusFilter === s ? 'on' : ''}`}
              onClick={() => setStatusFilter(s)}
              data-testid={`status-filter-${s}`}
              type="button"
            >
              {s}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          data-testid="deployments-sort"
          title="Sort deployments"
          style={{
            padding: '4px 8px',
            fontSize: 11.5,
            fontFamily: 'var(--font-mono)',
            background: 'var(--ink)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 4,
          }}
        >
          <option value="recent">sort · recent</option>
          <option value="name">sort · name</option>
          <option value="status">sort · status</option>
        </select>
        <Link
          to="/app/stacks/new"
          data-testid="create-stack-link"
          style={{
            marginLeft: 'auto',
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 500,
            background: 'var(--blue, #4488ff)',
            color: 'white',
            border: 0,
            borderRadius: 4,
            textDecoration: 'none',
          }}
        >
          + Create stack
        </Link>
      </div>

      <div className="table">
        <div className="table-row head" style={{ gridTemplateColumns: '1.5fr 1fr 100px 80px 100px 110px 80px 28px' }}>
          <span>name</span>
          <span>url</span>
          <span>status</span>
          <span>env</span>
          <span>last deploy</span>
          {/* Wave FIX-J: TTL column shows Permanent vs "Expires in Nh" so
              the user can scan the list and identify which deploys are
              about to be auto-cleaned. */}
          <span>ttl</span>
          <span>build</span>
          <span></span>
        </div>
        {loading && (
          <div className="table-row" style={{ gridTemplateColumns: '1fr', textAlign: 'center', padding: 32 }}>
            <span className="skel" style={{ width: '60%', height: 18, margin: '0 auto' }} />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div
            className="table-row"
            data-testid="deployments-empty"
            style={{
              gridTemplateColumns: '1fr',
              textAlign: 'center',
              padding: '40px 24px',
              color: 'var(--text-dim)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <div>
              <strong style={{ color: 'var(--text)', fontWeight: 500 }}>No deployments yet.</strong>
              <div style={{ marginTop: 6 }}>
                Ask your agent to ship one — e.g.{' '}
                <code>POST https://api.instanode.dev/deploy/new</code> with your
                Dockerfile + INSTANODE_TOKEN. Your deploy URL will appear here as soon
                as the build starts.
              </div>
            </div>
          </div>
        )}
        {/* B7-P2 (2026-05-20): explicit empty state for the
            "filter matches nothing" case. Distinguished from the
            no-deployments-yet message so the user knows the filter
            is the cause, not their account. */}
        {!loading && items.length > 0 && visible.length === 0 && (
          <div
            className="table-row"
            data-testid="deployments-no-match"
            style={{
              gridTemplateColumns: '1fr',
              textAlign: 'center',
              padding: '32px 24px',
              color: 'var(--text-dim)',
              fontSize: 12,
            }}
          >
            <div>
              No deployments match the current filter. Try “all” or change the env.
            </div>
          </div>
        )}
        {visible.map((d) => (
          // We link by app_id (not the UUID `id`) because the agent API's
          // GET /api/v1/deployments/:id route resolves `:id` against the
          // app_id column. Routing by UUID would 404. app_id is also the
          // segment used by /deploy/:id/logs, so the same param threads
          // through to the SSE log stream on DeployDetailPage.
          //
          // T15 P2-2: link directly to /app/deployments/:id — the prefixed
          // dashboard route. The unprefixed /deployments/:id path also
          // resolves but through LegacyDeploymentRedirect (App.tsx) which
          // does a render → <Navigate replace> → render double-hop. The
          // legacy route is for external/bookmarked links only; internal
          // nav should go straight to the canonical /app/* path.
          <Link
            to={`/app/deployments/${d.app_id}`}
            key={d.id}
            className="table-row"
            style={{ gridTemplateColumns: '1.5fr 1fr 100px 80px 100px 110px 80px 28px', textDecoration: 'none', color: 'inherit' }}
          >
            <div className="res-name">
              <ResourceIcon type="deploy" />
              <div className="info">
                <span
                  className="n"
                  data-testid={`deployment-row-name-${d.id}`}
                  style={isUnnamed(d.name) ? { fontStyle: 'italic', color: 'var(--text-dim)' } : undefined}
                >
                  {displayName(d.name, 'deploy')}
                </span>
                <span className="id">
                  {d.app_id} · {d.tier}
                </span>
              </div>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: d.url ? 'var(--blue)' : 'var(--text-faint)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                overflow: 'hidden'
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.url ? d.url.replace('https://', '') : '— internal —'}
              </span>
              {d.url && <span style={{ color: 'var(--text-faint)', flexShrink: 0 }}>↗</span>}
            </div>
            <StatusPill status={d.status} />
            <EnvPill env={d.env} />
            <RelTime at={d.last_deploy_at} />
            {/* Wave FIX-J: inline TTL badge. Click target is the row link,
                so the badge is read-only here; the Make Permanent button
                lives on the detail page banner variant. */}
            <TtlBadge deployment={d} variant="inline" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: d.status === 'building' ? 'var(--blue)' : 'var(--text-dim)' }}>
              {d.build_duration_s ? `${d.build_duration_s}s${d.status === 'building' ? ' …' : ''}` : '—'}
            </span>
            <button className="res-action" onClick={(e) => e.preventDefault()} aria-label="actions">⋯</button>
          </Link>
        ))}
      </div>

      {/* Private deploy section — Pro+ feature. Pro+ users get the live
          configurator that produces a precise agent prompt (since deploys
          are agent-driven in this product). Hobby / free / anonymous see
          a feature-specific UpgradePromptCard from src/components/upgradeCopy.ts. */}
      <section
        data-testid="private-deploy-section"
        style={{ marginTop: 32 }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', margin: 0 }}>
            Private deploys
          </h3>
          <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            IP allow-list · max {IP_ALLOW_LIST_MAX} entries
          </span>
          {canUsePrivateDeploy && (
            <span className="tag" style={{ marginLeft: 'auto' }}>pro</span>
          )}
        </div>
        {canUsePrivateDeploy ? (
          <PrivateDeployConfigurator />
        ) : (
          <PrivateDeployUpsell />
        )}
      </section>
    </>
  )
}

// PrivateDeployUpsell — tier-gated explainer for hobby/free/anonymous.
// Mirrors the PromoteUpsell + CustomDomainUpsell pattern: copy lives in
// upgradeCopy.ts under `private_deploy`.
function PrivateDeployUpsell() {
  return (
    <div data-testid="private-deploy-upsell">
      <UpgradePromptCard feature="private_deploy" />
    </div>
  )
}

// PrivateDeployConfigurator — Pro+ surface. Renders a Private toggle and,
// when on, the IpAllowList tag input. Once configured the panel exposes a
// PromptCard with a precise agent prompt that mirrors the createDeploy()
// helper's wire shape — agents do the actual deploy, the dashboard just
// composes the prose.
//
// Why a PromptCard and not a "Deploy" button:
//   The dashboard's contract is read-only — mutations are agent-driven
//   (see DeployDetailPage's redeploy/rollback/stop PromptCards). Adding
//   our own multipart file-upload form would fork the surface. The
//   createDeploy() helper still exists for symmetry with the backend, so
//   the agent prompt fields stay in lockstep with the actual wire shape.
function PrivateDeployConfigurator() {
  const [isPrivate, setIsPrivate] = useState(false)
  const [allowedIps, setAllowedIps] = useState<string[]>([])

  // Build a deterministic agent prompt body. Keys mirror createDeploy() in
  // src/api/index.ts so a future copy-paste into a real API call stays
  // accurate.
  const allowedIpsJSON = JSON.stringify(allowedIps)
  const promptText =
    `Ship a private instanode deployment.\n` +
    `\n` +
    `- Endpoint: POST https://api.instanode.dev/deploy/new\n` +
    `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
    `- Multipart fields (alongside the tarball):\n` +
    `    private: ${isPrivate}\n` +
    `    allowed_ips: ${allowedIpsJSON}\n` +
    `\n` +
    `Only requests originating from the IPs/CIDRs in allowed_ips can reach the deploy at the edge — everything else gets a 403.\n` +
    `\n` +
    `Pro tier required (the API returns 402 with agent_action otherwise). Empty allowed_ips with private=true returns 400 — give me at least one entry.`

  return (
    <div data-testid="private-deploy-configurator" className="card" style={{ padding: 16 }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          cursor: 'pointer',
          marginBottom: isPrivate ? 14 : 0,
        }}
      >
        <input
          type="checkbox"
          data-testid="private-toggle"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
        />
        <span>
          <strong style={{ fontWeight: 500 }}>Private deploy</strong>
          <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: 12 }}>
            Gate the deploy by an IP allow-list at the edge.
          </span>
        </span>
      </label>

      {isPrivate && (
        <>
          <div
            data-testid="private-ip-input-wrap"
            style={{ marginBottom: 14 }}
          >
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
            <IpAllowList value={allowedIps} onChange={setAllowedIps} />
          </div>
          <PromptCard
            title="Ship private deploy"
            prompt={
              <>
                Hand this prompt to your agent. The deploy will be gated by
                the IP allow-list above; everything else gets a 403 at the
                edge.
              </>
            }
            promptText={promptText}
            method="POST"
            endpoint="/deploy/new"
          />
        </>
      )}
    </div>
  )
}
