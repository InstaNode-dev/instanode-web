import { FormEvent, useEffect, useState } from 'react'
import { Card, RelTime } from '../components/Common'
import * as api from '../api'
import type { VaultEntry } from '../api'
import { useDashboardCtx, addEnv as addEnvCtx } from '../hooks/useDashboardCtx'

export function VaultPage() {
  const ctx = useDashboardCtx()
  const env = ctx.env
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.listVault(env)
      setEntries(r.entries)
    } catch (e: any) {
      setErr(e?.message ?? 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [env])

  async function reveal(key: string) {
    setBusy(key)
    setErr(null)
    try {
      const r = await api.revealVaultSecret(env, key)
      setRevealed((prev) => ({ ...prev, [key]: r.value }))
    } catch (e: any) {
      setErr(`reveal ${key}: ${e?.message ?? 'failed'}`)
    } finally {
      setBusy(null)
    }
  }

  async function remove(key: string) {
    if (!window.confirm(`Delete ${key} from ${env}? Removes every version permanently.`)) return
    setBusy(key)
    try {
      await api.deleteVaultSecret(env, key)
      await refresh()
    } catch (e: any) {
      setErr(`delete ${key}: ${e?.message ?? 'failed'}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h1 style={{ fontSize: 32, marginBottom: 6 }}>Vault</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
        Encrypted secrets · AES-256-GCM · scoped to <code style={{ color: 'var(--accent)' }}>{env}</code>
      </p>

      {err && (
        <div role="alert" style={{ borderLeft: '2px solid var(--rose)', padding: '10px 12px', marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {err}
        </div>
      )}

      <div className="vault-tabs">
        {ctx.envs.map((e) => (
          <button
            key={e}
            className={`vault-tab ${env === e ? 'active' : ''}`}
            onClick={() => addEnvCtx(e)}
          >
            {e === 'production' ? 'prod' : e === 'development' ? 'dev' : e}
          </button>
        ))}
        <NewEnvButton />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {env} · {entries.length} entries · aes-256-gcm
          </div>
          <button
            className="btn btn-sm btn-secondary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowAdd(true)}
            data-testid="add-secret"
          >
            + add secret
          </button>
        </div>

        {showAdd && (
          <AddSecretRow
            env={env}
            onClose={() => setShowAdd(false)}
            onSaved={() => { setShowAdd(false); refresh() }}
          />
        )}

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>loading…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
            <p style={{ marginBottom: 8 }}>no secrets in <code>{env}</code></p>
            <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              add one above, or run <code style={{ color: 'var(--accent)' }}>PUT /api/v1/vault/{env}/&lt;KEY&gt;</code> from your agent.
            </p>
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.key} className="vault-row" data-testid={`vault-row-${e.key}`}>
              <span className="ico">⚷</span>
              <span className="name">{e.key}</span>
              <span className="meta">rotated <RelTime at={e.rotated_at} /></span>
              <span className="meta" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {revealed[e.key] ? (
                  <code style={{ color: 'var(--accent)' }}>{revealed[e.key]}</code>
                ) : (
                  <span style={{ color: 'var(--text-faint)' }}>•••••</span>
                )}
              </span>
              {revealed[e.key] ? (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setRevealed((p) => { const { [e.key]: _, ...rest } = p; return rest })}
                >
                  hide
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy === e.key}
                  onClick={() => reveal(e.key)}
                  data-testid={`reveal-${e.key}`}
                >
                  {busy === e.key ? '…' : 'reveal'}
                </button>
              )}
              <button
                className="btn btn-sm btn-ghost"
                style={{ color: 'var(--rose)' }}
                disabled={busy === e.key}
                onClick={() => remove(e.key)}
                data-testid={`delete-${e.key}`}
              >
                delete
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 24 }}>
        <Card>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>encryption</div>
          <h4 style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>AES-256-GCM at rest</h4>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Every value is encrypted with the cluster's AES key before it touches Postgres. Reveal logs an audit row.
          </p>
        </Card>
        <Card>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>runtime resolution</div>
          <h4 style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>vault://env/KEY</h4>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Use <code>vault://KEY</code> in deploy env vars. The deployer resolves at deploy time. Plaintext never lands in your manifest or build logs.
          </p>
        </Card>
        <Card>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>scope</div>
          <h4 style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Per-env isolation</h4>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Secrets are scoped to a specific env. Production deploys cannot read staging keys.
          </p>
        </Card>
      </div>
    </>
  )
}

function NewEnvButton() {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  if (!creating) {
    return <button className="vault-tab" onClick={() => setCreating(true)} data-testid="vault-add-env">+ new env</button>
  }
  return (
    <span className="vault-tab" style={{ display: 'inline-flex', gap: 4, padding: '4px 8px' }}>
      <input
        autoFocus
        placeholder="qa"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim()) addEnvCtx(name); setCreating(false); setName('') }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) { addEnvCtx(name); setCreating(false); setName('') }
          if (e.key === 'Escape') { setCreating(false); setName('') }
        }}
        style={{
          background: 'transparent', border: 0, outline: 'none', color: 'var(--accent)',
          fontFamily: 'var(--font-mono)', fontSize: 11, width: 60,
        }}
      />
    </span>
  )
}

function AddSecretRow({
  env,
  onClose,
  onSaved,
}: {
  env: string
  onClose: () => void
  onSaved: () => void
}) {
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!/^[A-Z0-9_]{1,80}$/.test(k.trim())) {
      setErr('Key must be UPPER_SNAKE_CASE.')
      return
    }
    if (!v) { setErr('Value is required.'); return }
    setBusy(true)
    try {
      await api.putVaultSecret(env, k.trim(), v)
      onSaved()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface)' }}>
      <input
        placeholder="KEY_NAME"
        value={k}
        onChange={(e) => setK(e.target.value.toUpperCase())}
        autoFocus
        data-testid="add-secret-key"
        style={{ background: 'var(--ink)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 12.5, borderRadius: 4, width: 220 }}
      />
      <input
        type="password"
        placeholder="value"
        value={v}
        onChange={(e) => setV(e.target.value)}
        data-testid="add-secret-value"
        style={{ background: 'var(--ink)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 12.5, borderRadius: 4, flex: 1 }}
      />
      {err && <span style={{ color: 'var(--rose)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{err}</span>}
      <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{busy ? 'saving…' : 'save'}</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>cancel</button>
    </form>
  )
}
