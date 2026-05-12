import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ROBanner, ContractBanner, EnvPill, ExpiryBadge, TierPill, ResourceIcon,
  Card, ContractLine, PromptCard,
  expiryLevel, formatTimeUntil, useExpiryTick, copyToClipboard
} from '../components/Common'
import * as api from '../api'
import type { Resource } from '../api'

const TABS = ['Overview', 'Connection', 'Metrics', 'Audit'] as const
type Tab = (typeof TABS)[number]

export function ResourceDetailPage() {
  const { id = '' } = useParams()
  const [r, setR] = useState<Resource | null>(null)
  const [tab, setTab] = useState<Tab>('Overview')
  const [revealed, setRevealed] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const now = useExpiryTick(60_000)

  useEffect(() => {
    api.getResource(id)
      .then(({ resource }) => setR(resource))
      .catch((e) => setErr(e?.message ?? 'load failed'))
  }, [id])

  async function copyURL() {
    if (!r?.connection_url) return
    const ok = await copyToClipboard(r.connection_url)
    if (!ok) {
      console.warn('[ResourceDetailPage] copy failed — clipboard unavailable')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!r) return <div className="skel" style={{ width: '100%', height: 320 }} />

  const masked = (r.connection_url ?? '').replace(/:([^@]+)@/, ':<span class="mask">••••••••</span>@')

  return (
    <>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <ResourceIcon type={r.resource_type} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' }}>
              {r.name ?? r.id}
            </h2>
            <EnvPill env={r.env} />
            <TierPill tier={r.tier} />
            <ExpiryBadge expiresAt={r.expires_at} now={now} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>
            {r.token} · {r.resource_type} · {r.cloud_vendor ?? 'aws'} · {r.country_code ?? 'IN'} · created{' '}
            {new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>

      <ROBanner>
        The dashboard mirrors the resource — it never writes. <strong>To rotate, rename, or delete this Postgres, prompt your agent.</strong> The agent calls the same locked API endpoints listed below.
      </ROBanner>

      <ContractBanner kind="locked" badge="locked">
        <strong>GET /api/v1/resources/:id</strong> · returns the full <code>Resource</code> shape including <code>connection_url</code>.
        The connection URL is single-use safe — frontend keeps it in memory only, masks by default, reveals on click.
      </ContractBanner>

      {/* Time-remaining card — only when this resource has a TTL (claimed,
          not yet on an active subscription). Loud, near the top, with a
          direct link to /billing where the Upgrade button lives. */}
      {r.expires_at && (
        <Card
          title="Time remaining"
          right={<ExpiryBadge expiresAt={r.expires_at} now={now} />}
          style={{
            borderColor: 'rgba(255,122,138,0.28)',
            background: 'linear-gradient(180deg, rgba(255,122,138,0.04), transparent)',
            marginBottom: 16,
          }}
          className="expiry-card"
        >
          <div data-testid="expiry-card" style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, color: 'var(--rose)', fontWeight: 500 }}>
              {expiryLevel(r.expires_at, now) === 'expired'
                ? 'expired'
                : formatTimeUntil(r.expires_at, now)}
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55, flex: '1 1 320px' }}>
              This resource is on the 24h claim TTL. It will be deleted on{' '}
              <strong style={{ color: 'var(--text)' }}>
                {new Date(r.expires_at).toLocaleString()}
              </strong>{' '}
              unless you start a subscription.{' '}
              <Link to="/app/billing" style={{ color: 'var(--rose)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                Pay now to keep it →
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* tabs */}
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {(t === 'Metrics' || t === 'Audit') && <span className="tag">blocked</span>}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === 'Overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Connection URL" right="postgresql://">
              <div className="conn">
                <span className="url" dangerouslySetInnerHTML={{
                  __html: revealed
                    ? (r.connection_url ?? '')
                    : masked
                }} />
                <button className="btn btn-sm btn-ghost" onClick={() => setRevealed((x) => !x)}>
                  {revealed ? 'hide' : 'reveal'}
                </button>
                <button className="btn btn-sm btn-secondary" onClick={copyURL} disabled={!r.connection_url}>
                  {copied ? 'copied ✓' : 'copy'}
                </button>
              </div>
              {err && (
                <div role="alert" style={{ marginTop: 10, color: 'var(--rose)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {err}
                </div>
              )}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8
                }}>
                  SDK snippets
                </div>
                <div className="codeblock">
                  <span className="dim">{'// in your .env'}</span>
                  {'\n'}
                  <span className="j-key">DATABASE_URL</span>={r.connection_url?.replace(/:([^@]+)@/, ':****@')}
                  {'\n\n'}
                  <span className="dim">{'// pgvector ready, no CREATE EXTENSION'}</span>
                  {'\n'}
                  <span className="j-bool">import</span>{' '}{`{ Client }`} <span className="j-bool">from</span> <span className="j-str">'pg'</span>
                  {'\n'}
                  <span className="j-bool">const</span>{' db = '}<span className="j-bool">new</span>{' '}
                  <span className="j-key">Client</span>({`{ connectionString: process.env.DATABASE_URL }`})
                </div>
              </div>
            </Card>

            <Card title="Resource details">
              <Kv k="id" v={r.id} />
              <Kv k="type" v={r.resource_type} />
              <Kv k="tier" v={r.tier} />
              <Kv k="env" v={r.env} />
              <Kv k="name" v={r.name ?? '—'} />
              <Kv k="storage" v={`${(r.storage_bytes / 1_000_000).toFixed(1)} / ${(r.storage_limit_bytes / 1_000_000).toFixed(0)} MB · ${Math.round((r.storage_bytes / r.storage_limit_bytes) * 100)}%`} />
              <Kv k="connections" v={`${r.connections_in_use ?? '—'} / ${r.connections_limit ?? '—'}`} />
              <Kv k="cloud_vendor" v={`${r.cloud_vendor ?? '—'} · ${r.country_code ?? '—'}`} />
              <Kv k="expires_at" v={r.expires_at ?? 'never · claimed'} />
              <Kv k="created_at" v={r.created_at} />
            </Card>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="API contract">
              <ContractLine method="GET"    path="/api/v1/resources/:id" status="live" />
              <ContractLine method="POST"   path="/api/v1/resources/:id/rotate" status="live" />
              <ContractLine method="DELETE" path="/api/v1/resources/:id" status="live" />
              <ContractLine method="GET"    path="/api/v1/resources/:id/metrics" status="gap" />
              <ContractLine method="GET"    path="/api/v1/resources/:id/audit" status="gap" />
            </Card>

            <PromptCard
              title="Rotate credentials"
              hint="via agent"
              prompt={
                <>
                  Rotate the password for my <strong>{r.resource_type}</strong> resource{' '}
                  <em>{r.name ?? r.id}</em> (token <code>{r.token}</code>) and update the
                  connection string anywhere I've used it (.env, deployment env, secrets).
                  Existing connections on the old URL keep working for 5 minutes.
                </>
              }
              promptText={
                `Rotate the password for my ${r.resource_type} resource "${r.name ?? r.id}" on instanode.\n` +
                `\n` +
                `- Resource token: ${r.token}\n` +
                `- Resource id: ${r.id}\n` +
                `- Endpoint: POST https://api.instanode.dev/api/v1/resources/${r.token}/rotate\n` +
                `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
                `\n` +
                `After rotation, the response contains a new connection_url. Update it everywhere it appears in my project (.env, deployment manifests, secrets) and redeploy. The old URL keeps working for 5 minutes as a grace period.`
              }
              method="POST"
              endpoint={`/api/v1/resources/${r.token}/rotate`}
            />

            <PromptCard
              danger
              title="Decommission this resource"
              hint="data loss"
              prompt={
                <>
                  Permanently delete <em>{r.name ?? r.id}</em> and remove all references to its
                  connection string in my code. <strong>Data is gone for good.</strong>
                </>
              }
              promptText={
                `Permanently decommission my ${r.resource_type} resource "${r.name ?? r.id}" on instanode.\n` +
                `\n` +
                `- Resource token: ${r.token}\n` +
                `- Resource id: ${r.id}\n` +
                `- Storage: ${(r.storage_bytes / 1_000_000).toFixed(1)} MB will be destroyed\n` +
                `- Endpoint: DELETE https://api.instanode.dev/api/v1/resources/${r.token}\n` +
                `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
                `\n` +
                `Before deleting: confirm I have a backup elsewhere, then remove every reference to this resource's connection_url in my codebase (.env files, deployment manifests, code) so nothing tries to reconnect after the DELETE.`
              }
              method="DELETE"
              endpoint={`/api/v1/resources/${r.token}`}
            />
          </div>
        </div>
      )}

      {/* CONNECTION */}
      {tab === 'Connection' && (
        <Card title="Connection URL">
          <div className="conn">
            <span className="url">{r.connection_url}</span>
          </div>
        </Card>
      )}

      {/* METRICS — blocked */}
      {tab === 'Metrics' && (
        <>
          <ContractBanner kind="blocked" badge="🔒 blocked">
            <strong>Metrics tab is unbuilt.</strong> Backend has no <code>GET /api/v1/resources/:id/metrics</code> endpoint.
            Brief §5.5 requires storage / connections / query-rate over 24h / 7d / 30d. <strong>Frontend is blocked until contract locks.</strong> See <Link to="/contracts" style={{ textDecoration: 'underline' }}>Contracts</Link>.
          </ContractBanner>
          <Card title="Metrics · 24h" right={<span style={{ color: 'var(--rose)' }}>no data source</span>}>
            <div style={{ opacity: 0.4, padding: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
              awaiting backend
            </div>
          </Card>
        </>
      )}

      {/* AUDIT — blocked */}
      {tab === 'Audit' && (
        <ContractBanner kind="blocked" badge="🔒 blocked">
          <strong>Audit tab is unbuilt.</strong> No <code>GET /api/v1/resources/:id/audit</code> endpoint exists. Lock proposal in{' '}
          <Link to="/contracts" style={{ textDecoration: 'underline' }}>Contracts</Link>.
        </ContractBanner>
      )}
    </>
  )
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  )
}
