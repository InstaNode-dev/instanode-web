import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Brand } from '../components/Common'
import { setToken, fetchMe } from '../api'

export function LoginCallbackPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const sessionToken = params.get('session_token')
    if (!sessionToken) {
      setErr('No session token in callback URL.')
      return
    }
    let cancelled = false
    ;(async () => {
      setToken(sessionToken)
      // Verify the token actually works before navigating.
      try {
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
