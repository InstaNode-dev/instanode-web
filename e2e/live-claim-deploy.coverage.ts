// Coverage manifest for live-claim-deploy.spec.ts (W3 — claim + env-switch +
// deploy lifecycle legs).
//
// The spec tags its legs by matrix W3 leg-ID (claim-conversion, deploy-create-202,
// …); this sibling translates them into the canonical route strings the matrix
// (§0.2 / §1.C / §1.E / §1.K) attributes to this spec. Playwright-free so the
// vitest done-bar guard can import it without the @playwright/test runtime.
//
// `deploy-build-to-live-url` is intentionally NOT here — the full Kaniko build is
// PROD-EXEMPT (full-Kaniko-build-deferred); only the accepted-contract + events +
// delete legs run live.
//
// The spec re-exports this as `coveredRoutes`.
export const coveredRoutes: string[] = [
  'POST /cache/new',
  'POST /claim',
  'GET /api/v1/resources',
  'POST /deploy/new',
  'GET /api/v1/deployments/:id/events',
  'DELETE /api/v1/deployments/:id',
]
