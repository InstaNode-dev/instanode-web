import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ROBanner, EnvPill, TierPill, ResourceIcon, RelTime, UsageBar, Card, Sparkline,
  copyToClipboard
} from '../components/Common'
import { QuotaWallBanner } from '../components/QuotaWallBanner'
import { UpgradeButton } from '../components/UpgradeButton'
import * as api from '../api'
import type { Resource, ActivityItem } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

const TIER_LIMIT_GB: Record<string, number> = { hobby: 0.5, pro: 5, team: 50 }
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function OverviewPage() {
  const [resources, setResources] = useState<Resource[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null)
  const ctx = useDashboardCtx()
  const navigate = useNavigate()
  const tier = ctx.me?.team.tier ?? 'hobby'
  const env = ctx.env
  const vaultCount = ctx.counts.vault
  // Show the Pro upgrade CTA on the overview's prompt card only on
  // tiers that have something to gain by going to Pro. Team/growth
  // are already past Pro; on those the slot stays empty (the page
  // doesn't need a second upgrade CTA when /app/billing already has
  // one).
  const showProUpgrade = tier === 'anonymous' || tier === 'free' || tier === 'hobby'

  // Tier-aware quick prompts. Each one is a real, copyable instruction the
  // user pastes into their agent — interpolating the live tier so the agent
  // knows the relevant limits up front (no "what tier am I?" round-trip).
  const QUICK_PROMPTS: Array<{ id: string; label: string; endpoint: string; text: string }> = [
    {
      id: 'provision-postgres',
      label: 'Provision a Postgres for development',
      endpoint: 'POST /db/new',
      text:
        `Provision a Postgres database for development on instanode.\n` +
        `\n` +
        `- My current plan tier is "${tier}" — respect that tier's storage + connection limits.\n` +
        `- Endpoint: POST https://api.instanode.dev/db/new\n` +
        `- Auth: use my INSTANODE_TOKEN env var as Bearer.\n` +
        `- Return the connection_url and the resource id so I can write data immediately.`,
    },
    {
      id: 'deploy-app',
      label: 'Deploy my project',
      endpoint: 'POST /deploy/new',
      text:
        `Deploy my project to instanode.\n` +
        `\n` +
        `- My current plan tier is "${tier}" — respect that tier's CPU/memory/disk limits.\n` +
        `- Endpoint: POST https://api.instanode.dev/deploy/new\n` +
        `- Auth: use my INSTANODE_TOKEN env var as Bearer.\n` +
        `- Build from the Dockerfile at the repo root and return the live app URL.`,
    },
    {
      id: 'invite-teammate',
      label: 'Invite a teammate',
      endpoint: 'POST /api/v1/team/members/invite',
      text:
        `Invite a teammate to my instanode team.\n` +
        `\n` +
        `- My current plan tier is "${tier}" — respect that tier's seat limit.\n` +
        `- Endpoint: POST https://api.instanode.dev/api/v1/team/members/invite\n` +
        `- Auth: use my INSTANODE_TOKEN env var as Bearer.\n` +
        `- Body: {"email":"<their-email>","role":"developer"}.`,
    },
  ]

  async function copyPrompt(id: string, text: string) {
    const ok = await copyToClipboard(text)
    if (!ok) {
      console.warn('[OverviewPage] copy failed — clipboard unavailable')
      return
    }
    setCopiedPrompt(id)
    window.setTimeout(() => setCopiedPrompt((cur) => (cur === id ? null : cur)), 1500)
  }

  useEffect(() => {
    let alive = true
    Promise.all([api.listResources(ctx.env), api.fetchActivity()]).then(([r, a]) => {
      if (!alive) return
      setResources(r.items)
      setActivity(a.items)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [ctx.env])

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
      {/* QuotaWallBanner — Track U1. Renders only when the worker has
          flagged this team as approaching a tier limit (>=80% on any
          axis) within the last 24h. Dismissible per-team. */}
      <QuotaWallBanner teamId={ctx.me?.team?.id} />

      <ROBanner>
        The whole dashboard is a <strong>mirror.</strong> Resources, deploys, vault keys, audit trails — everything you see came from your agent calling the API. To <em>do</em> something, prompt your agent. <strong>Billing is the only exception.</strong>
      </ROBanner>

      <div className="stats">
        {/* Sparkline series intentionally omitted — there's no real
            time-series source for these metrics yet. The component
            renders the number tile honestly without a fake trend.
            Wire up real series in a follow-up (W7-G) once /api/v1/
            stats/series is live. */}
        <Stat k="resources" v={loading ? '—' : resources.length.toString()} d={newThisWeek === 0 ? '—' : `+${newThisWeek} this week`} series={undefined} />
        <Stat k={`storage / ${tierLimitGB} GB`} v={loading ? '—' : (totalStorageMB / 1000).toFixed(1)} unit="GB" d={storageSub} dCls="dim" series={undefined} />
        <Stat k={`conn / ${connLim}`} v={loading ? '—' : conn.toString()} d={connSub} dCls="dim" series={undefined} />
        <Stat k="deployments" v={loading ? '—' : deployCount.toString()} d={deploySub} series={undefined} />
        <Stat k="webhooks · 24h" v={loading ? '—' : webhookCount.toString()} d="" series={undefined} />
        <Stat k="vault entries" v={vaultCount.toString()} d={vaultSub} dCls="dim" series={undefined} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, minWidth: 0 }}>
        {/* recent resources */}
        <div style={{ minWidth: 0 }}>
          <div className="section-h">
            <h2>Recently active</h2>
            <Link to="/app/resources" className="sub" style={{ textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--text-ghost)' }}>
              View all {resources.length} →
            </Link>
          </div>
          <div className="table" data-testid="recently-active">
            {/* §10.21: render at least one row from the live resource list.
                The Link targets the /app/resources/:id route (previously
                /resources/:id, which only redirected). minWidth:0 on the
                parent grid container lets the table-row grid shrink
                correctly inside the 1.5fr column when names are long. */}
            {recent.length === 0 && !loading && (
              <div
                className="table-row"
                data-testid="recently-active-empty"
                style={{ gridTemplateColumns: '1fr', color: 'var(--text-faint)', fontSize: 12.5 }}
              >
                no resources yet — provision one with your agent
              </div>
            )}
            {recent.map((r) => (
              <div
                key={r.id}
                className="table-row"
                data-testid={`recently-active-row-${r.id}`}
                style={{ gridTemplateColumns: '1.4fr 0.5fr 0.55fr 1fr 0.6fr 28px' }}
              >
                <Link to={`/app/resources/${r.id}`} className="res-name">
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
              <span className="right">copy → paste in agent</span>
            </div>
            {showProUpgrade && (
              // Pro-upgrade A/B-tested CTA. Variant comes from
              // /auth/me's experiments map (server-side bucketed)
              // and decides both the copy and the colour. Click
              // fires POST /api/v1/experiments/converted before
              // navigating to /app/billing where the user can
              // actually pay; the report is capped at 500ms so a
              // slow analytics endpoint never delays navigation.
              <div
                data-testid="overview-upgrade-cta"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', marginBottom: 8,
                  border: '1px dashed var(--border)', borderRadius: 6,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  Want bigger limits and longer TTLs?
                </span>
                <UpgradeButton
                  variant={ctx.me?.experiments?.upgrade_button}
                  onClick={() => navigate('/app/billing')}
                  testId="overview-upgrade-button"
                  action="overview_upgrade_clicked"
                />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {QUICK_PROMPTS.map((p) => {
                const isCopied = copiedPrompt === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-label={`Copy prompt: ${p.label}`}
                    data-testid={`quick-prompt-${p.id}`}
                    onClick={() => copyPrompt(p.id, p.text)}
                    className="prompt-pill"
                    style={{
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      background: 'transparent',
                      textAlign: 'left',
                      width: '100%',
                      font: 'inherit',
                    }}
                  >
                    <span><span className="label">{p.label}</span></span>
                    <span style={{ opacity: 0.6 }}>{isCopied ? 'copied ✓' : p.endpoint}</span>
                  </button>
                )
              })}
            </div>
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
// Stat — a number tile with a label, value, unit, sub-line and optional
// sparkline trend.
//
// IMPORTANT: `series` must be REAL data when provided. The component
// used to synthesize hardcoded series like [22,20,18,...] from a `spark`
// shape hint, which presented as a real trend to users (P3 founder
// persona caught this on 2026-05-13). If you don't have real series data
// for the metric, omit the prop and the sparkline simply doesn't render.
// The number tile alone is still useful.
//
// `sparkColor` only affects the sparkline; ignored when `series` is undefined.
function Stat({
  k,
  v,
  unit,
  d,
  dCls = '',
  series,
  sparkColor,
}: {
  k: string
  v: string
  unit?: string
  d: string
  dCls?: string
  series?: number[]
  sparkColor?: string
}) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className={`d ${dCls}`}>{d}</div>
      {series && series.length > 0 ? (
        <Sparkline points={series} color={sparkColor} />
      ) : null}
    </div>
  )
}
