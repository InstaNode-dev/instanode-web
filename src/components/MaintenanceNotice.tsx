/* MaintenanceNotice — customer-facing scheduled-maintenance notice.
 *
 * Context: the prod cluster (api.instanode.dev) is intentionally paused for
 * scheduled maintenance. The SPA at instanode.dev still loads from GitHub
 * Pages (via Cloudflare), so a visitor sees the page render but every API
 * call fails. Without an explanation that reads as confusing breakage. This
 * component makes the downtime read as INTENTIONAL and reassures the visitor
 * their data is safe.
 *
 * Two surfaces, both on-brand (they reuse the design tokens in
 * src/styles/tokens.css — the amber "warning" family + the .auth-card /
 * .modal-overlay shapes — so they look intentional, not like a raw
 * browser alert):
 *
 *   1. A STICKY top banner on every route (marketing + app + login). It
 *      stays put even after the modal is dismissed, so the message never
 *      fully disappears.
 *   2. A one-time DISMISSIBLE modal on the surfaces where a customer would
 *      otherwise hit confusing API errors first — /app/* and /login*. It
 *      reinforces the same copy with a clear icon. Dismissal is remembered
 *      for the tab session (sessionStorage) so we don't trap the visitor in
 *      a re-popping dialog.
 *
 * TOGGLE: the whole thing is gated behind the build-time flag
 * VITE_MAINTENANCE_MODE. When it is '1' the notice renders; when unset or
 * '0' the component returns null and contributes ZERO markup (the default
 * everywhere except the published GitHub Pages build — see
 * .github/workflows/deploy-pages.yml, where VITE_MAINTENANCE_MODE: '1' is
 * set on the build step only). To turn the notice OFF on resume, set
 * VITE_MAINTENANCE_MODE back to '0' / remove it in deploy-pages.yml and
 * re-run the deploy (or revert the PR that added this).
 *
 * The `enabled` and `pathname` props exist so unit tests can drive the ON
 * branch and per-route modal logic deterministically without stubbing
 * import.meta.env or mounting a full router. In the real app they are
 * omitted and resolve from the env flag + the current location.
 */

import { useEffect, useState } from 'react'

// Single source of truth for the copy so the banner, the modal, and any
// future surface stay in lock-step (rule 16: one emitter per string).
export const MAINTENANCE_HEADLINE = 'Scheduled maintenance'
export const MAINTENANCE_BODY =
  'instanode is temporarily unavailable while we perform maintenance. ' +
  'Your data is safe and we’ll be back shortly. Thanks for your patience.'

// sessionStorage key for the one-time modal dismissal. Scoped to the tab
// session so a returning visitor in a fresh tab still sees it once.
const MODAL_DISMISSED_KEY = 'instanode.maintenanceModalDismissed'

// isMaintenanceEnabled — read the build-time flag. import.meta.env values
// are compile-time strings, so an unset flag is `undefined` and '0' is the
// explicit off. Exported so a test can assert the contract.
export function isMaintenanceEnabled(): boolean {
  return import.meta.env.VITE_MAINTENANCE_MODE === '1'
}

// modalAppliesTo — the modal only fires on the surfaces where a customer
// would otherwise hit confusing API failures first: the dashboard (/app*)
// and the login flow (/login*). Marketing routes get the banner only (no
// modal) so we don't nag a casual reader.
export function modalAppliesTo(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/') || pathname.startsWith('/login')
}

// resolvePathname — best-effort current path. Tests pass it explicitly; in
// the browser we read window.location. SSR (prerender) only ever renders
// public routes, so the modal branch never triggers there anyway, but we
// guard window access to stay SSR-safe: optional chaining returns undefined
// when `window` is absent (Node) and we fall back to '/' (a marketing path,
// so the modal stays off during prerender).
function resolvePathname(explicit?: string): string {
  return explicit ?? globalThis.window?.location?.pathname ?? '/'
}

interface Props {
  /** Override the env flag — used by tests to exercise the ON branch. */
  enabled?: boolean
  /** Override the current path — used by tests to drive modal routing. */
  pathname?: string
}

export function MaintenanceNotice({ enabled, pathname }: Props = {}) {
  const on = enabled ?? isMaintenanceEnabled()
  const path = resolvePathname(pathname)

  // Modal visibility: shown on /app* + /login* until dismissed this session.
  // Initialised lazily so we read sessionStorage exactly once on mount.
  const [modalOpen, setModalOpen] = useState<boolean>(() => {
    // Modal only applies on /app* + /login* — never on the prerendered
    // public routes, so this initializer's window/sessionStorage access is
    // only ever reached in the browser. SSR short-circuits at modalAppliesTo.
    if (!on || !modalAppliesTo(path)) return false
    try {
      return window.sessionStorage.getItem(MODAL_DISMISSED_KEY) !== '1'
    } catch {
      // sessionStorage can throw in locked-down privacy modes — fail open
      // to showing the modal (the message is the whole point).
      return true
    }
  })

  // Escape closes the modal (keyboard-accessible), mirroring the other
  // dialogs in the app (IssuePromoModal). Only bound while the modal is open.
  useEffect(() => {
    if (!modalOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismissModal()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // dismissModal is stable (defined below, no deps) — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen])

  if (!on) return null

  function dismissModal() {
    setModalOpen(false)
    try {
      window.sessionStorage.setItem(MODAL_DISMISSED_KEY, '1')
    } catch {
      // Best-effort persistence; the in-memory state already closed it.
    }
  }

  return (
    <>
      {/* ── sticky top banner — every route, persists after modal dismiss ── */}
      <div
        role="status"
        aria-live="polite"
        data-testid="maintenance-banner"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '10px 16px',
          textAlign: 'center',
          fontFamily: 'var(--font-display)',
          fontSize: 13.5,
          lineHeight: 1.45,
          color: 'var(--text)',
          background: 'rgba(255,192,105,0.10)',
          borderBottom: '1px solid rgba(255,192,105,0.30)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}>
          {'⚠️'}
        </span>
        <span>
          <strong style={{ fontWeight: 600 }}>{MAINTENANCE_HEADLINE}</strong>
          {' — '}
          {MAINTENANCE_BODY}
        </span>
      </div>

      {/* ── one-time dismissible modal on /app* + /login* ── */}
      {modalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="maintenance-modal-title"
          aria-describedby="maintenance-modal-body"
          data-testid="maintenance-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) dismissModal()
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 440,
              background: 'var(--surface)',
              border: '1px solid var(--border-hi)',
              borderRadius: 'var(--radius-lg)',
              padding: 28,
              boxShadow: '0 24px 48px -16px rgba(0,0,0,0.6)',
              textAlign: 'center',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 52,
                height: 52,
                margin: '0 auto 16px',
                borderRadius: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                background: 'rgba(255,192,105,0.10)',
                border: '1px solid rgba(255,192,105,0.30)',
              }}
            >
              {'⚠️'}
            </div>
            <h2
              id="maintenance-modal-title"
              style={{ fontSize: 21, fontWeight: 500, marginBottom: 10, letterSpacing: '-0.02em' }}
            >
              {MAINTENANCE_HEADLINE}
            </h2>
            <p
              id="maintenance-modal-body"
              style={{
                fontSize: 14,
                color: 'var(--text-dim)',
                lineHeight: 1.55,
                margin: '0 auto 22px',
                maxWidth: 360,
              }}
            >
              {MAINTENANCE_BODY}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="maintenance-modal-dismiss"
              onClick={dismissModal}
              autoFocus
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
