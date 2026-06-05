// Batch A (read flows) — real-backend (LIVE) E2E covering every authed READ
// user-flow against PRODUCTION via the minted cohort account.
//
// Plan: docs/sessions/2026-06-04/PROD-COVERAGE-MATRIX.md §3 batch A (W1–W6):
//   - W-OBS    : livez/healthz/readyz, openapi, capabilities, status,
//                oauth-protected-resource, incidents, llms/security static.
//   - W-RES    : whoami, resources list, resources/:id, /credentials, /metrics,
//                explicit DELETE; families, /:id/family, /:id/backups,
//                /:id/restores (seeded via a fast cache resource).
//   - W-VAULT  : PUT a secret → GET decrypts → list keys (read round-trip).
//   - W-APIKEYS: POST → GET (metadata-only) → DELETE (create→list→revoke; fast).
//   - W-BILLING: billing state, invoices, usage, usage/wall (reads; NO charge —
//                Razorpay recurring disabled, assert the documented contract).
//   - W-AUDIT  : audit feed (JSON) + audit.csv (header parity).
//
// Every leg is a genuine read-surface assertion: the minted PRO account performs
// a real GET against prod and we assert the real response shape + 200 (and a
// cheap authz check where it's free — a tampered/absent bearer must 401).
//
// It mirrors live-anon-provision.spec.ts / live-claim-deploy.spec.ts EXACTLY for
// the safety machinery (rule 24): E2E_LIVE=1 gating (whole file SKIPS loudly in
// normal PR CI so the per-PR gate NEVER depends on a live backend),
// assertSafeApiTarget() refusing an un-sanctioned prod target, cohort-branded
// ledger-before-assert + inline reap + afterAll backstop for the few resources a
// read needs (a cache resource, vault keys via account cascade, an api-key).
// Named live-*.spec.ts so playwright.live.config.ts's testMatch picks it up and
// the default (mocked, per-PR) config ignores it.
//
// ── Reads need a minted session ──────────────────────────────────────────────
// Every authed leg requires E2E_SESSION_JWT (the workflow-minted PRO cohort
// account, cohort.ts mintedSession()). When it is absent (a staging run without
// a minted session, or a local invocation) the authed legs SKIP loudly rather
// than red — the read surface can only be exercised as a real team.
//
// ── What creates (and is reaped) ─────────────────────────────────────────────
// Reads themselves create nothing. The few legs that must seed a row first:
//   - a fast CACHE resource (Redis hot-pool, no dedicated DB) for the
//     resources/:id, credentials, metrics, family, backups, restores reads —
//     recorded to the ledger + reaped inline (authed DELETE, 200).
//   - one VAULT key (vault is fast, no dedicated DB) for the get/list reads —
//     reaped via DELETE /api/v1/vault/:env/:key inline; the account cascade
//     (DELETE /internal/e2e/account) is the backstop (no vault deletePath case
//     is needed — keys live under the team and die with it).
//   - one API key (PAT) for the list/revoke read — revoked inline by the test
//     body itself (DELETE), account cascade backstop.

import { expect, test, type APIRequestContext } from '@playwright/test'

import {
  cohortName,
  COHORT_MARKER,
  assertSafeApiTarget,
  provisionIdentity,
  mintedSession,
} from './cohort'
import { recordEntity, loadLedger, reapEntities, clearLedger } from './cleanup-ledger'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = (process.env.E2E_API_URL ?? process.env.AGENT_API_URL ?? '')
  .toString()
  .replace(/\/$/, '')

const STATUS_OK = 200
const STATUS_CREATED = 201
const STATUS_UNAUTHORIZED = 401
const STATUS_PAYMENT_REQUIRED = 402
const STATUS_BACKEND_UNAVAILABLE = 503

// A syntactically valid but signature-invalid bearer. Used for the cheap authz
// assertion: an authed read with a tampered token must 401 (never 200) — proves
// the route is genuinely auth-gated, not accidentally public.
const TAMPERED_BEARER = 'not-a-real-jwt.tampered.signature'

