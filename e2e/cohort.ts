// WS1-P1 — test-cohort identity for real-backend (LIVE) Playwright runs.
//
// Plan: docs/sessions/2026-06-04/OBSERVABILITY-AND-INTELLIGENCE-PLAN.md, WS1.
//
// Every entity a LIVE spec creates (team / account / resource / deploy) is
// tagged with a recognizable, machine-greppable prefix so it is:
//   1. identifiable for cleanup (the reaper sweeps by this prefix as a
//      backstop, in addition to the per-run ledger), and
//   2. recognizable by the FOLLOW-UP backend skip-cohort guards (a separate
//      api/worker PR) so quota/abuse/churn/billing-charge paths NO-OP for
//      test-cohort teams — a LIVE run must never email a "we miss you", burn a
//      real quota budget, or attempt a real charge.
//
// This is the instanode-web side ONLY. The backend `is_test_cohort` column +
// the guards that read it ship in the api/worker tree (PR #260): a minted team
// is `is_test_cohort=true`, and the live worker skip-guards neuter
// billing/churn/email/quota for it. With those guards + the mint endpoint
// (cohort-scoped) + the reaper all live, a SANCTIONED minted-account run MAY
// target prod (see assertSafeApiTarget below). An un-sanctioned/un-tokened run
// against prod is still REFUSED so a stray invocation can never hammer prod.
//
// The contract the backend guards will key on (kept here as the single source
// of truth for the string the two repos share):
//   - cohort emails  ⇒  local-part starts with `e2e-cohort+`
//   - cohort names    ⇒  resource/team names start with `e2e-cohort-`
//   - cohort marker   ⇒  the literal token COHORT_MARKER appears in the
//                         email local-part and in every created name, so a
//                         single `LIKE '%e2e-cohort%'` (or the future
//                         `is_test_cohort` backfill) catches all of it.

/**
 * The literal token that brands every cohort entity. Backend skip-cohort
 * guards (follow-up PR) match teams/resources whose email or name contains
 * this substring. Keep in sync with the api/worker guard constant when that
 * lands. Exported as a const (not an inline string) per the project's
 * no-hardcoded-strings rule.
 */
export const COHORT_MARKER = 'e2e-cohort'

/** Email local-part prefix, e.g. `e2e-cohort+<run>-<rand>@instanode.dev`. */
export const COHORT_EMAIL_PREFIX = `${COHORT_MARKER}+`

/** Resource / team name prefix, e.g. `e2e-cohort-smoke-db-<rand>`. */
export const COHORT_NAME_PREFIX = `${COHORT_MARKER}-`

/** Domain used for cohort emails. instanode.dev keeps them on our own domain. */
export const COHORT_EMAIL_DOMAIN = 'instanode.dev'

/**
 * A stable id for one Playwright run. Used to namespace the ledger file AND to
 * stamp every created entity, so a failed run's leftovers are attributable to
 * the run that made them. Honours CI's run id when present.
 */
