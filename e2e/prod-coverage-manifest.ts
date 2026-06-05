// prod-coverage-manifest.ts — the canonical, in-repo mirror of
// docs/sessions/2026-06-04/PROD-COVERAGE-MATRIX.md.
//
// This is the single source of truth the vitest prod-coverage done-bar guard
// (e2e/prod-coverage-donebar.test.ts) iterates (CLAUDE.md rule 18). It lists
// EVERY prod-feasible user/agent flow (route-leg) exactly once, tagged either:
//
//   • { flow, tag: 'live' }                 → MUST be covered by at least one
//                                              live-*.spec.ts coverage manifest.
//   • { flow, tag: 'exempt', reason: '…' }  → kept CI-DB only; the reason mirrors
//                                              the matrix's exemption rationale.
//
// It is kept IN-REPO (not read cross-repo at test time) so the guard is
// self-contained and runs in the plain `vitest run` gate with no prod creds and
// no network. When a wave moves a route EX→live, flip its tag here AND add it to
// the relevant live-*.coverage.ts — the guard reds if the two drift apart.
//
// flow vocabulary = "<METHOD> <route>" route strings, the same vocabulary the
// live-*.coverage.ts manifests use (so the guard can union + compare directly).

/** A flow that has (and must keep) a live-prod Playwright spec. */
export interface LiveFlow {
  flow: string
  tag: 'live'
}

/**
 * A flow that is deliberately NOT covered by a live-prod spec. `reason` must be
 * non-empty and should mirror the matrix's exemption rationale (Brevo-gated
 * email delivery, Razorpay charge, real-GitHub-OAuth, full-Kaniko-build-deferred,
 * team-tier-gated, OPTIONS/CORS, static content, operator/admin routes,
 * live-DNS custom domains, destructive team purge).
 */
export interface ExemptFlow {
  flow: string
  tag: 'exempt'
  reason: string
}

export type ProdCoverageFlow = LiveFlow | ExemptFlow

