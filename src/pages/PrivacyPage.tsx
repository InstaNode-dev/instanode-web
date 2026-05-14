/* PrivacyPage — W12 H15 stop-gap.
 *
 * The footer on MarketingPage and PublicShell linked /privacy, but no route
 * was registered, so every click 404'd via the catch-all redirect to `/`.
 * This page is a 1-day stop-gap: honest placeholder copy with a legal@
 * mailto so customers and reviewers have a real escalation path while the
 * binding privacy language is being drafted.
 *
 * Replace this whole component with the finalized privacy policy when legal
 * sign-off lands. Until then, do NOT pretend to make commitments we
 * haven't reviewed — the iron rule from the customer policy memory is "no
 * fake legal copy".
 */

import { PublicShell } from '../layout/PublicShell'

const LEGAL_CONTACT_EMAIL = 'legal@instanode.dev'

export function PrivacyPage() {
  return (
    <PublicShell>
      <section
        data-testid="privacy-page"
        style={{ maxWidth: 720, padding: '32px 0', lineHeight: 1.7 }}
      >
        <span className="public-eyebrow">Legal · privacy</span>
        <h1 className="public-h1" style={{ marginBottom: 24 }}>
          Privacy<span className="dot">.</span>
        </h1>

        <p style={{ fontSize: 16, color: 'var(--text-dim)', marginBottom: 18 }}>
          The full text of our privacy policy is in design. Binding language
          is available on request via{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} style={{ color: 'var(--blue)' }}>
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>

        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 18 }}>
          In the meantime, the short version of what we do today:
        </p>

        <ul style={{ fontSize: 14, color: 'var(--text-dim)', paddingLeft: 20, marginBottom: 24 }}>
          <li>
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>What we collect.</strong>{' '}
            Email, OAuth identity (GitHub / Google), and the technical
            telemetry needed to run the platform (request logs, error
            traces, billing events). No analytics-grade browser fingerprints.
          </li>
          <li>
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>How we use it.</strong>{' '}
            Operating your account, billing, abuse detection, support
            replies. We do not sell or share personal data with third
            parties for advertising.
          </li>
          <li>
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Where it lives.</strong>{' '}
            US-region cloud infrastructure. Sub-processors include
            Razorpay (billing), Resend (transactional email), and our
            cloud provider.
          </li>
          <li>
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Your rights.</strong>{' '}
            Export or delete your data on request — email{' '}
            <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} style={{ color: 'var(--blue)' }}>
              {LEGAL_CONTACT_EMAIL}
            </a>
            .
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
