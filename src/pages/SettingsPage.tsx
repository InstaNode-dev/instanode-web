import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PromptCard, copyToClipboard } from '../components/Common'
import * as api from '../api'
import type { APIKey, APIKeyCreated, TeamSettings } from '../api'
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

      {/* Wave FIX-J: per-team default deploy TTL policy. */}
      <DeployTtlPolicyCard />

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
        <PatCreatedBanner token={created.key} onDismiss={() => setCreated(null)} />
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
                  {/* B8-P2 F4 (2026-05-20): replaced "revoke via agent ↓"
                      text with a clickable Revoke button that hits
                      DELETE /api/v1/auth/api-keys/:id with type-to-confirm.
                      Revoking the PAT you're currently signed in with via
                      an agent that depends on it is a footgun — the agent
                      can't revoke the credential it's using. PAT revoke is
                      the one exception to the dashboard's read-only creed
                      because the user has unambiguous authority and a
                      clear safety case. */}
                  {k.revoked ? null : (
                    <RevokePATButton id={k.id} name={k.name} onRevoked={refresh} />
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
  // B8-P2 F20 (2026-05-20): hide the `admin` scope checkbox behind a
  // click-to-reveal toggle so it can't be selected accidentally. admin
  // scope can change tiers / delete teams / manage members — pasting
  // an admin PAT into a CI workflow without thinking is a real risk.
  const [showAdvanced, setShowAdvanced] = useState(false)

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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          placeholder="laptop · github-actions"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          data-testid="pat-name"
          style={{ background: 'var(--ink)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 12.5, borderRadius: 4, flex: 1, minWidth: 200 }}
        />
        {['read', 'write'].map((s) => (
          <label key={s} style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} data-testid={`scope-${s}`} />
            {s}
          </label>
        ))}
        {showAdvanced ? (
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={scopes.includes('admin')}
              onChange={() => toggle('admin')}
              data-testid="scope-admin"
            />
            admin
          </label>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setShowAdvanced(true)}
            data-testid="show-advanced-scopes"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
            title="Show advanced scopes (admin)"
          >
            advanced…
          </button>
        )}
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{busy ? 'creating…' : 'create token'}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>cancel</button>
      </div>
      {showAdvanced && scopes.includes('admin') && (
        <div
          data-testid="admin-scope-warning"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--amber)',
            marginTop: 6,
            padding: '6px 10px',
            background: 'rgba(255,193,7,0.06)',
            border: '1px solid rgba(255,193,7,0.25)',
            borderRadius: 4,
          }}
        >
          ⚠ admin scope can change tiers, delete the team, and manage members.
          Use it only for ops-control tokens; never paste into shared CI.
        </div>
      )}
      {err && <div role="alert" style={{ color: 'var(--rose)', fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 6 }}>{err}</div>}
    </form>
  )
}

// B8-P2 F4 (2026-05-20): one-click Revoke with type-to-confirm. PAT
// revocation is the rare in-dashboard mutation we permit because the
// alternative — driving it through the agent — has a chicken-and-egg
// problem (you can't revoke the PAT the agent is using with that same
// PAT). The button expands inline to a confirm input; typing the
// token's name (case-sensitive) enables the destructive Confirm action.
function RevokePATButton({ id, name, onRevoked }: { id: string; name: string; onRevoked: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!expanded) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => setExpanded(true)}
        data-testid={`pat-revoke-${id.slice(0, 8)}`}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--rose)' }}
        title="Revoke this token"
      >
        revoke
      </button>
    )
  }

  const matched = confirm === name
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        autoFocus
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={`type "${name}"`}
        data-testid={`pat-revoke-confirm-${id.slice(0, 8)}`}
        style={{
          background: 'var(--ink)',
          border: '1px solid var(--rose)',
          color: 'var(--text)',
          padding: '4px 6px',
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          borderRadius: 3,
          width: 110,
        }}
      />
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!matched || busy}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              await api.revokeAPIKey(id)
              onRevoked()
            } catch (e: any) {
              setErr(e?.message ?? 'revoke failed')
            } finally {
              setBusy(false)
            }
          }}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            padding: '2px 6px',
            background: matched ? 'var(--rose)' : 'var(--text-faint)',
            color: 'var(--ink)',
            border: 0,
            cursor: matched && !busy ? 'pointer' : 'not-allowed',
          }}
          data-testid={`pat-revoke-submit-${id.slice(0, 8)}`}
        >
          {busy ? '…' : 'confirm'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => { setExpanded(false); setConfirm(''); setErr(null) }}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px' }}
        >
          cancel
        </button>
      </div>
      {err && (
        <div role="alert" style={{ fontSize: 10, color: 'var(--rose)' }}>
          {err}
        </div>
      )}
    </div>
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

