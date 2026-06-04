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
// the guards that read it are intentionally NOT in this PR (one-tree
// discipline) — see the PR body's follow-up note. Until those guards exist,
// LIVE runs MUST target STAGING, never prod.
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
