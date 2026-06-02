// PricingGrid — research-backed 5-tier pricing surface.
//
// Renders Free / Hobby / Hobby Plus / Pro / Team side-by-side as a 5-column
// grid that collapses to 2x3 on tablet (≤ 1100px) and a single stack on
// mobile (≤ 640px). Pro gets the "Most Popular" badge + raised treatment.
// The user's current tier shows a "Your plan" pill in place of its CTA;
// every other tier shows a tier-aware action.
//
// W11 (2026-05-13): inserted Hobby Plus ($19/mo) between Hobby and Pro
// as a research-backed pricing decoy — triple-tier $9/$19/$49 lifts
// conversion ~22% vs $9/$49 by anchoring against the middle price.
//
// Why a separate component:
//   - The BillingPage owns the auth/billing/usage state. This is a pure
//     pricing-surface presenter: take a current tier + frequency state +
//     a CTA handler, render the grid.
//   - The marketing /pricing page can (and probably should) compose the
//     same component so the in-product and public surfaces don't fork.
//     PricingPage.tsx remains its own implementation today — wiring that
//     up is a follow-up — but the props shape here is designed for both
//     use cases (`embedded` flag toggles the in-product frequency-toggle
//     row vs the marketing-page layout).
//
// Research references:
//   - 4-tier with Team as anchor → +25–60% mid-tier conversion.
//   - Annual default → +19–35% annual adoption.
//   - "2 months free" framing → Athenic +342% annual signups, +62% LTV.
//   - Most Popular badge → +158% middle-tier conversion in one cited study.

import type { ReactNode } from 'react'
import { TierCard, type Frequency, type TierKey } from './TierCard'

// PLAN_DATA — canonical labels + features for each tier. Mirrors the
// PLANS map in BillingPage (kept for the Usage panel / limits panel)
// but trimmed to what the pricing grid actually renders. Numbers + copy
// stay byte-identical so a hobby user sees the same description on the
// marketing page, the in-product grid, and the limits table.
export interface TierFeature {
  text: string
  comingSoon?: boolean
}

interface TierDefinition {
  key: TierKey
  label: string
  // Per-frequency price + subtext + savings. Free has no yearly variant
  // (the "$0 forever" headline doesn't need a frequency toggle), so we
  // store a single block that's reused regardless of toggle state.
  monthly: { price: string; sub: string }
  yearly?: { price: string; sub: string; savings: string; yearlyTotal: string }
  features: TierFeature[]
  // The next-tier slug — used when this tier is the *current* one and
  // we need a CTA target. Free → hobby, hobby → pro, pro → team, team
  // → null. Drives the "Upgrade to Team" copy on the Pro card when the
  // user is already on Pro.
  upgradesTo?: TierKey
  highlight?: boolean
  // Set when the tier is announced but not yet purchasable. As of
  // 2026-05-20, Team is launched — no current tier sets this, but
  // the flag is preserved as the type-system safety net for any
  // future "announced but unbuyable" rollout (early-access waitlists).
  comingSoon?: boolean
}