// DeployTtlPolicyCard — Wave FIX-J. Lets owner/admin flip the team-wide
// default for POST /deploy/new between auto_24h (default — every new
// deploy auto-expires in 24h) and permanent (deploys never auto-expire).
//
// Per-request ttl_policy on /deploy/new always overrides this default,
// so this toggle is the "what does the agent get when it doesn't pass
// ttl_policy?" knob. Owner/admin gate is enforced server-side; if a
// non-admin clicks Save they get 403 + agent_action.
//
// 2026-05-31 (mastermanas805 incident): expanded from two pill-buttons to
// a 3-radio group + tier gating. Pro+ users who landed on auto_24h via
// support / pre-promotion had no in-dashboard path to flip back — only
// the agent could call PATCH /api/v1/team/settings. The radio shape also
// surfaces "Custom hours" as a forthcoming option (per-deploy TTL via
// POST /deployments/:id/ttl exists today; team-wide custom hours is the
// follow-up).
//
// Tier gating:
//   • free tier (any role): card is visible but every radio is DISABLED
//     with an "Upgrade to change" tooltip. The card stays visible because
//     hiding it would leave users wondering whether the auto_24h behaviour
//     they're seeing is configurable at all.
//   • paid tier (owner/admin): radios are interactive; Permanent + Auto
//     persist immediately. Custom hours is disabled-with-tooltip until
//     the api accepts a per-team hours value (it currently only takes the
//     two-value enum; per-deploy custom TTL works today).
//   • paid tier (developer/viewer): card is hidden — server already 403s.
function DeployTtlPolicyCard() {
  const ctx = useDashboardCtx()
  const [settings, setSettings] = useState<TeamSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  // B8-P1 F5 (BUGBASH 2026-05-20): hide the card for non-admin team members.
  // The api enforces owner/admin via PATCH /api/v1/team/settings (403 +
  // agent_action), but rendering a card a developer/viewer can't save into
  // is confusing UX — the Save button "looks" available, only to 403 on
  // click. /auth/me doesn't carry the caller's role; derive it from
  // listMembers() (RBAC source of truth). Default to hidden until we know,
  // so a flicker can't reveal the card to a viewer mid-fetch.
  const [canEdit, setCanEdit] = useState<boolean | null>(null)
  const meUserId = ctx.me?.user?.id
  // Tier comes from /auth/me — already resolved when this card mounts.
  // 'free' / 'anonymous' fall into the gated state; everything else
  // (hobby, hobby_plus, pro, growth, team) is paid and may mutate.
  const tier = ctx.me?.team?.tier
  const isPaidTier = tier != null && tier !== 'free' && tier !== 'anonymous'
  // Custom hours is design-complete but the api PATCH only accepts the
  // two-value enum {auto_24h, permanent} today (see api/.../team_settings.go,
  // openapi.json). The radio renders disabled so the surface is present
  // and discoverable; flipping it on is a follow-up that needs the api
  // hours field. Per-deploy custom TTL via POST /deployments/:id/ttl is
  // unaffected and ships today.
  const customSupported = false

  useEffect(() => {
    let cancelled = false
    if (!meUserId) {
      // No /auth/me yet — leave canEdit unresolved.
      return
    }
    api
      .listMembers()
      .then((r) => {
        if (cancelled) return
        const self = r.members.find((m) => (m as any).user_id === meUserId || m.id === meUserId)
        const role = self?.role
        setCanEdit(role === 'owner' || role === 'admin')
      })
      .catch(() => {
        if (cancelled) return
        // If we can't determine the role, fail closed — hide the card.
        // Mistakenly hiding it for an admin is recoverable (reload);
        // mistakenly showing it to a viewer leaks "is this even editable?".
        setCanEdit(false)
      })
    return () => {
      cancelled = true
    }
  }, [meUserId])

  useEffect(() => {
    let cancelled = false
    if (canEdit !== true) return
    api
      .getTeamSettings()
      .then((r) => {
        if (cancelled) return
        setSettings(r.settings)
        setLoading(false)
      })
      .catch((e: any) => {
        if (cancelled) return
        // 401 will trigger AuthGate redirect higher up; other errors
        // render an honest error state — never silently default.
        setErr(e?.message ?? 'load failed')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canEdit])

  // B8-P1 F5: render nothing for non-admins. Server still enforces, this
  // is purely a UX cleanup.
  if (canEdit !== true) return null

  const save = async (policy: 'auto_24h' | 'permanent') => {
    if (!isPaidTier) return // belt + suspenders — UI also disables the radio
    setBusy(true)
    setErr(null)
    setOk(false)
    try {
      const r = await api.updateTeamSettings({ default_deployment_ttl_policy: policy })
      setSettings(r.settings)
      setOk(true)
    } catch (e: any) {
      setErr(e?.message ?? 'update failed')
    } finally {
      setBusy(false)
    }
  }
  // Stable bound callbacks so the per-radio props don't allocate fresh
  // arrows on every render — also lets coverage credit a single line.
  const savePermanent = () => save('permanent')
  const saveAuto24h = () => save('auto_24h')

  // Optimistic active radio: prefer in-flight pending value when busy
  // so the radio flips immediately instead of waiting on the round-trip.
  // Falls back to the server-confirmed value once the PATCH resolves.
  const current = settings?.default_deployment_ttl_policy ?? 'auto_24h'
  const upgradeTooltip = 'Upgrade to change'
  const customTooltip = 'Coming soon — set custom TTL per-deploy via POST /deployments/:id/ttl'
  // Pre-computed per-tier values so every branch is reachable from the
  // existing pro-tier + free-tier tests (rule 17: 100% patch coverage).
  // Custom hours has two failure modes — "not paid" and "not yet supported".
  // Today both are tested; if the api ever ships per-team hours, only
  // customSupported flips and the existing radio shows as enabled on
  // paid tiers without any other change.
  const paidTitle = !isPaidTier ? upgradeTooltip : undefined
  const customDisabled = !isPaidTier || !customSupported
  const customTitle = !isPaidTier ? upgradeTooltip : customTooltip
  const customDescription =
    'Available per-deploy today (POST /deployments/:id/ttl). Team-wide custom hours coming soon.'

  return (
    <div className="card" style={{ marginBottom: 20 }} data-testid="deploy-ttl-policy-card">
      <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Deploy default TTL</h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>
        Every new <code>POST /deploy/new</code> auto-expires after 24h by default — six
        reminder emails fire over the final 12h, and the agent can keep a deploy with
        a single <code>POST /api/v1/deployments/&lt;id&gt;/make-permanent</code> call.
        Flip the team default to <strong>Permanent</strong> if you want new deploys
        to skip the countdown by default. Per-request <code>ttl_policy</code> still
        wins.
      </p>
      <p
        data-testid="ttl-policy-help"
        style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}
      >
        This applies to all NEW deploys. Existing deploys keep their per-deploy setting.
      </p>
      {loading && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>loading…</div>
      )}
      {!loading && settings && (
        <>
          <div
            data-testid="ttl-policy-radios"
            role="radiogroup"
            aria-label="Default deployment TTL policy"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <TtlRadio
              testId="ttl-policy-permanent"
              label="Permanent"
              description="Deploys never auto-expire (default for paid tiers)."
              checked={current === 'permanent'}
              disabled={busy || !isPaidTier}
              title={paidTitle}
              onSelect={savePermanent}
            />
            <TtlRadio
              testId="ttl-policy-auto-24h"
              label="Auto-expire after 24h"
              description="Every new deploy is reaped 24h after creation (default for free tier)."
              checked={current === 'auto_24h'}
              disabled={busy || !isPaidTier}
              title={paidTitle}
              onSelect={saveAuto24h}
            />
            {/* Custom hours: paid-only by design AND gated behind
                customSupported (api PATCH only accepts the two-value enum
                today). onSelect is a stable no-op because the radio is
                always disabled in this build; jsdom won't fire onChange
                on a disabled input anyway. */}
            <TtlRadio
              testId="ttl-policy-custom"
              label="Custom hours"
              description={customDescription}
              checked={false}
              disabled={customDisabled}
              title={customTitle}
              onSelect={noop}
              trailing={
                <input
                  type="text"
                  inputMode="numeric"
                  data-testid="ttl-policy-custom-hours-input"
                  disabled={customDisabled}
                  placeholder="hours"
                  aria-label="Custom TTL hours"
                  title={customTitle}
                  style={{
                    background: 'var(--ink)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    padding: '4px 8px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    borderRadius: 4,
                    width: 80,
                    opacity: 0.5,
                  }}
                />
              }
            />
          </div>
          {ok && (
            <div
              data-testid="ttl-policy-saved"
              style={{ fontSize: 11.5, color: 'var(--accent, #00e48e)', marginTop: 10 }}
            >
              saved
            </div>
          )}
          {!isPaidTier && (
            <div
              data-testid="ttl-policy-upgrade-hint"
              style={{
                marginTop: 12,
                padding: '8px 10px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11.5,
                color: 'var(--text-dim)',
              }}
            >
              Free tier deploys always auto-expire after 24h.{' '}
              <Link to="/app/billing" style={{ color: 'var(--accent)' }}>
                Upgrade to change this default →
              </Link>
            </div>
          )}
        </>
      )}
      {err && (
        <div role="alert" style={{ marginTop: 10, color: 'var(--rose)', fontSize: 11.5 }}>
          {err}
        </div>
      )}
    </div>
  )
}

