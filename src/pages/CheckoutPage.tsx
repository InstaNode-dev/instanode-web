/* CheckoutPage — W12 funnel fix (C1) + BUG-P111/P112/P013/P121 hardening.
 *
 * The /pricing page CTAs used to point at `/checkout?plan=...&frequency=...`,
 * a route App.tsx never registered. The catch-all `*` route silently bounced
 * every paid-tier click to `/`, so the entire acquisition funnel from the
 * marketing surface was broken. We now register this page at
 * /app/checkout (under AuthGate, matching the rest of the auth-required
 * dashboard surface) and update the PricingPage CTAs to point at it.
 *
 * BUG-P111/P112/P113 (P0 CRITICAL, 2026-05-29) — defence-in-depth auth gate.
 * QA found that visiting /app/checkout/?plan=hobby while unauthenticated
 * still ended at a LIVE-mode Razorpay subscription page (sub_Sv96Mt2n8nnDYL).
 * The App-level AuthGate (App.tsx) only checks getToken() — a stale
 * localStorage JWT (e.g. a previous session that the server has since
 * invalidated) passes the gate but is rejected by /api/v1/billing/checkout
 * with 401. Without an explicit check here, any state in the URL/back-cache
 * could short-circuit to a real Razorpay subscription URL. This page now
 * performs its OWN getToken() check BEFORE the createCheckout call. If
 * unauth: redirect to /login?next=<this-path> via window.location.assign
 * (fail closed). The AuthGate above is the belt; this is the suspenders.
 *
 * BUG-P013 (P1, 2026-05-29) — preserve next= on redirect.
 * A logged-out user clicking /pricing → "Start hobby" used to land at /login
 * with no return path; after signin they hit /app/ and had to re-find
 * checkout. We now build a /login?next=<encoded path>&frequency=... URL so
 * the LoginPage already-built `loc.state.from` + login-callback can round-
 * trip the user back to the same plan.
 *
 * BUG-P121/P122 (P1, 2026-05-29) — no client-side caching of sub_*.
 * QA reported the same Razorpay subscription URL appearing across plan
 * changes and even across unauth sessions. We DO NOT cache the short_url
 * locally — every call to createCheckout returns a freshly-minted sub_* or
 * the F7-reused sub from the server. To defend against any FUTURE caching
 * regression, we also register a logout hook that clears anything labelled
 * with the well-known CHECKOUT_CACHE_KEY prefix.
 *
 * Flow:
 *   1. AuthGate (in App.tsx) is the FIRST layer — unauthenticated visitors
 *      with NO token at all get redirected to /login from the route guard
 *      before this component even mounts.
 *   2. THIS COMPONENT is the SECOND layer — on mount we re-check
 *      getToken() and re-render as 'unauthenticated' (which assigns to
 *      /login?next=...) if it has been cleared between route mount and
 *      component effect (e.g. logout in another tab triggered a storage
 *      event). Without this, a browser back-button from Razorpay could
 *      momentarily display the in-flight redirecting state on an unauth
 *      browser.
 *   3. On mount, we read `plan` and `frequency` from the URL search params,
 *      validate them, then POST /api/v1/billing/checkout with the canonical
 *      contract: {plan, plan_frequency}. The API contract lives in
 *      api/internal/handlers/billing.go:checkoutRequest.
 *   4. On success, response has `short_url` — we navigate the browser to it
 *      so Razorpay's hosted page collects payment.
 *   5. On 503 billing_not_configured we render a fallback panel pointing
 *      users at instanode.dev/pricing with a support email — this happens
 *      when the operator hasn't created the Razorpay plan_id for the tier
 *      yet, which is normal during dev / before launch.
 *   6. On 503 billing_misconfigured (BUG-P112 server-side guard, api
 *      ships in fix/billing-traffic-env-and-misconfig-detection) we render
 *      the same fallback panel — the operator pointed a non-prod
 *      deployment at a live Razorpay key and the server fast-failed before
 *      minting a real subscription.
 *   7. Any other failure is surfaced inline so the user isn't dropped on a
 *      blank page.
 *
 * Why /app/checkout and not /checkout: every authenticated action on this
 * platform lives under /app/* (per app architecture). Mounting this page
 * outside that subtree would require duplicating the AuthGate logic and
 * would diverge from the rest of the surface. The marketing CTAs simply
 * deep-link into /app/checkout?... — the AuthGate handles the login bounce.
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../api'
import { getToken, registerLogoutHook } from '../api'
import { isEmailVerifiedError, VerifyEmailBanner } from '../components/VerifyEmailBanner'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

// Razorpay-not-configured fallback target. The marketing pricing page still
// renders the tiers honestly even when Razorpay isn't wired, so sending
// stuck users back there is the right fallback — they can see what they
// were about to buy and email support to complete the purchase manually.
const RAZORPAY_FALLBACK_URL = 'https://instanode.dev/pricing'
const SUPPORT_EMAIL = 'support@instanode.dev'

// Login redirect target — used when the second-layer auth gate trips.
// Lives outside the component so it survives test re-renders and matches
// the App-level AuthGate's destination exactly.
const LOGIN_PATH = '/login'

// Allowed plans + frequencies — must mirror the API's accepted values
// (api/internal/handlers/billing.go:CreateCheckoutAPI). Anything outside
// these sets is rejected before we even attempt the network call so the
// user gets a fast, honest error instead of a 400 echo.
const ALLOWED_PLANS = ['hobby', 'hobby_plus', 'pro', 'team'] as const
const ALLOWED_FREQUENCIES = ['monthly', 'yearly'] as const
type AllowedPlan = (typeof ALLOWED_PLANS)[number]
type AllowedFrequency = (typeof ALLOWED_FREQUENCIES)[number]

// CHECKOUT_CACHE_KEY_PREFIX — every localStorage key we might one day use
// to cache checkout state (subscription_id, short_url, etc.) MUST start
// with this prefix so the logout hook below can purge them in one sweep.
// Today the page does NOT cache the short_url locally — but the prefix +
// purge-on-logout guarantee is the defensive belt against a future
// regression that adds such caching (BUG-P121/P122).
export const CHECKOUT_CACHE_KEY_PREFIX = 'instanode.checkout.'

// clearCheckoutCache — purge every localStorage entry whose key begins
// with CHECKOUT_CACHE_KEY_PREFIX. Idempotent. Called from the logout
// hook registered at module load below + exported for tests.
export function clearCheckoutCache(): void {
  try {
    if (typeof localStorage === 'undefined') return
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(CHECKOUT_CACHE_KEY_PREFIX)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch {
    // localStorage may throw in some embedded contexts (private browsing,
    // storage quota) — clearing is best-effort. If we can't read it, we
    // also can't write into it from this page, so there's nothing to leak.
  }
}

// Register the cache-purge on every logout. The hook registry is
// idempotent (registerLogoutHook dedupes by reference) so this is safe
// even if this module is re-evaluated under HMR / SSR hydration.
registerLogoutHook(clearCheckoutCache)

type Status =
  | { kind: 'loading' }
  | { kind: 'redirecting'; shortUrl: string }
  | { kind: 'fallback' } // 503 billing_not_configured | billing_misconfigured
  | { kind: 'invalid'; reason: string }
  | { kind: 'error'; message: string }
  // B6-P0 008 (BUGBASH 2026-05-20): api returns 403 with an
  // email_not_verified envelope when the claimed-but-unverified user tries
  // to upgrade. Surface a recoverable banner with a resend-magic-link
  // button instead of dropping the user on a generic "Checkout failed".
  | { kind: 'email_not_verified' }
  // BUG-P111/P013 (P0/P1, 2026-05-29): second-layer auth gate. Set when
  // getToken() returns null at component mount. Renders nothing visible
  // because the effect immediately window.location.assign('/login?next=…')
  // — but holding the state lets tests assert "we did not call
  // createCheckout" without timing flake.
  | { kind: 'unauthenticated' }

function isAllowedPlan(p: string | null): p is AllowedPlan {
  return p !== null && (ALLOWED_PLANS as readonly string[]).includes(p)
}
function isAllowedFrequency(f: string | null): f is AllowedFrequency {
  return f !== null && (ALLOWED_FREQUENCIES as readonly string[]).includes(f)
}

// buildLoginRedirect — assemble the /login?next=<encoded path> URL that
// preserves the plan + frequency the user was about to buy (BUG-P013).
// Exported for unit testing.
export function buildLoginRedirect(plan: string | null, frequency: string): string {
  // Reconstruct the canonical /app/checkout path with the same plan +
  // frequency the user was on so the LoginCallback round-trip can drop
  // them back here. Use URLSearchParams so future query-param additions
  // (e.g. ?promo=) get encoded correctly without hand-formatted ampersands.
  const search = new URLSearchParams()
  if (plan) search.set('plan', plan)
  search.set('frequency', frequency)
  const next = `/app/checkout?${search.toString()}`
  // /login?next=<encoded> — LoginPage reads loc.state.from in the React
  // Router path, but the OAuth + magic-link round-trips drop state, so we
  // surface `next` as a query param too. The login flow normalizes both.
  return `${LOGIN_PATH}?next=${encodeURIComponent(next)}`
}

export function CheckoutPage() {
  const [params] = useSearchParams()
  const planRaw = params.get('plan')
  const frequencyRaw = params.get('frequency') ?? 'monthly'

  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const ctx = useDashboardCtx()

  useEffect(() => {
    let cancelled = false

    // ──────────────────────────────────────────────────────────────────────
    // BUG-P111 second-layer auth gate (P0).
    // The App-level AuthGate (App.tsx) already redirects token-less users
    // to /login before this component mounts. BUT: a stale JWT in
    // localStorage passes that gate; the server then 401s — and in the
    // intervening millisecond the user has seen "Creating your Razorpay
    // checkout session…" + we have a real outbound network call. Worse,
    // any back/forward-cache restoration of a previously rendered
    // 'redirecting' state could surface a leaked sub_* URL to an unauth
    // browser (BUG-P121/P122). Re-check explicitly here, before any
    // network call, and fail CLOSED with a redirect to /login?next=… so
    // the user round-trips to their selected plan post-signin (BUG-P013).
    // ──────────────────────────────────────────────────────────────────────
    if (!getToken()) {
      setStatus({ kind: 'unauthenticated' })
      const dest = buildLoginRedirect(planRaw, frequencyRaw)
      window.location.assign(dest)
      return
    }

    // Validate query params before hitting the API. The pricing CTAs always
    // send valid values, but a hand-typed URL or a stale bookmark could
    // arrive here with garbage — surface that honestly instead of bouncing.
    if (!isAllowedPlan(planRaw)) {
      setStatus({
        kind: 'invalid',
        reason: planRaw
          ? `Unknown plan "${planRaw}". Expected one of: ${ALLOWED_PLANS.join(', ')}.`
          : 'Missing required ?plan= query parameter.',
      })
      return
    }
    if (!isAllowedFrequency(frequencyRaw)) {
      setStatus({
        kind: 'invalid',
        reason: `Unknown frequency "${frequencyRaw}". Expected one of: ${ALLOWED_FREQUENCIES.join(', ')}.`,
      })
      return
    }

    ;(async () => {
      try {
        const r = await api.createCheckout(planRaw, frequencyRaw)
        if (cancelled) return
        if (r.short_url) {
          setStatus({ kind: 'redirecting', shortUrl: r.short_url })
          // Imperative navigation so the back button returns to /pricing
          // rather than the in-flight /app/checkout state. We use
          // location.assign (not replace) so users can hit Back to bail.
          window.location.assign(r.short_url)
          return
        }
        // The api swears the response always includes short_url on success,
        // but we defend in case of a partial-response regression on the
        // server side — fail loud rather than spin forever.
        setStatus({ kind: 'error', message: 'Checkout response missing short_url.' })
      } catch (e: any) {
        if (cancelled) return
        // 401 from the API: the user's token was rejected mid-flight (e.g.
        // logged out from another tab, server-side jti invalidation). The
        // global call() wrapper already calls handle401() which fires
        // clearToken() + redirects to /login?session_expired=1. We tag the
        // state so a test (or a future onAuthError analytics hook) can
        // observe the path without us doing a second redirect on top of
        // the wrapper's.
        if (e?.status === 401) {
          setStatus({ kind: 'unauthenticated' })
          return
        }
        // 503 billing_not_configured is the documented path when the
        // operator hasn't created the Razorpay plan_id for this tier yet.
        // 503 billing_misconfigured (BUG-P112 server-side guard) is the
        // sibling — operator wired a live Razorpay key to a non-prod
        // deployment. Both render the same fallback panel.
        if (
          e?.status === 503 &&
          (e?.code === 'billing_not_configured' || e?.code === 'billing_misconfigured')
        ) {
          setStatus({ kind: 'fallback' })
          return
        }
        // B6-P0 008: api emits 403 email_not_verified when the team's
        // primary email isn't verified yet. Surface the recovery banner.
        if (isEmailVerifiedError(e)) {
          setStatus({ kind: 'email_not_verified' })
          return
        }
        setStatus({
          kind: 'error',
          message: e?.message ?? 'Could not start checkout.',
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [planRaw, frequencyRaw])

  return (
    <div data-testid="checkout-page" style={{ padding: '32px 0', maxWidth: 640 }}>
      <h2 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 16 }}>
        Checkout
      </h2>
      {status.kind === 'unauthenticated' && (
        // We've already issued window.location.assign('/login?next=…')
        // synchronously in the effect — this marker is visible for the
        // brief flash before the browser navigates, AND it gives tests
        // a stable assertion target. Use a neutral message so a screen
        // reader doesn't read "Checkout failed" during the redirect.
        <p data-testid="checkout-unauthenticated" style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          Sign in to continue to checkout…
        </p>
      )}
      {status.kind === 'loading' && (
        <p data-testid="checkout-loading" style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          Creating your Razorpay checkout session…
        </p>
      )}
      {status.kind === 'redirecting' && (
        <p data-testid="checkout-redirecting" style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          Redirecting to Razorpay…{' '}
          <a href={status.shortUrl} style={{ color: 'var(--blue)' }}>
            Click here if the redirect doesn't happen.
          </a>
        </p>
      )}
      {status.kind === 'fallback' && (
        <div
          data-testid="checkout-fallback"
          className="card"
          style={{ padding: 18, lineHeight: 1.6, fontSize: 14 }}
        >
          <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
            Razorpay not yet configured for this plan
          </strong>{' '}
          — contact{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--blue)' }}>
            {SUPPORT_EMAIL}
          </a>{' '}
          and we'll set it up. In the meantime, here's the pricing page:{' '}
          <a href={RAZORPAY_FALLBACK_URL} style={{ color: 'var(--blue)' }}>
            {RAZORPAY_FALLBACK_URL}
          </a>
          .
        </div>
      )}
      {status.kind === 'invalid' && (
        <div
          data-testid="checkout-invalid"
          className="card"
          style={{ padding: 18, lineHeight: 1.6, fontSize: 14, color: 'var(--text-dim)' }}
        >
          <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
            Invalid checkout link.
          </strong>{' '}
          {status.reason}{' '}
          <a href="/pricing" style={{ color: 'var(--blue)' }}>
            Return to pricing
          </a>
          .
        </div>
      )}
      {status.kind === 'email_not_verified' && (
        <div
          data-testid="checkout-email-not-verified"
          className="card"
          style={{ padding: 18, lineHeight: 1.6, fontSize: 14 }}
        >
          <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
            Verify your email before upgrading.
          </strong>{' '}
          <VerifyEmailBanner email={ctx.me?.user?.email} />
        </div>
      )}
      {status.kind === 'error' && (
        <div
          data-testid="checkout-error"
          className="card"
          style={{ padding: 18, lineHeight: 1.6, fontSize: 14 }}
        >
          <strong style={{ color: 'var(--red, #ff7a8a)', fontWeight: 500 }}>
            Checkout failed.
          </strong>{' '}
          {status.message}{' '}
          <a href="/pricing" style={{ color: 'var(--blue)' }}>
            Back to pricing
          </a>{' '}
          · email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--blue)' }}>
            {SUPPORT_EMAIL}
          </a>{' '}
          if this keeps happening.
        </div>
      )}
    </div>
  )
}
