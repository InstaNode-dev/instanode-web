import { FormEvent, useEffect, useState } from 'react'
import { PromptCard, copyToClipboard } from '../components/Common'
import * as api from '../api'
import type { APIKey, APIKeyCreated } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

// PAT creation stays clickable here because it's the bootstrap surface:
// the user's FIRST token has to come from the dashboard session — the
// agent can't mint its own credentials before having any credentials.
// Revocation, on the other hand, goes through the agent like every
// other mutation.
export function SettingsPage() {
  const ctx = useDashboardCtx()
  const [keys, setKeys] = useState<APIKey[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [created, setCreated] = useState<APIKeyCreated | null>(null)

  async function refresh() {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.listAPIKeys()
      setKeys(r.items)
    } catch (e: any) {
      setErr(e?.message ?? 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <>
      <h1 style={{ fontSize: 32, marginBottom: 6 }}>Settings</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
        Personal Access Tokens for agents and CI · scoped to your team
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Profile</h3>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>email · cannot change</div>
            <div style={{ fontSize: 14 }}>{ctx.me?.user?.email ?? '—'}</div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>user id</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{ctx.me?.user?.id ?? '—'}</div>
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Team</h3>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>tier</div>
            <div style={{ fontSize: 14 }}>{ctx.me?.team?.tier ?? '—'}</div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>team id</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{ctx.me?.team?.id ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* PAT mint result */}
      {created && (
        <div role="alert" data-testid="pat-created" style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', padding: 14, marginBottom: 20, borderRadius: 6 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Token created — save it now.</strong> This is the only time you'll see it.
          </div>
          <code data-testid="created-token-value" style={{ display: 'block', background: 'var(--ink)', padding: 10, borderRadius: 4, fontSize: 12, wordBreak: 'break-all', color: 'var(--accent)' }}>{created.key}</code>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-sm btn-secondary" onClick={async () => {
              const ok = await copyToClipboard(created.key)
              if (!ok) console.warn('[SettingsPage] copy failed — clipboard unavailable')
            }}>copy</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setCreated(null)}>dismiss</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>API tokens · personal</h3>
          <button
            className="btn btn-sm btn-primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowNew(true)}
            data-testid="new-pat"
          >
            + new token
          </button>
        </div>

        {showNew && <CreatePATForm onClose={() => setShowNew(false)} onCreated={(k) => { setCreated(k); refresh(); setShowNew(false) }} />}

        {err && <div role="alert" style={{ padding: 14, color: 'var(--rose)' }}>{err}</div>}
        {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>loading…</div>}

        {!loading && keys.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>
            <div style={{ marginBottom: 6 }}>no tokens yet</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              tokens authenticate <code>instant</code> CLI calls and CI workflows.
            </div>
          </div>
        )}

        {!loading && keys.length > 0 && (
          <div className="table" data-testid="pat-list">
            {keys.map((k) => (
              <div key={k.id} className="table-row" style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr 100px' }} data-testid={`pat-row-${k.id.slice(0, 8)}`}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{k.name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>
                    {k.scopes.join(' · ')}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                  created {new Date(k.created_at).toLocaleDateString()}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
                  {k.last_used_at ? `used ${fmtRel(k.last_used_at)}` : 'never used'}
                </div>
                <div>
                  {k.revoked ? (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--rose)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>revoked</span>
                  ) : null}
                </div>
                <div>
                  {k.revoked ? null : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>
                      revoke via agent ↓
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <PromptCard
          danger
          title="Revoke a token"
          hint="via agent"
          prompt={
            <>
              Revoke a personal access token. Any agent, CI workflow, or script using it
              starts failing within seconds — make sure nothing live depends on the token
              before sending.
            </>
          }
          promptText={
            `Revoke a personal access token on my instanode account.\n` +
            `\n` +
            `- Token id (copy from the list on dashboard /settings): <token-id>\n` +
            `- Endpoint: DELETE https://api.instanode.dev/api/v1/api-keys/<token-id>\n` +
            `- Auth: use my INSTANODE_TOKEN env var as Bearer (a DIFFERENT token — you cannot revoke the token you're authenticating with)\n` +
            `\n` +
            `Before revoking: check that nothing live depends on this token. Common places to look: my agent's INSTANODE_TOKEN env var, .github/workflows/*.yml, any CI secret called INSTANODE_*, any deployed service env. After revoke, any caller using it will get 401 within seconds.`
          }
          method="DELETE"
          endpoint={`/api/v1/api-keys/<token-id>`}
        />
      </div>
    </>
  )
}

function CreatePATForm({ onClose, onCreated }: { onClose: () => void; onCreated: (k: APIKeyCreated) => void }) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['read', 'write'])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function toggle(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) { setErr('Name is required.'); return }
    setBusy(true)
    try {
      const k = await api.createAPIKey({ name: name.trim(), scopes })
      onCreated(k)
    } catch (e: any) {
      setErr(e?.message ?? 'create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ padding: 14, borderBottom: '1px solid var(--border)', background: 'var(--surface)' }} data-testid="create-form">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input
          placeholder="laptop · github-actions"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          data-testid="pat-name"
          style={{ background: 'var(--ink)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 12.5, borderRadius: 4, flex: 1 }}
        />
        {['read', 'write', 'admin'].map((s) => (
          <label key={s} style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} data-testid={`scope-${s}`} />
            {s}
          </label>
        ))}
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{busy ? 'creating…' : 'create token'}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>cancel</button>
      </div>
      {err && <div role="alert" style={{ color: 'var(--rose)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{err}</div>}
    </form>
  )
}

function fmtRel(iso: string) {
  const t = new Date(iso).getTime()
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
