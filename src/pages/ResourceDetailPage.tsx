import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ROBanner, ContractBanner, EnvPill, TierPill, ResourceIcon,
  Card, ContractLine, PromptCard, PromptPill
} from '../components/Common'
import * as api from '../api'
import type { Resource } from '../api'

const TABS = ['Overview', 'Connection', 'Metrics', 'Audit'] as const
type Tab = (typeof TABS)[number]

export function ResourceDetailPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [r, setR] = useState<Resource | null>(null)
  const [tab, setTab] = useState<Tab>('Overview')
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.getResource(id)
      .then(({ resource }) => setR(resource))
      .catch((e) => setErr(e?.message ?? 'load failed'))
  }, [id])

  async function rotate() {
    if (!r) return
    if (!window.confirm('Rotate credentials? Existing connections using the old URL will need to reconnect.')) return
    setBusy('rotate'); setErr(null)
    try {
      const { resource } = await api.rotateResource(r.id)
      setR(resource); setRevealed(true)
    } catch (e: any) {
      setErr(e?.message ?? 'rotate failed')
    } finally {
      setBusy(null)
    }
  }

  async function destroy() {
    if (!r) return
    if (!window.confirm(`Delete ${r.name ?? r.id}? The data is gone for good.`)) return
    setBusy('delete'); setErr(null)
    try {
      await api.deleteResource(r.id)
      nav('/resources')
    } catch (e: any) {
      setErr(e?.message ?? 'delete failed')
      setBusy(null)
    }
  }

  function copyURL() {
    if (!r?.connection_url) return
    navigator.clipboard.writeText(r.connection_url)
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' }}>
              {r.name ?? r.id}
            </h2>
            <EnvPill env={r.env} />
            <TierPill tier={r.tier} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>
            {r.token} · {r.resource_type} · {r.cloud_vendor ?? 'aws'} · {r.country_code ?? 'IN'} · created{' '}
            {new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <PromptPill label="ask agent" />
        </div>
      </div>

      <ROBanner>
        The dashboard mirrors the resource — it never writes. <strong>To rotate, rename, or delete this Postgres, prompt your agent.</strong> The agent calls the same locked API endpoints listed below.
      </ROBanner>

      <ContractBanner kind="locked" badge="locked">
        <strong>GET /api/v1/resources/:id</strong> · returns the full <code>Resource</code> shape including <code>connection_url</code>.
        The connection URL is single-use safe — frontend keeps it in memory only, masks by default, reveals on click.
      </ContractBanner>

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
                <button className="btn btn-sm btn-secondary" onClick={rotate} disabled={busy === 'rotate'} data-testid="rotate">
                  {busy === 'rotate' ? 'rotating…' : 'rotate'}
                </button>
                <button className="btn btn-sm btn-ghost" style={{ color: 'var(--rose)' }} onClick={destroy} disabled={busy === 'delete'} data-testid="delete">
                  {busy === 'delete' ? 'deleting…' : 'delete'}
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
              danger
              title="Mutate this resource"
              hint="via agent"
              prompt={<>Rotate the password for <em>{r.name ?? r.id}</em></>}
              method="POST"
              endpoint={`/api/v1/resources/${r.token}/rotate`}
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