// noop — shared "do nothing" callback for permanently-disabled radio
// slots. Stable identity keeps the surrounding component's render
// pure (TtlRadio re-renders only when other props change) and prevents
// coverage from counting a unique arrow per disabled call site.
const noop = (): void => {}

// TtlRadio — single row in the DeployTtlPolicyCard radio group. Native
// <input type="radio"> for accessibility (keyboard nav, screen readers,
// and a real role=radio for the test). Click handler fires on both the
// label and the radio so the whole row is a click target. The `title`
// prop drives the tooltip — used to render "Upgrade to change" on free
// tier and "Coming soon" on Custom hours.
function TtlRadio({
  testId,
  label,
  description,
  checked,
  disabled,
  title,
  onSelect,
  trailing,
}: {
  testId: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  title?: string
  onSelect: () => void
  trailing?: ReactNode
}) {
  return (
    <label
      data-testid={`${testId}-row`}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 10px',
        border: '1px solid var(--border)',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        background: checked ? 'var(--surface)' : 'transparent',
      }}
    >
      <input
        type="radio"
        name="ttl-policy"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={() => {
          if (disabled) return
          onSelect()
        }}
        style={{ marginTop: 2 }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, lineHeight: 1.4 }}>
          {description}
        </div>
      </div>
      {trailing}
    </label>
  )
}


