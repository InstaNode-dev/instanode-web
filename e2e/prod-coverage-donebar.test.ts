// prod-coverage-donebar.test.ts — the PROD-COVERAGE done-bar guard.
//
// Reds CI whenever a prod-feasible user flow is added without either a live-prod
// integration spec or a justified exemption. It is the in-repo, network-free
// enforcement of "every user control/flow covered by a live PROD integration
// test" (docs/sessions/2026-06-04/PROD-COVERAGE-MATRIX.md §4 Option B).
//
// ── Why this is a vitest `.test.ts`, not a Playwright `.spec.ts` ──────────────
// It runs in the normal `npm run gate` (`vitest run`) — a STATIC drift check. It
// makes NO network calls and needs NO E2E_* secrets / prod creds. To stay
// playwright-free it imports each live spec's covered-route manifest from the
// spec's playwright-free sibling (`e2e/<name>.coverage.ts`) — the exact module
// the spec itself re-exports as `coveredRoutes`, so the guard sees what the spec
// covers without loading the @playwright/test runtime.
//
// ── What it asserts (registry-iterating — CLAUDE.md rule 18) ──────────────────
//   a. Every `live`-tagged flow in PROD_COVERAGE_MANIFEST appears in at least one
//      spec's exported covered set (fails listing any uncovered flow).
//   b. Every `exempt`-tagged flow has a non-empty reason.
//   c. No flow is untagged / duplicated across the manifest.
// Plus a reverse-drift check: no spec covers a route that isn't a `live` flow in
// the manifest (so a renamed/added covered route can't silently escape the
// inventory).

import { describe, expect, it } from 'vitest'

import { coveredRoutes as readsCovered } from './live-reads.coverage'
import { coveredRoutes as writesCovered } from './live-writes.coverage'
import { coveredRoutes as stacksLifecycleCovered } from './live-stacks-lifecycle.coverage'
import { coveredRoutes as authCovered } from './live-auth.coverage'
import { coveredRoutes as claimDeployCovered } from './live-claim-deploy.coverage'
import { coveredRoutes as anonProvisionCovered } from './live-anon-provision.coverage'
import { coveredRoutes as provisionSmokeCovered } from './live-provision-smoke.coverage'
import { PROD_COVERAGE_MANIFEST, type ProdCoverageFlow } from './prod-coverage-manifest'

// Each live-*.spec.ts re-exports its sibling's `coveredRoutes`; we union the
// siblings here. To add a spec to the done-bar, add one row — registry-iterating,
// no hand-typed duplicate of the route lists themselves (rule 18).
const SPEC_MANIFESTS: ReadonlyArray<{ spec: string; covered: readonly string[] }> = [
  { spec: 'live-reads.spec.ts', covered: readsCovered },
  { spec: 'live-writes.spec.ts', covered: writesCovered },
  { spec: 'live-stacks-lifecycle.spec.ts', covered: stacksLifecycleCovered },
  { spec: 'live-auth.spec.ts', covered: authCovered },
  { spec: 'live-claim-deploy.spec.ts', covered: claimDeployCovered },
  { spec: 'live-anon-provision.spec.ts', covered: anonProvisionCovered },
  { spec: 'live-provision-smoke.spec.ts', covered: provisionSmokeCovered },
]

/** Union of every route covered by some live-*.spec.ts. */
const coveredUnion = new Set<string>(SPEC_MANIFESTS.flatMap((m) => [...m.covered]))

/** Which spec(s) cover a given route (for actionable failure messages). */
function specsCovering(flow: string): string[] {
  return SPEC_MANIFESTS.filter((m) => m.covered.includes(flow)).map((m) => m.spec)
}

const liveFlows = PROD_COVERAGE_MANIFEST.filter((f): f is Extract<ProdCoverageFlow, { tag: 'live' }> => f.tag === 'live')
const exemptFlows = PROD_COVERAGE_MANIFEST.filter(
  (f): f is Extract<ProdCoverageFlow, { tag: 'exempt' }> => f.tag === 'exempt',
)