// ─── LIVE-PROD-NOW (matrix LN) — every entry MUST be in a live-*.coverage.ts ───
const LIVE_FLOWS: LiveFlow[] = (
  [
    // §1.A Liveness / health / discovery — W-OBS (live-reads)
    'GET /livez',
    'GET /healthz',
    'GET /readyz',
    'GET /openapi.json',
    'GET /api/v1/capabilities',
    'GET /api/v1/status',
    'GET /.well-known/oauth-protected-resource',
    'GET /api/v1/incidents',

    // §1.Q Content / static (light) — W-OBS (live-reads)
    'GET /llms.txt',
    'GET /security.txt',

    // §1.B Anonymous provisioning (7 services) — smoke + anon-provision
    'POST /db/new',
    'POST /vector/new',
    'POST /cache/new',
    'POST /nosql/new',
    'POST /queue/new',
    'POST /storage/new',
    'POST /webhook/new',
    'POST /webhook/receive/:token',
    'GET /api/v1/webhooks/:token/requests',

    // §1.C Onboarding / claim — claim-deploy + W-ONBOARD (live-writes)
    'POST /claim',
    'GET /start',
    'GET /claim/preview',

    // §1.D Auth — live-auth + W-AUTH2 (live-stacks-lifecycle)
    'GET /auth/github/start',
    'GET /auth/github/callback',
    'OPTIONS /auth/exchange',
    'GET /auth/me',
    'POST /auth/logout',
    'POST /auth/cli',
    'GET /auth/cli/:id',
    'POST /auth/email/start',
    'POST /auth/github',

    // §1.E Management API — identity + resources — W-RES (live-reads) + claim-deploy
    'GET /api/v1/resources',
    'GET /api/v1/whoami',
    'GET /api/v1/resources/:id',
    'GET /api/v1/resources/:id/credentials',
    'GET /api/v1/resources/:id/metrics',
    'DELETE /api/v1/resources/:id',
    'POST /api/v1/resources/:id/rotate-credentials',

    // §1.F Resources lifecycle — W-LIFECYCLE (live-stacks-lifecycle) + W-RES
    'GET /api/v1/resources/families',
    'GET /api/v1/resources/:id/family',
    'POST /api/v1/resources/:id/pause',
    'POST /api/v1/resources/:id/resume',
    'POST /api/v1/resources/:id/backup',
    'GET /api/v1/resources/:id/backups',
    'GET /api/v1/resources/:id/restores',

    // §1.G Billing (reads + checkout-contract) — W-BILLING (live-reads)
    'GET /api/v1/billing',
    'GET /api/v1/billing/invoices',
    'GET /api/v1/billing/usage',

    // §1.H API keys (PAT) — W-APIKEYS (live-reads)
    'POST /api/v1/auth/api-keys',
    'GET /api/v1/auth/api-keys',
    'DELETE /api/v1/auth/api-keys/:id',

    // §1.I Audit log — W-AUDIT (live-reads)
    'GET /api/v1/audit',
    'GET /api/v1/audit.csv',

    // §1.J Stacks — W-STACKS / W-STACKS-ADV (live-stacks-lifecycle)
    'POST /stacks/new',
    'GET /stacks/:slug',
    'DELETE /stacks/:slug',
    'GET /api/v1/stacks',
    'GET /api/v1/stacks/:slug',
    'GET /api/v1/stacks/:slug/family',
    'DELETE /api/v1/stacks/:slug/confirm-deletion',
    'POST /api/v1/stacks/:slug/promote',
    'PATCH /stacks/:slug/env',

    // §1.K Deploy single-app + lifecycle — claim-deploy + W-DEPLOY (live-writes)
    'POST /deploy/new',
    'GET /api/v1/deployments',
    'GET /api/v1/deployments/:id',
    'GET /api/v1/deployments/:id/events',
    'DELETE /api/v1/deployments/:id',
    'DELETE /api/v1/deployments/:id/confirm-deletion',
    'PATCH /api/v1/deployments/:id',
    'POST /api/v1/deployments/:id/make-permanent',
    'POST /api/v1/deployments/:id/ttl',

    // §1.M Teams / invitations / member management — W-TEAM (live-writes)
    'GET /api/v1/team',
    'PATCH /api/v1/team',
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

    // §1.N Vault — W-VAULT (live-reads)
    'PUT /api/v1/vault/:env/:key',
    'GET /api/v1/vault/:env/:key',
    'GET /api/v1/vault/:env',

    // §1.P Misc surfaces — W-BILLING (usage/wall) + W-WEBHOOK
    'GET /api/v1/usage/wall',
  ] as const
).map((flow) => ({ flow, tag: 'live' as const }))

