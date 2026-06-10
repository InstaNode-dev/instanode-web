/* postAuthDestination.ts — COMMERCE-FIRST REDIRECT (2026-06-10).
 *
 * Product decision (memory project_commerce_first_redirect_at_interactions):
 * user interactions with the system are scarce, so every claim/login
 * touchpoint must push commerce. This is the single pure decision function
 * that the post-auth landing surfaces (LoginCallbackPage, ClaimPage success)
 * call to decide WHERE to send a freshly-authenticated user.
 *
 * The rule, by tier:
 *   - free                            → /pricing       (drive the first purchase)
 *   - hobby / hobby_plus / pro / growth (paid, upgrade-eligible)
 *                                     → /app/billing   (show them the next tier)
 *   - team (top tier)                 → /app           (no upsell — already maxed)
 *   - anonymous / unknown / empty     → /app           (no commerce surface to
 *                                        push; the page only reaches this fn
 *                                        AFTER a successful auth, so a missing/
 *                                        weird tier degrades to the dashboard
 *                                        rather than trapping the user)
 *
 * HARD RULES this function encodes:
 *   1. NEVER route to a Team checkout. Team is gated / "contact sales"
 *      ([[project_team_plan_not_rolled_out_no_payment]]); a team-tier user is
 *      already at the top, so there is nothing to upsell — send them to /app.
 *      The billing surface for paid-but-eligible tiers is the in-app upgrade
 *      page (/app/billing), which itself never offers a Team purchase.
 *   2. An explicit `next` destination ALWAYS wins. A deep-link (e.g.
 *      login → /app/checkout?plan=pro, or the 401-interceptor's saved
 *      return_to) is a deliberate user intent and must never be overridden by
 *      the commerce redirect. This also prevents loops: a user sent to
 *      /pricing who clicks "sign in" and comes back with a saved next never
 *      bounces pricing→login→pricing.
 *
 * `next` is only honoured when it is a SAFE internal path (starts with a
 * single "/" but not "//" — the latter is a protocol-relative URL that could
 * point off-origin). This mirrors the existing return_to guard in
 * LoginCallbackPage (which additionally requires the /app prefix) but is
 * intentionally a touch broader here so a deep-link to /pricing itself, or a
 * future public post-auth landing, is also honourable. Callers that need the
 * stricter /app-only guard should pre-filter before calling.
 */

import { TIER_RANK, type Tier } from '../api'

// Canonical destinations — named constants, never inline string literals
// (feedback_no_hardcoded_strings). These are the three landing surfaces the
// commerce-first rule can resolve to.
export const DEST_PRICING = '/pricing'
export const DEST_BILLING = '/app/billing'
export const DEST_DASHBOARD = '/app'

// The free tier's rank in the canonical ladder (TIER_RANK.free === 1).
// Anything strictly above free and strictly below team is "paid but
// upgrade-eligible" → /app/billing. We derive these from TIER_RANK rather
// than hand-listing the tiers so a future tier inserted between free and team
// in the ladder automatically lands in the upgrade bucket (rule 18 — derive
// from the registry, don't hand-type the membership list).
const FREE_RANK = TIER_RANK.free
const TEAM_RANK = TIER_RANK.team

/** isSafeInternalNext — true when `next` is a same-origin absolute path we can
 *  redirect to without leaving the SPA. Rejects empty, off-origin (http://…),
 *  and protocol-relative ("//evil.com") values. */
export function isSafeInternalNext(next: string | null | undefined): next is string {
  if (!next) return false
  // Must be an absolute in-app path …
  if (next[0] !== '/') return false
  // … but NOT a protocol-relative URL ("//host") which the browser treats as
  // off-origin. A single leading slash followed by anything else is fine.
  if (next[1] === '/') return false
  return true
}

/**
 * postAuthDestination — the commerce-first landing decision.
 *
 * @param tier  the authenticated user's plan tier (from /auth/me → me.user.tier).
 *              An empty string / unknown value degrades to the dashboard.
 * @param next  an optional explicit destination (deep-link / saved return_to).
 *              When it is a safe internal path it ALWAYS wins over the
 *              commerce redirect.
 * @returns the path to navigate to.
 */
export function postAuthDestination(tier: Tier | string | null | undefined, next?: string | null): string {
  // 1. Explicit deep-link always wins — never override a deliberate
  //    destination, and never loop pricing→login→pricing.
  if (isSafeInternalNext(next)) return next

  // 2. Tier-based commerce push.
  const rank = TIER_RANK[(tier ?? '') as string]

  // Unknown / anonymous / free-below tiers we never upsell mid-flow: only the
  // explicit `free` tier gets the pricing push. Anonymous shouldn't reach here
  // (they auth first), and an unrecognised tier degrades to the dashboard.
  if (rank === FREE_RANK) return DEST_PRICING

  // Paid but not yet top-tier → show the in-app upgrade/billing surface.
  // (rank strictly between free and team.)
  if (typeof rank === 'number' && rank > FREE_RANK && rank < TEAM_RANK) {
    return DEST_BILLING
  }

  // Top tier (team), unknown tier, or anything else → straight to the
  // dashboard. NEVER a Team checkout.
  return DEST_DASHBOARD
}
