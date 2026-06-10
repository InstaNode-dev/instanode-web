import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Brand } from '../components/Common'
import { setToken, clearToken, fetchMe, getToken, completeCliSession } from '../api'
import { postAuthDestination } from '../lib/postAuthDestination'

const OAUTH_API_BASE_DEFAULT = 'https://api.instanode.dev'
const OAUTH_CALLBACK_PATH = '/login/callback'

function resolveApiBase(): string {
  return (typeof window !== 'undefined' && (window as any).__INSTANODE_API_URL__) || OAUTH_API_BASE_DEFAULT
}

// readCliSession — pull the CLI device-flow session id off /login's query
// string. The api emits /login?cli_session=<id>; CliAuthRedirect normalises
// the legacy ?s= form to it. We forward this id through the OAuth /
// magic-link `return_to` so it survives the round-trip and LoginCallbackPage
// can POST /auth/cli/{id}/complete after sign-in (D2). Returns '' when absent.
function readCliSession(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('cli_session') ?? ''
}

// buildCallbackReturnTo — the post-auth landing URL the api redirects back
// to. When a CLI device-flow session is in flight we append ?cli_session=<id>
// so the callback page can complete it. Same-origin by construction.
function buildCallbackReturnTo(): string {
  const base = window.location.origin + OAUTH_CALLBACK_PATH
  const cli = readCliSession()
  return cli ? `${base}?cli_session=${encodeURIComponent(cli)}` : base
}

