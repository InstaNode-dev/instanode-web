// Coverage manifest for live-provision-smoke.spec.ts (WS1-P1 — the anonymous
// /db/new hot-pool provision smoke). Playwright-free sibling so the vitest
// prod-coverage done-bar guard can import the covered-route set without the
// @playwright/test runtime. The spec re-exports this as `coveredRoutes`.
export const coveredRoutes: string[] = [
  'POST /db/new',
  'GET /api/v1/resources',
]
