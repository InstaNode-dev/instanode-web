// upgradeCopy — feature-specific copy for in-context upgrade prompts (U2).
//
// Track U2 replaces every generic "Upgrade to Pro" CTA on the dashboard with a
// feature-specific prompt that explains what the click actually unlocks.
// Surface-level framing converts measurably better than the generic label.
//
// Coordination with track P1 (variant A/B on the button itself):
//   P1 attaches an optional `experiments.upgrade_cta` payload to /auth/me.
//   The CARD copy (title + body) varies by surface — that's this module.
//   The BUTTON inside the card varies by experiment — read from useDashboardCtx.
//   The two compose: surface-specific framing + experiment-specific CTA.
//
// If P1 hasn't shipped (or returns no variant), we fall back to the default
// label "Upgrade to Pro →" so the UI degrades cleanly.
//
// Adding a new surface:
//   1. Pick a stable `UpgradeFeature` key (e.g. 'team_seats')
//   2. Add an entry to UPGRADE_COPY below
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

/** Shape of a single feature's prompt. `title` is the strong lead; `body` is
 *  the explainer that follows; `priceLine` is the small mono "$9/mo · ~30s
 *  setup" footer; `ctaHref` is the link target (default /app/billing).
 *
 *  ctaLabel is optional — when omitted, the card uses the P1 experiment
 *  variant from /auth/me, falling back to "Upgrade to Pro →". Surfaces that
 *  need a different default label can override here. */
export interface UpgradeCopy {
  title: string
  body: string
  priceLine?: string
  ctaLabel?: string
  ctaHref?: string
}

/** Default billing route — kept here so callers stop duplicating the literal.
 *  CustomDomainPanel and DeployDetailPage previously each had their own
 *  `const BILLING_PATH = '/app/billing'`. */
export const BILLING_PATH = '/app/billing'

/** Default CTA label used when P1 hasn't supplied a variant. Keep this as the
 *  single source of truth so the fallback stays consistent across surfaces. */
export const DEFAULT_UPGRADE_CTA = 'Upgrade to Pro →'

export const UPGRADE_COPY: Record<UpgradeFeature, UpgradeCopy> = {
  vault_prod: {
    title: 'Vault for production env requires Pro',
    body: 'Keeps prod secrets isolated from staging and dev. AES-256-GCM at rest, scoped per-env at runtime.',
    priceLine: '$9/mo · ~30s setup',
  },
  provision_twin: {
    title: 'Provision-twin in another env requires Pro',
    body: 'Creates a sibling staging Postgres in one click, linked to your prod DB. Schema stays in lockstep.',
    priceLine: '$9/mo · ~30s setup',
  },
  family_bindings: {
    title: 'Family deploy bindings require Pro',
    body: 'One deploy manifest works across prod + staging + dev. Promote between envs without rewriting bindings.',
    priceLine: '$9/mo · ~30s setup',
  },
  quota_wall: {
    title: "You're approaching your hobby quota",
    body: 'Upgrade to Pro for 5 GB Postgres (10x) and 256 MB Redis. Your existing resources keep working — limits raise immediately.',
    priceLine: '$9/mo · resources elevate instantly',
  },
  custom_domain: {
    title: 'Custom domains are a Pro feature',
    body: 'Bind your own hostname (e.g. app.acme.com) to a deployment. TLS certs issued automatically via cert-manager.',
    priceLine: '$9/mo · ~30s setup',
  },
  private_deploy: {
    title: 'Private deploys with IP allow-list require Pro',
    body: 'Lock your CRM, internal dashboard, or staging app to specific IPs.',
    priceLine: '$9/mo · ~30s setup',
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