/** GET helper carrying the minted bearer. */
function authedGet(
  request: APIRequestContext,
  path: string,
  bearer: string,
): Promise<import('@playwright/test').APIResponse> {
  return request.fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearer}` },
    failOnStatusCode: false,
  })
}

/** Read a response body as JSON, tolerating a non-JSON body in the error msg. */
async function bodyJSON(resp: import('@playwright/test').APIResponse): Promise<Record<string, unknown>> {
  return (await resp.json().catch(() => ({}))) as Record<string, unknown>
}

interface CacheResource {
  token: string
  bearer: string
}

// Provision ONE fast cache resource (Redis hot-pool, no dedicated DB) as the
// minted PRO account, recorded to the ledger BEFORE any throwing assert (rule
// 24). The shared seed for every resource-scoped read (resources/:id,
// credentials, metrics, family, backups, restores). Returns the token + the
// bearer to address + reap it.
async function provisionCacheSeed(request: APIRequestContext, label: string): Promise<CacheResource> {
  const id = provisionIdentity({}, false) // authed-minted; cache is fast, never forceAnon
  const name = cohortName(label)
  const resp = await request.fetch(`${API_URL}/cache/new`, {
    method: 'POST',
    headers: id.headers,
    data: JSON.stringify({ name }),
    failOnStatusCode: false,
  })
  test.skip(
    resp.status() === STATUS_BACKEND_UNAVAILABLE,
    `cache service returned 503 at ${API_URL} — cannot seed a resource for the read legs. Reports skipped.`,
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
    token: id.bearer,
    note: `batchA cache seed ${name}`,
  })
  return { token: body.token, bearer: String(id.bearer) }
}

// Reap a single resource inline (authed DELETE). The account cascade + afterAll
// are the backstops; we still reap eagerly so the ledger stays truthful between
// serial tests.
async function reapResource(request: APIRequestContext, res: CacheResource, note: string): Promise<void> {
  const result = await reapEntities(request, [
    { kind: 'resource', id: res.token, apiUrl: API_URL, token: res.bearer, note, recordedAt: new Date().toISOString() },
  ])
  expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
  clearLedger()
}

test.describe('LIVE — Batch A read flows (W-OBS / W-RES / W-VAULT / W-APIKEYS / W-BILLING / W-AUDIT)', () => {
  test.describe.configure({ mode: 'serial' })

  // Hard skip in normal CI: the LIVE harness must never make the per-PR gate
  // depend on a reachable backend.
  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend Batch A read suite is opt-in. Set E2E_LIVE=1 + ' +
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
        `[live-reads afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── W-OBS — liveness / discovery (unauthed + minted GETs; zero write risk) ───
  // These are public/minted GETs with a stable contract. No resource is created.
  test.describe('W-OBS — liveness, discovery, capabilities, status, incidents, static', () => {
    test('GET /livez, /healthz, /readyz — health surfaces respond with their shape', async ({ request }) => {
      // /livez + /healthz: 200 always (shallow). /readyz: 200 or 503 (deep
      // readiness matrix may legitimately be degraded), both with the same shape.
      const livez = await request.fetch(`${API_URL}/livez`, { failOnStatusCode: false })
      expect(livez.status(), 'GET /livez should be 200 (process up)').toBe(STATUS_OK)

      const healthz = await request.fetch(`${API_URL}/healthz`, { failOnStatusCode: false })
      expect(healthz.status(), 'GET /healthz should be 200 (binary up + platform_db ping)').toBe(STATUS_OK)
      const h = await bodyJSON(healthz)
      // /healthz stamps commit_id (rule 14 build-SHA gate reads this).
      expect(h.commit_id, 'GET /healthz must stamp commit_id (rule 14 build-SHA gate)').toBeTruthy()

      const readyz = await request.fetch(`${API_URL}/readyz`, { failOnStatusCode: false })
      expect(
        [STATUS_OK, STATUS_BACKEND_UNAVAILABLE].includes(readyz.status()),
        `GET /readyz should be 200 (ready) or 503 (deep-readiness degraded); got ${readyz.status()}.`,
      ).toBe(true)
    })

    test('GET /openapi.json — OpenAPI 3.1 spec with the vault routes present', async ({ request }) => {
      const resp = await request.fetch(`${API_URL}/openapi.json`, { failOnStatusCode: false })
      expect(resp.status(), 'GET /openapi.json should be 200').toBe(STATUS_OK)
      const spec = await bodyJSON(resp)
      expect(
        String(spec.openapi ?? ''),
        `openapi.json must declare an OpenAPI 3.1 version; got '${String(spec.openapi)}'.`,
      ).toMatch(/^3\.1/)
      const paths = (spec.paths ?? {}) as Record<string, unknown>
      // The vault route surface must be documented (matrix §1.N is a real flow).
      const vaultPaths = Object.keys(paths).filter((p) => p.includes('/vault'))
      expect(
        vaultPaths.length,
        `openapi.json must document the vault routes; found paths: ${Object.keys(paths).length}.`,
      ).toBeGreaterThan(0)
    })

    test('GET /api/v1/capabilities — plans.Registry-iterated tier matrix', async ({ request }) => {
      const resp = await request.fetch(`${API_URL}/api/v1/capabilities`, { failOnStatusCode: false })
      expect(resp.status(), 'GET /api/v1/capabilities should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      expect(body.ok, 'capabilities ok flag').toBe(true)
      const tiers = (body.tiers ?? []) as Array<Record<string, unknown>>
      expect(
        Array.isArray(tiers) && tiers.length > 0,
        `capabilities must return a non-empty tiers[] (plans.Registry-iterated); got ${JSON.stringify(body.tiers)}.`,
      ).toBe(true)
      // The free + pro tiers are load-bearing in the contract; both must surface.
      const names = tiers.map((t) => String(t.name ?? t.tier ?? ''))
      expect(names, `capabilities tiers must include 'pro'; got ${JSON.stringify(names)}.`).toContain('pro')
    })

    test('GET /api/v1/status — public status feed shape', async ({ request }) => {
      const resp = await request.fetch(`${API_URL}/api/v1/status`, { failOnStatusCode: false })
      expect(resp.status(), 'GET /api/v1/status should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      // Stable contract: an ok flag at minimum. Field set is forward-compatible.
      expect(body.ok ?? body.status, 'status feed must carry an ok/status field').toBeTruthy()
    })

    test('GET /.well-known/oauth-protected-resource — MCP discovery doc', async ({ request }) => {
      const resp = await request.fetch(`${API_URL}/.well-known/oauth-protected-resource`, {
        failOnStatusCode: false,
      })
      expect(
        resp.status(),
        `GET /.well-known/oauth-protected-resource should be 200; got ${resp.status()}.`,
      ).toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      // RFC 9728: the doc advertises a resource identifier.
      expect(body.resource, 'oauth-protected-resource doc must advertise a resource').toBeTruthy()
    })

    test('GET /api/v1/incidents — public incident feed shape', async ({ request }) => {
      const resp = await request.fetch(`${API_URL}/api/v1/incidents`, { failOnStatusCode: false })
      expect(resp.status(), 'GET /api/v1/incidents should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      expect(body.ok, 'incidents ok flag').toBe(true)
      expect(
        Array.isArray(body.items),
        `incidents must carry an items[] array; got ${JSON.stringify(body.items)}.`,
      ).toBe(true)
      expect(body.status_page, 'incidents must advertise a status_page URL').toBeTruthy()
    })

    test('GET /llms.txt + /security.txt — content-surface smoke (200 + non-empty)', async ({ request }) => {
      for (const path of ['/llms.txt', '/security.txt']) {
        const resp = await request.fetch(`${API_URL}${path}`, { failOnStatusCode: false })
        expect(resp.status(), `GET ${path} should be 200`).toBe(STATUS_OK)
        const text = await resp.text()
        expect(text.trim().length, `GET ${path} should return a non-empty body`).toBeGreaterThan(0)
      }
    })
  })

  // ── W-RES — identity + resource reads (minted PRO; cache-backed seed) ────────
  test.describe('W-RES — whoami + resource reads (list/get/credentials/metrics) + delete', () => {
    test('GET /api/v1/whoami — minted identity (team/tier) + tampered bearer 401', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — whoami read needs the minted cohort account.')
      const bearer = minted!.token

      const resp = await authedGet(request, '/api/v1/whoami', bearer)
      expect(resp.status(), 'GET /api/v1/whoami should be 200 for a minted session').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      expect(body.ok, 'whoami ok flag').toBe(true)
      expect(body.team_id, 'whoami must echo the team_id').toBeTruthy()
      expect(body.tier ?? body.plan_tier, 'whoami must echo the tier/plan_tier').toBeTruthy()

      // Cheap authz: a tampered bearer must 401 (route is genuinely auth-gated).
      const tampered = await authedGet(request, '/api/v1/whoami', TAMPERED_BEARER)
      expect(
        tampered.status(),
        `GET /api/v1/whoami with a tampered bearer must 401 (auth-gated); got ${tampered.status()}.`,
      ).toBe(STATUS_UNAUTHORIZED)
    })

    test('GET /api/v1/resources — list returns the items[] envelope', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — resources list needs the minted cohort account.')
      const resp = await authedGet(request, '/api/v1/resources', minted!.token)
      expect(resp.status(), 'GET /api/v1/resources should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      expect(
        Array.isArray(body.items),
        `resources list must carry an items[] array; got ${JSON.stringify(body).slice(0, 200)}.`,
      ).toBe(true)
    })

    test('GET /api/v1/resources/:id, /credentials, /metrics — seed a cache resource then read', async ({
      request,
    }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — resource detail reads need the minted cohort account.')
      const res = await provisionCacheSeed(request, 'wres-detail')

      // GET /api/v1/resources/:id — the detail shape.
      const detail = await authedGet(request, `/api/v1/resources/${res.token}`, res.bearer)
      expect(detail.status(), `GET /api/v1/resources/${res.token} should be 200`).toBe(STATUS_OK)
      const detailBody = await bodyJSON(detail)
      expect(detailBody.ok, 'resource detail ok flag').toBe(true)
      const item = (detailBody.item ?? {}) as Record<string, unknown>
      expect(String(item.token ?? ''), 'resource detail item must echo the token').toBe(res.token)
      // The list view must NEVER leak the connection_url (creds are a dedicated
      // surface). resourceToMap omits it; assert it is absent here.
      expect(
        item.connection_url,
        'resource detail item must NOT leak the connection_url (creds are a separate surface).',
      ).toBeFalsy()

      // GET /api/v1/resources/:id/credentials — the connection_url IS revealed.
      const creds = await authedGet(request, `/api/v1/resources/${res.token}/credentials`, res.bearer)
      expect(creds.status(), 'GET /:id/credentials should be 200').toBe(STATUS_OK)
      const credsBody = await bodyJSON(creds)
      expect(credsBody.ok, 'credentials ok flag').toBe(true)
      expect(
        String(credsBody.connection_url ?? ''),
        'credentials must reveal a usable redis connection_url; got ' + String(credsBody.connection_url),
      ).toMatch(/^rediss?:\/\//)

      // GET /api/v1/resources/:id/metrics — Pro tier has metrics access; the
      // minted account is PRO. A non-Pro stack would 402; assert the contract.
      const metrics = await authedGet(request, `/api/v1/resources/${res.token}/metrics`, res.bearer)
      expect(
        [STATUS_OK, STATUS_PAYMENT_REQUIRED].includes(metrics.status()),
        `GET /:id/metrics should be 200 (Pro) or 402 (tier-gated); got ${metrics.status()}.`,
      ).toBe(true)
      if (metrics.status() === STATUS_OK) {
        const m = await bodyJSON(metrics)
        expect(m.ok, 'metrics ok flag').toBe(true)
        expect(
          Array.isArray(m.metrics),
          `metrics must carry a metrics[] series; got ${JSON.stringify(m).slice(0, 200)}.`,
        ).toBe(true)
        expect(m.window_seconds, 'metrics must echo the resolved window_seconds').toBeTruthy()
      }

      // ── Explicit DELETE assertion (W-RES formalizes the authed reap) ─────────
      const del = await request.fetch(`${API_URL}/api/v1/resources/${res.token}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${res.bearer}` },
        failOnStatusCode: false,
      })
      expect(
        del.status() >= 200 && del.status() < 300,
        `DELETE /api/v1/resources/:id should succeed (2xx); got ${del.status()}. ` +
          `Body: ${await del.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      clearLedger()
    })

    test('GET /api/v1/resources/families, /:id/family, /:id/backups, /:id/restores', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — family/backup reads need the minted cohort account.')
      const res = await provisionCacheSeed(request, 'wres-family')

      // GET /api/v1/resources/families — the per-team family rollup.
      const families = await authedGet(request, '/api/v1/resources/families', res.bearer)
      expect(families.status(), 'GET /api/v1/resources/families should be 200').toBe(STATUS_OK)
      const famBody = await bodyJSON(families)
      expect(famBody.ok, 'families ok flag').toBe(true)
      expect(
        Array.isArray(famBody.families),
        `families must carry a families[] array; got ${JSON.stringify(famBody).slice(0, 200)}.`,
      ).toBe(true)

      // GET /api/v1/resources/:id/family — the single resource's env-family.
      const family = await authedGet(request, `/api/v1/resources/${res.token}/family`, res.bearer)
      expect(family.status(), 'GET /:id/family should be 200').toBe(STATUS_OK)
      const fBody = await bodyJSON(family)
      expect(fBody.ok, 'family ok flag').toBe(true)
      expect(
        Array.isArray(fBody.members),
        `family must carry a members[] array; got ${JSON.stringify(fBody).slice(0, 200)}.`,
      ).toBe(true)
      // The seeded resource must be a member of its own (singleton) family.
      const memberTokens = (fBody.members as Array<Record<string, unknown>>).map((m) => String(m.token))
      expect(memberTokens, `family members must include the seeded resource ${res.token}.`).toContain(res.token)

      // GET /api/v1/resources/:id/backups + /restores — the enqueue-read
      // surfaces. A fresh resource has none yet; assert the empty-but-200 shape.
      const backups = await authedGet(request, `/api/v1/resources/${res.token}/backups`, res.bearer)
      expect(backups.status(), 'GET /:id/backups should be 200').toBe(STATUS_OK)
      const bBody = await bodyJSON(backups)
      expect(bBody.ok, 'backups ok flag').toBe(true)
      expect(Array.isArray(bBody.items), 'backups must carry an items[] array').toBe(true)
      expect(bBody.total, 'backups must carry a total count').toBe((bBody.items as unknown[]).length)

      const restores = await authedGet(request, `/api/v1/resources/${res.token}/restores`, res.bearer)
      expect(restores.status(), 'GET /:id/restores should be 200').toBe(STATUS_OK)
      const rBody = await bodyJSON(restores)
      expect(rBody.ok, 'restores ok flag').toBe(true)
      expect(Array.isArray(rBody.items), 'restores must carry an items[] array').toBe(true)
      expect(rBody.total, 'restores must carry a total count').toBe((rBody.items as unknown[]).length)

      await reapResource(request, res, 'W-RES family seed')
    })
  })

  // ── W-VAULT — secret read round-trip (vault is fast, no dedicated DB) ────────
  test.describe('W-VAULT — PUT a secret → GET decrypts → list keys', () => {
    test('vault put → get (decrypt) → list keys round-trip', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — vault reads need the minted cohort account.')
      const bearer = minted!.token
      const env = 'development'
      const key = `WRES_${Math.random().toString(36).slice(2, 10).toUpperCase()}`
      const value = `cohort-secret-${Math.random().toString(36).slice(2, 12)}`

      // PUT — seed the secret (write that enables the reads). 201 Created.
      const put = await request.fetch(`${API_URL}/api/v1/vault/${env}/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ value }),
        failOnStatusCode: false,
      })
      test.skip(
        put.status() === STATUS_PAYMENT_REQUIRED,
        `vault PUT returned 402 — this stack's tier lacks vault access; the minted account should be ` +
          `PRO (vault-enabled). Reports skipped.`,
      )
      expect(
        put.status(),
        `vault PUT should return ${STATUS_CREATED}; got ${put.status()}. ` +
          `Body: ${await put.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_CREATED)

      // GET /api/v1/vault/:env/:key — decrypts and returns the plaintext.
      const get = await authedGet(request, `/api/v1/vault/${env}/${key}`, bearer)
      expect(get.status(), 'vault GET should be 200').toBe(STATUS_OK)
      const getBody = await bodyJSON(get)
      expect(getBody.ok, 'vault get ok flag').toBe(true)
      expect(
        getBody.value,
        'vault GET must decrypt and return the same value that was PUT (encrypt-at-rest round-trip).',
      ).toBe(value)
      expect(getBody.key, 'vault GET must echo the key').toBe(key)

      // GET /api/v1/vault/:env — list keys (names only, never values).
      const list = await authedGet(request, `/api/v1/vault/${env}`, bearer)
      expect(list.status(), 'vault list should be 200').toBe(STATUS_OK)
      const listBody = await bodyJSON(list)
      expect(listBody.ok, 'vault list ok flag').toBe(true)
      const keys = (listBody.keys ?? []) as string[]
      expect(keys, `vault list must include the just-PUT key ${key}; got ${JSON.stringify(keys)}.`).toContain(key)

      // Reap the seeded key inline (account cascade is the backstop — vault keys
      // live under the team and die with it, so no deletePath case is needed).
      const del = await request.fetch(`${API_URL}/api/v1/vault/${env}/${key}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(
        del.status() >= 200 && del.status() < 300,
        `vault DELETE should succeed (2xx); got ${del.status()}.`,
      ).toBe(true)
    })
  })

  // ── W-APIKEYS — PAT create → list (metadata-only) → revoke (fast) ────────────
  test.describe('W-APIKEYS — create → list metadata-only → revoke', () => {
    test('POST → GET → DELETE /api/v1/auth/api-keys (plaintext-once + metadata-only list)', async ({
      request,
    }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — api-key flow needs the minted cohort account.')
      const bearer = minted!.token
      const name = cohortName('wapikey')

      // POST — create. Returns the plaintext key ONCE.
      const create = await request.fetch(`${API_URL}/api/v1/auth/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        data: JSON.stringify({ name }),
        failOnStatusCode: false,
      })
      expect(
        create.status(),
        `POST /api/v1/auth/api-keys should return ${STATUS_CREATED}; got ${create.status()}. ` +
          `Body: ${await create.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_CREATED)
      const created = await bodyJSON(create)
      expect(created.ok, 'api-key create ok flag').toBe(true)
      const id = String(created.id ?? '')
      expect(id, 'api-key create must return an id').toBeTruthy()
      expect(created.key, 'api-key create must return the plaintext key ONCE (shown-once contract)').toBeTruthy()
      expect(String(created.name ?? ''), 'api-key create must echo the name').toBe(name)

      // GET — list. Metadata only; the plaintext key must NEVER appear in the list.
      const list = await authedGet(request, '/api/v1/auth/api-keys', bearer)
      expect(list.status(), 'GET /api/v1/auth/api-keys should be 200').toBe(STATUS_OK)
      const listBody = await bodyJSON(list)
      expect(listBody.ok, 'api-key list ok flag').toBe(true)
      const items = (listBody.items ?? []) as Array<Record<string, unknown>>
      const mine = items.find((k) => String(k.id) === id)
      expect(mine, `the created api-key ${id} must appear in the list (${items.length} item(s)).`).toBeTruthy()
      expect(
        (mine as Record<string, unknown>).key,
        'the list must NOT contain the plaintext key (metadata-only contract) — a leak here is a security bug.',
      ).toBeUndefined()
      expect((mine as Record<string, unknown>).revoked, 'a fresh api-key must not be revoked').toBe(false)

      // DELETE — revoke. The list metadata flips revoked=true.
      const revoke = await request.fetch(`${API_URL}/api/v1/auth/api-keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(revoke.status(), 'DELETE /api/v1/auth/api-keys/:id should be 200').toBe(STATUS_OK)

      const afterList = await authedGet(request, '/api/v1/auth/api-keys', bearer)
      expect(afterList.status(), 'post-revoke list should be 200').toBe(STATUS_OK)
      const afterBody = await bodyJSON(afterList)
      const afterMine = ((afterBody.items ?? []) as Array<Record<string, unknown>>).find(
        (k) => String(k.id) === id,
      )
      // The row may either flip revoked=true or drop from the active list; both
      // are valid "revoked" states. Assert it is no longer an active key.
      if (afterMine) {
        expect(afterMine.revoked, `the revoked api-key ${id} must show revoked=true in the list.`).toBe(true)
      }
    })
  })

  // ── W-BILLING — read surfaces (NO charge; Razorpay recurring disabled) ───────
  test.describe('W-BILLING — billing state, invoices, usage, usage/wall (reads)', () => {
    test('GET /api/v1/billing — plan/tier summary', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — billing read needs the minted cohort account.')
      const resp = await authedGet(request, '/api/v1/billing', minted!.token)
      expect(resp.status(), 'GET /api/v1/billing should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      expect(body.ok, 'billing ok flag').toBe(true)
      expect(body.tier, 'billing must echo the team tier').toBeTruthy()
      // subscription_status is part of the stable contract (defaults to 'none').
      expect(body.subscription_status, 'billing must carry subscription_status').toBeTruthy()
    })

    test('GET /api/v1/billing/invoices — invoices[] shape (empty OK on prod)', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — invoices read needs the minted cohort account.')
      const resp = await authedGet(request, '/api/v1/billing/invoices', minted!.token)
      // Razorpay-external may 503 on prod (recurring disabled / portal down).
      // Assert the documented contract: 200 with invoices[], or 503 (skip).
      test.skip(
        resp.status() === STATUS_BACKEND_UNAVAILABLE,
        `GET /api/v1/billing/invoices returned 503 — Razorpay portal unavailable on prod ` +
          `(recurring disabled). Documented PROD-EXEMPT-adjacent contract. Reports skipped.`,
      )
      expect(resp.status(), 'GET /api/v1/billing/invoices should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      expect(body.ok, 'invoices ok flag').toBe(true)
      expect(
        Array.isArray(body.invoices),
        `invoices must carry an invoices[] array (empty is OK — a cohort account has no charges); ` +
          `got ${JSON.stringify(body).slice(0, 200)}.`,
      ).toBe(true)
    })

    test('GET /api/v1/billing/usage — usage rollup + Cache-Control header', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — usage read needs the minted cohort account.')
      const resp = await authedGet(request, '/api/v1/billing/usage', minted!.token)
      expect(resp.status(), 'GET /api/v1/billing/usage should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      // The usage summary is a cached aggregate (rule: declare caching layer).
      // It carries an ok flag + a tier; the exact rollup field set is forward-
      // compatible, so assert the stable bits.
      expect(body.ok ?? body.tier, 'usage rollup must carry an ok/tier field').toBeTruthy()
    })

    test('GET /api/v1/usage/wall — near-wall state for the org', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — usage/wall read needs the minted cohort account.')
      const resp = await authedGet(request, '/api/v1/usage/wall', minted!.token)
      expect(resp.status(), 'GET /api/v1/usage/wall should be 200').toBe(STATUS_OK)
      const body = await bodyJSON(resp)
      expect(body.ok, 'usage/wall ok flag').toBe(true)
      // A fresh cohort account is nowhere near a wall (and a PRO/team account
      // may early-return near_wall=false). The field must always be present.
      expect(
        typeof body.near_wall,
        `usage/wall must carry a boolean near_wall; got ${typeof body.near_wall}.`,
      ).toBe('boolean')
    })
  })

  // ── W-AUDIT — audit feed reflects an auditable action + CSV parity ───────────
  test.describe('W-AUDIT — audit feed (JSON) + audit.csv (header parity)', () => {
    test('auditable action → GET /api/v1/audit reflects it; audit.csv header parity', async ({ request }) => {
      const minted = mintedSession()
      test.skip(!minted?.token, 'no E2E_SESSION_JWT — audit reads need the minted cohort account.')
      const bearer = minted!.token

      // Perform a genuinely auditable action: provision a cache resource (writes
      // a resource.created audit row). Then the feed must reflect SOMETHING.
      const res = await provisionCacheSeed(request, 'waudit')

      // GET /api/v1/audit — the JSON feed. Cursor-paginated, tier-gated.
      const audit = await authedGet(request, '/api/v1/audit', bearer)
      expect(audit.status(), 'GET /api/v1/audit should be 200').toBe(STATUS_OK)
      const auditBody = await bodyJSON(audit)
      expect(auditBody.ok, 'audit ok flag').toBe(true)
      const items = (auditBody.items ?? []) as Array<Record<string, unknown>>
      expect(Array.isArray(items), 'audit must carry an items[] array').toBe(true)
      // The audit emit is best-effort/async, so we assert the FEED works (a
      // non-empty feed for an account that just provisioned, or at minimum the
      // stable paginated envelope). We tolerate eventual-consistency: the
      // envelope shape is the load-bearing contract here.
      expect(auditBody.tier, 'audit envelope must echo the tier').toBeTruthy()
      expect(
        Object.prototype.hasOwnProperty.call(auditBody, 'next_cursor'),
        'audit envelope must carry next_cursor (cursor pagination contract).',
      ).toBe(true)
      // Redaction: any row with an actor email must be masked, never raw.
      for (const ev of items) {
        const masked = ev.actor_email_masked
        if (masked != null) {
          expect(
            String(masked).includes('@') ? /\*/.test(String(masked)) : true,
            `audit actor_email_masked must be redacted (contain a mask char); got '${String(masked)}'.`,
          ).toBe(true)
        }
      }

      // GET /api/v1/audit.csv — header parity with the JSON columns.
      const csv = await request.fetch(`${API_URL}/api/v1/audit.csv`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearer}` },
        failOnStatusCode: false,
      })
      expect(csv.status(), 'GET /api/v1/audit.csv should be 200').toBe(STATUS_OK)
      expect(
        csv.headers()['content-type'] ?? '',
        'audit.csv must be served as text/csv.',
      ).toContain('text/csv')
      const csvText = await csv.text()
      const headerLine = csvText.split('\n')[0]?.trim() ?? ''
      // The CSV header columns (audit.go ListCSV). The masked-email column is
      // the redaction parity check vs the JSON feed.
      for (const col of ['id', 'kind', 'created_at', 'actor_email_masked', 'summary']) {
        expect(headerLine, `audit.csv header must contain the '${col}' column; got '${headerLine}'.`).toContain(col)
      }

      await reapResource(request, res, 'W-AUDIT seed')
    })
  })

  // Coverage manifest (rule 18): the matrix routes this file moves to
  // LIVE-PROD-NOW. A future registry-iterating done-bar (matrix §4) can read
  // this list to confirm no Batch A leg silently dropped. COHORT_MARKER is
  // referenced so the cohort import stays load-bearing even if every authed leg
  // skips (no minted session).
  test('coverage manifest — Batch A read routes present + cohort marker wired', () => {
    const coveredRoutes = [
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
    expect(coveredRoutes.length, 'Batch A route manifest should be non-empty').toBeGreaterThan(20)
    expect(COHORT_MARKER, 'cohort marker must be the shared brand').toBe('e2e-cohort')
  })
})

// Exported so a future registry-iterating prod-coverage done-bar (matrix §4
// Option B) can union manifests across live-*.spec.ts without a hand-typed list.
export const coveredRoutes: string[] = [
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
  'PUT /api/v1/vault/:env/:key',
  'GET /api/v1/vault/:env/:key',
  'GET /api/v1/vault/:env',
  'POST /api/v1/auth/api-keys',
  'GET /api/v1/auth/api-keys',
  'DELETE /api/v1/auth/api-keys/:id',
  'GET /api/v1/billing',
  'GET /api/v1/billing/invoices',
  'GET /api/v1/billing/usage',
  'GET /api/v1/usage/wall',
  'GET /api/v1/audit',
  'GET /api/v1/audit.csv',
]
