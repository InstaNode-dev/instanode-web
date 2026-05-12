import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ContractBanner, EnvPill, StatusPill, ResourceIcon, RelTime
} from '../components/Common'
import { QuotaWallBanner } from '../components/QuotaWallBanner'
import * as api from '../api'
import type { DashboardDeployment } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

export function DeploymentsPage() {
  const ctx = useDashboardCtx()
  const [items, setItems] = useState<DashboardDeployment[]>([])
  const [loading, setLoading] = useState(true)

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

      <div className="table">
        <div className="table-row head" style={{ gridTemplateColumns: '1.5fr 1fr 100px 80px 100px 80px 28px' }}>
          <span>name</span>
          <span>url</span>
          <span>status</span>
          <span>env</span>
          <span>last deploy</span>
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
            style={{ gridTemplateColumns: '1.5fr 1fr 100px 80px 100px 80px 28px', textDecoration: 'none', color: 'inherit' }}
          >
            <div className="res-name">
              <ResourceIcon type="deploy" />
              <div className="info">
                <span className="n">{d.name}</span>
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: d.status === 'building' ? 'var(--blue)' : 'var(--text-dim)' }}>
              {d.build_duration_s ? `${d.build_duration_s}s${d.status === 'building' ? ' …' : ''}` : '—'}
            </span>
            <button className="res-action" onClick={(e) => e.preventDefault()} aria-label="actions">⋯</button>
          </Link>
        ))}
      </div>
    </>
  )
}
