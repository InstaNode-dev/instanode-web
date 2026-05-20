import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Brand } from '../components/Common'
import { setToken, clearToken, fetchMe } from '../api'

const OAUTH_API_BASE_DEFAULT = 'https://api.instanode.dev'
const OAUTH_CALLBACK_PATH = '/login/callback'

function resolveApiBase(): string {
  return (typeof window !== 'undefined' && (window as any).__INSTANODE_API_URL__) || OAUTH_API_BASE_DEFAULT
}

function startGitHubOAuth() {
  const apiBase = resolveApiBase()
  const returnTo = encodeURIComponent(window.location.origin + OAUTH_CALLBACK_PATH)
  window.location.href = `${apiBase}/auth/github/start?return_to=${returnTo}`
}

export function LoginPage() {
  const navigate = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [token, setTokenInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showTokenForm, setShowTokenForm] = useState(false)
  // B8-E2 (2026-05-20): session-expired banner. Set when the AuthGate
  // (or call() wrapper handle401) redirects an authenticated user
  // whose JWT was rejected mid-session. Surfaced via the URL search
  // param so the prior session is gone — no in-memory state to lean on.
  const sessionExpired =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('session_expired') === '1'

  const [email, setEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailErr, setEmailErr] = useState<string | null>(null)

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailErr(null)
    if (!email.includes('@')) {
      setEmailErr('Enter a valid email.')
      return
    }
    setEmailBusy(true)
    try {
      const apiBase = resolveApiBase()
      const url = apiBase + '/auth/email/start'
      const returnTo = window.location.origin + OAUTH_CALLBACK_PATH
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), return_to: returnTo }),
      })
      // Backend deliberately returns 202 regardless of whether email exists.
      if (resp.status >= 400) {
        const body = await resp.json().catch(() => null)
        throw new Error((body && body.message) || resp.statusText)
      }
      setEmailSent(true)
    } catch (e: any) {
      setEmailErr(e?.message ?? 'Could not send the magic link.')
    } finally {
      setEmailBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!token.trim()) {
      setErr('Paste a Personal Access Token to continue.')
      return
    }
    setBusy(true)
    setToken(token.trim())
    try {
      await fetchMe()
      const dest = loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/app'
      navigate(dest, { replace: true })
    } catch (e: any) {
      clearToken()
      setErr(
        e?.status === 401
          ? 'Token rejected. Mint a fresh PAT or use the claim link from your agent.'
          : `Couldn't reach the API: ${e?.message ?? 'unknown error'}`,
      )
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div style={{ marginBottom: 28 }}>
          <Brand />
        </div>
        <h1>Sign in.</h1>
        <p>
          Continue with GitHub or your email. Anonymous resources are claimed via the
          link in your agent's response — not from this page.
        </p>

        {sessionExpired && (
          <div
            role="status"
            data-testid="session-expired-banner"
            style={{
              marginBottom: 18,
              padding: '10px 12px',
              borderLeft: '2px solid var(--amber)',
              background: 'rgba(255,193,7,0.06)',
              fontSize: 12.5,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text)',
            }}
          >
            Your session expired — please sign in to continue. You'll land
            back where you left off.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', gap: 10 }}
            onClick={startGitHubOAuth}
            data-testid="oauth-github"
          >
            <span aria-hidden="true" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>▢</span>
            <span>Continue with GitHub</span>
          </button>
        </div>

        {/* Magic-link form */}
        <div style={{ marginTop: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--text-faint)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span>or</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
          {emailSent ? (
            <div role="status" data-testid="magic-link-sent" style={{ padding: '10px 12px', borderLeft: '2px solid var(--accent)', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
              Check your inbox — we sent a sign-in link to <strong>{email}</strong>. Expires in 15 min.
            </div>
          ) : (
            <form onSubmit={submitEmail}>
              <div className="form-row">
                <label htmlFor="email">email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="founder@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={emailBusy}
                  data-testid="email-input"
                />
              </div>
              {emailErr && (
                <div role="alert" data-testid="email-error" style={{ marginBottom: 10, padding: '10px 12px', borderLeft: '2px solid var(--rose)', fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {emailErr}
                </div>
              )}
              <button
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: 'center' }}
                type="submit"
                disabled={emailBusy}
                data-testid="email-submit"
              >
                {emailBusy ? 'Sending…' : 'Email me a magic link →'}
              </button>
            </form>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowTokenForm((v) => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            margin: '4px 0 14px',
            color: 'var(--text-faint)',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
          }}
          aria-expanded={showTokenForm}
          aria-controls="pat-form"
          data-testid="toggle-token-form"
        >
          {showTokenForm ? '− hide token field' : '+ or have a token?'}
        </button>

        {showTokenForm && (
          <form onSubmit={submit} id="pat-form">
            <div className="form-row">
              <label htmlFor="token">token</label>
              <input
                id="token"
                type="password"
                autoComplete="off"
                placeholder="ink_•••••••••••••••"
                value={token}
                onChange={(e) => setTokenInput(e.target.value)}
                autoFocus
                disabled={busy}
                data-testid="token-input"
              />
            </div>

            {err && (
              <div role="alert" data-testid="login-error" style={{ marginBottom: 12, padding: '10px 12px', borderLeft: '2px solid var(--rose)', fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                {err}
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              type="submit"
              disabled={busy}
              data-testid="login-submit"
            >
              {busy ? 'Verifying…' : 'Continue →'}
            </button>

            <p
              style={{
                marginTop: 20,
                fontSize: 11.5,
                color: 'var(--text-faint)',
                fontFamily: 'var(--font-mono)',
                lineHeight: 1.55,
              }}
            >
              no token? run <code style={{ color: 'var(--accent)' }}>POST /db/new</code> from your agent —
              the response carries a <code style={{ color: 'var(--accent)' }}>claim_url</code> that mints one.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
