// Coverage manifest for the Wave 3 real-backend UI journeys (live-ui-*.spec.ts).
//
// Extracted into a playwright-free sibling so the vitest prod-coverage done-bar
// guard (prod-coverage-donebar.test.ts) can union the covered-route set without
// the @playwright/test runtime. These are the api routes the UI journeys drive
// THROUGH THE BROWSER (or, for the agent-driven mutations the read-only
// dashboard delegates, via the api while the UI renders the result) — every one
// must be a 'live' flow in prod-coverage-manifest.ts (the guard's reverse-drift
// check enforces it).
//
// Journey → route mapping:
//   #1 auth round-trip ....... GET /auth/me, POST /auth/email/start
//   #2 resources view/logs ... GET /api/v1/resources, GET /api/v1/resources/:id,
//                              GET /api/v1/resources/:id/metrics,
//                              GET /api/v1/resources/:id/credentials,
//                              DELETE /api/v1/resources/:id
//   #3 deploy lifecycle ...... POST /deploy/new, GET /api/v1/deployments,
//                              GET /api/v1/deployments/:id, GET /deploy/:id/logs,
//                              POST /api/v1/deployments/:id/make-permanent,
//                              DELETE /api/v1/deployments/:id
//   #4 delete→replace ........ POST /deploy/new (+402 cap), GET /api/v1/deployments,
//                              DELETE /api/v1/deployments/:id
//   #5 pause/resume .......... POST /api/v1/resources/:id/pause,
//                              POST /api/v1/resources/:id/resume
//   #6 vault ................. PUT /api/v1/vault/:env/:key, GET /api/v1/vault/:env,
//                              GET /api/v1/vault/:env/:key
//   #7 team invite ........... POST /api/v1/team/members/invite,
//                              GET /api/v1/team/invitations,
//                              DELETE /api/v1/team/invitations/:id
export const coveredRoutes: string[] = [
  // #1 auth round-trip (UI)
  'GET /auth/me',
  'POST /auth/email/start',
  // #2 resources: view → metrics stream → creds reveal → delete (UI + api delete).
  // Creds reveal renders the connection_url already in the getResource payload —
  // no separate /credentials call — so only the routes the journey truly hits.
  'GET /api/v1/resources',
  'GET /api/v1/resources/:id',
  'GET /api/v1/resources/:id/metrics',
  'DELETE /api/v1/resources/:id',
  // #3 deploy lifecycle + build LOGS (SSE) + make-permanent
  'POST /deploy/new',
  'GET /api/v1/deployments',
  'GET /api/v1/deployments/:id',
  'GET /deploy/:id/logs',
  'POST /api/v1/deployments/:id/make-permanent',
  'DELETE /api/v1/deployments/:id',
  // #5 pause/resume (UI clickable mutations)
  'POST /api/v1/resources/:id/pause',
  'POST /api/v1/resources/:id/resume',
  // #6 vault add/reveal/delete
  'PUT /api/v1/vault/:env/:key',
  'GET /api/v1/vault/:env',
  'GET /api/v1/vault/:env/:key',
  // #7 team invite → pending → revoke
  'POST /api/v1/team/members/invite',
  'GET /api/v1/team/invitations',
  'DELETE /api/v1/team/invitations/:id',
]
