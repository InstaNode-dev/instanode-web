// UpgradePromptCard — shared in-context upgrade prompt (U2).
//
// Renders a single feature-specific upsell tile (title + body + small CTA).
// Copy is sourced from upgradeCopy.ts by the `feature` key, so every call site
// stays at one prop. The CTA button label respects P1's /auth/me experiment
// variant when present — see upgradeCopy.readUpgradeCtaVariant for the shape.
//
// Visual style mirrors the existing inline upsells (PromoteUpsell in
// DeployDetailPage, CustomDomainPanel's upgrade_required banner) so the
// chrome doesn't fork: one-line card with text on the left and a small
// btn-primary on the right.
//
// Variant strategy:
//   - Card copy varies by feature (this module's responsibility)
//   - Button label varies by P1 experiment (read from /auth/me)
//   - Per-surface override via `ctaLabel` on the copy entry takes priority
//     over the experiment label, so a surface that needs a specific call
//     to action can override.

import { useDashboardCtx } from '../hooks/useDashboardCtx'
import {
  UPGRADE_COPY,
  BILLING_PATH,
  DEFAULT_UPGRADE_CTA,
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

  // Variant resolution order:
  //   1. test override (lets the unit test drive variant without /auth/me)
  //   2. per-feature override (copy.ctaLabel) — surfaces that need their
  //      own default ("Upgrade now" on a hard quota wall, etc.)
  //   3. P1 experiment variant from /auth/me
  //   4. DEFAULT_UPGRADE_CTA fallback
  const experimentLabel =
    variantOverride !== undefined
      ? variantOverride?.label
      : readUpgradeCtaVariant(ctx.me)?.label
  const ctaLabel = copy.ctaLabel ?? experimentLabel ?? DEFAULT_UPGRADE_CTA
  const ctaHref = href ?? copy.ctaHref ?? BILLING_PATH

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
      <a
        href={ctaHref}
        className="btn btn-primary btn-sm"
        data-testid="upgrade-prompt-cta"
      >
        {ctaLabel}
      </a>
    </section>
  )
}