// Numbers are USD and come from api/plans.yaml. "2 months free" framing
// is enforced visually for Pro/Team: yearly price = monthly * 10,
// savings = monthly * 2 (~17% off). Hobby + Hobby Plus follow the same
// "~17% off / 2 months free" ladder so the savings story is consistent
// across every paid tier.
//   Hobby      $9/mo →   $90/yr ($7.50/mo)   · save $18  (plans.yaml hobby_yearly = 9000 cents)
//   Hobby Plus $19/mo →  $199/yr ($16.58/mo) · save $29
//   Pro        $49/mo →  $490/yr ($40.83/mo) · save $98
//   Team       $199/mo → $1990/yr ($165.83/mo) · save $398
//
// FIX-G (2026-05-14): Hobby yearly was showing $99/yr · save $9 which
// drifted from plans.yaml hobby_yearly.price_monthly_cents = 9000 ($90/yr).
// Numbers below now mirror plans.yaml. If pricing changes again, edit
// plans.yaml first then this comment + the hobby block below — the
// PricingGrid is a static marketing display, not a /api/v1/capabilities
// reader (that's a follow-up worth doing once the pricing surface has
// more than two consumers).
export const PRICING_GRID_TIERS: TierDefinition[] = [
  {
    key: 'free',
    label: 'Free',
    monthly: { price: '$0', sub: 'forever' },
    // Free has no yearly variant — leave yearly undefined so the
    // grid renders the monthly block in both modes (no fake savings).
    features: [
      { text: '10 MB Postgres · 24h TTL' },
      { text: '5 MB Redis · 24h TTL' },
      { text: '5 MB MongoDB · 24h TTL' },
      { text: '100 stored webhooks' },
      { text: 'agent-only access' },
    ],
    upgradesTo: 'hobby',
  },
  {
    key: 'hobby',
    label: 'Hobby',
    monthly: { price: '$9', sub: '/mo' },
    yearly: {
      price: '$7.50',
      sub: '/mo, billed yearly',
      savings: '$90/yr · save $18 (17%)',
      yearlyTotal: '$90/yr',
    },
    features: [
      { text: '1 GB Postgres · 8 conn' },
      { text: '50 MB Redis' },
      { text: '100 MB MongoDB · 5 conn' },
      { text: '1 deployment' },
      { text: '20 vault entries · production env' },
      { text: '1,000 stored webhooks' },
    ],
    upgradesTo: 'hobby_plus',
  },
  // hobby_plus — $19/mo mid-step between Hobby and Pro.
  // 2026-05-15 (W12 pricing pass): multi-env vault rolled back to Pro+,
  // so hobby_plus's differentiators vs hobby are now storage (10× Mongo,
  // 10× object), 2 deployments, custom domain, and self-serve restore —
  // not multi-env.
  {
    key: 'hobby_plus',
    label: 'Hobby Plus',
    monthly: { price: '$19', sub: '/mo' },
    yearly: {
      price: '$16.58',
      sub: '/mo, billed yearly',
      savings: '$199/yr · save $29',
      yearlyTotal: '$199/yr',
    },
    features: [
      { text: '1 GB Postgres · 8 conn' },
      { text: '50 MB Redis' },
      { text: '1 GB MongoDB · 5 conn · 5 GB object storage' },
      { text: '2 deployments · custom domain' },
      { text: '50 vault entries · production env' },
      { text: '14-day backups · 1-click restore' },
    ],
    upgradesTo: 'pro',
    // FIX-G (2026-05-14): "Most Popular" badge moved here from Pro. The W12
    // tier intro positioned Hobby Plus as the conversion sweet-spot (the
    // mid-tier decoy that lifts $9→$19 upgrades and frames Pro as the
    // power-user step), so flagging it as the popular pick keeps that story
    // consistent across the pricing surface and the marketing copy.
    highlight: true,
  },
  {
    key: 'pro',
    label: 'Pro',
    monthly: { price: '$49', sub: '/mo' },
    yearly: {
      price: '$40.83',
      sub: '/mo, billed yearly',
      savings: '$490/yr · save $98',
      yearlyTotal: '$490/yr',
    },
    features: [
      // 2026-05-15 Pro storage bump — keep in sync with api/plans.yaml.
      { text: '10 GB Postgres · 20 conn' },
      { text: '512 MB Redis' },
      { text: '5 GB MongoDB · 20 conn' },
      { text: '50 GB object storage · 10 deployments' },
      { text: '200 vault entries · multi-env' },
      { text: 'custom domain · 10k stored webhooks' },
    ],
    upgradesTo: 'team',
  },
  {
    // Team — launched 2026-05-20 (DOC-REALITY-DELTA sweep). plans.yaml:375
    // has team at $199/mo, $1990/yr, every limit -1 (unlimited).
    // CTA goes via buildCtaLabel('team') → "Contact sales" until the
    // assisted-Razorpay self-serve flow ships.
    key: 'team',
    label: 'Team',
    monthly: { price: '$199', sub: '/mo' },
    yearly: {
      price: '$165.83',
      sub: '/mo billed yearly',
      savings: '$1990/yr · save $398 (17%)',
      yearlyTotal: '$1990/yr',
    },
    features: [
      { text: 'unlimited Postgres · Redis · MongoDB · queues · storage' },
      { text: 'unlimited deployments · 50 custom domains' },
      { text: 'unlimited vault entries · multi-env' },
      { text: '90-day backups · self-serve restore' },
      { text: 'RBAC + audit log' },
      { text: 'SSO / SAML (coming soon)' },
      { text: '99.9% SLA (coming soon)' },
    ],
  },
]

