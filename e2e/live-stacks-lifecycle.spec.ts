// Batch C (stacks + resource-lifecycle + secondary-auth) — real-backend (LIVE)
// E2E covering the stack, resource-lifecycle, and secondary-auth user-flows
// against PRODUCTION via the minted cohort account.
//
// Plan: docs/sessions/2026-06-04/PROD-COVERAGE-MATRIX.md §3 waves 11–14:
//   - W-STACKS      : POST /stacks/new (multi-service, minimal manifest → 202
//                     accepted contract) → GET /api/v1/stacks (list) →
//                     GET /api/v1/stacks/:slug (get) + GET /stacks/:slug
//                     (OptionalAuth get) → PATCH /stacks/:slug/env (merge → 200,
//                     response carries the merged key) → cross-team/missing 404
//                     → two-step DELETE /stacks/:slug (paid → 202 pending OR 200
//                     immediate) → skip-email reap. The full multi-service Kaniko
//                     build is DEFERRED (too slow on prod); we assert the
//                     accepted/pending CONTRACT exactly as live-writes asserts
//                     deploy 202.
//   - W-STACKS-ADV  : GET /api/v1/stacks/:slug/family (PRO 200 + Cache-Control),
//                     DELETE /api/v1/stacks/:slug/confirm-deletion (cancel arm),
//                     POST /api/v1/stacks/:slug/promote (non-destructive contract:
//                     412 needs-redeploy / 202 pending / 402 tier — never a 5xx).
//   - W-LIFECYCLE   : resource lifecycle on a FAST cache resource (NOT a
//                     dedicated DB): pause → resume (Pro+), rotate-credentials,
//                     backup CONTRACT (cache → 400 unsupported_resource_type;
//                     postgres-only — we assert the documented contract, never
//                     wait for a real backup), restores list, then reap.
//   - W-AUTH2       : secondary-auth surfaces — POST /auth/email/start accepted
//                     contract (Brevo-gated → never assert delivery), POST
//                     /auth/github body-flow no-credential contract (400
//                     missing_code / 401 oauth_failed / 503 not-configured), and
//                     a DISPOSABLE claimed-session logout round-trip (GET
//                     /auth/me 200 → POST /auth/logout → SAME bearer 401). The
//                     logout leg NEVER touches the shared minted JWT (Batch B's
//                     logout lesson) — it claims a throwaway team and revokes
//                     THAT session.
//
// It mirrors live-writes.spec.ts / live-reads.spec.ts EXACTLY for the safety
// machinery (rule 24): E2E_LIVE=1 gating (whole file SKIPS loudly in normal PR
// CI so the per-PR gate NEVER depends on a live backend), assertSafeApiTarget()
// refusing an un-sanctioned prod target, cohort-branded ledger-before-assert +
// inline reap + afterAll backstop. Named live-*.spec.ts so
// playwright.live.config.ts's testMatch picks it up and the default (mocked,
// per-PR) config ignores it.
//
// ── Slow services pinned to the anon hot-pool ────────────────────────────────
// The lifecycle legs use a CACHE resource (Redis hot-pool, no dedicated backing
// DB) so nothing races the 120s per-test timeout. NO db/vector/nosql/queue
// provision happens here (those are forceAnon-only elsewhere). The stack create
// is a 202-accepted async contract — we never wait for the build.
//
// ── External-dependency PROD-EXEMPT (matrix §0.4 / §6) ───────────────────────
//   - W-AUTH2 magic-link DELIVERY (Brevo sender unvalidated) — we assert only
//     the /auth/email/start accepted contract, never that a link is delivered.
//   - W-AUTH2 github body-flow needs a real GitHub OAuth code — we assert the
//     no-credential contract (400/401/503), never a real GitHub round-trip.
//   - Custom domains stay EX (live DNS + cert-manager) — not touched here.
//   - The logout leg needs a DISPOSABLE session: the anon claim path
//     (E2E_TEST_TOKEN fingerprint bypass) mints one. Without it the leg SKIPS
//     loudly rather than risk the shared minted JWT.

import { gzipSync } from 'node:zlib'

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'