export function runId(): string {
  const ci = process.env.E2E_LIVE_RUN_ID || process.env.GITHUB_RUN_ID
  if (ci) return String(ci)
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * A cohort email. Uses the `+`-subaddress form so every cohort send routes to
 * one mailbox (`e2e-cohort@instanode.dev`) yet stays unique per call — and so
 * the backend guard can match on the `e2e-cohort+` local-part prefix.
 */
export function cohortEmail(label = 'smoke'): string {
  return `${COHORT_EMAIL_PREFIX}${label}-${runId()}-${rand()}@${COHORT_EMAIL_DOMAIN}`
}

/** A cohort-branded resource/team name. */
export function cohortName(label = 'res'): string {
  return `${COHORT_NAME_PREFIX}${label}-${rand()}`
}

/** Predicate the reaper uses to decide if a name/email belongs to the cohort. */
export function isCohortBranded(value: string | null | undefined): boolean {
  return !!value && value.includes(COHORT_MARKER)
}

// ── Prod-target safety (item 3) ──────────────────────────────────────────────
// LIVE specs create REAL backend resources. Originally cohort.ts refused any
// prod E2E_API_URL outright (only STAGING was safe). Now that the backend
// `is_test_cohort` skip-guards (PR #260), the cohort-scoped mint endpoint, and
// the reaper are all live, a prod run is safe IFF it is a SANCTIONED
// minted-account run — i.e. it carries a mint token (E2E_ACCOUNT_TOKEN, used by
// the CI workflow to mint/reap the account) or an already-minted session JWT
// (E2E_SESSION_JWT). A prod target WITHOUT either is still refused, so a stray /
// mis-configured invocation can never provision-and-leak against prod.

/** The prod api host. A prod target is only allowed for a sanctioned minted run. */
export const PROD_API_HOST = 'api.instanode.dev'

/** True when the resolved api base points at the prod api host. */
export function isProdApiTarget(apiUrl: string): boolean {
  if (!apiUrl) return false
  try {
    return new URL(apiUrl).host.toLowerCase() === PROD_API_HOST
  } catch {
    // Not a parseable URL — be conservative and substring-match the host so a
    // malformed-but-prod-looking value can't slip past as "not prod".
    return apiUrl.toLowerCase().includes(PROD_API_HOST)
  }
}

/**
 * True when this process is a SANCTIONED minted-account run: it holds a mint
 * token (the workflow mints/reaps the account out-of-band) or an already-minted
 * session JWT. Either proves the run is the cohort-scoped, reaped, skip-guarded
 * path rather than a stray prod invocation.
 */
export function isSanctionedMintedRun(): boolean {
  return !!(process.env.E2E_ACCOUNT_TOKEN || process.env.E2E_SESSION_JWT)
}

/**
 * Guard a LIVE spec's resolved api target. Throws (failing the spec loudly,
 * never silently passing) when E2E_API_URL points at prod WITHOUT a sanctioned
 * minted-account run. Staging targets and sanctioned prod runs pass through.
 * Specs call this once at module load (before any provision) via topGuard().
 */
export function assertSafeApiTarget(apiUrl: string): void {
  if (isProdApiTarget(apiUrl) && !isSanctionedMintedRun()) {
    throw new Error(
      `Refusing to run LIVE E2E against prod (${PROD_API_HOST}) without a sanctioned ` +
        `minted-account run. Set E2E_ACCOUNT_TOKEN (CI mints+reaps a cohort account) ` +
        `or E2E_SESSION_JWT (a pre-minted cohort session), or point E2E_API_URL at staging. ` +
        `This guard exists so a stray run can never provision-and-leak real prod resources.`,
    )
  }
}

// ── Workflow-minted account (item 2) ─────────────────────────────────────────
// The prod E2E workflow mints an ephemeral cohort account up front
// (POST /internal/e2e/account) and exports its session JWT + identity into the
// env. When E2E_SESSION_JWT is set, the authed legs use THAT account's bearer
// instead of self-minting from E2E_JWT_SECRET — so the authed flow runs against
// prod as a real, skip-guarded cohort team. Anon legs are unaffected.

/** The minted account's identity + bearer, surfaced from the workflow env. */
export interface MintedSession {
  /** Bearer token for authed requests (the api session JWT). */
  token: string
  /** The minted team's id (the workflow reaps the account by this out-of-band). */
  teamID: string
  /** The minted user's email, when the workflow exported it. */
  email: string
  /** The minted tier (e.g. 'pro'), when the workflow exported it. */
  tier: string
}

/**
 * Returns the workflow-minted session when E2E_SESSION_JWT is set, else null.
 * Authed legs prefer this over self-minting so a prod run uses a real cohort
 * account. E2E_TEAM_ID / E2E_ACCOUNT_EMAIL / E2E_ACCOUNT_TIER are the companion
 * fields the workflow exports from the mint response.
 */
export function mintedSession(): MintedSession | null {
  const token = process.env.E2E_SESSION_JWT
  if (!token) return null
  return {
    token,
    teamID: process.env.E2E_TEAM_ID ?? '',
    email: process.env.E2E_ACCOUNT_EMAIL ?? '',
    tier: process.env.E2E_ACCOUNT_TIER ?? '',
  }
}
