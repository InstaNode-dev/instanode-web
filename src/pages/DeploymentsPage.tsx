import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ContractBanner, EnvPill, StatusPill, ResourceIcon, RelTime
} from '../components/Common'
import * as api from '../api'
import type { DashboardStack } from '../api'

export function DeploymentsPage() {
  const [items, setItems] = useState<DashboardStack[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listStacks().then((r) => {
      setItems(r.items)
      setLoading(false)
    })
  }, [])

  return (
    <>
      <ContractBanner kind="warning" badge="naming gap">
        <strong>"Deployments" in the brief = "Stacks" in the code.</strong> The agent API exposes <code>GET /api/v1/stacks</code>{' '}
        (returns <code>DashboardStack</code>). UI keeps <code>/deployments</code> (user language); API stays <code>/stacks</code> (existing).
      </ContractBanner>

      <ContractBanner kind="locked" badge="locked">
        <strong>GET /api/v1/stacks</strong> · returns <code>{`{"ok": true, "items": DashboardStack[], "total": number}`}</code>.
        Status enum: <code>building | running | failed | stopped</code>.
      </ContractBanner>

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
                Deployment lands in Phase 1 — see roadmap. For now, use kubectl on your own
                cluster or contact <a href="mailto:support@instanode.dev">support</a>.
              </div>
            </div>
          </div>
        )}
        {items.map((d) => (
          <Link
            to={`/deployments/${d.id}`}
            key={d.id}
            className="table-row"
            style={{ gridTemplateColumns: '1.5fr 1fr 100px 80px 100px 80px 28px', textDecoration: 'none', color: 'inherit' }}
          >
            <div className="res-name">
              <ResourceIcon type="deploy" />
              <div className="info">
                <span className="n">{d.name}</span>
                <span className="id">
                  {d.id} · {d.tier}
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
