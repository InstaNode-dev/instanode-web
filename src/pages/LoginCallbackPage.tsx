import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Brand } from '../components/Common'
import { setToken, fetchMe, getAPIBaseURL } from '../api'

// AUTH-004 (api PR #176, 2026-05-29): the OAuth/magic-link browser
// callback no longer puts the session JWT in the URL — it sets a Secure;
// HttpOnly cookie (`instanode_session_exchange`, Path=/auth/exchange,
// Max-Age=30) on the api origin and redirects here with ?signed_in=1.
// The SPA POSTs /auth/exchange with credentials, gets `{token}` in the
// response body, stores it in localStorage like the old flow, then
// proceeds. Keeps the JWT out of URL/Referer/server-access logs.
//
// Legacy `?session_token=<jwt>` path is retained for any old links /
// alternate JSON OAuth handlers that still URL-deliver the token (see
// api/internal/handlers/auth.go appendSessionToken docstring).
async function exchangeCookieForToken(): Promise<string> {
  const apiBase = getAPIBaseURL()
  // DELIBERATE: no custom headers (no Accept, no Content-Type). A POST
  // with only safelisted headers + credentials:include is a "simple
  // cross-origin request" per the CORS spec — no preflight. Adding
  // Accept:application/json would force an OPTIONS preflight that the
  // api's PreflightAllowlist rejects (Accept not in corsAllowHeaders),
  // returning 403 → "Failed to fetch" in the browser. The api returns
  // JSON regardless of the request Accept header.
  const resp = await fetch(`${apiBase}/auth/exchange`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!resp.ok) {
    let detail = ''
    try {
      const body = await resp.json()
      detail = body?.message ?? body?.error ?? ''
    } catch {
      // Non-JSON or empty body — keep detail empty; fall through to status.
    }
    const tag = detail ? `${resp.status} ${resp.statusText}: ${detail}` : `${resp.status} ${resp.statusText}`
    throw new Error(`Session exchange failed (${tag}).`)
  }
  const body = await resp.json().catch(() => null)
  const token = body && typeof body.token === 'string' ? body.token : ''
  if (!token) {
    throw new Error('Session exchange returned no token.')
  }
  return token
}

export function LoginCallbackPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    // AUTH-004 cookie-exchange marker takes precedence; legacy URL token
    // remains a fallback for any old/alternate flows that still URL-encode it.
    const signedIn = params.get('signed_in') === '1'
    const legacyToken = params.get('session_token')
    if (!signedIn && !legacyToken) {
      setErr('No session token in callback URL.')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const token = legacyToken ?? (await exchangeCookieForToken())
        if (cancelled) return
        setToken(token)
        // Verify the token actually works before navigating.
        await fetchMe()
        if (cancelled) return
        // Restore the original destination (set by 401 interceptor pre-login)
        // or default to the authenticated overview.
        const returnTo = (() => {
          try { return localStorage.getItem('instanode.return_to') ?? '' } catch { return '' }
        })()
        try { localStorage.removeItem('instanode.return_to') } catch {}
        const dest = returnTo && returnTo.startsWith('/app') ? returnTo : '/app'
        nav(dest, { replace: true })
      } catch (e: any) {
        if (cancelled) return
        setErr(e?.message ?? 'Session token rejected by the API.')
      }
    })()
    return () => { cancelled = true }
  }, [params, nav])

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div style={{ marginBottom: 28 }}>
          <Brand />
        </div>
        {err ? (
          <>
            <h1>Sign-in failed.</h1>
            <p style={{ marginBottom: 18, color: 'var(--text-dim)' }}>
              {err}
            </p>
            <a className="btn btn-secondary" href="/login" style={{ width: '100%', justifyContent: 'center' }}>
              Try again →
            </a>
          </>
        ) : (
          <>
            <h1>Signing you in.</h1>
            <p style={{ color: 'var(--text-dim)' }}>
              Verifying session token…
            </p>
          </>
        )}
      </div>
    </div>
  )
}
