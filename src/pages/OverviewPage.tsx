import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ROBanner, PromptPill, EnvPill, TierPill, ResourceIcon, RelTime, UsageBar, Card, Sparkline
} from '../components/Common'
import * as api from '../api'
import type { Resource, ActivityItem } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

const TIER_LIMIT_GB: Record<string, number> = { hobby: 0.5, pro: 5, team: 50 }
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function OverviewPage() {
  const [resources, setResources] = useState<Resource[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const ctx = useDashboardCtx()
  const tier = ctx.me?.team.tier ?? 'hobby'
  const env = ctx.env
  const vaultCount = ctx.counts.vault

  useEffect(() => {
    let alive = true
    Promise.all([api.listResources(), api.fetchActivity()]).then(([r, a]) => {
      if (!alive) return
      setResources(r.items)
      setActivity(a.items)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // computed stats — no /overview endpoint exists, derived client-side
  const totalStorageMB = Math.round(resources.reduce((s, r) => s + r.storage_bytes, 0) / 1_000_000)
  const tierLimitGB = TIER_LIMIT_GB[tier] ?? 5
  const tierLimitMB = tierLimitGB * 1000
  const storagePct = tierLimitMB > 0 ? Math.round((totalStorageMB / tierLimitMB) * 100) : 0
  const conn = resources.reduce((s, r) => s + (r.connections_in_use ?? 0), 0)
  const connLim = resources.reduce((s, r) => s + (r.connections_limit ?? 0), 0)
  const recent = [...resources].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 4)

  const now = Date.now()
  const newThisWeek = resources.filter((r) => now - +new Date(r.created_at) <= SEVEN_DAYS_MS).length
  const deploys = resources.filter((r) => r.resource_type === 'deploy')
  const deployCount = deploys.length
  const deployHealthy = deploys.filter((r) => r.status === 'active').length
  const webhookCount = resources.filter((r) => r.resource_type === 'webhook').length

  const storageSub = resources.length === 0 ? tier : `${storagePct}% of ${tier} tier`
  const connSub = connLim === 0 ? '' : `${conn}/${connLim} active`
  const deploySub = deployCount === 0 ? 'none yet' : `${deployHealthy}/${deployCount} healthy`
  const vaultSub = vaultCount === 0 ? '' : `scoped to ${env}`

  return (
    <>
      <ROBanner>
        The whole dashboard is a <strong>mirror.</strong> Resources, deploys, vault keys, audit trails — everything you see came from your agent calling the API. To <em>do</em> something, prompt your agent. <strong>Billing is the only exception.</strong>
      </ROBanner>

      <div className="stats">
        <Stat k="resources" v={loading ? '—' : resources.length.toString()} d={newThisWeek === 0 ? '—' : `+${newThisWeek} this week`} spark="m" />
        <Stat k={`storage / ${tierLimitGB} GB`} v={loading ? '—' : (totalStorageMB / 1000).toFixed(1)} unit="GB" d={storageSub} dCls="dim" spark="up" sparkColor="rgba(108,206,255,0.45)" />
        <Stat k={`conn / ${connLim}`} v={loading ? '—' : conn.toString()} d={connSub} dCls="dim" spark="bumpy" sparkColor="rgba(255,192,105,0.4)" />
        <Stat k="deployments" v={loading ? '—' : deployCount.toString()} d={deploySub} spark="flat" sparkColor="rgba(183,148,246,0.4)" />
        <Stat k="webhooks · 24h" v={loading ? '—' : webhookCount.toString()} d="" spark="up" sparkColor="rgba(0,228,142,0.45)" />
        <Stat k="vault entries" v={vaultCount.toString()} d={vaultSub} dCls="dim" spark="flat" sparkColor="rgba(255,122,138,0.4)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        {/* recent resources */}
        <div>
          <div className="section-h">
            <h2>Recently active</h2>
            <Link to="/resources" className="sub" style={{ textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--text-ghost)' }}>
              View all {resources.length} →
            </Link>
          </div>
          <div className="table">
            {recent.map((r) => (
              <div key={r.id} className="table-row" style={{ gridTemplateColumns: '1.4fr 0.5fr 0.55fr 1fr 0.6fr 28px' }}>
                <Link to={`/resources/${r.id}`} className="res-name">
                  <ResourceIcon type={r.resource_type} />
                  <div className="info">
                    <span className="n">{r.name ?? r.id}</span>
                    <span className="id">
                      {r.token} · {r.resource_type}
                    </span>
                  </div>
                </Link>
                <TierPill tier={r.tier} />
                <EnvPill env={r.env} />
                <UsageBar used={Math.round(r.storage_bytes / 1_000_000)} limit={Math.round(r.storage_limit_bytes / 1_000_000)} format={(a, b) => `${a} / ${b}`} />
                <RelTime at={r.created_at} />
                <button className="res-action" aria-label="actions">⋯</button>
              </div>
            ))}
          </div>
        </div>

        {/* prompts + activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="prompt-card">
            <div className="head">
              <strong>Quick prompts</strong>
              <span className="right">⌘K to send</span>
            </div>
            <div className="prompt" style={{ fontSize: 14, padding: '11px 14px' }}>
              <em>Spin up a Postgres for staging</em>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              <a className="prompt-pill" style={{ justifyContent: 'space-between', padding: '6px 10px' }}>
                <span><span className="label">Deploy this app</span></span>
                <span style={{ opacity: 0.6 }}>POST /deploy/new</span>
              </a>
              <a className="prompt-pill" style={{ justifyContent: 'space-between', padding: '6px 10px' }}>
                <span><span className="label">Add an OpenAI key to vault</span></span>
                <span style={{ opacity: 0.6 }}>PUT /vault/:env/:key</span>
              </a>
              <a className="prompt-pill" style={{ justifyContent: 'space-between', padding: '6px 10px' }}>
                <span><span className="label">Invite a teammate</span></span>
                <span style={{ opacity: 0.6 }}>POST /team/.../invite</span>
              </a>
            </div>
            <Link to="/agent" style={{ display: 'flex', gap: 4, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--violet)' }}>
              Browse the prompt library →
            </Link>
          </div>

          <Card title="Recent activity" right="last 1h" className="" style={{ padding: 0 }}>
            <div className="feed">
              {activity.map((a) => (
                <div key={a.id} className="feed-row">
                  <span className={`dot ${a.level}`} />
                  <span className="text" dangerouslySetInnerHTML={{ __html: a.text }} />
                  <RelTime at={a.at} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

// ---------- helpers ----------
function Stat({
  k,
  v,
  unit,
  d,
  dCls = '',
  spark,
  sparkColor
}: {
  k: string
  v: string
  unit?: string
  d: string
  dCls?: string
  spark?: 'up' | 'flat' | 'bumpy' | 'm'
  sparkColor?: string
}) {
  const series =
    spark === 'up'   ? [22, 20, 18, 15, 13, 11, 10, 8] :
    spark === 'flat' ? [12, 12, 12, 12, 12, 12, 12, 12] :
    spark === 'bumpy' ? [18, 15, 8, 16, 4, 12, 6, 14, 9, 7, 11] :
    /* m */            [18, 16, 17, 12, 13, 8, 10, 4]
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className={`d ${dCls}`}>{d}</div>
      <Sparkline points={series} color={sparkColor} />
    </div>
  )
}
