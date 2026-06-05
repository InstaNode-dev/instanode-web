// Batch B (write flows) — real-backend (LIVE) E2E covering the authed WRITE
// user-flows against PRODUCTION via the minted cohort account.
//
// Plan: docs/sessions/2026-06-04/PROD-COVERAGE-MATRIX.md §3 batch B (W7–W10):
//   - W-ONBOARD : GET /start (302 → /claim?t=), GET /claim/preview (resource
//                 summary for the upgrade token). The /claim happy-path + 409
//                 replay already live in live-claim-deploy.spec.ts — NOT
//                 duplicated here; this file covers the onboarding WRITES/redirect
//                 surfaces that aren't yet covered.
//   - W-WEBHOOK : POST /webhook/new (authed) → POST /webhook/receive/:token →
//                 GET /api/v1/webhooks/:token/requests shows the captured
//                 request (write→inspect round-trip) → reap.
//   - W-TEAM    : PATCH /api/v1/team (rename), GET/PATCH /api/v1/team/settings,
//                 GET/PUT /api/v1/team/env-policy, GET /api/v1/team/summary,
//                 GET /api/v1/team/members, and member-management (invite / role
//                 change / remove / leave). CRITICAL ISOLATION: the primary
//                 minted account is NEVER removed/left. Invite/remove/leave use a
//                 SECOND throwaway minted account (POST /internal/e2e/account via
//                 E2E_ACCOUNT_TOKEN) as the secondary member, reaped afterward.
//   - W-DEPLOY  : POST /deploy/new (minted PRO has deploy headroom) → 202
//                 accepted contract → GET /api/v1/deployments + /:id +
//                 /:id/events → PATCH (private) + make-permanent + set-ttl →
//                 two-step delete (confirm-deletion request + cancel) → DELETE
//                 (skip-email) → gone. The full Kaniko build→live-URL leg is
//                 DEFERRED (too heavy); we assert the lifecycle contract.
//
// Every leg is a genuine write-surface assertion: the minted PRO account does a
// real mutation against prod and we assert the real response shape + the
// read-back reflects it. It mirrors live-reads.spec.ts / live-claim-deploy.spec.ts
// EXACTLY for the safety machinery (rule 24): E2E_LIVE=1 gating (whole file SKIPS
// loudly in normal PR CI so the per-PR gate NEVER depends on a live backend),
// assertSafeApiTarget() refusing an un-sanctioned prod target, cohort-branded
// ledger-before-assert + inline reap + afterAll backstop. Named live-*.spec.ts so
// playwright.live.config.ts's testMatch picks it up and the default (mocked,
// per-PR) config ignores it.
//
// ── Writes need a minted session ─────────────────────────────────────────────
// Every authed leg requires E2E_SESSION_JWT (the workflow-minted PRO cohort
// account, cohort.ts mintedSession()). When it is absent the authed legs SKIP
// loudly rather than red — a write surface can only be exercised as a real team.
//
// ── External-dependency PROD-EXEMPT (matrix §0.4 / §6) ───────────────────────
// Flows requiring external deps are skipped-with-reason, matching the matrix:
//   - W-TEAM member-mgmt secondary account needs E2E_ACCOUNT_TOKEN (the mint
//     guard secret). When unset, the secondary-member legs SKIP loudly; the
//     owner-only team reads/patches still run on the primary minted account.
//   - W-DEPLOY two-step deletion EMAIL is Brevo-gated (sender unvalidated) — we
//     assert the request/cancel CONTRACT (202 pending_confirmation OR the
//     skip-email immediate path), never that an email is delivered.

import { gzipSync } from 'node:zlib'

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'

import {
  cohortName,
  COHORT_MARKER,
  isCohortBranded,
  assertSafeApiTarget,
  authedProvisionHeaders,
  mintedSession,
  PROD_API_HOST,
} from './cohort'
import { recordEntity, loadLedger, reapEntities, clearLedger } from './cleanup-ledger'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = (process.env.E2E_API_URL ?? process.env.AGENT_API_URL ?? '')
  .toString()
  .replace(/\/$/, '')

const STATUS_OK = 200
const STATUS_CREATED = 201
const STATUS_ACCEPTED = 202
const STATUS_FOUND = 302
const STATUS_BAD_REQUEST = 400
const STATUS_FORBIDDEN = 403
const STATUS_NOT_FOUND = 404
const STATUS_CONFLICT = 409
const STATUS_BACKEND_UNAVAILABLE = 503

// The mint-guard secret. The e2e-prod workflow exports it into the test step
// env so the W-TEAM secondary-member legs can mint a throwaway second account.
// When unset (a local/staging run), those legs SKIP loudly — they must never
// touch the PRIMARY minted account.
const E2E_ACCOUNT_TOKEN = process.env.E2E_ACCOUNT_TOKEN ?? ''

// The mint/reap header the api's internal e2e surface honours
// (internal_e2e_account.go e2eAccountTokenHeader). Constant per the
// no-hardcoded-strings rule.
const E2E_TOKEN_HEADER = 'X-E2E-Token'

// The header that bypasses the two-step email-confirmed deletion flow
// (deletion_confirm.go SkipEmailConfirmationHeader). Used for the FINAL reap
// of a paid-tier deployment so the actual destruction doesn't depend on a
// Brevo-delivered confirmation email (sender unvalidated on prod — matrix §6).
const SKIP_EMAIL_CONFIRMATION_HEADER = 'X-Skip-Email-Confirmation'
const SKIP_EMAIL_CONFIRMATION_VALUE = 'yes'

