import { useEffect, useState } from 'react'
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

// Tiers that can ship a private deploy (Track B). The agent API enforces
// the same gate via 402 + agent_action on POST /deploy/new — keeping the
// allowlist in lockstep keeps the UI from offering a feature the backend
// will reject.
const PRIVATE_DEPLOY_TIERS: ReadonlySet<Tier> = new Set(['pro', 'team', 'growth'])

export function DeploymentsPage() {
  const ctx = useDashboardCtx()
  const [items, setItems] = useState<DashboardDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const tier = (ctx.me?.user.tier ?? 'anonymous') as Tier
  const canUsePrivateDeploy = PRIVATE_DEPLOY_TIERS.has(tier)

  // Source of truth: GET /api/v1/deployments (single-container apps via
  // POST /deploy/new). The env switcher in the sidebar drives the ?env=
  // query param; switching envs triggers a refetch via the dep array.
  useEffect(() => {
    let cancelled = false
    api
      .listDeployments(ctx.env)
      .then((r) => {
        if (cancelled) return
        setItems(r.items)
        setLoading(false)
      })
      .catch(() => {
        // Honest empty state on failure — the page renders the no-
        // deployments hint rather than fabricating placeholder rows.
        if (!cancelled) {
          setItems([])
          setLoading(false)
        }
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

      {/* W9: human-driven "Create stack" entry-point. The dashboard
          stays read-only everywhere else, but POST /stacks/new is
          multipart-only — agents can't tar up source either, so this
          form is the one place we drive a write ourselves. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Link
          to="/app/stacks/new"
          data-testid="create-stack-link"
          style={{
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
        {items.map((d) => (
          // We link by app_id (not the UUID `id`) because the agent API's
          // GET /api/v1/deployments/:id route resolves `:id` against the
          // app_id column. Routing by UUID would 404. app_id is also the
          // segment used by /deploy/:id/logs, so the same param threads
          // through to the SSE log stream on DeployDetailPage.
          <Link
            to={`/deployments/${d.app_id}`}
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