// ─── PROD-EXEMPT (matrix EX) — kept CI-DB only, with reason ────────────────────
const EXEMPT_FLOWS: ExemptFlow[] = (
  [
    // §1.A — observability surface, token-gated; not a user flow
    ['GET /metrics', 'observability surface — token-gated; not a user flow'],

    // §1.B — webhook/receive verb fan-out (app.All); POST round-trip covers the handler
    ['PUT /webhook/receive/:token', 'webhook/receive verb fan-out (app.All) — POST round-trip covers the handler'],
    ['PATCH /webhook/receive/:token', 'webhook/receive verb fan-out (app.All) — POST round-trip covers the handler'],
    ['DELETE /webhook/receive/:token', 'webhook/receive verb fan-out (app.All) — POST round-trip covers the handler'],

    // §1.D — magic-link callback: Brevo sender unvalidated → no link delivered
    ['GET /auth/email/callback', 'Brevo sender unvalidated — no magic link delivered, no live token to redeem (CI-DB)'],

    // §1.G — billing externals: Razorpay recurring disabled → no live charge/portal
    ['POST /api/v1/billing/change-plan', 'Razorpay recurring disabled / no-downgrade policy — real plan change needs a live sub (CI-DB fake portal)'],
    ['POST /api/v1/billing/update-payment', 'Razorpay portal redirect (external) — no live charge (CI-DB fake portal)'],
    ['POST /razorpay/webhook', 'external Razorpay-signed; recurring disabled — no live charge (CI-DB)'],

    // §1.L — deploy ↔ GitHub link: needs a real installed GitHub App + repo
    ['POST /api/v1/deployments/:id/github', 'real GitHub App + repo required — live infeasible (CI-DB whitebox)'],
    ['GET /api/v1/deployments/:id/github', 'real GitHub App + repo required — live infeasible (CI-DB whitebox)'],
    ['DELETE /api/v1/deployments/:id/github', 'real GitHub App + repo required — live infeasible (CI-DB whitebox)'],
    ['GET /integrations/github/install', 'real GitHub OAuth — no installed App in prod (CI-DB)'],
    ['GET /integrations/github/callback', 'real GitHub OAuth — no installed App in prod (CI-DB)'],
    ['POST /webhooks/github', 'real GitHub HMAC webhook — no installed App in prod (CI-DB)'],

    // §1.J — custom domains: live DNS + cert-manager round-trip infeasible from CI
    ['POST /api/v1/stacks/:slug/domains', 'custom-domain ingress/cert needs live DNS + cert-manager — infeasible from CI (CI-DB to verified-state)'],
    ['GET /api/v1/stacks/:slug/domains', 'custom-domain ingress/cert needs live DNS + cert-manager — infeasible from CI (CI-DB to verified-state)'],
    ['DELETE /api/v1/stacks/:slug/domains/:id', 'custom-domain ingress/cert needs live DNS + cert-manager — infeasible from CI (CI-DB)'],

    // §1.M — team destructive purge: would strand the shared minted team
    ['DELETE /api/v1/team', 'destructive team purge (cascades resources) — would strand the shared minted team (CI-DB)'],
    ['POST /api/v1/team/restore', 'paired with destructive team delete — not run on the shared minted team (CI-DB)'],

    // §1.O — email-delivery webhooks: inbound external, no email flows until Brevo validated
    ['POST /webhooks/brevo/:secret', 'inbound Brevo delivery webhook (external secret) — no email flows until sender validated (CI-DB)'],
    ['POST /api/v1/email/webhook/brevo', 'inbound Brevo delivery webhook (external secret) — no email flows until sender validated (CI-DB)'],
    ['POST /api/v1/email/webhook/ses', 'alt SES backend inbound webhook (external) — not the prod ESP (CI-DB)'],

    // §1.P — approval token minted server-side into an email
    ['GET /approve/:token', 'approval token is minted into an email — generating one live needs the email pipeline (CI-DB)'],

    // §1.Q — OPTIONS/CORS preflights: no business logic; GET siblings covered
    ['OPTIONS /livez', 'CORS preflight (204 + Allow only) — GET sibling covered'],
    ['OPTIONS /healthz', 'CORS preflight (204 + Allow only) — GET sibling covered'],
    ['OPTIONS /readyz', 'CORS preflight (204 + Allow only) — GET sibling covered'],
    ['OPTIONS /openapi.json', 'CORS preflight (204 + Allow only) — GET sibling covered'],

    // §1.R — dev-only / internal / admin: operator-only, 404 in prod
    ['POST /internal/set-tier', 'operator-only, ENVIRONMENT=development-gated — 404 in prod (CI-DB)'],
    ['POST /internal/e2e/account', 'mint/reap harness — exercised by e2e-prod.yml itself, not a spec assertion (CI-DB asserts safety arms)'],
    ['DELETE /internal/e2e/account/:team_id', 'mint/reap harness — exercised by e2e-prod.yml itself, not a spec assertion (CI-DB asserts safety arms)'],
    ['GET /api/v1/admin/*', 'AdminPathPrefix-gated founder console — 404 by default in prod, not a customer flow (CI-DB)'],
  ] as const
).map(([flow, reason]) => ({ flow, tag: 'exempt' as const, reason }))

/** The canonical inventory the done-bar guard iterates (rule 18). */
export const PROD_COVERAGE_MANIFEST: ProdCoverageFlow[] = [...LIVE_FLOWS, ...EXEMPT_FLOWS]
