import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ContractBanner, EnvPill, TierPill, ResourceIcon, RelTime, UsageBar, PromptPill
} from '../components/Common'
import * as api from '../api'
import type { Env, Resource, ResourceType } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

const TYPES: (ResourceType | 'all')[] = ['all', 'postgres', 'redis', 'mongodb', 'queue', 'storage', 'webhook']

export function ResourcesPage() {
  const ctx = useDashboardCtx()
  const ENVS: (Env | 'all')[] = ['all', ...ctx.envs] as (Env | 'all')[]
  const [items, setItems] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [env, setEnv] = useState<Env | 'all'>(ctx.env as Env)
  const [type, setType] = useState<ResourceType | 'all'>('all')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    api.listResources()
      .then((r) => {
        if (!alive) return
        setItems(r.items)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setErr(e?.message ?? 'load failed')
        setLoading(false)
      })
    return () => { alive = false }
  }, [ctx.env])

  // Sync local filter to global env when ctx changes.
  useEffect(() => { setEnv(ctx.env as Env) }, [ctx.env])

  const filtered = useMemo(
    () =>
      items.filter(
        (r) => (env === 'all' || r.env === env) && (type === 'all' || r.resource_type === type)
      ),
    [items, env, type]
  )

  // counts per env (for filter chips)
  const envCounts = useMemo(() => {
    const m: Record<string, number> = { all: items.length }
    items.forEach((r) => {
      m[r.env] = (m[r.env] ?? 0) + 1
    })
    return m
  }, [items])

  const totalGB = items.reduce((s, r) => s + r.storage_bytes, 0) / 1_000_000_000

  return (
    <>
      <ContractBanner kind="locked" badge="locked">
        <strong>GET /api/v1/resources</strong> · returns <code>{`{"ok": true, "items": Resource[], "total": number}`}</code>. Backed by{' '}
        <code>resourcesH.List()</code> which fans out to gRPC <code>agent.ListResources(team_id)</code>. <code>connection_url</code>{' '}
        is intentionally omitted from list responses — only <code>GET /:id</code> and <code>/rotate</code> include it.
      </ContractBanner>

      <ContractBanner kind="warning" badge="needs lock">
        <strong>Multi-env filtering</strong> isn't yet supported by the backend. Currently filtered client-side. <strong>Decision:</strong>{' '}
        add server-side <code>?env=production</code> param OR keep client-side. (For now: client-side.)
      </ContractBanner>

      <div className="filters">
        {ENVS.map((e) => (
          <button key={e} className={`chip ${env === e ? 'on' : ''}`} onClick={() => setEnv(e)}>
            {e === 'all' ? 'all envs' : e}
            {envCounts[e] !== undefined && envCounts[e] > 0 && env !== e && (
              <span style={{ opacity: 0.6 }}>· {envCounts[e]}</span>
            )}
          </button>
        ))}
        <span style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch', margin: '0 6px' }} />
        {TYPES.map((t) => (
          <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>
            {t}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          <PromptPill label="deploy this app" />
        </span>
      </div>

      <div className="section-h">
        <h2>{loading ? 'loading…' : `${filtered.length} resources`}</h2>
        <span className="sub">
          total · {totalGB.toFixed(2)} GB used
        </span>
      </div>

      <div className="table">
        <div className="table-row head" style={{ gridTemplateColumns: '1.6fr 70px 80px 1fr 80px 90px 28px' }}>
          <span>resource</span>
          <span>tier</span>
          <span>env</span>
          <span>storage</span>
          <span>conn</span>
          <span>created</span>
          <span></span>
        </div>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="table-row" style={{ gridTemplateColumns: '1.6fr 70px 80px 1fr 80px 90px 28px' }}>
                <span className="skel" style={{ width: 180, height: 18 }} />
                <span className="skel" style={{ width: 40, height: 14 }} />
                <span className="skel" style={{ width: 50, height: 14 }} />
                <span className="skel" style={{ width: '100%', height: 12 }} />
                <span className="skel" style={{ width: 40, height: 12 }} />
                <span className="skel" style={{ width: 60, height: 12 }} />
                <span />
              </div>
            ))
          : filtered.map((r) => (
              <Link
                to={`/resources/${r.id}`}
                key={r.id}
                className="table-row"
                style={{ gridTemplateColumns: '1.6fr 70px 80px 1fr 80px 90px 28px', textDecoration: 'none', color: 'inherit' }}
              >
                <div className="res-name">
                  <ResourceIcon type={r.resource_type} />
                  <div className="info">
                    <span className="n">{r.name ?? r.id}</span>
                    <span className="id">{r.token}</span>
                  </div>
                </div>
                <TierPill tier={r.tier} />
                <EnvPill env={r.env} />
                <UsageBar
                  used={Math.round(r.storage_bytes / 1_000_000)}
                  limit={Math.round(r.storage_limit_bytes / 1_000_000)}
                  format={(a, b) => `${a} / ${b} MB`}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                  {r.connections_in_use ?? '—'} / {r.connections_limit ?? '—'}
                </span>
                <RelTime at={r.created_at} />
                <button className="res-action" onClick={(e) => e.preventDefault()} aria-label="actions">⋯</button>
              </Link>
            ))}
      </div>
    </>
  )
}