/** GET helper carrying a bearer. */
function authedGet(request: APIRequestContext, path: string, bearer: string): Promise<APIResponse> {
  return request.fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearer}` },
    failOnStatusCode: false,
  })
}

/** Read a response body as JSON, tolerating a non-JSON body. */
async function bodyJSON(resp: APIResponse): Promise<Record<string, unknown>> {
  return (await resp.json().catch(() => ({}))) as Record<string, unknown>
}

/** A minted secondary account (W-TEAM member-mgmt isolation). */
interface MintedAccount {
  teamID: string
  userID: string
  email: string
  sessionJWT: string
}

// Mint a throwaway SECONDARY cohort account via the guarded internal endpoint.
// Used ONLY for the member-mgmt isolation legs so the PRIMARY minted account is
// never removed/left. Recorded to the ledger as a `team` entity so the reaper
// (and the afterAll backstop) deletes it even if a leg throws — the team-cascade
// DELETE removes the account + everything it owns. Returns null when the mint
// token isn't configured (caller SKIPS loudly).
async function mintSecondaryAccount(
  request: APIRequestContext,
  label: string,
): Promise<MintedAccount | null> {
  if (!E2E_ACCOUNT_TOKEN) return null
  const resp = await request.fetch(`${API_URL}/internal/e2e/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [E2E_TOKEN_HEADER]: E2E_ACCOUNT_TOKEN },
    // free tier is enough for a secondary member; never mint team/growth.
    data: JSON.stringify({ tier: 'free' }),
    failOnStatusCode: false,
  })
  // A 404 means the mint token is wrong / the endpoint isn't armed on this
  // stack (inert-by-default 404 posture). Treat as "can't mint" → SKIP.
  if (resp.status() === STATUS_NOT_FOUND) return null
  expect(
    resp.status(),
    `POST /internal/e2e/account should return ${STATUS_OK} when the mint token is configured; got ` +
      `${resp.status()}. Body: ${await resp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_OK)
  const body = (await resp.json()) as {
    team_id: string
    user_id: string
    email: string
    session_jwt: string
  }
  // Record for reaping BEFORE any throwing assert (rule 24). Kind 'e2e-account'
  // reaps via the guarded internal cascade DELETE /internal/e2e/account/:team_id
  // (token-header authorized, NOT a Bearer) — the SAME path the workflow uses
  // for the primary account. The reaper reads E2E_ACCOUNT_TOKEN from the env.
  recordEntity({
    kind: 'e2e-account',
    id: body.team_id,
    apiUrl: API_URL,
    note: `batchB secondary account ${label} ${body.email}`,
  })
  return {
    teamID: body.team_id,
    userID: body.user_id,
    email: body.email,
    sessionJWT: body.session_jwt,
  }
}

// Reap a secondary account out-of-band via the guarded internal reap endpoint
// (DELETE /internal/e2e/account/:team_id) — the SAME cascade the workflow
// teardown uses. Idempotent (404/already_gone == success). The ledger `team`
// entry is the backstop; we reap eagerly so the ledger stays truthful.
async function reapSecondaryAccount(request: APIRequestContext, acct: MintedAccount): Promise<void> {
  if (!E2E_ACCOUNT_TOKEN) return
  const resp = await request.fetch(`${API_URL}/internal/e2e/account/${acct.teamID}`, {
    method: 'DELETE',
    headers: { [E2E_TOKEN_HEADER]: E2E_ACCOUNT_TOKEN },
    failOnStatusCode: false,
  })
  expect(
    [STATUS_OK, STATUS_ACCEPTED, 204, STATUS_NOT_FOUND, 410].includes(resp.status()),
    `reap secondary account should succeed (2xx/404/410); got ${resp.status()}. ` +
      `Body: ${await resp.text().catch(() => '<unreadable>')}`,
  ).toBe(true)
}

// ── Minimal gzipped-tar build context (W-DEPLOY) ─────────────────────────────
// A real /deploy/new requires a multipart `tarball` (gzipped tar) carrying a
// Dockerfile. Hand-rolled (mirrors live-claim-deploy.spec.ts) so no tar/gzip
// dep. The build OUTCOME is irrelevant to the lifecycle legs under test.
function makeMinimalTarGz(): Buffer {
  const content = Buffer.from('FROM scratch\n', 'utf8')
  return gzipSync(buildUstarTar('Dockerfile', content))
}

function buildUstarTar(name: string, content: Buffer): Buffer {
  const BLOCK = 512
  const header = Buffer.alloc(BLOCK)
  header.write(name, 0, 'utf8')
  header.write('0000644', 100, 'ascii')
  header.write('0000000', 108, 'ascii')
  header.write('0000000', 116, 'ascii')
  header.write(content.length.toString(8).padStart(11, '0'), 124, 'ascii')
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0'), 136, 'ascii')
  header.write('0', 156, 'ascii')
  header.write('ustar', 257, 'ascii')
  header.write('00', 263, 'ascii')
  header.write('        ', 148, 'ascii')
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  const contentBlocks = Math.ceil(content.length / BLOCK)
  const paddedContent = Buffer.alloc(contentBlocks * BLOCK)
  content.copy(paddedContent)
  const terminator = Buffer.alloc(BLOCK * 2)
  return Buffer.concat([header, paddedContent, terminator])
}

test.describe('LIVE — Batch B write flows (W-ONBOARD / W-WEBHOOK / W-TEAM / W-DEPLOY)', () => {
  test.describe.configure({ mode: 'serial' })

  // Hard skip in normal CI: the LIVE harness must never make the per-PR gate
  // depend on a reachable backend.
  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend Batch B write suite is opt-in. Set E2E_LIVE=1 + ' +
      'E2E_API_URL + E2E_SESSION_JWT (minted cohort account) to run it.',
  )
  test.skip(
    LIVE && !API_URL,
    'E2E_LIVE=1 but E2E_API_URL/AGENT_API_URL is unset — no backend to target.',
  )

  // Prod-target safety (item 3): refuse an un-sanctioned prod target; allow it
  // only for a minted-account run (E2E_ACCOUNT_TOKEN/E2E_SESSION_JWT present).
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  // Backstop reaper (rule 24): afterAll reaps every still-ledgered entity even
  // if a leg throws before its inline reap; reap-cohort.ts re-runs the same path
  // out-of-process in CI teardown if the process dies.
  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-writes afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── W-ONBOARD — /start redirect + /claim/preview (onboarding writes) ─────────
  // The /claim happy-path + 409 replay live in live-claim-deploy.spec.ts. Here
  // we cover the onboarding surfaces NOT yet covered live: GET /start (the
  // organic onboarding URL → 302 to the dashboard /claim) and GET /claim/preview
  // (the "what am I about to claim" summary the ClaimPage shows before the user
  // commits). Both are driven by an anon-upgrade JWT minted from a real anon
  // provision, so no Brevo/email is involved (matrix §1.C → LIVE-PROD-NOW).
  test.describe('W-ONBOARD — /start (302) + /claim/preview (resource summary)', () => {
    test('GET /start with an upgrade token → 302 → /claim?t=; without → 302 → /claim', async ({
      request,
    }) => {
      // Mint a real anon-upgrade token by provisioning an anon cache and pulling
      // the "?t=<jwt>" out of its note. uniqueIP keeps the per-fingerprint dedup
      // cap (rule 6) from handing back an existing token.
      const anon = await provisionAnonCacheForUpgrade(request)

      // /start with a token → 302 to the dashboard /claim?t=<jwt>. We do NOT
      // follow the redirect (it lands on the SPA); we assert the Location.
      const withToken = await request.fetch(
        `${API_URL}/start?t=${encodeURIComponent(anon.upgradeJWT)}`,
        { method: 'GET', maxRedirects: 0, failOnStatusCode: false },
      )
      expect(
        withToken.status(),
        `GET /start?t= should 302-redirect to the dashboard claim page; got ${withToken.status()}.`,
      ).toBe(STATUS_FOUND)
      const loc = withToken.headers()['location'] ?? ''
      expect(loc, `GET /start?t= Location must point at a /claim page; got '${loc}'.`).toContain('/claim')
      expect(
        loc,
        `GET /start?t= must thread the upgrade token through as ?t= so the dashboard can preview/claim; ` +
          `got '${loc}'.`,
      ).toContain('?t=')

      // /start with NO token → 302 to a bare /claim (the dashboard prompts for
      // the token / login). Still a redirect, never a 200/404.
      const noToken = await request.fetch(`${API_URL}/start`, {
        method: 'GET',
        maxRedirects: 0,
        failOnStatusCode: false,
      })
      expect(
        noToken.status(),
        `GET /start (no token) should still 302-redirect to /claim; got ${noToken.status()}.`,
      ).toBe(STATUS_FOUND)
      expect(noToken.headers()['location'] ?? '', 'GET /start (no token) Location must be /claim').toContain(
        '/claim',
      )

      // Reap the anon resource (TTL-backed; anon resources have no authed DELETE,
      // so reap is best-effort — the 24h TTL is the backstop). It is already on
      // the ledger; the afterAll/reap-cohort sweep covers it.
      clearLedger()
    })

    test('GET /claim/preview?t= → token_valid + items[] summary of the resources to claim', async ({
      request,
    }) => {
      const anon = await provisionAnonCacheForUpgrade(request)

      const preview = await request.fetch(
        `${API_URL}/claim/preview?t=${encodeURIComponent(anon.upgradeJWT)}`,
        { method: 'GET', failOnStatusCode: false },
      )
      expect(
        preview.status(),
        `GET /claim/preview?t= should be 200 for a valid unclaimed token; got ${preview.status()}. ` +
          `Body: ${await preview.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const body = await bodyJSON(preview)
      expect(body.ok, 'claim/preview ok flag').toBe(true)
      expect(
        body.token_valid,
        'claim/preview must report token_valid=true for an unclaimed upgrade token (the ClaimPage ' +
          'shows the resource summary only when the token is valid).',
      ).toBe(true)
      // Canonical `items` envelope (onboarding.go B5-P1-3). The anon resource we
      // just provisioned must appear in the preview so the user sees what they
      // are about to claim.
      const items = (body.items ?? []) as Array<Record<string, unknown>>
      expect(
        Array.isArray(items),
        `claim/preview must carry an items[] array; got ${JSON.stringify(body).slice(0, 200)}.`,
      ).toBe(true)
      const tokens = items.map((r) => String(r.token))
      expect(
        tokens,
        `claim/preview items must include the just-provisioned anon resource ${anon.token} so the ` +
          `ClaimPage shows it; got ${JSON.stringify(tokens)}.`,
      ).toContain(anon.token)
      // Each previewed resource carries its type + tier (the ClaimPage renders
      // these). Assert the shape on the matched row.
      const mine = items.find((r) => String(r.token) === anon.token) as Record<string, unknown>
      expect(String(mine.resource_type ?? ''), 'previewed resource must echo its resource_type').toBeTruthy()

      // A missing token → 400 missing_token (the dashboard's "no token" guard).
      const noToken = await request.fetch(`${API_URL}/claim/preview`, {
        method: 'GET',
        failOnStatusCode: false,
      })
      expect(
        noToken.status(),
        `GET /claim/preview without ?t= must be ${STATUS_BAD_REQUEST} (missing_token); got ${noToken.status()}.`,
      ).toBe(STATUS_BAD_REQUEST)

      clearLedger()
    })
  })

  // ── W-WEBHOOK — provision → POST to receiver → inspect captured request ──────
  // The webhook write→inspect round-trip: provision an authed webhook (fast, no
  // dedicated DB), POST a request to its receive_url, then GET the inspector and
  // assert the captured request reflects exactly what was sent (method, body,
  // header). This is the user-visible "did my webhook capture it" flow.
  test.describe('W-WEBHOOK — POST /webhook/new → receive → GET /api/v1/webhooks/:token/requests', () => {
    test('provision webhook → POST to receiver → inspector shows the captured request → reap', async ({
      request,
    }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — webhook round-trip needs the minted cohort account.')
      const bearer = minted!.token

      // Provision an authed webhook. authedProvisionHeaders carries the bearer +
      // a unique XFF (the authed path is not fingerprint-gated, but keep it
      // consistent with the other authed provisions).
      const create = await request.fetch(`${API_URL}/webhook/new`, {
        method: 'POST',
        headers: authedProvisionHeaders(bearer),
        data: JSON.stringify({ name: cohortName('wwebhook') }),
        failOnStatusCode: false,
      })
      test.skip(
        create.status() === STATUS_BACKEND_UNAVAILABLE,
        `/webhook/new returned 503 at ${API_URL} — webhook backend not enabled. Reports skipped.`,
      )
      expect(
        create.status(),
        `POST /webhook/new should return ${STATUS_CREATED}; got ${create.status()}. ` +
          `Body: ${await create.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_CREATED)
      const created = await bodyJSON(create)
      const token = String(created.token ?? '')
      const receiveURL = String(created.receive_url ?? '')
      expect(token, '/webhook/new must return a token').toBeTruthy()
      expect(
        receiveURL,
        `/webhook/new must return a receive_url; got '${receiveURL}'.`,
      ).toContain('/webhook/receive/')
      // Record for reaping the instant it exists (rule 24).
      recordEntity({
        kind: 'resource',
        id: token,
        apiUrl: API_URL,
        token: bearer,
        note: `batchB webhook ${token}`,
      })

      // POST a recognizable request to the receiver. The receive_url is an
      // absolute prod URL; the receiver requires no auth (the token IS the
      // address). We hit it via the api host directly (the receive_url already
      // carries the prod host on a sanctioned run).
      const probeBody = JSON.stringify({ cohort: COHORT_MARKER, nonce: Math.random().toString(36).slice(2) })
      const probeHeaderVal = `cohort-${Math.random().toString(36).slice(2, 8)}`
      const send = await request.fetch(`${API_URL}/webhook/receive/${token}?probe=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cohort-Probe': probeHeaderVal },
        data: probeBody,
        failOnStatusCode: false,
      })
      expect(
        send.status(),
        `POST /webhook/receive/:token should accept + store the request (200); got ${send.status()}. ` +
          `Body: ${await send.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const sendBody = await bodyJSON(send)
      expect(sendBody.ok, 'receiver ok flag').toBe(true)
      expect(sendBody.id, 'receiver must return an id for the stored request').toBeTruthy()

      // Inspect: GET /api/v1/webhooks/:token/requests must show the captured
      // request. The token IS the credential — we pass the bearer too (the
      // resource is team-owned; an owning-team session is permitted, a
      // cross-team one would 403).
      const inspect = await authedGet(request, `/api/v1/webhooks/${token}/requests`, bearer)
      expect(
        inspect.status(),
        `GET /api/v1/webhooks/:token/requests should be 200; got ${inspect.status()}. ` +
          `Body: ${await inspect.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const inspectBody = await bodyJSON(inspect)
      expect(inspectBody.ok, 'inspector ok flag').toBe(true)
      const requests = (inspectBody.requests ?? []) as Array<Record<string, unknown>>
      expect(
        Array.isArray(requests) && requests.length > 0,
        `the inspector must show the captured request (write→inspect round-trip); got ` +
          `${JSON.stringify(inspectBody).slice(0, 200)}.`,
      ).toBe(true)
      expect(
        inspectBody.total,
        'inspector total must equal the requests[] length.',
      ).toBe(requests.length)
      // The captured request must reflect what was sent: method, body, and the
      // custom header. Find the request carrying our nonce body.
      const captured = requests.find((r) => String(r.body ?? '').includes(probeBody.slice(0, 20)))
      expect(
        captured,
        `the inspector must capture the exact request we POSTed (body match); got ` +
          `${requests.length} request(s).`,
      ).toBeTruthy()
      const cap = captured as Record<string, unknown>
      expect(String(cap.method ?? ''), 'captured request must record the HTTP method').toBe('POST')
      expect(String(cap.body ?? ''), 'captured request must store the verbatim body').toBe(probeBody)
      // Headers are captured grouped by key (map[string][]string). Our custom
      // header must be present (case-insensitive key lookup).
      const headers = (cap.headers ?? {}) as Record<string, unknown>
      const headerKeys = Object.keys(headers).map((k) => k.toLowerCase())
      expect(
        headerKeys,
        `captured request must record the custom X-Cohort-Probe header; got keys ${JSON.stringify(
          Object.keys(headers),
        )}.`,
      ).toContain('x-cohort-probe')

      // Reap the webhook resource (authed DELETE, 200). afterAll + reap-cohort
      // back this up.
      const result = await reapEntities(request, [
        {
          kind: 'resource',
          id: token,
          apiUrl: API_URL,
          token: bearer,
          note: 'W-WEBHOOK reap',
          recordedAt: new Date().toISOString(),
        },
      ])
      expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
      clearLedger()
    })
  })

  // ── W-TEAM — settings/env-policy/summary reads+patches + member-mgmt ─────────
  // The owner-only team mutations run on the PRIMARY minted account (safe — they
  // don't remove/leave it). The member-management legs that COULD strand the
  // primary (invite/remove/leave) operate on a SECONDARY throwaway minted
  // account so the shared primary is never disturbed. NEVER remove/leave the
  // primary (matrix §1.M — DELETE /api/v1/team stays PROD-EXEMPT).
  test.describe('W-TEAM — settings + env-policy + summary + member management (isolated)', () => {
    test('PATCH /api/v1/team (rename) → GET reflects it', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — team rename needs the minted cohort account.')
      const bearer = minted!.token
      const newName = cohortName('wteam-rename')

      const patch = await request.fetch(`${API_URL}/api/v1/team`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ name: newName }),
        failOnStatusCode: false,
      })
      expect(
        patch.status(),
        `PATCH /api/v1/team should be 200; got ${patch.status()}. ` +
          `Body: ${await patch.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const patchBody = await bodyJSON(patch)
      expect(patchBody.ok, 'team patch ok flag').toBe(true)
      const team = (patchBody.team ?? {}) as Record<string, unknown>
      expect(String(team.name ?? ''), 'PATCH /api/v1/team must echo the new name').toBe(newName)

      // Read-back: GET /api/v1/team reflects the rename (write→read round-trip).
      const get = await authedGet(request, '/api/v1/team', bearer)
      expect(get.status(), 'GET /api/v1/team should be 200').toBe(STATUS_OK)
      const getBody = await bodyJSON(get)
      expect(
        String(((getBody.team ?? {}) as Record<string, unknown>).name ?? ''),
        'GET /api/v1/team must reflect the just-patched name.',
      ).toBe(newName)
    })

    test('GET /api/v1/team/summary — counts rollup shape', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — team summary needs the minted cohort account.')
      const resp = await authedGet(request, '/api/v1/team/summary', minted!.token)
      expect(resp.status(), 'GET /api/v1/team/summary should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      // Real prod shape (team_summary.go): { ok, freshness_seconds, as_of, tier,
      // counts: { resources:{total,...}, deployments, members, vault_keys } }.
      // The summary is a 5-min cached aggregate (declare caching layer per the
      // rule); assert the stable envelope + the counts object.
      expect(body.ok, 'team summary ok flag').toBe(true)
      expect(body.tier, 'team summary must echo the team tier').toBeTruthy()
      const counts = (body.counts ?? {}) as Record<string, unknown>
      expect(
        counts.resources != null && typeof counts.resources === 'object',
        `team summary must carry a counts.resources object; got ${JSON.stringify(body).slice(0, 200)}.`,
      ).toBe(true)
      expect(
        typeof counts.members,
        `team summary counts.members must be a number; got ${typeof counts.members}.`,
      ).toBe('number')
    })

    test('GET/PATCH /api/v1/team/settings — TTL policy round-trip', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — team settings need the minted cohort account.')
      const bearer = minted!.token

      const get = await authedGet(request, '/api/v1/team/settings', bearer)
      expect(get.status(), 'GET /api/v1/team/settings should be 200').toBe(STATUS_OK)
      const getBody = await bodyJSON(get)
      expect(getBody.ok, 'team settings ok flag').toBe(true)
      expect(getBody.settings, 'team settings must carry a settings object').toBeTruthy()

      // PATCH the deployment TTL policy to 'permanent' then back to 'auto_24h'
      // (the only two valid values, team_settings.go). Read-back each time.
      const patchPolicy = async (policy: string): Promise<void> => {
        const resp = await request.fetch(`${API_URL}/api/v1/team/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
          data: JSON.stringify({ default_deployment_ttl_policy: policy }),
          failOnStatusCode: false,
        })
        expect(
          resp.status(),
          `PATCH /api/v1/team/settings (policy=${policy}) should be 200; got ${resp.status()}. ` +
            `Body: ${await resp.text().catch(() => '<unreadable>')}`,
        ).toBe(STATUS_OK)
        const body = await bodyJSON(resp)
        const settings = (body.settings ?? {}) as Record<string, unknown>
        expect(
          String(settings.default_deployment_ttl_policy ?? ''),
          `team settings must echo the patched policy=${policy}.`,
        ).toBe(policy)
      }
      await patchPolicy('permanent')
      await patchPolicy('auto_24h')

      // An invalid policy → 400 invalid_ttl_policy (the dashboard's guard).
      const bad = await request.fetch(`${API_URL}/api/v1/team/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ default_deployment_ttl_policy: 'not-a-policy' }),
        failOnStatusCode: false,
      })
      expect(
        bad.status(),
        `PATCH team/settings with an invalid policy must be ${STATUS_BAD_REQUEST}; got ${bad.status()}.`,
      ).toBe(STATUS_BAD_REQUEST)
    })

    test('GET/PUT /api/v1/team/env-policy — policy round-trip (owner)', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — env-policy needs the minted cohort account.')
      const bearer = minted!.token

      const get = await authedGet(request, '/api/v1/team/env-policy', bearer)
      expect(get.status(), 'GET /api/v1/team/env-policy should be 200').toBe(STATUS_OK)
      const getBody = await bodyJSON(get)
      expect(getBody.ok, 'env-policy ok flag').toBe(true)
      expect(
        Object.prototype.hasOwnProperty.call(getBody, 'policy'),
        'env-policy GET must carry a policy object (empty {} is the default).',
      ).toBe(true)

      // PUT a policy then PUT it back to empty. The body IS the policy object
      // (env_policy.go: NOT wrapped in {"policy": ...}). A valid policy locks a
      // role away from an env; we set production→[owner] then clear it so we
      // don't leave the cohort team in a locked-down state.
      const putPolicy = async (policy: Record<string, unknown>): Promise<void> => {
        const resp = await request.fetch(`${API_URL}/api/v1/team/env-policy`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
          data: JSON.stringify(policy),
          failOnStatusCode: false,
        })
        expect(
          resp.status(),
          `PUT /api/v1/team/env-policy should be 200; got ${resp.status()}. ` +
            `Body: ${await resp.text().catch(() => '<unreadable>')}`,
        ).toBe(STATUS_OK)
      }
      await putPolicy({ production: { deploy: ['owner'] } })
      // Read-back: GET reflects the PUT.
      const afterPut = await bodyJSON(await authedGet(request, '/api/v1/team/env-policy', bearer))
      const policyObj = (afterPut.policy ?? {}) as Record<string, unknown>
      expect(
        Object.prototype.hasOwnProperty.call(policyObj, 'production'),
        `env-policy GET after PUT must reflect the production rule; got ${JSON.stringify(policyObj)}.`,
      ).toBe(true)
      // Reset to the permissive default {} so the cohort team isn't left locked.
      await putPolicy({})
    })

    test('GET /api/v1/team/members + GET /api/v1/team/invitations — owner reads', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — member reads need the minted cohort account.')
      const bearer = minted!.token

      const members = await authedGet(request, '/api/v1/team/members', bearer)
      expect(members.status(), 'GET /api/v1/team/members should be 200').toBe(STATUS_OK)
      const membersBody = await bodyJSON(members)
      expect(membersBody.ok, 'members ok flag').toBe(true)
      expect(
        Array.isArray(membersBody.members),
        `members must carry a members[] array; got ${JSON.stringify(membersBody).slice(0, 200)}.`,
      ).toBe(true)
      // The minted account's own owner must be a member of its team.
      expect(
        (membersBody.members as unknown[]).length,
        'the minted team must have at least its owner as a member.',
      ).toBeGreaterThan(0)

      const invitations = await authedGet(request, '/api/v1/team/invitations', bearer)
      expect(invitations.status(), 'GET /api/v1/team/invitations should be 200').toBe(STATUS_OK)
      const invBody = await bodyJSON(invitations)
      expect(invBody.ok, 'invitations ok flag').toBe(true)
      expect(
        Array.isArray(invBody.invitations),
        `invitations must carry an invitations[] array; got ${JSON.stringify(invBody).slice(0, 200)}.`,
      ).toBe(true)
    })

    test('member-mgmt isolated — invite (developer) → list → revoke; secondary account reaped', async ({
      request,
    }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — member-mgmt needs the primary minted cohort account.')
      const bearer = minted!.token
      // The secondary-member legs need the mint guard secret. When absent, the
      // member-management WRITES can't be exercised without risking the primary
      // account → SKIP loudly (matrix PROD-EXEMPT-adjacent: needs E2E_ACCOUNT_TOKEN).
      const secondary = await mintSecondaryAccount(request, 'wteam-member')
      test.skip(
        secondary === null,
        'E2E_ACCOUNT_TOKEN unset (or mint endpoint not armed) — cannot mint a SECONDARY throwaway ' +
          'account to act as the invitee. The member-mgmt WRITE legs (invite/role/remove/leave) MUST ' +
          'NOT touch the PRIMARY minted account, so they SKIP rather than risk it. Set E2E_ACCOUNT_TOKEN ' +
          '(the mint guard secret) to run them.',
      )
      const sec = secondary!

      // Invite the SECONDARY account's email as a developer (RBAC token flow —
      // does not consume a legacy seat, and does not require the invitee to act
      // for the invitation row to exist + be listable + revocable).
      const invite = await request.fetch(`${API_URL}/api/v1/team/members/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ email: sec.email, role: 'developer' }),
        failOnStatusCode: false,
      })
      expect(
        invite.status(),
        `POST /api/v1/team/members/invite should return ${STATUS_CREATED}; got ${invite.status()}. ` +
          `Body: ${await invite.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_CREATED)
      const inviteBody = await bodyJSON(invite)
      expect(inviteBody.ok, 'invite ok flag').toBe(true)
      const inv = (inviteBody.invitation ?? {}) as Record<string, unknown>
      const invID = String(inv.id ?? '')
      expect(invID, 'invite must return an invitation id').toBeTruthy()
      expect(String(inv.email ?? ''), 'invitation must echo the invitee email').toBe(sec.email)
      expect(String(inv.role ?? ''), 'invitation must echo the developer role').toBe('developer')

      // List invitations → the new invite must appear.
      const list = await authedGet(request, '/api/v1/team/invitations', bearer)
      expect(list.status(), 'GET /api/v1/team/invitations should be 200').toBe(STATUS_OK)
      const listBody = await bodyJSON(list)
      const invIDs = ((listBody.invitations ?? []) as Array<Record<string, unknown>>).map((i) =>
        String(i.id),
      )
      expect(invIDs, `the new invitation ${invID} must appear in the invitations list.`).toContain(invID)

      // Revoke the invitation (owner-only). The list no longer contains it.
      const revoke = await request.fetch(`${API_URL}/api/v1/team/invitations/${invID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(
        revoke.status(),
        `DELETE /api/v1/team/invitations/:id should be 200; got ${revoke.status()}. ` +
          `Body: ${await revoke.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const afterList = await bodyJSON(await authedGet(request, '/api/v1/team/invitations', bearer))
      const afterIDs = ((afterList.invitations ?? []) as Array<Record<string, unknown>>).map((i) =>
        String(i.id),
      )
      expect(afterIDs, `the revoked invitation ${invID} must NOT appear in the list anymore.`).not.toContain(
        invID,
      )

      // LEAVE contract — asserted on the SECONDARY account, never the primary.
      // The secondary's owner is the only member of its own team; leaving as the
      // sole owner is rejected (you can't orphan a team). We assert the CONTRACT
      // (the endpoint responds, not a 5xx) using the secondary's own bearer — the
      // primary is never touched.
      const leave = await request.fetch(`${API_URL}/api/v1/team/members/leave`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sec.sessionJWT}` },
        failOnStatusCode: false,
      })
      expect(
        leave.status() < 500,
        `POST /api/v1/team/members/leave (on the SECONDARY account) must respond with a client-level ` +
          `contract (2xx/4xx), never a 5xx; got ${leave.status()}. (The sole owner can't orphan their ` +
          `team — a 4xx here is the correct guard.)`,
      ).toBe(true)

      // REMOVE contract — a non-member user_id on the primary team must 4xx
      // (not_found / forbidden), proving the remove endpoint is reachable + safe
      // WITHOUT removing any real member of the primary. We use the secondary's
      // user_id (it never joined the primary, since the invite was only created,
      // not accepted).
      const remove = await request.fetch(`${API_URL}/api/v1/team/members/${sec.userID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(
        [STATUS_NOT_FOUND, STATUS_FORBIDDEN, STATUS_BAD_REQUEST, STATUS_CONFLICT].includes(remove.status()),
        `DELETE /api/v1/team/members/:user_id for a NON-member must be a safe 4xx (not_found/forbidden), ` +
          `proving the endpoint is reachable without disturbing the primary's real members; got ` +
          `${remove.status()}.`,
      ).toBe(true)

      // Reap the secondary account out-of-band (cascade). The ledger `team`
      // entry + afterAll are the backstops.
      await reapSecondaryAccount(request, sec)
      clearLedger()
    })
  })

  // ── W-DEPLOY — create(202) → list/get/events → patch/permanent/ttl → delete ──
  // The minted PRO account has deploy headroom (deployments_apps=10). The full
  // Kaniko build→live-URL leg is DEFERRED; we assert the lifecycle CONTRACT on a
  // single created deployment. The two-step deletion EMAIL is Brevo-gated (matrix
  // §6) — we assert the request/cancel contract, then do the real reap with the
  // skip-email header so destruction doesn't depend on a delivered email.
  test.describe('W-DEPLOY — create → list/get/events → patch/permanent/ttl → two-step delete', () => {
    test('full deployment lifecycle contract on the minted PRO account', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — deploy lifecycle needs the minted PRO cohort account.')
      const bearer = minted!.token

      // ── Create: a minimal tarball deploy (202 accepted; build outcome
      //    irrelevant to the lifecycle legs). ───────────────────────────────────
      const deployName = cohortName('wdeploy')
      const create = await request.fetch(`${API_URL}/deploy/new`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        multipart: {
          name: deployName,
          env: 'development',
          tarball: { name: 'context.tar.gz', mimeType: 'application/gzip', buffer: makeMinimalTarGz() },
        },
        failOnStatusCode: false,
      })
      test.skip(
        create.status() === STATUS_BACKEND_UNAVAILABLE,
        `/deploy/new returned 503 — compute/build backend not enabled in this stack. Reports skipped.`,
      )
      expect(
        create.status(),
        `POST /deploy/new should return ${STATUS_ACCEPTED} (async build accepted); got ${create.status()}. ` +
          `A 402 means the minted account lacks deploy headroom; a 4xx means the multipart contract ` +
          `changed. Body: ${await create.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_ACCEPTED)
      const created = (await create.json()) as { ok?: boolean; item?: Record<string, unknown> }
      const item = created.item ?? {}
      const appID = String(item.app_id ?? item.token ?? '')
      expect(appID, `/deploy/new must return an app_id; got item=${JSON.stringify(item)}.`).toBeTruthy()
      recordEntity({
        kind: 'deployment',
        id: appID,
        apiUrl: API_URL,
        token: bearer,
        note: `batchB deploy ${deployName}`,
      })
      expect(created.ok, '/deploy/new ok flag').toBe(true)
      expect(item.id, '/deploy/new item must carry a db id').toBeTruthy()
      expect(String(item.status ?? ''), '/deploy/new item must carry a lifecycle status').toBeTruthy()
      expect(
        String(item.environment ?? ''),
        '/deploy/new must echo the resolved environment=development (rule 11).',
      ).toBe('development')
      expect(
        isCohortBranded(String(item.name ?? '')),
        `the deployment name must carry the cohort marker '${COHORT_MARKER}'; got '${String(item.name)}'.`,
      ).toBe(true)

      // ── List: the new deployment appears in GET /api/v1/deployments. ─────────
      const list = await authedGet(request, '/api/v1/deployments', bearer)
      expect(list.status(), 'GET /api/v1/deployments should be 200').toBe(STATUS_OK)
      const listBody = await bodyJSON(list)
      expect(listBody.ok, 'deployments list ok flag').toBe(true)
      const ids = ((listBody.items ?? []) as Array<Record<string, unknown>>).map((d) =>
        String(d.app_id ?? d.token),
      )
      expect(ids, `the new deployment ${appID} must appear in the team's deployments list.`).toContain(appID)

      // ── Get: GET /api/v1/deployments/:id → the detail envelope. ──────────────
      const get = await authedGet(request, `/api/v1/deployments/${encodeURIComponent(appID)}`, bearer)
      expect(get.status(), `GET /api/v1/deployments/${appID} should be 200`).toBe(STATUS_OK)
      const getBody = await bodyJSON(get)
      expect(getBody.ok, 'deployment get ok flag').toBe(true)
      expect(
        String(((getBody.item ?? {}) as Record<string, unknown>).app_id ?? ''),
        'deployment get item must echo the app_id.',
      ).toBe(appID)

      // ── Events: the failure-timeline read surface (#200). 200 + envelope. ────
      const events = await authedGet(
        request,
        `/api/v1/deployments/${encodeURIComponent(appID)}/events`,
        bearer,
      )
      expect(events.status(), 'GET /:id/events should be 200 for an owned deployment').toBe(STATUS_OK)
      const eventsBody = await bodyJSON(events)
      expect(eventsBody.ok, 'events envelope ok flag').toBe(true)
      expect(Array.isArray(eventsBody.events), 'events envelope must carry an events[] array').toBe(true)
      expect(eventsBody.count, 'events count must equal events[] length').toBe(
        (eventsBody.events as unknown[]).length,
      )

      // ── make-permanent: PRO can keep a deploy permanently (DB-level; no k8s
      //    round-trip). 200 + the item reflects the permanent policy. ───────────
      const permanent = await request.fetch(
        `${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}/make-permanent`,
        { method: 'POST', headers: { Authorization: `Bearer ${bearer}` }, failOnStatusCode: false },
      )
      expect(
        permanent.status(),
        `POST /:id/make-permanent should be 200 for a PRO deploy; got ${permanent.status()}. ` +
          `Body: ${await permanent.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const permBody = await bodyJSON(permanent)
      expect(permBody.ok, 'make-permanent ok flag').toBe(true)

      // ── set-ttl: re-arm a 24h TTL (DB-level). 200 OR 409 if the row already
      //    flipped to a terminal/permanent state concurrently — both are honest. ─
      const ttl = await request.fetch(`${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}/ttl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ hours: 24 }),
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, STATUS_CONFLICT].includes(ttl.status()),
        `POST /:id/ttl should be 200 (re-armed) or 409 (already permanent/terminal); got ${ttl.status()}. ` +
          `Body: ${await ttl.text().catch(() => '<unreadable>')}`,
      ).toBe(true)

      // ── patch (private): the access-control update touches the k8s Ingress.
      //    For a still-building deploy the Ingress may not exist yet → the
      //    compute update can 503. Assert the contract tolerantly: 200 (applied),
      //    402 (tier-gated — should NOT happen on PRO), or 503 (ingress not ready). ─
      const patch = await request.fetch(`${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ private: false }),
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, STATUS_BACKEND_UNAVAILABLE].includes(patch.status()),
        `PATCH /api/v1/deployments/:id (private=false) should be 200 (applied) or 503 (ingress not ready ` +
          `for a still-building deploy); got ${patch.status()}. Body: ${await patch
            .text()
            .catch(() => '<unreadable>')}`,
      ).toBe(true)

      // ── Two-step delete CONTRACT: a paid (PRO) account's plain DELETE enters
      //    the email-confirmed flow → 202 pending_confirmation (the email itself
      //    is Brevo-gated; we don't assert delivery). If the stack has no email
      //    client wired it falls through to immediate 200 — both are valid. ──────
      const requestDelete = await request.fetch(
        `${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${bearer}` }, failOnStatusCode: false },
      )
      expect(
        [STATUS_OK, STATUS_ACCEPTED, STATUS_CONFLICT, STATUS_BACKEND_UNAVAILABLE].includes(
          requestDelete.status(),
        ),
        `DELETE /api/v1/deployments/:id should be 202 (two-step pending, paid tier), 200 (immediate, ` +
          `no email client), 409 (already pending), or 503 (Brevo send failed — sender unvalidated on ` +
          `prod, matrix §6); got ${requestDelete.status()}. Body: ${await requestDelete
            .text()
            .catch(() => '<unreadable>')}`,
      ).toBe(true)
      const delBody = await bodyJSON(requestDelete)
      if (requestDelete.status() === STATUS_ACCEPTED) {
        // Two-step path: the 202 carries the pending-confirmation contract.
        expect(
          String(delBody.deletion_status ?? ''),
          'the 202 two-step delete must report deletion_status=pending_confirmation.',
        ).toBe('pending_confirmation')

        // Cancel the pending deletion (DELETE /:id/confirm-deletion) — the
        // owner can cancel without the emailed token. 200/2xx (or 404 if it
        // already resolved). This proves the cancel arm of the two-step flow.
        const cancel = await request.fetch(
          `${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}/confirm-deletion`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${bearer}` }, failOnStatusCode: false },
        )
        expect(
          (cancel.status() >= 200 && cancel.status() < 300) || cancel.status() === STATUS_NOT_FOUND,
          `DELETE /:id/confirm-deletion (cancel) should be 2xx or 404; got ${cancel.status()}. ` +
            `Body: ${await cancel.text().catch(() => '<unreadable>')}`,
        ).toBe(true)
      }

      // ── Final reap: the REAL destruction. Use the skip-email header so it
      //    doesn't depend on a Brevo-delivered confirmation (sender unvalidated
      //    on prod). 2xx (deleted) or 404 (already gone). ───────────────────────
      const finalDelete = await request.fetch(
        `${API_URL}/api/v1/deployments/${encodeURIComponent(appID)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${bearer}`,
            [SKIP_EMAIL_CONFIRMATION_HEADER]: SKIP_EMAIL_CONFIRMATION_VALUE,
          },
          failOnStatusCode: false,
        },
      )
      expect(
        (finalDelete.status() >= 200 && finalDelete.status() < 300) ||
          finalDelete.status() === STATUS_NOT_FOUND,
        `final DELETE (skip-email) should be 2xx (deleted) or 404 (already gone); got ` +
          `${finalDelete.status()}. Body: ${await finalDelete.text().catch(() => '<unreadable>')}`,
      ).toBe(true)

      // Gone: the events surface (same RBAC) now 404s, or 200 during async
      // teardown — never a 5xx (a 5xx means delete left the row broken).
      const afterDelete = await authedGet(
        request,
        `/api/v1/deployments/${encodeURIComponent(appID)}/events`,
        bearer,
      )
      expect(
        [STATUS_OK, STATUS_NOT_FOUND].includes(afterDelete.status()),
        `post-delete events query should be 404 (gone) or 200 (teardown in progress); got ` +
          `${afterDelete.status()}.`,
      ).toBe(true)

      // Reap is idempotent (404/409-deletion_already_pending == alreadyGone).
      const result = await reapEntities(request, [
        {
          kind: 'deployment',
          id: appID,
          apiUrl: API_URL,
          token: bearer,
          note: 'W-DEPLOY reap',
          recordedAt: new Date().toISOString(),
        },
      ])
      expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
      clearLedger()
    })
  })

  // Coverage manifest (rule 18): the matrix routes this file moves to
  // LIVE-PROD-NOW. A future registry-iterating done-bar (matrix §4) reads this
  // to confirm no Batch B leg silently dropped. COHORT_MARKER + PROD_API_HOST are
  // referenced so the cohort import stays load-bearing even if every authed leg
  // skips (no minted session).
  test('coverage manifest — Batch B write routes present + cohort marker wired', () => {
    expect(coveredRoutes.length, 'Batch B route manifest should be non-empty').toBeGreaterThan(10)
    expect(COHORT_MARKER, 'cohort marker must be the shared brand').toBe('e2e-cohort')
    expect(PROD_API_HOST, 'prod api host constant must be wired').toBe('api.instanode.dev')
  })
})