// Tier-aware CTA copy. Returns the label the user sees on each tier's
// button, given the user's current tier and the active frequency.
//   - Free + current: no CTA (returns null).
//   - Free + not-current (e.g. anonymous viewing pricing page): "Start Free".
//   - Hobby: "Start Hobby — $7.50/mo" (annual) or "$9/mo" (monthly).
//   - Pro: "Get Pro — $40.83/mo" (annual) or "$49/mo" (monthly).
//   - Team: "Contact sales" (always — the surface is comingSoon).
//
// Returns null when the tier is the current one (the card renders the
// "Your plan" pill instead) or when there's no sensible CTA target.
export function buildCtaLabel(
  tier: TierKey,
  currentTier: TierKey,
  frequency: Frequency,
): string | null {
  if (tier === currentTier) return null
  if (tier === 'free') return 'Stay on Free'
  if (tier === 'team') return 'Contact sales'
  const def = PRICING_GRID_TIERS.find((t) => t.key === tier)
  if (!def) return null
  const useYearly = frequency === 'yearly' && !!def.yearly
  const price = useYearly ? def.yearly!.price : def.monthly.price
  // "Get Pro — $7.50/mo" / "Start Hobby — $9/mo" / "Get Hobby Plus — $19/mo"
  // "Get" reads as the action you take on an upgrade you actively want
  // (Pro / Hobby Plus). "Start" reads gentler for the cheapest paid
  // step-up (Hobby). Both end in the price so research's "verb + outcome
  // + anchored price" pattern is preserved.
  const verb = tier === 'pro' || tier === 'hobby_plus' ? 'Get' : 'Start'
  return `${verb} ${def.label} — ${price}/mo`
}

// Map a tier definition + frequency to the TierCard.pricing prop shape.
function pricingFor(t: TierDefinition, frequency: Frequency) {
  if (frequency === 'yearly' && t.yearly) {
    return {
      headline: t.yearly.price,
      subtext: t.yearly.sub,
      savings: t.yearly.savings,
    }
  }
  return { headline: t.monthly.price, subtext: t.monthly.sub }
}

export interface PricingGridProps {
  currentTier: TierKey
  frequency: Frequency
  onFrequencyChange: (f: Frequency) => void
  // Called when a non-current tier's CTA fires. Pro's CTA is special-cased
  // (composes UpgradeButton via `proCtaSlot`); every other CTA routes here.
  onSelectTier: (target: TierKey) => void
  // Per-tier disabled flag (e.g. while checkout is in flight).
  ctaDisabled?: boolean
  // Optional slot for the Pro tier's CTA. Lets the parent inject the
  // P1 A/B-variant UpgradeButton without forking this component to
  // know about experiments. When omitted, Pro falls back to the same
  // <button> as the other tiers.
  proCtaSlot?: ReactNode
  // Heading + intro renderer hook — used so embedded BillingPage and
  // standalone PricingPage can each provide their own copy. Defaults
  // to a compact in-product heading.
  heading?: ReactNode
  // Show / hide the frequency toggle. Defaults to true — set false on
  // surfaces that drive the toggle externally.
  showFrequencyToggle?: boolean
  // Optional testid override on the wrapper.
  testId?: string
}

