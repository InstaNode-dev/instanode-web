import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ContractBanner, EnvPill, ExpiryBadge, TierPill, ResourceIcon, RelTime, UsageBar, PromptCard,
  useExpiryTick
} from '../components/Common'
import * as api from '../api'
import type { Resource, ResourceType } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

const TYPES: (ResourceType | 'all')[] = ['all', 'postgres', 'redis', 'mongodb', 'queue', 'storage', 'webhook']

export function ResourcesPage() {
  const ctx = useDashboardCtx()
  const [items, setItems] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<ResourceType | 'all'>('all')
  const [err, setErr] = useState<string | null>(null)
  // Render-time clock for countdown badges. Drives 60s refresh — every
  // resource row's ExpiryBadge re-renders against `now`.
  const now = useExpiryTick(60_000)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    api.listResources(ctx.env)
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

  const filtered = useMemo(
    () => items.filter((r) => type === 'all' || r.resource_type === type),
    [items, type]
  )

  const totalGB = items.reduce((s, r) => s + r.storage_bytes, 0) / 1_000_000_000

  return (
    <>

      <div className="filters">
        {TYPES.map((t) => (
          <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '16px 0' }}>
        <PromptCard
          title="Provision a new resource"
          hint="postgres · redis · mongodb · queue · storage · webhook"
          prompt={
            <>
              Provision a new resource on my instanode account. Pick the type and tier in
              the prompt — limits come from my current plan (<code>{ctx.me?.team?.tier ?? 'unknown'}</code>).
            </>
          }
          promptText={
            `Provision a new resource on my instanode account.\n` +
            `\n` +
            `- Type: <postgres | redis | mongodb | queue | storage | webhook>\n` +
            `- Env: <production | staging | development> (default production)\n` +
            `- Name (optional): <my-app-db>\n` +
            `- My plan tier: ${ctx.me?.team?.tier ?? 'unknown'} — limits per resource come from this\n` +
            `\n` +
            `Endpoint: POST https://api.instanode.dev/<type>/new  (e.g. /db/new for postgres, /cache/new for redis, /nosql/new for mongodb, /queue/new, /storage/new, /webhook/new)\n` +
            `Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
            `\n` +
            `The response contains a connection_url and a token. Wire connection_url into my app's env (e.g. DATABASE_URL=<url>) and commit. The token is how this resource is referenced in later operations.`
          }
          method="POST"
          endpoint={`/<type>/new`}
        />
        <PromptCard
          title="Deploy an app on these resources"
          hint="zero-click container deploy"
          prompt={
            <>
              Deploy my current project as a container on instanode, wired to all the
              resources above. The platform pulls my repo, builds, and exposes a public URL.
            </>
          }
          promptText={
            `Deploy my project as a container on instanode, wired to my existing claimed resources.\n` +
            `\n` +
            `- Dockerfile path: <path to Dockerfile in my repo, default ./Dockerfile>\n` +
            `- Resources to wire in: <list resource tokens — they appear in dashboard /resources>\n` +
            `- Env: <production | staging | development>\n` +
            `- My plan tier: ${ctx.me?.team?.tier ?? 'unknown'}\n` +
            `\n` +
            `Endpoint: POST https://api.instanode.dev/deploy/new\n` +
            `Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
            `\n` +
            `The response contains a deploy id, a public *.deployment.instanode.dev URL, and a streaming logs URL. Use GET /api/v1/stacks/<slug>/logs/<svc> to watch the build live.`
          }
          method="POST"
          endpoint={`/deploy/new`}
        />
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
                    <span className="n" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {r.name ?? r.id}
                      <ExpiryBadge expiresAt={r.expires_at} now={now} />
                    </span>
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
                <span />
              </Link>
            ))}
      </div>
    </>
  )
}
