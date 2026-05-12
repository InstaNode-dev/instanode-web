import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Brand, ResourceIcon } from '../components/Common'
import { claim, createAPIKey, createCheckout, listResources, setToken } from '../api'
import type { Resource, ResourceType } from '../api'

type Preview = { type: ResourceType; id: string; size: string }
type Stage = 'enter-email' | 'claiming' | 'choose-plan' | 'checkout' | 'error'

function decodeJWT(jwt: string): {
  rt?: string[]
  tok?: string[]
  co?: string
  cv?: string
  exp?: number
} | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const padded = parts[1] + '='.repeat((-parts[1].length) & 3)
    return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

const SIZE_HINT: Record<string, string> = {
  postgres: '10 MB',
  redis: '5 MB',
  mongodb: '5 MB',
  webhook: '100 stored',
  queue: '24 h',
  storage: '1 bucket',
}

// Returns ms remaining until the soonest expiry across the given resources.
// Returns null when no resource has an expires_at (already permanent — shouldn't
// happen at this point in the flow, but we render the page gracefully if so).
function soonestExpiryMs(items: Resource[], now: number = Date.now()): number | null {
  let soonest: number | null = null
  for (const r of items) {
    if (!r.expires_at) continue
    const t = new Date(r.expires_at).getTime()
    if (Number.isNaN(t)) continue
    if (soonest === null || t < soonest) soonest = t
  }
  return soonest === null ? null : Math.max(0, soonest - now)
}