function startGitHubOAuth() {
  const apiBase = resolveApiBase()
  const returnTo = encodeURIComponent(buildCallbackReturnTo())
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

  // D2 — already-signed-in CLI device-flow completion.
  //
  // When a developer who is ALREADY authenticated runs `instant login`, the
  // CLI opens /login?cli_session=<id> and polls. The fresh-OAuth/magic-link
  // path completes the device flow in LoginCallbackPage (it POSTs
  // /auth/cli/{id}/complete after sign-in) — but an already-authed user never
  // takes that path: they land directly on /login with a live token and would
  // otherwise be shown the sign-in form again, never firing the completion.
  // So here, when BOTH a token exists AND cli_session is present, we fire the
  // SAME completion path (completeCliSession) immediately and show a terminal-
  // return confirmation instead of the sign-in form. Mirrors LoginCallbackPage:
  // same function, best-effort (completeCliSession swallows its own errors), and
  // a failure surfaces a note but does NOT hard-block.
  const [cliApproved, setCliApproved] = useState<null | 'ok' | 'failed'>(null)
  useEffect(() => {
    const cli = readCliSession()
    // Only the already-authed path runs here. A fresh-login user has no token
    // yet; their cli_session rides through return_to to LoginCallbackPage.
    if (!cli || !getToken()) return
    let cancelled = false
    ;(async () => {
      const { ok } = await completeCliSession(cli)
      if (cancelled) return
      setCliApproved(ok ? 'ok' : 'failed')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // sendMagicLink — POST /auth/email/start. Extracted from submitEmail so the
  // "Resend" affordance in the sent-confirmation state (F4) can re-fire the
  // exact same request without duplicating the fetch + error handling.
  const sendMagicLink = async () => {
    setEmailErr(null)
    if (!email.includes('@')) {
      setEmailErr('Enter a valid email.')
      return false
    }
    setEmailBusy(true)
    try {
      const apiBase = resolveApiBase()
      const url = apiBase + '/auth/email/start'
      const returnTo = buildCallbackReturnTo()
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
      return true
    } catch (e: any) {
      setEmailErr(e?.message ?? 'Could not send the magic link.')
      return false
    } finally {
      setEmailBusy(false)
    }
  }

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    await sendMagicLink()
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
      const me = await fetchMe()
      // BUG-P013 (P1, 2026-05-29): when CheckoutPage's second-layer auth
      // gate redirects an unauth user it issues `/login?next=<encoded
      // path>` (a hard window.location.assign, so React Router state is
      // dropped). Read `next=` from the query string FIRST, fall back to
      // `loc.state.from` (the App-level AuthGate path).
      // /login itself is never a valid landing — reject so a stale
      // bookmark doesn't trap the user in a loop.
      const queryNext = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('next')
        : null
      const candidate = queryNext ?? loc.state?.from ?? ''
      // Only honour relative same-origin paths so a forged
      // /login?next=https://evil.com cannot phish the post-signin nav;
      // /login itself is never a valid landing (loop guard).
      const next = candidate && candidate !== '/login' ? candidate : undefined
      // COMMERCE-FIRST REDIRECT (2026-06-10): with no explicit deep-link,
      // route by plan tier — free → /pricing, paid-but-eligible →
      // /app/billing, top tier → /app. An explicit safe `next` always wins.
      // postAuthDestination drops unsafe (off-origin / protocol-relative)
      // next values back to the tier rule.
      const dest = postAuthDestination(me?.user?.tier, next)
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

  // D2 — already-authed CLI approval confirmation. The user came from a
  // terminal (they ran `instant login`); don't silently drop them into the
  // dashboard. Show a clear "return to your terminal" screen. On a completion
  // failure we still confirm they're signed in and tell them to retry the CLI
  // (completeCliSession never throws, so this is the only failure surface).
  if (cliApproved !== null) {
    return (
      <div className="auth-shell">
        <div className="auth-card" data-testid="cli-approved" style={{ maxWidth: 480 }}>
          <div style={{ marginBottom: 28 }}>
            <Brand />
          </div>
          {cliApproved === 'ok' ? (
            <>
              <h1>CLI session approved.</h1>
              <div
                role="status"
                data-testid="cli-approved-ok"
                style={{
                  marginTop: 16,
                  padding: '10px 12px',
                  borderLeft: '2px solid var(--accent)',
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text)',
                  lineHeight: 1.6,
                }}
              >
                ✓ Your CLI session is approved — return to your terminal. You can
                close this tab.
              </div>
            </>
          ) : (
            <>
              <h1>Couldn't approve the CLI session.</h1>
              <div
                role="alert"
                data-testid="cli-approved-failed"
                style={{
                  marginTop: 16,
                  padding: '10px 12px',
                  borderLeft: '2px solid var(--rose)',
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text)',
                  lineHeight: 1.6,
                }}
              >
                You're signed in, but we couldn't link this browser to your CLI
                session — it may have expired. Re-run <code style={{ color: 'var(--accent)' }}>instant login</code> in
                your terminal to get a fresh link.
              </div>
            </>
          )}
        </div>
      </div>
    )
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
            // F4 (2026-06-10): the "we sent a link" state used to be a silent
            // dead-end. Email delivery is currently 100%-failing (Brevo sender
            // unvalidated — see CLAUDE.md P0), so a static "check your inbox"
            // banner traps every magic-link user with no recovery. We now
            // surface (a) a "Didn't get it? Resend" affordance and (b) a
            // "continue with GitHub" fallback that routes the user to the one
            // working auth path.
            <div data-testid="magic-link-sent">
              <div role="status" style={{ padding: '10px 12px', borderLeft: '2px solid var(--accent)', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                Check your inbox — we sent a sign-in link to <strong>{email}</strong>. Expires in 15 min.
              </div>

              {emailErr && (
                <div role="alert" data-testid="magic-link-resend-error" style={{ marginTop: 10, padding: '10px 12px', borderLeft: '2px solid var(--rose)', fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {emailErr}
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', lineHeight: 1.6 }}>
                Didn't get it?{' '}
                <button
                  type="button"
                  onClick={() => { void sendMagicLink() }}
                  disabled={emailBusy}
                  data-testid="magic-link-resend"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: 'var(--accent)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    cursor: emailBusy ? 'default' : 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {emailBusy ? 'Resending…' : 'Resend the link'}
                </button>
                {' '}— or change the address above and resend.
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: 'center', gap: 10, marginTop: 14 }}
                onClick={startGitHubOAuth}
                data-testid="magic-link-github-fallback"
              >
                <span aria-hidden="true" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>▢</span>
                <span>or continue with GitHub</span>
              </button>
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