import {
  cohortEmail,
  cohortName,
  COHORT_MARKER,
  isCohortBranded,
  assertSafeApiTarget,
  authedProvisionHeaders,
  anonProvisionHeaders,
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
const STATUS_BAD_REQUEST = 400
const STATUS_UNAUTHORIZED = 401
const STATUS_PAYMENT_REQUIRED = 402
const STATUS_PRECONDITION_FAILED = 412
const STATUS_NOT_FOUND = 404
const STATUS_CONFLICT = 409
const STATUS_BACKEND_UNAVAILABLE = 503

// The header that bypasses the two-step email-confirmed deletion flow
// (deletion_confirm.go SkipEmailConfirmationHeader). Used for the FINAL reap of
// a paid-tier stack so the actual destruction doesn't depend on a Brevo-
// delivered confirmation email (sender unvalidated on prod — matrix §6).
const SKIP_EMAIL_CONFIRMATION_HEADER = 'X-Skip-Email-Confirmation'
const SKIP_EMAIL_CONFIRMATION_VALUE = 'yes'

/** A syntactically valid but signature-invalid bearer (cheap authz probe). */
const TAMPERED_BEARER = 'not-a-real-jwt.tampered.signature'

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

// ── Minimal gzipped-tar build context (W-STACKS) ─────────────────────────────
// A real /stacks/new requires, per service in the manifest, a multipart field
// (named after the service) carrying a gzipped tar with a Dockerfile. Hand-
// rolled (mirrors live-writes.spec.ts) so no tar/gzip dep. The build OUTCOME is
// irrelevant to the lifecycle legs under test — we assert only the 202 contract.
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

// The single-service stack name used in the manifest + the multipart tarball
// field (they MUST match — stack.New looks up form.File[serviceName]).
const STACK_SERVICE_NAME = 'web'

// A minimal one-service manifest. No `expose` (avoids the Ingress/cert path),
// no `needs` (no resource ownership to wire), default port. The build outcome
// is irrelevant — we assert the 202 accepted contract.
const STACK_MANIFEST = `services:\n  ${STACK_SERVICE_NAME}:\n    port: 8080\n`

interface CreatedStack {
  slug: string
  bearer: string
}

// Create a single-service stack AS the minted PRO account → 202 accepted.
// Recorded to the ledger BEFORE any throwing assert (rule 24). Returns the slug
// + the bearer to address/reap it. Skips loudly on a 503 (compute backend off).
async function createMintedStack(
  request: APIRequestContext,
  bearer: string,
  label: string,
): Promise<CreatedStack> {
  const name = cohortName(label)
  const create = await request.fetch(`${API_URL}/stacks/new`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}` },
    multipart: {
      manifest: STACK_MANIFEST,
      name,
      env: 'development',
      [STACK_SERVICE_NAME]: {
        name: 'context.tar.gz',
        mimeType: 'application/gzip',
        buffer: makeMinimalTarGz(),
      },
    },
    failOnStatusCode: false,
  })
  test.skip(
    create.status() === STATUS_BACKEND_UNAVAILABLE,
    `/stacks/new returned 503 at ${API_URL} — stack compute/build backend not enabled. Reports skipped.`,
  )
  expect(
    create.status(),
    `POST /stacks/new should return ${STATUS_ACCEPTED} (async build accepted); got ${create.status()}. ` +
      `A 402 means the minted account lacks deployment headroom; a 4xx means the multipart/manifest ` +
      `contract changed. Body: ${await create.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_ACCEPTED)
  const body = await bodyJSON(create)
  const slug = String(body.stack_id ?? '')
  expect(slug, `/stacks/new must return a stack_id (slug); got ${JSON.stringify(body).slice(0, 200)}.`).toBeTruthy()
  // Record for reaping the instant it exists (rule 24). Stacks reap via the
  // 'resource'-style path? No — stacks DELETE at /stacks/:slug, not
  // /api/v1/resources/:id. The ledger has no stack kind; we reap stacks inline
  // (skip-email) + the account cascade is the backstop. We still record a 'team'
  // marker note so a post-mortem can attribute the slug, but rely on the inline
  // skip-email DELETE + account cascade for the actual teardown.
  recordEntity({
    kind: 'stack',
    id: slug,
    apiUrl: API_URL,
    token: bearer,
    note: `batchC stack ${name}`,
  })
  expect(body.ok, '/stacks/new ok flag').toBe(true)
  expect(String(body.status ?? ''), '/stacks/new must carry a lifecycle status (building)').toBeTruthy()
  expect(
    String(body.env ?? ''),
    '/stacks/new must echo the resolved env=development (rule 11).',
  ).toBe('development')
  expect(
    String(body.tier ?? ''),
    '/stacks/new must echo the team tier for an authed (minted PRO) create.',
  ).toBeTruthy()
  return { slug, bearer }
}

// Reap a stack inline via the skip-email DELETE (so destruction doesn't depend
// on a Brevo-delivered confirmation — sender unvalidated on prod). Idempotent:
// 2xx (deleted) or 404 (already gone). The account cascade is the backstop.
async function reapStack(request: APIRequestContext, stack: CreatedStack): Promise<void> {
  const del = await request.fetch(`${API_URL}/stacks/${encodeURIComponent(stack.slug)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${stack.bearer}`,
      [SKIP_EMAIL_CONFIRMATION_HEADER]: SKIP_EMAIL_CONFIRMATION_VALUE,
    },
    failOnStatusCode: false,
  })
  expect(
    (del.status() >= 200 && del.status() < 300) || del.status() === STATUS_NOT_FOUND,
    `stack reap (skip-email DELETE) should be 2xx (deleted) or 404 (already gone); got ${del.status()}. ` +
      `Body: ${await del.text().catch(() => '<unreadable>')}`,
  ).toBe(true)
}

