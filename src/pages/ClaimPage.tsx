import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Brand, ResourceIcon } from '../components/Common'
import { claim, createAPIKey, setToken } from '../api'
import type { ResourceType } from '../api'

type Preview = { type: ResourceType; id: string; size: string }

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

export function ClaimPage() {
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [stage, setStage] = useState<'enter-email' | 'claiming' | 'done' | 'error'>('enter-email')
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview[]>([])

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
      setStage('done')
      setTimeout(() => navigate('/app?welcome=1', { replace: true }), 700)
    } catch (e: any) {
      setStage('error')
      setErr(e?.message ?? 'Claim failed. The link may have already been used.')
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
            disabled={stage === 'claiming' || stage === 'done'}
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
          disabled={stage === 'claiming' || stage === 'done'}
          data-testid="claim-submit"
        >
          {stage === 'claiming' && 'Claiming…'}
          {stage === 'done' && 'Claimed ✓ Redirecting…'}
          {(stage === 'enter-email' || stage === 'error') && 'Claim all →'}
        </button>

        <p style={{ marginTop: 18, fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
          POST /claim · atomic · single-use · returns session_token + trial_ends_at
        </p>
      </div>
    </div>
  )
}
