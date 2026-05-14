/* CheckoutPage — W12 funnel fix (C1).
 *
 * The /pricing page CTAs used to point at `/checkout?plan=...&frequency=...`,
 * a route App.tsx never registered. The catch-all `*` route silently bounced
 * every paid-tier click to `/`, so the entire acquisition funnel from the
 * marketing surface was broken. We now register this page at
 * /app/checkout (under AuthGate, matching the rest of the auth-required
 * dashboard surface) and update the PricingPage CTAs to point at it.
 *
 * Flow:
 *   1. AuthGate (in App.tsx) ensures only logged-in users see this page.
 *      Unauthenticated visitors are redirected to /login with state.from set
 *      to /app/checkout?plan=... so post-login they land back here.
 *   2. On mount, we read `plan` and `frequency` from the URL search params,
 *      validate them, then POST /api/v1/billing/checkout with the canonical
 *      contract: {plan, plan_frequency}. The API contract lives in
 *      api/internal/handlers/billing.go:checkoutRequest.
 *   3. On success, response has `short_url` — we navigate the browser to it
 *      so Razorpay's hosted page collects payment.
 *   4. On 503 billing_not_configured we render a fallback panel pointing
 *      users at instanode.dev/pricing with a support email — this happens
 *      when the operator hasn't created the Razorpay plan_id for the tier
 *      yet, which is normal during dev / before launch.
 *   5. Any other failure is surfaced inline so the user isn't dropped on a
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

// Razorpay-not-configured fallback target. The marketing pricing page still
// renders the tiers honestly even when Razorpay isn't wired, so sending
// stuck users back there is the right fallback — they can see what they
// were about to buy and email support to complete the purchase manually.
const RAZORPAY_FALLBACK_URL = 'https://instanode.dev/pricing'
const SUPPORT_EMAIL = 'support@instanode.dev'

// Allowed plans + frequencies — must mirror the API's accepted values
// (api/internal/handlers/billing.go:CreateCheckoutAPI). Anything outside
// these sets is rejected before we even attempt the network call so the
// user gets a fast, honest error instead of a 400 echo.
const ALLOWED_PLANS = ['hobby', 'hobby_plus', 'pro', 'team'] as const
const ALLOWED_FREQUENCIES = ['monthly', 'yearly'] as const
type AllowedPlan = (typeof ALLOWED_PLANS)[number]
type AllowedFrequency = (typeof ALLOWED_FREQUENCIES)[number]

type Status =
  | { kind: 'loading' }
  | { kind: 'redirecting'; shortUrl: string }
  | { kind: 'fallback' } // 503 billing_not_configured
  | { kind: 'invalid'; reason: string }
  | { kind: 'error'; message: string }

function isAllowedPlan(p: string | null): p is AllowedPlan {
  return p !== null && (ALLOWED_PLANS as readonly string[]).includes(p)
}
function isAllowedFrequency(f: string | null): f is AllowedFrequency {
  return f !== null && (ALLOWED_FREQUENCIES as readonly string[]).includes(f)
}

export function CheckoutPage() {
  const [params] = useSearchParams()
  const planRaw = params.get('plan')
  const frequencyRaw = params.get('frequency') ?? 'monthly'

  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

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
        // 503 billing_not_configured is the documented path when the
        // operator hasn't created the Razorpay plan_id for this tier yet.
        // Render the friendly fallback instead of a raw error banner.
        if (e?.status === 503 && e?.code === 'billing_not_configured') {
          setStatus({ kind: 'fallback' })
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
