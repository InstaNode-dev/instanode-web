/* TermsPage — W12 H15 stop-gap.
 *
 * The footer on MarketingPage and PublicShell linked /terms, but no route
 * was registered, so every click 404'd via the catch-all redirect to `/`.
 * Stop-gap placeholder with a legal@ mailto so customers have a real
 * escalation path while the binding terms of service is being drafted.
 *
 * Replace this whole component with the finalized terms of service when
 * legal sign-off lands. Until then, do NOT pretend to make commitments
 * we haven't reviewed — the iron rule is "no fake legal copy".
 */

import { PublicShell } from '../layout/PublicShell'

const LEGAL_CONTACT_EMAIL = 'legal@instanode.dev'

export function TermsPage() {
  return (
    <PublicShell>
      <section
        data-testid="terms-page"
        style={{ maxWidth: 720, padding: '32px 0', lineHeight: 1.7 }}
      >
        <span className="public-eyebrow">Legal · terms</span>
        <h1 className="public-h1" style={{ marginBottom: 24 }}>
          Terms<span className="dot">.</span>
        </h1>

        <p style={{ fontSize: 16, color: 'var(--text-dim)', marginBottom: 18 }}>
          The full text of our terms of service is in design. Binding
          language is available on request via{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} style={{ color: 'var(--blue)' }}>
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>

        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 18 }}>
          The high-level posture today:
        </p>

        <ul style={{ fontSize: 14, color: 'var(--text-dim)', paddingLeft: 20, marginBottom: 24 }}>
          <li>
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Acceptable use.</strong>{' '}
            No illegal content, no abuse of shared infrastructure, no
            attempting to circumvent tier limits. Resources that violate
            this may be suspended.
          </li>
          <li>
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Billing.</strong>{' '}
            Anonymous tier is free with a 24-hour TTL. Paid tiers
            (Hobby / Hobby Plus / Pro / Team) bill via Razorpay from day
            one — there is no free trial. Cancel by emailing{' '}
            <code>support@instanode.dev</code>; existing resources keep
            their tier until the end of the current billing period.
          </li>
          <li>
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Service availability.</strong>{' '}
            No SLA on Anonymous / Hobby / Hobby Plus / Pro. Team tier
            ships with a 99.9% SLA. Status:{' '}
            <a href="https://status.instanode.dev" style={{ color: 'var(--blue)' }}>
              status.instanode.dev
            </a>
            .
          </li>
          <li>
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Liability.</strong>{' '}
            Standard cap-at-fees-paid-in-prior-12-months; details in the
            binding language above on request.
          </li>
        </ul>

        <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>
          This page is a placeholder. The above bullets are not a contract —
          binding language is provided on request.
        </p>
      </section>
    </PublicShell>
  )
}