function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function ClaimPage() {
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const [email, setEmail] = useState('')
  const [stage, setStage] = useState<Stage>('enter-email')
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [countdownMs, setCountdownMs] = useState<number | null>(null)
  const [explainerOpen, setExplainerOpen] = useState(true)
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null)
  const [checkoutPlan, setCheckoutPlan] = useState<'hobby' | 'pro' | null>(null)

  useEffect(() => {
    if (!token) return
    const decoded = decodeJWT(token)
    if (!decoded) return
    const types = (decoded.rt as ResourceType[]) ?? []
    const tokens = decoded.tok ?? []
    setPreview(
      types.map((t, i) => ({
        type: t,
        id: tokens[i] ? `${t.slice(0, 1)}_${tokens[i].slice(0, 8)}` : `${t.slice(0, 1)}_unknown`,
        size: SIZE_HINT[t] ?? '—',
      })),
    )
  }, [token])

  // Recompute the countdown every second while we're on the choose-plan
  // screen. The soonest expiry is sticky — only the displayed time ticks.
  useEffect(() => {
    if (stage !== 'choose-plan') return
    const tick = () => {
      const ms = soonestExpiryMs(resources)
      setCountdownMs(ms)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [stage, resources])

  const submit = async () => {
    setErr(null)
    if (!email.trim()) {
      setErr('Email is required.')
      return
    }
    if (!token) {
      setErr('Missing claim token. Open the link from your agent.')
      return
    }
    setStage('claiming')
    try {
      const sess = await claim({ jwt: token, email: email.trim() })
      setToken(sess.session_token)
      try {
        const pat = await createAPIKey({ name: 'dashboard-session', scopes: ['read', 'write'] })
        setToken(pat.key)
      } catch {
        // Falls back to the session JWT — still valid for an hour.
      }
      // Resources still carry their 24h TTL — claim transfers ownership but
      // payment is what makes them permanent. Pull the list so the upgrade
      // CTA can show "your resources die in HH:MM:SS".
      try {
        const r = await listResources()
        setResources(r.items)
      } catch {
        // Non-fatal — the upgrade CTAs still work; we just can't show a timer.
        setResources([])
      }
      setStage('choose-plan')
    } catch (e: any) {
      setStage('error')
      setErr(e?.message ?? 'Claim failed. The link may have already been used.')
    }
  }

  const startCheckout = async (plan: 'hobby' | 'pro') => {
    setCheckoutErr(null)
    setCheckoutPlan(plan)
    setStage('checkout')
    try {
      const r = await createCheckout(plan)
      if (r.short_url) {
        window.location.href = r.short_url
        return
      }
      setCheckoutErr('Checkout returned no URL. Try again or contact support.')
      setStage('choose-plan')
    } catch (e: any) {
      setCheckoutErr(e?.message ?? 'Checkout failed. Try again or contact support.')
      setStage('choose-plan')
    } finally {
      setCheckoutPlan(null)
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 480 }}>
          <div style={{ marginBottom: 24 }}><Brand /></div>
          <h1>Missing claim link.</h1>
          <p>This page expects a token. Open the claim link from your agent's response.</p>
        </div>
      </div>
    )
  }

  // ── Post-claim payment funnel ────────────────────────────────────────
  // We're on this screen because POST /claim succeeded and a session was
  // minted. The resources we just claimed still carry their 24h TTL — only
  // the `subscription.charged` Razorpay webhook fires
  // ElevateResourceTiersByTeam and makes them permanent. So the job here
  // is to get the user to checkout, fast.
  if (stage === 'choose-plan' || stage === 'checkout') {
    const showCountdown = countdownMs !== null
    return (
      <div className="auth-shell">
        <div className="auth-card" data-testid="claim-funnel" style={{ maxWidth: 520 }}>
          <div style={{ marginBottom: 20 }}>
            <Brand />
          </div>

          {/* Timer banner — the urgency lever. */}
          <div
            data-testid="claim-countdown"
            style={{
              padding: '14px 16px',
              marginBottom: 24,
              border: '1px solid var(--border)',
              borderLeft: '2px solid var(--rose)',
              borderRadius: 6,
              background: 'var(--surface)',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: 0.06,
                marginBottom: 6,
              }}
            >
              your resources are on a 24h timer
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span
                data-testid="claim-countdown-value"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 22,
                  color: 'var(--text)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {showCountdown ? formatCountdown(countdownMs!) : '—'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                until expiry — let's keep them alive.
              </span>
            </div>
          </div>

          <h1 style={{ marginBottom: 6 }}>Keep your resources.</h1>
          <p style={{ marginBottom: 22 }}>
            Pick a plan to make your{' '}
            {preview.length > 0 ? `${preview.length} ` : ''}resource{preview.length === 1 ? '' : 's'}{' '}
            permanent. Payment is the moment they stop expiring.
          </p>

          {checkoutErr && (
            <div
              role="alert"
              data-testid="claim-checkout-error"
              style={{
                marginBottom: 16,
                padding: '10px 12px',
                borderLeft: '2px solid var(--rose)',
                fontSize: 12.5,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text)',
              }}
            >
              {checkoutErr}
            </div>
          )}

          {/* Primary CTA — Hobby, the wedge tier. Big, loud price. */}
          <button
            className="btn btn-primary"
            data-testid="claim-checkout-hobby"
            onClick={() => startCheckout('hobby')}
            disabled={stage === 'checkout'}
            style={{
              width: '100%',
              justifyContent: 'space-between',
              padding: '18px 20px',
              fontSize: 16,
              marginBottom: 10,
            }}
          >
            <span style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', fontWeight: 600 }}>
                {stage === 'checkout' && checkoutPlan === 'hobby'
                  ? 'Opening checkout…'
                  : 'Keep my resources'}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 11.5,
                  fontFamily: 'var(--font-mono)',
                  opacity: 0.85,
                  marginTop: 2,
                }}
              >
                Hobby plan
              </span>
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              $9 / mo
            </span>
          </button>

          {/* Secondary CTA — Pro, deliberately quieter. */}
          <button
            className="btn btn-secondary"
            data-testid="claim-checkout-pro"
            onClick={() => startCheckout('pro')}
            disabled={stage === 'checkout'}
            style={{
              width: '100%',
              justifyContent: 'space-between',
              padding: '12px 16px',
              marginBottom: 20,
            }}
          >
            <span style={{ fontSize: 13 }}>
              {stage === 'checkout' && checkoutPlan === 'pro'
                ? 'Opening checkout…'
                : 'Show me Pro instead'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
              $49 / mo
            </span>
          </button>

          {/* Dismissable explainer — quiet, ground-rules-only. */}
          {explainerOpen && (
            <div
              data-testid="claim-explainer"
              style={{
                position: 'relative',
                padding: '10px 32px 10px 12px',
                fontSize: 11.5,
                lineHeight: 1.5,
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              You can take 24 hours to decide. After that, your free-tier resources expire
              after 24h unless you subscribe, and you'll need to provision new ones.
              <button
                aria-label="Dismiss explainer"
                data-testid="claim-explainer-dismiss"
                onClick={() => setExplainerOpen(false)}
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 8,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-faint)',
                  cursor: 'pointer',
                  padding: 2,
                  lineHeight: 1,
                  fontSize: 14,
                }}
              >
                ×
              </button>
            </div>
          )}

          <p
            style={{
              marginTop: 18,
              fontSize: 11,
              color: 'var(--text-faint)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
            }}
          >
            POST /api/v1/billing/checkout · razorpay-hosted · cancellation via support
          </p>
        </div>
      </div>
    )
  }

  // ── Email entry (pre-claim) ──────────────────────────────────────────
  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div style={{ marginBottom: 24 }}>
          <Brand />
        </div>
        <h1>Make these yours.</h1>
        <p>
          Enter your email to bind these resources to a permanent account. They inherit your plan
          tier and stop expiring.
        </p>

        {preview.length > 0 && (
          <div className="card" data-testid="claim-preview" style={{ padding: 0, marginBottom: 20 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.06 }}>
              preview · {preview.length} resource{preview.length !== 1 ? 's' : ''}
            </div>
            {preview.map((r) => (
              <div key={r.id} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
                <ResourceIcon type={r.type} size={20} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.type}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>{r.id}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>{r.size}</span>
              </div>
            ))}
          </div>
        )}

        <div className="form-row">
          <label htmlFor="email">email</label>
          <input
            id="email"
            type="email"
            placeholder="founder@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={stage === 'claiming'}
            data-testid="claim-email"
          />
        </div>

        {err && (
          <div role="alert" data-testid="claim-error" style={{ marginBottom: 12, padding: '10px 12px', borderLeft: '2px solid var(--rose)', fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
            {err}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={submit}
          disabled={stage === 'claiming'}
          data-testid="claim-submit"
        >
          {stage === 'claiming' ? 'Claiming…' : 'Claim all →'}
        </button>

        <p style={{ marginTop: 18, fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
          POST /claim · atomic · single-use · returns session_token + trial_ends_at
        </p>
      </div>
    </div>
  )
}
