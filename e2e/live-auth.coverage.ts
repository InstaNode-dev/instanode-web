// Coverage manifest for live-auth.spec.ts (W1 — auth/session/github/cli legs).
//
// live-auth.spec.ts tags its legs by matrix W1 leg-ID (A1-start, A4, …). This
// sibling translates those leg-IDs into the canonical route strings the
// prod-coverage matrix (§0.2 / §1.D) attributes to this spec, so the vitest
// done-bar guard can union one shared route vocabulary across every live-*.spec.
// Playwright-free so the guard never imports the @playwright/test runtime.
//
// The spec re-exports this as `coveredRoutes`.
export const coveredRoutes: string[] = [
  'GET /auth/github/start',
  'GET /auth/github/callback',
  'OPTIONS /auth/exchange',
  'GET /auth/me',
  'POST /auth/logout',
  'POST /auth/cli',
  'GET /auth/cli/:id',
  'POST /auth/email/start',
]
