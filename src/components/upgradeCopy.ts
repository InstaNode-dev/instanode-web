// upgradeCopy — feature-specific copy for in-context upgrade prompts (U2).
//
// Track U2 replaces every generic "Upgrade to Pro" CTA on the dashboard with a
// feature-specific prompt that explains what the click actually unlocks.
// Surface-level framing converts measurably better than the generic label.
//
// Pricing direction (2026-05-13, per PRICING-BEST-PRACTICES-2026-05-13.md):
//   The primary upgrade target is **Pro Annual** — highest-LTV product, framed
//   as "2 months free". The monthly option survives as a secondary text link
//   below the primary CTA so users mid-cycle can still pick monthly.
//
// Coordination with track P1 (variant A/B on the button itself):
//   P1 attaches an optional `experiments.upgrade_cta` payload to /auth/me.
//   The CARD copy (title + body) varies by surface — that's this module.
//   The BUTTON inside the card varies by experiment — read from useDashboardCtx.
//   P1's variant label, when present, overrides the *primary* CTA label only;
//   the secondary "Or pay monthly" link stays static so the A/B test doesn't
//   accidentally measure a copy delta on both surfaces at once.
//
// If P1 hasn't shipped (or returns no variant), we fall back to the per-feature
// primaryCtaLabel (Pro Annual framing) so the UI degrades cleanly.
//
// Adding a new surface:
//   1. Pick a stable `UpgradeFeature` key (e.g. 'team_seats')
//   2. Add an entry to UPGRADE_COPY below (title + body + primary/secondary CTAs)
//   3. <UpgradePromptCard feature="team_seats" /> on the surface

/** Stable identifiers for each upgrade surface — used as the prop key on
 *  UpgradePromptCard so the copy stays in one place and the call site
 *  carries no inline strings. */
export type UpgradeFeature =
  | 'vault_prod'
  | 'provision_twin'
  | 'family_bindings'
  | 'quota_wall'
  | 'custom_domain'
  | 'private_deploy'

/** Frequency of the checkout destination linked from a CTA. Carried on the
 *  link as `?frequency=…` so BillingPage can pre-select the right toggle. */
export type CtaFrequency = 'yearly' | 'monthly'

/** Shape of a single feature's prompt.
 *
 *  - `title`/`body`: the surface-specific framing.
 *  - `priceLine`: small mono footer (kept for visual continuity with U2).
 *  - `primaryCtaLabel`/`primaryCtaFrequency`: the prominent CTA — defaults
 *    to the Pro Annual destination ("$7.50/mo billed yearly · 2 months free").
 *  - `secondaryCtaLabel`/`secondaryCtaFrequency`: the small text link below
 *    ("Or pay monthly — $9/mo") that keeps the monthly path discoverable.
 *  - `ctaHref`: link target (defaults to BILLING_PATH). Both CTAs use the
 *    same base href; the `frequency` and `plan` query params are appended
 *    by UpgradePromptCard so the two destinations differ only by query. */
export interface UpgradeCopy {
  title: string
  body: string
  priceLine?: string
  primaryCtaLabel: string
  primaryCtaFrequency: CtaFrequency
  secondaryCtaLabel: string
  secondaryCtaFrequency: CtaFrequency
  ctaHref?: string
}

/** Default billing route — kept here so callers stop duplicating the literal.
 *  CustomDomainPanel and DeployDetailPage previously each had their own
 *  `const BILLING_PATH = '/app/billing'`. */
export const BILLING_PATH = '/app/billing'

/** Default plan slug appended to billing CTAs — the only plan we currently
 *  upsell to from these surfaces is Pro. Kept as a constant so the literal
 *  doesn't scatter across upgradeCopy + UpgradePromptCard. */
export const DEFAULT_UPGRADE_PLAN = 'pro'

/** Shared primary CTA label — the Pro Annual destination. Anchored on the
 *  effective per-month price ($7.50) with the "2 months free" framing from
 *  the pricing playbook. Centralised so every surface stays on-message. */
export const PRIMARY_CTA_LABEL_PRO_ANNUAL = 'Get Pro — $7.50/mo billed yearly · 2 months free'

/** Shared secondary CTA label — the mid-cycle monthly fallback. Kept short
 *  so it visually reads as a secondary text link rather than a second
 *  button. */
export const SECONDARY_CTA_LABEL_PRO_MONTHLY = 'Or pay monthly — $9/mo'

/** Legacy fallback. Retained so existing P1 variant logic continues to work
 *  when a /auth/me payload omits both feature copy and variant label.
 *  Note: with the 2026-05-13 refactor, every UPGRADE_COPY entry supplies
 *  primaryCtaLabel directly, so this fallback is only hit by tests that
 *  bypass the copy map (or future surfaces that opt out of the default). */
export const DEFAULT_UPGRADE_CTA = 'Upgrade to Pro →'