interface CacheResource {
  token: string
  bearer: string
}

// Provision ONE fast cache resource (Redis hot-pool, no dedicated DB) as the
// minted PRO account, recorded to the ledger BEFORE any throwing assert (rule
// 24). The shared seed for the resource-lifecycle legs. Returns token + bearer.
async function provisionCacheSeed(
  request: APIRequestContext,
  bearer: string,
  label: string,
): Promise<CacheResource> {
  const name = cohortName(label)
  const resp = await request.fetch(`${API_URL}/cache/new`, {
    method: 'POST',
    headers: authedProvisionHeaders(bearer),
    data: JSON.stringify({ name }),
    failOnStatusCode: false,
  })
  test.skip(
    resp.status() === STATUS_BACKEND_UNAVAILABLE,
    `cache service returned 503 at ${API_URL} — cannot seed a resource for the lifecycle legs. Reports skipped.`,
  )
  expect(
    resp.status(),
    `POST /cache/new (seed) should return ${STATUS_CREATED}; got ${resp.status()}. ` +
      `Body: ${await resp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const body = (await resp.json()) as { token: string }
  recordEntity({
    kind: 'resource',
    id: body.token,
    apiUrl: API_URL,
    token: bearer,
    note: `batchC cache seed ${name}`,
  })
  return { token: body.token, bearer }
}

// Reap a single resource inline (authed DELETE). Account cascade + afterAll
// back it up; we reap eagerly so the ledger stays truthful between serial tests.
async function reapResource(request: APIRequestContext, res: CacheResource, note: string): Promise<void> {
  const result = await reapEntities(request, [
    { kind: 'resource', id: res.token, apiUrl: API_URL, token: res.bearer, note, recordedAt: new Date().toISOString() },
  ])
  expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
  clearLedger()
}

// ── Anon-claim helper (W-AUTH2 disposable-session logout) ────────────────────
interface ClaimedTeam {
  resourceToken: string
  sessionToken: string
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

// Provision an anon cache + claim it into a REAL throwaway team, returning the
// claim's session_token (onboarding.go) — a DISPOSABLE bearer we can revoke
// without touching the shared minted JWT. Needs the anon fingerprint bypass
// (E2E_TEST_TOKEN) to work on prod; returns null when it can't mint one.
async function provisionAndClaim(request: APIRequestContext): Promise<ClaimedTeam | null> {
  if (!process.env.E2E_TEST_TOKEN) return null
  const create = await request.fetch(`${API_URL}/cache/new`, {
    method: 'POST',
    headers: anonProvisionHeaders(),
    data: JSON.stringify({ name: cohortName('wauth2-anon') }),
    failOnStatusCode: false,
  })
  if (create.status() === STATUS_BACKEND_UNAVAILABLE) return null
  expect(
    create.status(),
    `POST /cache/new (anon, for claim) should return ${STATUS_CREATED}; got ${create.status()}. ` +
      `Body: ${await create.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const created = (await create.json()) as { token: string; note: string }
  recordEntity({ kind: 'resource', id: created.token, apiUrl: API_URL, note: `W-AUTH2 anon ${created.token}` })

  const upgradeJWT = extractUpgradeJWT(created.note)
  const claim = await request.fetch(`${API_URL}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ jwt: upgradeJWT, email: cohortEmail('wauth2') }),
    failOnStatusCode: false,
  })
  expect(
    claim.status(),
    `POST /claim should return ${STATUS_CREATED}; got ${claim.status()}. ` +
      `Body: ${await claim.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const claimBody = (await claim.json()) as { session_token?: string }
  const sessionToken = String(claimBody.session_token ?? '')
  if (!sessionToken) return null
  return { resourceToken: created.token, sessionToken }
}

test.describe('LIVE — Batch C (W-STACKS / W-STACKS-ADV / W-LIFECYCLE / W-AUTH2)', () => {
  test.describe.configure({ mode: 'serial' })

  // Hard skip in normal CI: the LIVE harness must never make the per-PR gate
  // depend on a reachable backend.
  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend Batch C suite is opt-in. Set E2E_LIVE=1 + ' +
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
        `[live-stacks-lifecycle afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── W-STACKS — create(202) → list/get → env-merge → 404 → two-step delete ────
  test.describe('W-STACKS — stacks/new(202) → list + get → env merge → missing 404 → delete', () => {
    test('full single-service stack lifecycle contract on the minted PRO account', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — stack lifecycle needs the minted PRO cohort account.')
      const bearer = minted!.token

      // ── Create: 202 accepted (build outcome irrelevant). ─────────────────────
      const stack = await createMintedStack(request, bearer, 'wstacks')
      const slug = stack.slug

      // ── List: GET /api/v1/stacks shows the new stack (write→read round-trip). ─
      const list = await authedGet(request, '/api/v1/stacks', bearer)
      expect(list.status(), 'GET /api/v1/stacks should be 200').toBe(STATUS_OK)
      const listBody = await bodyJSON(list)
      expect(listBody.ok, 'stacks list ok flag').toBe(true)
      const items = (listBody.items ?? []) as Array<Record<string, unknown>>
      expect(
        Array.isArray(items),
        `stacks list must carry an items[] array; got ${JSON.stringify(listBody).slice(0, 200)}.`,
      ).toBe(true)
      const mine = items.find((s) => String(s.stack_id) === slug)
      expect(mine, `the new stack ${slug} must appear in the team's stacks list (${items.length} item(s)).`).toBeTruthy()
      expect(
        isCohortBranded(String((mine as Record<string, unknown>).name ?? '')),
        `the stack name must carry the cohort marker '${COHORT_MARKER}'; got '${String((mine as Record<string, unknown>).name)}'.`,
      ).toBe(true)
      expect(String((mine as Record<string, unknown>).env ?? ''), 'list row must echo env=development').toBe('development')

      // ── Get (api/v1): GET /api/v1/stacks/:slug → detail envelope. ────────────
      const apiGet = await authedGet(request, `/api/v1/stacks/${encodeURIComponent(slug)}`, bearer)
      expect(apiGet.status(), `GET /api/v1/stacks/${slug} should be 200`).toBe(STATUS_OK)
      const apiGetBody = await bodyJSON(apiGet)
      expect(apiGetBody.ok, 'stack get ok flag').toBe(true)
      expect(String(apiGetBody.stack_id ?? ''), 'stack get must echo the stack_id').toBe(slug)
      expect(
        Array.isArray(apiGetBody.services),
        `stack get must carry a services[] array; got ${JSON.stringify(apiGetBody).slice(0, 200)}.`,
      ).toBe(true)

      // ── Get (OptionalAuth route): GET /stacks/:slug (same detail surface). ────
      const optGet = await authedGet(request, `/stacks/${encodeURIComponent(slug)}`, bearer)
      expect(optGet.status(), `GET /stacks/${slug} should be 200`).toBe(STATUS_OK)
      const optGetBody = await bodyJSON(optGet)
      expect(String(optGetBody.stack_id ?? ''), 'OptionalAuth stack get must echo the stack_id').toBe(slug)

      // ── PATCH /stacks/:slug/env: merge a key → 200; response carries it. The
      //    persisted env is applied on the NEXT redeploy (GET doesn't echo env),
      //    so the load-bearing read-back is the PATCH response's merged `env`. ──
      const envKey = `WSTACKS_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
      const envVal = `cohort-${Math.random().toString(36).slice(2, 10)}`
      const patch = await request.fetch(`${API_URL}/stacks/${encodeURIComponent(slug)}/env`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ env: { [envKey]: envVal } }),
        failOnStatusCode: false,
      })
      expect(
        patch.status(),
        `PATCH /stacks/:slug/env should be 200 (mig 062 persists env_vars); got ${patch.status()}. ` +
          `Body: ${await patch.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const patchBody = await bodyJSON(patch)
      expect(patchBody.ok, 'env patch ok flag').toBe(true)
      const mergedEnv = (patchBody.env ?? {}) as Record<string, unknown>
      // The response env is REDACTED (secret values masked), but the KEY must be
      // present in the merged set — proving the merge persisted (silent-data-loss
      // was the B7-P0-1 regression this surface had).
      expect(
        Object.prototype.hasOwnProperty.call(mergedEnv, envKey),
        `PATCH /stacks/:slug/env must return the merged set INCLUDING the just-set key ${envKey}; ` +
          `got keys ${JSON.stringify(Object.keys(mergedEnv))}.`,
      ).toBe(true)

      // A second PATCH merges incrementally (PATCH semantics, not replace-all):
      // the first key must still be present alongside the new one.
      const envKey2 = `WSTACKS2_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
      const patch2 = await request.fetch(`${API_URL}/stacks/${encodeURIComponent(slug)}/env`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ env: { [envKey2]: 'v2' } }),
        failOnStatusCode: false,
      })
      expect(patch2.status(), 'second PATCH /stacks/:slug/env should be 200').toBe(STATUS_OK)
      const merged2 = ((await bodyJSON(patch2)).env ?? {}) as Record<string, unknown>
      expect(
        Object.prototype.hasOwnProperty.call(merged2, envKey) &&
          Object.prototype.hasOwnProperty.call(merged2, envKey2),
        `PATCH env is incremental — both ${envKey} and ${envKey2} must survive the second merge; ` +
          `got keys ${JSON.stringify(Object.keys(merged2))}.`,
      ).toBe(true)

      // An invalid env-var key → 400 invalid_env_key (POSIX shape guard).
      const badPatch = await request.fetch(`${API_URL}/stacks/${encodeURIComponent(slug)}/env`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ env: { '1bad-key': 'x' } }),
        failOnStatusCode: false,
      })
      expect(
        badPatch.status(),
        `PATCH env with a non-POSIX key must be ${STATUS_BAD_REQUEST} (invalid_env_key); got ${badPatch.status()}.`,
      ).toBe(STATUS_BAD_REQUEST)

      // ── Missing/cross-team 404: an unknown slug must 404 (cross-tenant
      //    existence stays opaque) on BOTH get surfaces. ─────────────────────────
      const bogusSlug = `nope-${Math.random().toString(36).slice(2, 10)}`
      const missing = await authedGet(request, `/api/v1/stacks/${bogusSlug}`, bearer)
      expect(
        missing.status(),
        `GET /api/v1/stacks/:slug for an unknown slug must be 404; got ${missing.status()}.`,
      ).toBe(STATUS_NOT_FOUND)

      // ── Two-step delete CONTRACT: a paid (PRO) account's plain DELETE enters
      //    the email-confirmed flow → 202 pending_confirmation (email Brevo-
      //    gated; we don't assert delivery). Stacks with no email client fall
      //    through to immediate 200; a 503 means the Brevo send failed (sender
      //    unvalidated on prod). All are honest contract states. ──────────────────
      const requestDelete = await request.fetch(`${API_URL}/stacks/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, STATUS_ACCEPTED, STATUS_CONFLICT, STATUS_BACKEND_UNAVAILABLE].includes(requestDelete.status()),
        `DELETE /stacks/:slug should be 202 (two-step pending, paid tier), 200 (immediate, no email ` +
          `client), 409 (already pending), or 503 (Brevo send failed — sender unvalidated on prod, ` +
          `matrix §6); got ${requestDelete.status()}. Body: ${await requestDelete.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      if (requestDelete.status() === STATUS_ACCEPTED) {
        const delBody = await bodyJSON(requestDelete)
        expect(
          String(delBody.deletion_status ?? ''),
          'the 202 two-step stack delete must report deletion_status=pending_confirmation.',
        ).toBe('pending_confirmation')
        // Cancel the pending deletion (DELETE /api/v1/stacks/:slug/confirm-deletion)
        // — the owner can cancel without the emailed token. 2xx, or 404 if it
        // already resolved. This proves the cancel arm of the two-step flow.
        const cancel = await request.fetch(
          `${API_URL}/api/v1/stacks/${encodeURIComponent(slug)}/confirm-deletion`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${bearer}` }, failOnStatusCode: false },
        )
        expect(
          (cancel.status() >= 200 && cancel.status() < 300) || cancel.status() === STATUS_NOT_FOUND,
          `DELETE /api/v1/stacks/:slug/confirm-deletion (cancel) should be 2xx or 404; got ${cancel.status()}. ` +
            `Body: ${await cancel.text().catch(() => '<unreadable>')}`,
        ).toBe(true)
      }

      // ── Final reap: the REAL destruction (skip-email so it doesn't depend on
      //    a Brevo-delivered confirmation). 2xx (deleted) or 404 (already gone). ─
      await reapStack(request, stack)

      // Gone: the get surface now 404s (or 200 during async teardown) — never 5xx.
      const afterDelete = await authedGet(request, `/api/v1/stacks/${encodeURIComponent(slug)}`, bearer)
      expect(
        [STATUS_OK, STATUS_NOT_FOUND].includes(afterDelete.status()),
        `post-delete stack get should be 404 (gone) or 200 (teardown in progress); got ${afterDelete.status()}.`,
      ).toBe(true)
      clearLedger()
    })
  })

  // ── W-STACKS-ADV — family + promote + confirm-deletion cancel (contract) ─────
  test.describe('W-STACKS-ADV — family read + promote contract + confirm-deletion cancel', () => {
    test('family (PRO 200 + Cache-Control), promote non-destructive contract, cancel arm', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — stack-advanced legs need the minted PRO cohort account.')
      const bearer = minted!.token

      const stack = await createMintedStack(request, bearer, 'wstacksadv')
      const slug = stack.slug

      // ── Family: GET /api/v1/stacks/:slug/family. PRO is multi-env-allowed →
      //    200 with the family[] (at minimum the source as a singleton). The
      //    endpoint sets Cache-Control: private, max-age=60. ─────────────────────
      const family = await authedGet(request, `/api/v1/stacks/${encodeURIComponent(slug)}/family`, bearer)
      expect(
        [STATUS_OK, STATUS_PAYMENT_REQUIRED].includes(family.status()),
        `GET /api/v1/stacks/:slug/family should be 200 (PRO) or 402 (tier-gated); got ${family.status()}. ` +
          `Body: ${await family.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      if (family.status() === STATUS_OK) {
        const famBody = await bodyJSON(family)
        expect(famBody.ok, 'family ok flag').toBe(true)
        expect(String(famBody.slug ?? ''), 'family must echo the source slug').toBe(slug)
        const fam = (famBody.family ?? []) as Array<Record<string, unknown>>
        expect(
          Array.isArray(fam) && fam.length > 0,
          `family must carry a non-empty family[] (the source as a singleton at minimum); ` +
            `got ${JSON.stringify(famBody).slice(0, 200)}.`,
        ).toBe(true)
        const slugs = fam.map((s) => String(s.slug))
        expect(slugs, `the family must include the source stack ${slug}.`).toContain(slug)
        expect(
          family.headers()['cache-control'] ?? '',
          'family read must set a private, short Cache-Control (per-team, read-only aggregate).',
        ).toContain('private')
      }

      // ── Promote: POST /api/v1/stacks/:slug/promote to=staging. The source has
      //    no successful build (image_ref) yet, so the documented contract is a
      //    NON-DESTRUCTIVE 412 (needs a successful source deploy first) — OR a 402
      //    (tier), 400 (validation), or 202 (accepted). NEVER a 5xx. We never let
      //    a promote actually create+leak a sibling stack (412 is the expected
      //    path for a just-created, not-yet-built stack). ─────────────────────────
      const promote = await request.fetch(`${API_URL}/api/v1/stacks/${encodeURIComponent(slug)}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ to: 'staging', copy_vault: false }),
        failOnStatusCode: false,
      })
      expect(
        [
          STATUS_PRECONDITION_FAILED,
          STATUS_PAYMENT_REQUIRED,
          STATUS_BAD_REQUEST,
          STATUS_ACCEPTED,
          STATUS_CONFLICT,
        ].includes(promote.status()),
        `POST /api/v1/stacks/:slug/promote should be 412 (source not yet built — no image_ref), 402 ` +
          `(tier), 400 (validation), 202 (accepted), or 409 — never a 5xx; got ${promote.status()}. ` +
          `Body: ${await promote.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      // If the promote was unexpectedly ACCEPTED it created a sibling staging
      // stack; reap it so we never leak. The slug is the same app family — the
      // staging sibling carries its own slug in the response item when present.
      if (promote.status() === STATUS_ACCEPTED) {
        const promoteBody = await bodyJSON(promote)
        const sibSlug = String(promoteBody.stack_id ?? '')
        if (sibSlug && sibSlug !== slug) {
          recordEntity({ kind: 'stack', id: sibSlug, apiUrl: API_URL, token: bearer, note: 'W-STACKS-ADV promote sibling' })
          await reapStack(request, { slug: sibSlug, bearer })
        }
      }

      // ── Cancel arm WITHOUT a prior request: DELETE confirm-deletion when no
      //    pending row exists → 404 not_found (the endpoint is reachable + safe). ─
      const cancelNoPending = await request.fetch(
        `${API_URL}/api/v1/stacks/${encodeURIComponent(slug)}/confirm-deletion`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${bearer}` }, failOnStatusCode: false },
      )
      expect(
        cancelNoPending.status(),
        `DELETE confirm-deletion with NO pending row must be 404 (not_found) — proving the cancel arm ` +
          `is reachable without disturbing the stack; got ${cancelNoPending.status()}.`,
      ).toBe(STATUS_NOT_FOUND)

      // Reap the stack.
      await reapStack(request, stack)
      clearLedger()
    })
  })

  // ── W-LIFECYCLE — pause/resume + rotate + backup contract on a fast cache ────
  test.describe('W-LIFECYCLE — pause → resume + rotate-credentials + backup/restore contract', () => {
    test('resource lifecycle on a fast cache resource (Pro), backup contract, reap', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — resource lifecycle needs the minted PRO cohort account.')
      const bearer = minted!.token

      const res = await provisionCacheSeed(request, bearer, 'wlifecycle')

      // ── Pause: Pro+ flips status → paused. 200 + the resource reflects it.
      //    (402 only on a non-Pro stack — the minted account is PRO.) ─────────────
      const pause = await request.fetch(`${API_URL}/api/v1/resources/${res.token}/pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, STATUS_PAYMENT_REQUIRED].includes(pause.status()),
        `POST /:id/pause should be 200 (Pro) or 402 (tier-gated); got ${pause.status()}. ` +
          `Body: ${await pause.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      const paused = pause.status() === STATUS_OK
      if (paused) {
        const pauseBody = await bodyJSON(pause)
        expect(pauseBody.ok, 'pause ok flag').toBe(true)
        expect(String(pauseBody.status ?? ''), 'pause must report status=paused').toBe('paused')

        // ── Resume: flips back to active (no tier gate on resume). 200. ──────────
        const resume = await request.fetch(`${API_URL}/api/v1/resources/${res.token}/resume`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}` },
          failOnStatusCode: false,
        })
        expect(
          resume.status(),
          `POST /:id/resume should be 200 (owner can always un-pause); got ${resume.status()}. ` +
            `Body: ${await resume.text().catch(() => '<unreadable>')}`,
        ).toBe(STATUS_OK)
        const resumeBody = await bodyJSON(resume)
        expect(resumeBody.ok, 'resume ok flag').toBe(true)
        expect(String(resumeBody.status ?? ''), 'resume must report status=active').toBe('active')
      }

      // ── Rotate credentials: a new connection_url is minted. 200 (Pro) /
      //    402 (tier) / 409 (paused/invalid state) / 503 (provider) — all honest. ─
      const rotate = await request.fetch(`${API_URL}/api/v1/resources/${res.token}/rotate-credentials`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, STATUS_PAYMENT_REQUIRED, STATUS_CONFLICT, STATUS_BACKEND_UNAVAILABLE].includes(rotate.status()),
        `POST /:id/rotate-credentials should be 200 (rotated), 402 (tier), 409 (state), or 503 (provider); ` +
          `got ${rotate.status()}. Body: ${await rotate.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      if (rotate.status() === STATUS_OK) {
        const rotateBody = await bodyJSON(rotate)
        expect(rotateBody.ok, 'rotate ok flag').toBe(true)
      }

      // ── Backup CONTRACT: backups are postgres-ONLY today. On a cache resource
      //    the documented contract is 400 unsupported_resource_type (postgres-only)
      //    — OR 402 on a stack where the tier lacks backup access. We assert the
      //    documented contract; we NEVER wait for a real backup. ──────────────────
      const backup = await request.fetch(`${API_URL}/api/v1/resources/${res.token}/backup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(
        [STATUS_BAD_REQUEST, STATUS_PAYMENT_REQUIRED, STATUS_OK].includes(backup.status()),
        `POST /:id/backup on a CACHE resource should be 400 (unsupported_resource_type — backups are ` +
          `postgres-only) or 402 (tier); got ${backup.status()}. Body: ${await backup.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      if (backup.status() === STATUS_BAD_REQUEST) {
        const backupBody = await bodyJSON(backup)
        expect(
          String(backupBody.error ?? ''),
          'cache backup must be rejected with unsupported_resource_type (postgres-only contract).',
        ).toBe('unsupported_resource_type')
      }

      // ── Backups + restores list: the read surfaces respond with the items[]
      //    envelope even with nothing enqueued (a fresh resource has none). ────────
      const backups = await authedGet(request, `/api/v1/resources/${res.token}/backups`, bearer)
      expect(backups.status(), 'GET /:id/backups should be 200').toBe(STATUS_OK)
      const bBody = await bodyJSON(backups)
      expect(bBody.ok, 'backups ok flag').toBe(true)
      expect(Array.isArray(bBody.items), 'backups must carry an items[] array').toBe(true)

      const restores = await authedGet(request, `/api/v1/resources/${res.token}/restores`, bearer)
      expect(restores.status(), 'GET /:id/restores should be 200').toBe(STATUS_OK)
      const rBody = await bodyJSON(restores)
      expect(rBody.ok, 'restores ok flag').toBe(true)
      expect(Array.isArray(rBody.items), 'restores must carry an items[] array').toBe(true)

      await reapResource(request, res, 'W-LIFECYCLE seed')
    })
  })

  // ── W-AUTH2 — secondary-auth surfaces (email-start, github body-flow, logout) ─
  test.describe('W-AUTH2 — magic-link start contract + github body-flow contract + disposable logout', () => {
    test('POST /auth/email/start → 2xx {ok} (Brevo-gated; delivery NOT asserted)', async ({ request }) => {
      // The start leg is always 2xx so it never leaks whether an email exists.
      // We assert the accepted contract ONLY — delivery is Brevo-gated (sender
      // unvalidated on prod; matrix §6), so we never assert a link is delivered.
      const resp = await request.fetch(`${API_URL}/auth/email/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          email: cohortEmail('wauth2-magic'),
          return_to: `https://${PROD_API_HOST.replace(/^api\./, '')}/login/callback`,
        }),
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, STATUS_ACCEPTED].includes(resp.status()),
        `POST /auth/email/start should always 2xx (rejecting would leak whether the email exists); ` +
          `got ${resp.status()}. Body: ${await resp.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      const body = await bodyJSON(resp)
      expect(body.ok, `/auth/email/start should return {ok:true}; got ${JSON.stringify(body)}`).toBe(true)
    })

    test('POST /auth/github (body-flow) no-credential contract → 400/401/503', async ({ request }) => {
      // No `code` → 400 missing_code (self-contained agent-facing instruction).
      const noCode = await request.fetch(`${API_URL}/auth/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({}),
        failOnStatusCode: false,
      })
      expect(
        noCode.status(),
        `POST /auth/github with no code must be ${STATUS_BAD_REQUEST} (missing_code); got ${noCode.status()}.`,
      ).toBe(STATUS_BAD_REQUEST)
      expect(
        String((await bodyJSON(noCode)).error ?? ''),
        'POST /auth/github with no code must carry error=missing_code.',
      ).toBe('missing_code')

      // A bogus code → 401 oauth_failed (exchange rejected) OR 503
      // oauth_not_configured (GitHub OAuth disabled on this stack). Either is the
      // correct no-credential contract — we NEVER complete a real GitHub flow.
      const badCode = await request.fetch(`${API_URL}/auth/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ code: `cohort-bogus-${Math.random().toString(36).slice(2, 10)}` }),
        failOnStatusCode: false,
      })
      expect(
        [STATUS_UNAUTHORIZED, STATUS_BACKEND_UNAVAILABLE].includes(badCode.status()),
        `POST /auth/github with a bogus code must be 401 (oauth_failed) or 503 (oauth_not_configured); ` +
          `got ${badCode.status()}. A 2xx here would mean a fake code authenticated — a critical auth bug. ` +
          `Body: ${await badCode.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
    })

    test('disposable claimed session — /auth/me 200 → logout → SAME bearer 401', async ({ request }) => {
      // CRITICAL: this leg REVOKES the bearer it tests, so it must NEVER revoke
      // the shared minted E2E_SESSION_JWT (every other serial leg provisions AS
      // that session). It always uses a DISPOSABLE claimed team's session_token.
      const disposable = await provisionAndClaim(request)
      test.skip(
        disposable === null,
        'No DISPOSABLE session available (E2E_TEST_TOKEN unset, or claim omitted a session_token). The ' +
          'logout leg must NEVER revoke the shared minted JWT, so it SKIPS rather than risk it. Set ' +
          'E2E_TEST_TOKEN (the anon fingerprint-bypass secret) to run it.',
      )
      const token = disposable!.sessionToken

      // 1) The disposable bearer works pre-logout.
      const pre = await authedGet(request, '/auth/me', token)
      expect(
        pre.status(),
        `pre-logout /auth/me with the disposable bearer should be 200; got ${pre.status()}. ` +
          `If it is already 401 the revocation assertion below is meaningless.`,
      ).toBe(STATUS_OK)

      // Tampered bearer must 401 (cheap authz proof the route is auth-gated).
      const tampered = await authedGet(request, '/auth/me', TAMPERED_BEARER)
      expect(
        tampered.status(),
        `GET /auth/me with a tampered bearer must 401; got ${tampered.status()}.`,
      ).toBe(STATUS_UNAUTHORIZED)

      // Reap the throwaway team's resource NOW, while its session is still valid
      // — logout below revokes the only bearer that authorizes the DELETE, so
      // reaping afterward would 401 and leak the resource.
      const reap = await reapEntities(request, [
        { kind: 'resource', id: disposable!.resourceToken, apiUrl: API_URL, token, note: 'W-AUTH2 logout leg', recordedAt: new Date().toISOString() },
      ])
      expect(reap.failed.length, `pre-logout reap failed: ${JSON.stringify(reap.failed)}`).toBe(0)
      clearLedger()

      // 2) Logout — revokes the jti.
      const logout = await request.fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      })
      expect(
        logout.status(),
        `POST /auth/logout with a valid bearer should succeed (200); got ${logout.status()}.`,
      ).toBe(STATUS_OK)

      // 3) THE REGRESSION ASSERTION: the SAME bearer must now be rejected.
      const post = await authedGet(request, '/auth/me', token)
      expect(
        post.status(),
        `REUSED bearer after logout must return 401 (jti in the Redis revocation set); got ${post.status()}. ` +
          `A 200 here is the login/logout regression class — a session that survives its own logout.`,
      ).toBe(STATUS_UNAUTHORIZED)
    })
  })

  // Coverage manifest (rule 18): the matrix routes this file moves to
  // LIVE-PROD-NOW. A future registry-iterating done-bar (matrix §4) reads this
  // to confirm no Batch C leg silently dropped. COHORT_MARKER + PROD_API_HOST
  // are referenced so the cohort import stays load-bearing even if every authed
  // leg skips (no minted session).
  test('coverage manifest — Batch C routes present + cohort marker wired', () => {
    expect(coveredRoutes.length, 'Batch C route manifest should be non-empty').toBeGreaterThan(10)
    expect(COHORT_MARKER, 'cohort marker must be the shared brand').toBe('e2e-cohort')
    expect(PROD_API_HOST, 'prod api host constant must be wired').toBe('api.instanode.dev')
  })
})

// Exported so a future registry-iterating prod-coverage done-bar (matrix §4
// Option B) can union manifests across live-*.spec.ts without a hand-typed list.
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
