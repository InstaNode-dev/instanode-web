// Coverage manifest for live-anon-provision.spec.ts (W2 — the six remaining
// anonymous resource-provision flows + authed reap).
//
// The spec drives one identical test per service from the PROVISION_FLOWS
// registry; this sibling lists the canonical route string each flow exercises
// (matrix §1.B). Playwright-free so the vitest done-bar guard can import it
// without the @playwright/test runtime. `POST /db/new` is NOT here — it lives in
// live-provision-smoke.coverage.ts.
//
// The spec re-exports this as `coveredRoutes`.
export const coveredRoutes: string[] = [
  'POST /vector/new',
  'POST /cache/new',
  'POST /nosql/new',
  'POST /queue/new',
  'POST /storage/new',
  'POST /webhook/new',
  'DELETE /api/v1/resources/:id',
]