export function PricingGrid({
  currentTier,
  frequency,
  onFrequencyChange,
  onSelectTier,
  ctaDisabled = false,
  proCtaSlot,
  heading,
  showFrequencyToggle = true,
  testId = 'pricing-grid',
}: PricingGridProps) {
  return (
    <section data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PricingGridStyles />
      {heading}
      {showFrequencyToggle && (
        <FrequencyToggle frequency={frequency} onChange={onFrequencyChange} />
      )}
      <div className="pricing-grid-cards" data-testid="pricing-grid-cards">
        {PRICING_GRID_TIERS.map((t) => {
          const isCurrent = t.key === currentTier
          const ctaLabel = isCurrent ? null : buildCtaLabel(t.key, currentTier, frequency)
          return (
            <TierCard
              key={t.key}
              tier={t.key}
              label={t.label}
              pricing={pricingFor(t, frequency)}
              features={t.features}
              highlight={!!t.highlight}
              isCurrent={isCurrent}
              ctaLabel={ctaLabel ?? undefined}
              onCta={() => onSelectTier(t.key)}
              ctaDisabled={ctaDisabled}
              ctaSlot={t.key === 'pro' && !isCurrent ? proCtaSlot : undefined}
              ctaTestId={`tier-cta-${t.key}`}
            />
          )
        })}
      </div>
    </section>
  )
}

/**
 * FrequencyToggle — segmented [Monthly] [Annual — 2 months free] control.
 * Annual is shown as the right-hand option and carries the "2 months free"
 * inline copy per the Athenic finding. Visually identical to the marketing
 * page's toggle so in-product and public surfaces feel continuous.
 */
function FrequencyToggle({
  frequency,
  onChange,
}: {
  frequency: Frequency
  onChange: (f: Frequency) => void
}) {
  return (
    <div
      data-testid="billing-frequency-toggle"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        margin: '4px 0 2px',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
        }}
      >
        billing cycle
      </span>
      <div
        role="radiogroup"
        aria-label="Billing cycle"
        style={{
          display: 'inline-flex',
          border: '1px solid var(--border-hi, var(--border))',
          borderRadius: 999,
          padding: 2,
          background: 'var(--elevated, var(--surface))',
        }}
      >
        <button
          type="button"
          role="radio"
          aria-checked={frequency === 'monthly'}
          data-testid="frequency-monthly"
          onClick={() => onChange('monthly')}
          style={{
            borderRadius: 999,
            padding: '5px 14px',
            fontSize: 12,
            background: frequency === 'monthly' ? 'var(--accent)' : 'transparent',
            color: frequency === 'monthly' ? 'var(--ink)' : 'var(--text)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Monthly
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={frequency === 'yearly'}
          data-testid="frequency-yearly"
          onClick={() => onChange('yearly')}
          style={{
            borderRadius: 999,
            padding: '5px 14px',
            fontSize: 12,
            background: frequency === 'yearly' ? 'var(--accent)' : 'transparent',
            color: frequency === 'yearly' ? 'var(--ink)' : 'var(--text)',
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>Annual</span>
          <span
            data-testid="frequency-2-months-free"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              letterSpacing: '0.04em',
              color: frequency === 'yearly' ? 'var(--ink)' : 'var(--accent)',
              opacity: frequency === 'yearly' ? 0.9 : 1,
            }}
          >
            — 2 months free
          </span>
        </button>
      </div>
    </div>
  )
}

/**
 * Grid layout styles — kept inline as a <style> tag so the BillingPage and
 * a hypothetical marketing reuse don't both need to pull a global stylesheet.
 * Breakpoints:
 *   - default: 5 columns (Free / Hobby / Hobby Plus / Pro / Team)
 *   - ≤ 1280px: 3+2 layout (3 on top, 2 on bottom — still readable)
 *   - ≤ 880px: 2x3 (5 cards laid out across 2 cols)
 *   - ≤ 540px: single stack
 *
 * W11 (2026-05-13): bumped from 4 columns to 5 to add hobby_plus.
 */
function PricingGridStyles() {
  return (
    <style>{`
      .pricing-grid-cards {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 12px;
      }
      @media (max-width: 1280px) {
        .pricing-grid-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @media (max-width: 880px) {
        .pricing-grid-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 540px) {
        .pricing-grid-cards { grid-template-columns: 1fr; }
      }
    `}</style>
  )
}