describe('PROD-COVERAGE done-bar guard', () => {
  // (c) No flow untagged / duplicated.
  it('every manifest flow is tagged live|exempt exactly once (no dupes, no untagged)', () => {
    const seen = new Map<string, number>()
    const untagged: string[] = []
    for (const f of PROD_COVERAGE_MANIFEST) {
      seen.set(f.flow, (seen.get(f.flow) ?? 0) + 1)
      if (f.tag !== 'live' && f.tag !== 'exempt') untagged.push(f.flow)
    }
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([flow, n]) => `${flow} (×${n})`)
    expect(
      duplicated,
      `These flows appear more than once in PROD_COVERAGE_MANIFEST. Each prod-feasible ` +
        `flow must be listed exactly once. De-duplicate in prod-coverage-manifest.ts:\n  - ${duplicated.join('\n  - ')}`,
    ).toEqual([])
    expect(
      untagged,
      `These flows are missing a valid tag (must be 'live' or 'exempt') in ` +
        `prod-coverage-manifest.ts:\n  - ${untagged.join('\n  - ')}`,
    ).toEqual([])
  })

  // (b) Every exempt flow carries a non-empty reason.
  it('every exempt flow has a non-empty reason', () => {
    const missing = exemptFlows.filter((f) => !f.reason || f.reason.trim() === '').map((f) => f.flow)
    expect(
      missing,
      `These exempt flows have an empty reason in prod-coverage-manifest.ts. Give each a ` +
        `concrete reason mirroring the matrix (Brevo-gated email, Razorpay charge, ` +
        `real-GitHub-OAuth, full-Kaniko-build-deferred, team-tier-gated, OPTIONS/CORS, ` +
        `static content, operator/admin, live-DNS domains):\n  - ${missing.join('\n  - ')}`,
    ).toEqual([])
  })

  // (a) Every live flow is covered by at least one live-*.spec.ts.
  it('every live flow is covered by at least one live-*.spec.ts manifest', () => {
    const uncovered = liveFlows.filter((f) => !coveredUnion.has(f.flow)).map((f) => f.flow)
    expect(
      uncovered,
      `These flows are tagged 'live' in prod-coverage-manifest.ts but NO live-*.spec.ts ` +
        `covers them. For each: add a live-* spec covering it (and the route to that spec's ` +
        `live-*.coverage.ts), OR re-tag it exempt-with-reason in prod-coverage-manifest.ts:\n  - ` +
        uncovered.join('\n  - '),
    ).toEqual([])
  })

  // Reverse drift: nothing a spec covers may escape the manifest's live set. This
  // catches a spec gaining a new covered route without the inventory being
  // updated (the inverse of (a)).
  it('every spec-covered route is a live flow in the manifest (no untracked coverage)', () => {
    const liveSet = new Set(liveFlows.map((f) => f.flow))
    const exemptSet = new Set(exemptFlows.map((f) => f.flow))
    const untracked: string[] = []
    for (const route of coveredUnion) {
      if (liveSet.has(route)) continue
      const where = specsCovering(route).join(', ')
      if (exemptSet.has(route)) {
        untracked.push(`${route} — covered by ${where} but tagged EXEMPT in the manifest (re-tag it 'live')`)
      } else {
        untracked.push(`${route} — covered by ${where} but ABSENT from prod-coverage-manifest.ts (add it as a 'live' flow)`)
      }
    }
    expect(
      untracked,
      `These routes are covered by a live-*.spec.ts but aren't tracked as 'live' flows in ` +
        `prod-coverage-manifest.ts. Add/flip them so the inventory mirrors reality (rule 18):\n  - ` +
        untracked.join('\n  - '),
    ).toEqual([])
  })

  // Sanity: the manifest is non-trivial and both classes are populated (a guard
  // that asserts nothing is worse than no guard).
  it('manifest is non-trivial — both live and exempt classes populated', () => {
    expect(liveFlows.length, 'expected a substantial live-prod flow set').toBeGreaterThan(50)
    expect(exemptFlows.length, 'expected the documented exemptions to be present').toBeGreaterThan(10)
  })
})