export const UPGRADE_COPY: Record<UpgradeFeature, UpgradeCopy> = {
  vault_prod: {
    title: 'Vault for production env requires Pro Annual',
    body: 'Keeps prod secrets isolated from staging and dev. AES-256-GCM at rest, scoped per-env at runtime.',
    priceLine: '$7.50/mo billed yearly · 2 months free',
    primaryCtaLabel: PRIMARY_CTA_LABEL_PRO_ANNUAL,
    primaryCtaFrequency: 'yearly',
    secondaryCtaLabel: SECONDARY_CTA_LABEL_PRO_MONTHLY,
    secondaryCtaFrequency: 'monthly',
  },
  provision_twin: {
    title: 'Provision-twin in another env requires Pro Annual',
    body: 'Creates a sibling staging Postgres in one click, linked to your prod DB. Schema stays in lockstep.',
    priceLine: '$7.50/mo billed yearly · 2 months free',
    primaryCtaLabel: PRIMARY_CTA_LABEL_PRO_ANNUAL,
    primaryCtaFrequency: 'yearly',
    secondaryCtaLabel: SECONDARY_CTA_LABEL_PRO_MONTHLY,
    secondaryCtaFrequency: 'monthly',
  },
  family_bindings: {
    title: 'Family deploy bindings require Pro Annual',
    body: 'One deploy manifest works across prod + staging + dev. Promote between envs without rewriting bindings.',
    priceLine: '$7.50/mo billed yearly · 2 months free',
    primaryCtaLabel: PRIMARY_CTA_LABEL_PRO_ANNUAL,
    primaryCtaFrequency: 'yearly',
    secondaryCtaLabel: SECONDARY_CTA_LABEL_PRO_MONTHLY,
    secondaryCtaFrequency: 'monthly',
  },
  quota_wall: {
    title: "You're approaching your hobby quota — Pro Annual unlocks 10x",
    body: 'Upgrade to Pro for 5 GB Postgres (10x) and 256 MB Redis. Your existing resources keep working — limits raise immediately.',
    priceLine: '$7.50/mo billed yearly · 2 months free · resources elevate instantly',
    primaryCtaLabel: PRIMARY_CTA_LABEL_PRO_ANNUAL,
    primaryCtaFrequency: 'yearly',
    secondaryCtaLabel: SECONDARY_CTA_LABEL_PRO_MONTHLY,
    secondaryCtaFrequency: 'monthly',
  },
  custom_domain: {
    title: 'Custom domains require Pro Annual',
    body: 'Bind your own hostname (e.g. app.acme.com) to a deployment. TLS certs issued automatically via cert-manager.',
    priceLine: '$7.50/mo billed yearly · 2 months free',
    primaryCtaLabel: PRIMARY_CTA_LABEL_PRO_ANNUAL,
    primaryCtaFrequency: 'yearly',
    secondaryCtaLabel: SECONDARY_CTA_LABEL_PRO_MONTHLY,
    secondaryCtaFrequency: 'monthly',
  },
  private_deploy: {
    title: 'Private deploys with IP allow-list require Pro Annual',
    body: 'Lock your CRM, internal dashboard, or staging app to specific IPs.',
    priceLine: '$7.50/mo billed yearly · 2 months free',
    primaryCtaLabel: PRIMARY_CTA_LABEL_PRO_ANNUAL,
    primaryCtaFrequency: 'yearly',
    secondaryCtaLabel: SECONDARY_CTA_LABEL_PRO_MONTHLY,
    secondaryCtaFrequency: 'monthly',
  },
}

/** Optional experiment shape we expect P1 to add to /auth/me. Modelled as
 *  an optional field on AuthMeResponse so the dashboard can ship before
 *  P1 lands without a type-level dependency on it.
 *
 *  Assumption (documented in handoff to P1): the variant payload is a small
 *  bag of `{ label?: string }` — anything else (color, etc.) can be derived
 *  on the client from `variant`. If P1 ships a different shape we'll adapt
 *  the reader in UpgradePromptCard. */
export interface UpgradeExperimentVariant {
  variant?: string
  label?: string
}

/** Read a variant from a /auth/me-shaped object without taking a hard
 *  dependency on AuthMeResponse. Returns the experiment-specific label
 *  (P1) or null when no variant is in flight. */
export function readUpgradeCtaVariant(me: unknown): UpgradeExperimentVariant | null {
  const m = me as { experiments?: { upgrade_cta?: UpgradeExperimentVariant } } | null | undefined
  return m?.experiments?.upgrade_cta ?? null
}

/** Build the destination URL for a CTA. The frequency + plan query params
 *  let BillingPage pre-select the right toggle when it lands — keeps the
 *  source-of-truth in upgradeCopy rather than scattered string-concat at
 *  every call site. */
export function buildCtaHref(
  baseHref: string,
  frequency: CtaFrequency,
  plan: string = DEFAULT_UPGRADE_PLAN,
): string {
  // Preserve any existing query/hash on the base href. Most callers pass a
  // bare path (BILLING_PATH), but a surface that overrides with `?env=staging`
  // still works because URLSearchParams round-trips cleanly.
  const [path, existing = ''] = baseHref.split('?')
  const params = new URLSearchParams(existing)
  params.set('frequency', frequency)
  params.set('plan', plan)
  return `${path}?${params.toString()}`
}
