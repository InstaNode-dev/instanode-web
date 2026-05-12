import { useEffect, useState } from 'react'
import { Card, PromptCard, RelTime } from '../components/Common'
import { UpgradePromptCard } from '../components/UpgradePromptCard'
import * as api from '../api'
import type { Tier, VaultEntry } from '../api'
import { useDashboardCtx, addEnv as addEnvCtx } from '../hooks/useDashboardCtx'

// Tiers that have multi-env vault access. Anything outside this set is
// limited to the production env on its own tier (hobby = prod-only). Pasting
// the API-side allowlist here keeps the dashboard from over-promising.
const VAULT_MULTI_ENV_TIERS: ReadonlySet<Tier> = new Set(['pro', 'team', 'growth'])

export function VaultPage() {
  const ctx = useDashboardCtx()
  const env = ctx.env
  const tier = (ctx.me?.team.tier ?? 'hobby') as Tier
  // The vault_prod upsell only makes sense for tiers that don't already
  // have multi-env access. We surface it when the user has navigated to a
  // non-production env tab on a single-env tier — the explicit signal that
  // they're hitting the wall this tier enforces.
  const showVaultUpsell =
    !VAULT_MULTI_ENV_TIERS.has(tier) && env !== 'production'
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
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

  // Reveal is a read (with audit), not a mutation — kept clickable so the
  // human can inspect a secret value here. Add / delete go through the agent
  // via PromptCard so the dashboard never writes.
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

      {showVaultUpsell && (
        <div style={{ marginBottom: 16 }}>
          <UpgradePromptCard feature="vault_prod" />
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
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>loading…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
            <p style={{ marginBottom: 8 }}>no secrets in <code>{env}</code></p>
            <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              copy the "Add or update a secret" prompt below and paste it to your agent.
            </p>
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.key} className="vault-row" data-testid={`vault-row-${e.key}`}>
              <span className="ico">⚷</span>
              <span className="name">{e.key}</span>
              <span className="meta">
                {e.rotated_at ? <>rotated <RelTime at={e.rotated_at} /></> : null}
              </span>
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
            </div>
          ))
        )}
      </div>

      {/* Agent-prompt cards: dashboard never writes. Add/delete flow through agent. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <PromptCard
          title="Add or update a secret"
          hint="via agent"
          prompt={
            <>
              Add a vault secret to the <code>{env}</code> env. Reuse the same prompt to
              update an existing key — versions are kept and the latest wins at deploy time.
            </>
          }
          promptText={
            `Add a secret to my instanode vault in the "${env}" env.\n` +
            `\n` +
            `- Key: <UPPER_SNAKE_CASE_KEY>\n` +
            `- Value: <plaintext value — replace with the real value before sending>\n` +
            `- Endpoint: PUT https://api.instanode.dev/api/v1/vault/${env}/<KEY>\n` +
            `- Body: {"value":"<VALUE>"}\n` +
            `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
            `\n` +
            `The value is encrypted with AES-256-GCM before it touches Postgres. To use at runtime, reference it as vault://${env}/<KEY> in any deploy env var — the deployer resolves at deploy time so plaintext never lands in manifests or build logs.`
          }
          method="PUT"
          endpoint={`/api/v1/vault/${env}/<KEY>`}
        />
        <PromptCard
          danger
          title="Delete a secret"
          hint="data loss"
          prompt={
            <>
              Remove a vault secret from <code>{env}</code>. Drops every version permanently —
              cannot be recovered.
            </>
          }
          promptText={
            `Delete a secret from my instanode vault in the "${env}" env. All versions are removed permanently — no recovery.\n` +
            `\n` +
            `- Key to delete: <UPPER_SNAKE_CASE_KEY>\n` +
            `- Endpoint: DELETE https://api.instanode.dev/api/v1/vault/${env}/<KEY>\n` +
            `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
            `\n` +
            `Before deleting: grep my codebase for vault://${env}/<KEY> references so I know which deploys will break on next rollout.`
          }
          method="DELETE"
          endpoint={`/api/v1/vault/${env}/<KEY>`}
        />
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

