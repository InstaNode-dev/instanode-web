// e2e/tier-matrix.ts — the per-tier × per-page EXPECTATION registry for the
// real-backend tier-matrix sweep (live-ui-tier-matrix.spec.ts).
//
// Design ref: docs/ci/00-INTERACTION-PATHS.md Part C ("no per-route × per-tier ×
// per-async-state CI sweep") + Part A3 (the tier dimension). This module is the
// ONE place that encodes "what the dashboard SHOULD render per tier" so the
// matrix spec stays registry-iterating (CLAUDE.md rule 18): adding a tier to the
// canonical ladder auto-expands the matrix, and a soft-gate allowlist change in
// the app surfaces here as a single edit rather than a hand-typed per-tier list
// scattered across the spec.
//
// ── Source of truth (mirrored here, NOT re-invented) ──────────────────────────
// The app's tier-gating lives as hardcoded ReadonlySet allowlists on each page
// (Part A3 "Flag: no client-side OpenFeature wired yet — soft gates = hardcoded
// tier allowlists"). We mirror EACH allowlist here with a back-reference comment
// so a drift is a one-line fix in lockstep with the page. The canonical tier
// ladder is TIER_RANK (src/api/index.ts) — kept byte-aligned with the backend
// common/plans/rank.go. We import it so the matrix iterates the SAME ladder the
// app ranks by; a new tier in TIER_RANK appears in the matrix automatically.
//
//   PRIVATE_DEPLOY_TIERS   = pro|team|growth   (src/pages/DeploymentsPage.tsx:37,
//                                               DeployDetailPage.tsx PRIVATE_DEPLOY_EDIT_TIERS)
//   VAULT_MULTI_ENV_TIERS  = pro|team|growth   (src/pages/VaultPage.tsx:11)
//   CUSTOM_DOMAIN_TIERS    = hobby_plus|pro|team|growth (src/pages/DeployDetailPage.tsx:31)
//   deploy-TTL edit (isPaidTier) = NOT free/anonymous  (src/pages/SettingsPage.tsx:419)
//   Overview upgrade CTA (showProUpgrade) = anonymous|free|hobby
//                                               (src/pages/OverviewPage.tsx:69)
//   Billing next-tier = team for pro|growth → "Contact sales" mailto, NEVER
//     self-serve checkout (src/pages/BillingPage.tsx NEXT_CHANGE_PLAN_TIER) —
//     the project's HARD "Team not self-serve" rule.

import { TIER_RANK } from '../src/api'

// ── The canonical tier ladder the matrix iterates ────────────────────────────

/**
 * Every tier the app ranks, lowest→highest, derived from TIER_RANK (the same
 * table src/api/index.ts uses, byte-aligned with the backend rank.go). Iterating
 * THIS (not a hand-typed slice) is what makes a new tier auto-expand the matrix
 * (rule 18). `anonymous` and `team`/`growth` are present here as the FULL ladder;
 * the matrix spec intersects this with what the factory can MINT.
 */
export const ALL_TIERS: readonly string[] = Object.entries(TIER_RANK)
  .sort((a, b) => a[1] - b[1])
  .map(([tier]) => tier)

// ── Mirrored soft-gate allowlists (back-referenced above) ─────────────────────
// Each Set mirrors the corresponding app allowlist EXACTLY. A `*_test.ts`-style
// drift guard is impractical cross-module here (the app's Sets are page-local,
// not exported), so the back-reference comments + the live render assertions are
// the lockstep mechanism: if the app gate diverges from this mirror, the live
// matrix spec's render assertion FAILS against prod (the point of the sweep).

/** Tiers that can ship a private deploy (DeploymentsPage configurator vs upsell). */
const PRIVATE_DEPLOY_TIERS = new Set(['pro', 'team', 'growth'])

/** Tiers with multi-env vault (non-prod env tabs not walled). */
const VAULT_MULTI_ENV_TIERS = new Set(['pro', 'team', 'growth'])

/** Tiers that can edit the team deploy-TTL default (SettingsPage isPaidTier). */
const TTL_EDIT_TIERS_EXCLUDE = new Set(['anonymous', 'free'])

/** Tiers that see the Overview "want bigger limits" upgrade CTA (showProUpgrade). */
const OVERVIEW_UPGRADE_CTA_TIERS = new Set(['anonymous', 'free', 'hobby'])

/** Tiers whose next upgrade step is Team (→ contact-sales, never self-serve). */
const NEXT_IS_TEAM_TIERS = new Set(['pro', 'growth'])

// ── Per-tier × per-feature expectation (computed, not hand-typed) ─────────────

/** A single tier's expected gated/ungated state across the matrix features. */
export interface TierExpectation {
  tier: string
  /** Private-deploy: true → DeploymentsPage shows the live configurator;
   *  false → the UpgradePromptCard upsell. */
  privateDeployUnlocked: boolean
  /** Multi-env vault: true → non-prod env tabs are not walled. */
  vaultMultiEnvUnlocked: boolean
  /** Deploy-TTL edit: true → SettingsPage radios are editable (paid tier);
   *  false → the free-tier upgrade hint + disabled radios. */
  ttlEditUnlocked: boolean
  /** Overview upgrade CTA: true → the "want bigger limits" CTA renders. */
  overviewUpgradeCta: boolean
  /** Billing: true → this tier's only "next step" is Team, so the upgrade
   *  surface is contact-sales (mailto) and NEVER a self-serve Team checkout. */
  billingNextIsTeamContactSales: boolean
}

/** Compute a tier's expectation from the mirrored allowlists (registry-derived). */
export function expectationFor(tier: string): TierExpectation {
  return {
    tier,
    privateDeployUnlocked: PRIVATE_DEPLOY_TIERS.has(tier),
    vaultMultiEnvUnlocked: VAULT_MULTI_ENV_TIERS.has(tier),
    ttlEditUnlocked: !TTL_EDIT_TIERS_EXCLUDE.has(tier),
    overviewUpgradeCta: OVERVIEW_UPGRADE_CTA_TIERS.has(tier),
    billingNextIsTeamContactSales: NEXT_IS_TEAM_TIERS.has(tier),
  }
}