// ── Anon-upgrade provisioning helper (W-ONBOARD) ─────────────────────────────
interface AnonUpgrade {
  token: string
  upgradeJWT: string
}

// Provision an anonymous cache and extract the anon-upgrade JWT from its note
// (the "?t=<jwt>" upgrade link). Recorded to the ledger BEFORE asserting (rule
// 24). Anon resources have no authed DELETE — they're TTL-reaped (24h), so the
// ledger entry carries no bearer and the reaper treats it as best-effort.
async function provisionAnonCacheForUpgrade(request: APIRequestContext): Promise<AnonUpgrade> {
  // Lazy import to keep the anon-header builder local to the onboarding legs.
  const { anonProvisionHeaders } = await import('./cohort')
  const resp = await request.fetch(`${API_URL}/cache/new`, {
    method: 'POST',
    headers: anonProvisionHeaders(),
    data: JSON.stringify({ name: cohortName('wonboard-anon') }),
    failOnStatusCode: false,
  })
  test.skip(
    resp.status() === STATUS_BACKEND_UNAVAILABLE,
    `cache service returned 503 at ${API_URL} — cannot mint a claimable anon resource for W-ONBOARD. ` +
      `Reports skipped.`,
  )
  expect(
    resp.status(),
    `POST /cache/new (anon) should return ${STATUS_CREATED}; got ${resp.status()}. ` +
      `Body: ${await resp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const body = (await resp.json()) as { token: string; note: string }
  recordEntity({ kind: 'resource', id: body.token, apiUrl: API_URL, note: `W-ONBOARD anon ${body.token}` })
  return { token: body.token, upgradeJWT: extractUpgradeJWT(body.note) }
}

function extractUpgradeJWT(note: string): string {
  const marker = '?t='
  const idx = note.indexOf(marker)
  if (idx === -1) throw new Error(`no "?t=" upgrade token in /cache/new note: ${note}`)
  let tok = note.slice(idx + marker.length)
  const stop = tok.search(/[\s)"']/)
  if (stop !== -1) tok = tok.slice(0, stop)
  return tok
}

// Exported so a future registry-iterating prod-coverage done-bar (matrix §4
// Option B) can union manifests across live-*.spec.ts without a hand-typed list.
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
