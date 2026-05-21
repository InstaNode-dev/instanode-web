// VerifyEmailBanner — B6-P0 008 (BUGBASH 2026-05-20).
//
// The agent-driven funnel was: claim → land on dashboard → click Upgrade →
// POST /api/v1/billing/checkout → Razorpay redirect. The api gate-checks
// `email_verified` on the team's primary user before minting a Razorpay
// subscription, so any team that landed via /claim (which creates the user
// but doesn't auto-verify the email) hits a 403 at checkout. The dashboard
// previously rendered that 403 as a generic "checkout failed" toast, which
// gave the user no recovery path — they couldn't tell *why* and had no
// "resend magic link" action to take.
//
// This component is the recovery path. Callers detect the api's "email
// not verified" envelope (status 403 + a code/message hinting at email
// verification) and render the banner inline next to the failed CTA. The
// banner offers a single click to resend the magic-link email via POST
// /auth/email/start (the same endpoint LoginPage uses), then surfaces the
// "check your inbox" confirmation in place. Once the user clicks the link
// and re-loads the page their session carries `email_verified=true` and
// the original Upgrade click works.
//
// The server fix (auto-verify on claim) is the right durable fix; this
// banner exists for the window where that hasn't shipped, and as a
// permanent fallback for any other path that lands an unverified user on
// the upgrade button (e.g. an admin manually creating a user).

import { useState } from 'react'

const SUFFIX = '/login/callback'

/** Heuristic: was the caught error the api's email-not-verified gate?
 *
 *  The api returns 403 with a code like `email_not_verified` and/or a
 *  message containing "verify". We match on either. Status 403 alone is
 *  too broad (RBAC failures, admin gates, etc.), so we require a hint.
 */
export function isEmailVerifiedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: number; code?: string; message?: string }
  if (e.status !== 403) return false
  const code = (e.code ?? '').toLowerCase()
  const msg = (e.message ?? '').toLowerCase()
  return (
    code.includes('email') && (code.includes('verif') || code.includes('not_verified'))
  ) || (msg.includes('email') && msg.includes('verif'))
}

/** Pulled out so tests + the LoginPage can share the same probe. */
function resolveApiBase(): string {
  // Mirror LoginPage.resolveApiBase: prefer the build-time API base if set,
  // fall back to current origin. The Vite proxy handles dev.
  const fromEnv = (import.meta as any).env?.VITE_API_BASE
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return ''
}

export function VerifyEmailBanner({ email }: { email?: string }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const targetEmail = (email ?? '').trim()

  async function resend() {
    if (!targetEmail) {
      setErr('No email on this session — please log in again.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const apiBase = resolveApiBase()
      const url = apiBase + '/auth/email/start'
      const returnTo = window.location.origin + SUFFIX
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, return_to: returnTo }),
      })
      // /auth/email/start deliberately returns 202 even for unknown emails
      // to avoid email-enumeration. Treat any 2xx as success.
      if (resp.status >= 400) {
        const body = await resp.json().catch(() => null)
        throw new Error((body && body.message) || resp.statusText)
      }
      setSent(true)
    } catch (e: any) {
      setErr(e?.message ?? 'Could not send the magic link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="alert"
      data-testid="verify-email-banner"
      style={{
        marginTop: 12,
        padding: '12px 14px',
        border: '1px solid var(--accent, #00e48e)',
        background: 'var(--accent-soft, rgba(0, 228, 142, 0.08))',
        borderRadius: 6,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <strong>Verify your email to upgrade.</strong> Checkout is gated on a
        verified email — the claim flow creates your account but doesn't auto-verify it.
      </div>
      {targetEmail && (
        <div style={{ marginBottom: 10, color: 'var(--text-dim)', fontSize: 12 }}>
          We'll send the magic link to <code>{targetEmail}</code>.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn btn-sm btn-primary"
          data-testid="verify-email-resend"
          onClick={resend}
          disabled={busy || sent || !targetEmail}
        >
          {sent ? 'Sent — check your inbox' : busy ? 'Sending…' : 'Resend magic link'}
        </button>
        {sent && (
          <span data-testid="verify-email-sent-hint" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
            Click the link, then retry Upgrade.
          </span>
        )}
      </div>
      {err && (
        <div
          role="alert"
          data-testid="verify-email-resend-error"
          style={{ marginTop: 10, color: 'var(--rose, #ff5a6e)', fontSize: 12 }}
        >
          {err}
        </div>
      )}
    </div>
  )
}
