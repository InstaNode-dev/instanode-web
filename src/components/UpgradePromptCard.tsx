// UpgradePromptCard — shared in-context upgrade prompt (U2).
//
// Renders a feature-specific upsell tile with:
//   - title + body (surface-specific framing from upgradeCopy)
//   - PRIMARY CTA button → /app/billing?frequency=yearly&plan=pro
//   - SECONDARY text link → /app/billing?frequency=monthly&plan=pro
//
// The primary destination is **Pro Annual** by default (per the 2026-05-13
// pricing playbook — highest-LTV product, "2 months free" framing). The
// secondary link keeps the monthly path discoverable for mid-cycle users
// who don't want to commit to a yearly bill.
//
// Visual style mirrors the existing inline upsells so the chrome doesn't
// fork: one card with text on the left, primary button on the right, and
// a small "Or pay monthly" link directly under the primary CTA.
//
// Variant composition (P1):
//   - Card copy varies by feature (this module's responsibility)
//   - PRIMARY button label varies by P1 experiment (read from /auth/me)
//     — when present, the variant label REPLACES the default Pro Annual
//     label on the primary CTA. The destination still points at the
//     yearly frequency so we don't accidentally A/B test the destination.
//   - The SECONDARY link is intentionally static — running an A/B on
//     both surfaces at once would confound the experiment.

import { useDashboardCtx } from '../hooks/useDashboardCtx'
import {
  UPGRADE_COPY,
  BILLING_PATH,
  DEFAULT_UPGRADE_CTA,
  buildCtaHref,
  readUpgradeCtaVariant,
  type UpgradeFeature,
} from './upgradeCopy'

export interface UpgradePromptCardProps {
  /** Which surface is showing the prompt — drives the copy. */
  feature: UpgradeFeature
  /** Override the CTA href (defaults to BILLING_PATH = /app/billing). */
  href?: string
  /** Optional dense layout — drops padding for use inside narrow inline
   *  banners (matches the old CustomDomainPanel banner footprint). */
  dense?: boolean
  /** Test-id hook — defaults to `upgrade-prompt-<feature>`. */
  testId?: string
  /** Experiment variant override for tests. Production callers should not
   *  pass this — the card reads from useDashboardCtx automatically. */
  variantOverride?: { label?: string } | null
}

export function UpgradePromptCard({
  feature,
  href,
  dense = false,
  testId,
  variantOverride,
}: UpgradePromptCardProps) {
  const copy = UPGRADE_COPY[feature]
  const ctx = useDashboardCtx()

  // Variant resolution for the PRIMARY CTA label only.
  // Order:
  //   1. test override (lets the unit test drive variant without /auth/me)
  //   2. P1 experiment variant from /auth/me (replaces default when present)
  //   3. per-feature primary label (the Pro Annual default)
  //   4. DEFAULT_UPGRADE_CTA last-resort (shouldn't fire post-refactor, but
  //      kept so a future surface that omits primaryCtaLabel still renders)
  const experimentLabel =
    variantOverride !== undefined
      ? variantOverride?.label
      : readUpgradeCtaVariant(ctx.me)?.label

  const primaryLabel = experimentLabel ?? copy.primaryCtaLabel ?? DEFAULT_UPGRADE_CTA
  const baseHref = href ?? copy.ctaHref ?? BILLING_PATH
  const primaryHref = buildCtaHref(baseHref, copy.primaryCtaFrequency)
  const secondaryHref = buildCtaHref(baseHref, copy.secondaryCtaFrequency)

  const padY = dense ? 10 : 14
  const padX = dense ? 12 : 18

  return (
    <section
      className="card"
      data-testid={testId ?? `upgrade-prompt-${feature}`}
      data-feature={feature}
      style={{
        padding: `${padY}px ${padX}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          data-testid="upgrade-prompt-title"
          style={{ fontSize: 13.5, color: 'var(--text)', marginBottom: 4 }}
        >
          <strong style={{ fontWeight: 500 }}>{copy.title}</strong>
        </div>
        <div
          data-testid="upgrade-prompt-body"
          style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}
        >
          {copy.body}
        </div>
        {copy.priceLine && (
          <div
            data-testid="upgrade-prompt-price"
            style={{
              marginTop: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-faint)',
              letterSpacing: '0.03em',
            }}
          >
            {copy.priceLine}
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
        }}
      >
        <a
          href={primaryHref}
          className="btn btn-primary btn-sm"
          data-testid="upgrade-prompt-cta"
          data-frequency={copy.primaryCtaFrequency}
        >
          {primaryLabel}
        </a>
        <a
          href={secondaryHref}
          data-testid="upgrade-prompt-cta-secondary"
          data-frequency={copy.secondaryCtaFrequency}
          style={{
            fontSize: 11.5,
            color: 'var(--text-dim)',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          {copy.secondaryCtaLabel}
        </a>
      </div>
    </section>
  )
}