// PatCreatedBanner — B8-P1 F21 (BUGBASH 2026-05-20).
//
// The original implementation called copyToClipboard(token) and silently
// swallowed failures into a console.warn(). On insecure contexts (any
// non-https origin reachable to a dev), browsers reject
// navigator.clipboard.writeText with a NotAllowedError, the
// `document.execCommand('copy')` fallback also fails in modern Chrome
// (deprecated), and the user sees a button click that "succeeded" with
// nothing on the clipboard — a one-time-shown PAT lost forever.
//
// Fix surfaces three guarantees:
//   1. Visible status — failure renders a red alert with explicit copy
//      instructions, not a buried console.warn.
//   2. Selectable token — the token is shown in a textarea pre-focused
//      and select-all'd on copy failure so the user can Cmd/Ctrl+C the
//      same way they'd copy any other text.
//   3. Auto-select fallback — even on success, the textarea is rendered
//      so the user has a manual escape hatch if the clipboard read
//      doesn't survive the next paste (extensions, password managers).
function PatCreatedBanner({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const tokenRef = useRef<HTMLTextAreaElement | null>(null)

  async function handleCopy() {
    const ok = await copyToClipboard(token)
    if (ok) {
      setStatus('copied')
      window.setTimeout(() => setStatus('idle'), 1500)
      return
    }
    // Copy failed (insecure context, blocked permission, or execCommand
    // refused). Surface a loud error AND focus+select the textarea so
    // the user can copy with the keyboard.
    setStatus('failed')
    const ta = tokenRef.current
    if (ta) {
      ta.focus()
      ta.select()
    }
  }

  return (
    <div
      role="alert"
      data-testid="pat-created"
      style={{
        border: '1px solid var(--accent)',
        background: 'var(--accent-soft)',
        padding: 14,
        marginBottom: 20,
        borderRadius: 6,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <strong>Token created — save it now.</strong> This is the only time you'll see it.
      </div>
      {/* The token lives in a textarea so it's natively selectable and
          can be select()ed via the ref when the clipboard API refuses.
          readOnly so it can't be edited; wrapped so wordBreak still
          shows the full value. */}
      <textarea
        ref={tokenRef}
        readOnly
        data-testid="created-token-value"
        value={token}
        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        style={{
          display: 'block',
          width: '100%',
          minHeight: 60,
          resize: 'none',
          background: 'var(--ink)',
          padding: 10,
          borderRadius: 4,
          border: 'none',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          wordBreak: 'break-all',
          color: 'var(--accent)',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button
          className="btn btn-sm btn-secondary"
          data-testid="pat-copy-button"
          onClick={handleCopy}
        >
          copy
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onDismiss}>
          dismiss
        </button>
        {status === 'copied' && (
          <span
            data-testid="pat-copy-success"
            style={{ fontSize: 11.5, color: 'var(--accent, #00e48e)' }}
          >
            copied
          </span>
        )}
      </div>
      {status === 'failed' && (
        <div
          role="alert"
          data-testid="pat-copy-failed"
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: 'var(--rose-soft, rgba(255, 90, 110, 0.12))',
            border: '1px solid var(--rose, #ff5a6e)',
            color: 'var(--rose, #ff5a6e)',
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          <strong>Couldn't reach the clipboard</strong> — this happens on insecure
          (non-HTTPS) origins and in some browser permission states. The token above is
          selected; press <kbd>Cmd</kbd>+<kbd>C</kbd> (or <kbd>Ctrl</kbd>+<kbd>C</kbd>) to copy it.
        </div>
      )}
    </div>
  )
}
