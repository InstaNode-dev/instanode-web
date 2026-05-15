import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ContractBanner, EnvPill, ExpiryBadge, TierPill, ResourceIcon, RelTime, UsageBar, PromptCard,
  useExpiryTick, displayName, isUnnamed
} from '../components/Common'
import { QuotaWallBanner } from '../components/QuotaWallBanner'
import { UpgradePromptCard } from '../components/UpgradePromptCard'
import { PauseResumeButton } from '../components/PauseResumeButton'
import * as api from '../api'
import type { Resource, ResourceType, Tier } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

// Tiers that benefit from a quota-wall upgrade prompt. Pro / team / growth
// already have higher caps — showing the prompt to them would be noise.
const QUOTA_UPGRADE_TIERS: ReadonlySet<Tier> = new Set(['anonymous', 'free', 'hobby'])

// Trigger threshold for the quota-wall prompt: any single resource at or
// above 80% of its storage cap. Mirrors the `isWarn` rule on BillingPage so
// the two surfaces agree on what "approaching the wall" means.
const QUOTA_WARN_PCT = 0.8

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

  // Replace one row in-place after pause/resume so the row's status pill +
  // button label flip without a full refetch. Keyed by id; we keep object
  // identity for every other row so React doesn't re-render the whole table.
  function handleResourceUpdated(next: Resource) {
    setItems((prev) => prev.map((r) => (r.id === next.id ? next : r)))
  }

  const totalGB = items.reduce((s, r) => s + r.storage_bytes, 0) / 1_000_000_000

  // Quota-wall prompt visibility — show only when the user is on a tier
  // that has a higher tier to upgrade to AND at least one resource is at
  // or above 80% of its storage cap. Read from the live resource list so
  // we don't have to round-trip through /billing/usage. Resources with
  // `storage_limit_bytes <= 0` (rare; defensively guarded) are skipped so
  // we don't divide by zero.
  const tier = (ctx.me?.team.tier ?? 'hobby') as Tier
  const showQuotaPrompt = useMemo(() => {
    if (!QUOTA_UPGRADE_TIERS.has(tier)) return false
    return items.some(
      (r) =>
        r.storage_limit_bytes > 0 &&
        r.storage_bytes / r.storage_limit_bytes >= QUOTA_WARN_PCT,
    )
  }, [items, tier])

  return (
    <>
      {/* QuotaWallBanner (U1): 80% pre-wall nudge driven by worker scan.
          UpgradePromptCard quota_wall (U2): at-wall prompt rendered client-side
          when the user has actually hit the cap. Layered: gentle nudge first,
          firm prompt when stuck. */}
      <QuotaWallBanner teamId={ctx.me?.team?.id} />
      {showQuotaPrompt && (
        <div style={{ marginBottom: 12 }}>
          <UpgradePromptCard feature="quota_wall" />
        </div>
      )}

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
        <div className="table-row head" style={{ gridTemplateColumns: '1.6fr 70px 80px 1fr 80px 90px 80px' }}>
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
              <div key={i} className="table-row" style={{ gridTemplateColumns: '1.6fr 70px 80px 1fr 80px 90px 80px' }}>
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
                style={{ gridTemplateColumns: '1.6fr 70px 80px 1fr 80px 90px 80px', textDecoration: 'none', color: 'inherit' }}
              >
                <div className="res-name">
                  <ResourceIcon type={r.resource_type} />
                  <div className="info">
                    <span className="n" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span
                        data-testid={`resource-row-name-${r.id}`}
                        style={isUnnamed(r.name) ? { fontStyle: 'italic', color: 'var(--text-dim)' } : undefined}
                      >
                        {displayName(r.name, r.resource_type)}
                      </span>
                      {r.status === 'paused' && (
                        <span
                          data-testid="resource-row-paused-pill"
                          title="Paused — data preserved, doesn't count against quota"
                          style={{
                            padding: '1px 6px',
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: 'var(--text-dim)',
                            background: 'rgba(255,193,7,0.08)',
                            border: '1px solid rgba(255,193,7,0.25)',
                            borderRadius: 3,
                          }}
                        >
                          Paused
                        </span>
                      )}
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
                <span onClick={(e) => e.preventDefault()}>
                  <PauseResumeButton
                    resource={r}
                    onUpdated={handleResourceUpdated}
                    size="sm"
                  />
                </span>
              </Link>
            ))}
      </div>
    </>
  )
}
