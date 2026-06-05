// Coverage manifest for live-stacks-lifecycle.spec.ts (Batch C — W-STACKS/
// STACKS-ADV/LIFECYCLE/AUTH2 legs). Extracted into a playwright-free sibling so
// the vitest prod-coverage done-bar guard can import the covered-route set
// without the @playwright/test runtime. The spec re-exports this as
// `coveredRoutes`.
export const coveredRoutes: string[] = [
  // W-STACKS
  'POST /stacks/new',
  'GET /api/v1/stacks',
  'GET /api/v1/stacks/:slug',
  'GET /stacks/:slug',
  'PATCH /stacks/:slug/env',
  'DELETE /stacks/:slug',
  'DELETE /api/v1/stacks/:slug/confirm-deletion',
  // W-STACKS-ADV
  'GET /api/v1/stacks/:slug/family',
  'POST /api/v1/stacks/:slug/promote',
  // W-LIFECYCLE
  'POST /api/v1/resources/:id/pause',
  'POST /api/v1/resources/:id/resume',
  'POST /api/v1/resources/:id/rotate-credentials',
  'POST /api/v1/resources/:id/backup',
  'GET /api/v1/resources/:id/backups',
  'GET /api/v1/resources/:id/restores',
  // W-AUTH2
  'POST /auth/email/start',
  'POST /auth/github',
  'GET /auth/me',
  'POST /auth/logout',
]
