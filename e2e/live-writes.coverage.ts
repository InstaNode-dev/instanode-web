// Coverage manifest for live-writes.spec.ts (Batch B — W-ONBOARD/WEBHOOK/TEAM/
// DEPLOY write legs). Extracted into a playwright-free sibling so the vitest
// prod-coverage done-bar guard can import the covered-route set without the
// @playwright/test runtime. The spec re-exports this as `coveredRoutes`.
export const coveredRoutes: string[] = [
  // W-ONBOARD
  'GET /start',
  'GET /claim/preview',
  // W-WEBHOOK
  'POST /webhook/new',
  'POST /webhook/receive/:token',
  'GET /api/v1/webhooks/:token/requests',
  // W-TEAM
  'PATCH /api/v1/team',
  'GET /api/v1/team',
  'GET /api/v1/team/summary',
  'GET /api/v1/team/settings',
  'PATCH /api/v1/team/settings',
  'GET /api/v1/team/env-policy',
  'PUT /api/v1/team/env-policy',
  'GET /api/v1/team/members',
  'GET /api/v1/team/invitations',
  'POST /api/v1/team/members/invite',
  'DELETE /api/v1/team/invitations/:id',
  'POST /api/v1/team/members/leave',
  'DELETE /api/v1/team/members/:user_id',
  // W-DEPLOY
  'POST /deploy/new',
  'GET /api/v1/deployments',
  'GET /api/v1/deployments/:id',
  'GET /api/v1/deployments/:id/events',
  'POST /api/v1/deployments/:id/make-permanent',
  'POST /api/v1/deployments/:id/ttl',
  'PATCH /api/v1/deployments/:id',
  'DELETE /api/v1/deployments/:id',
  'DELETE /api/v1/deployments/:id/confirm-deletion',
]
