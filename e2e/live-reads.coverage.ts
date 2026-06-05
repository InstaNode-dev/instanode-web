// Coverage manifest for live-reads.spec.ts (Batch A — W-OBS/RES/VAULT/APIKEYS/
// BILLING/AUDIT read legs). Extracted into a playwright-free sibling so the
// vitest prod-coverage done-bar guard (e2e/prod-coverage-donebar.test.ts) can
// import the covered-route set WITHOUT pulling in the @playwright/test runtime.
//
// The spec re-exports this as `coveredRoutes`; the guard unions it with the
// other live-*.coverage.ts manifests (rule 18 — registry-iterating, no
// hand-typed duplicate list).
export const coveredRoutes: string[] = [
  // W-OBS
  'GET /livez',
  'GET /healthz',
  'GET /readyz',
  'GET /openapi.json',
  'GET /api/v1/capabilities',
  'GET /api/v1/status',
  'GET /.well-known/oauth-protected-resource',
  'GET /api/v1/incidents',
  'GET /llms.txt',
  'GET /security.txt',
  // W-RES
  'GET /api/v1/whoami',
  'GET /api/v1/resources',
  'GET /api/v1/resources/:id',
  'GET /api/v1/resources/:id/credentials',
  'GET /api/v1/resources/:id/metrics',
  'DELETE /api/v1/resources/:id',
  'GET /api/v1/resources/families',
  'GET /api/v1/resources/:id/family',
  'GET /api/v1/resources/:id/backups',
  'GET /api/v1/resources/:id/restores',
  // W-VAULT
  'PUT /api/v1/vault/:env/:key',
  'GET /api/v1/vault/:env/:key',
  'GET /api/v1/vault/:env',
  // W-APIKEYS
  'POST /api/v1/auth/api-keys',
  'GET /api/v1/auth/api-keys',
  'DELETE /api/v1/auth/api-keys/:id',
  // W-BILLING
  'GET /api/v1/billing',
  'GET /api/v1/billing/invoices',
  'GET /api/v1/billing/usage',
  'GET /api/v1/usage/wall',
  // W-AUDIT
  'GET /api/v1/audit',
  'GET /api/v1/audit.csv',
]
