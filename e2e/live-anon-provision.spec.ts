// WS1-P2 (matrix W2) — real-backend (LIVE) E2E covering EVERY anonymous
// resource-provision flow end-to-end against the real api.
//
// Plan: docs/sessions/2026-06-04/USER-FLOW-INVENTORY-AND-TEST-MATRIX.md
//   - §B1  "Anon provision (each service)" — tier='anonymous', env echoed.
//   - §C1.S "Provision S happy" — usable connection/URL returned per service.
//   - §W2  "Extend live-provision-smoke.spec.ts pattern to
//           vector/cache/nosql/queue/storage/webhook" (this file).
//
// db (/db/new) is already covered by live-provision-smoke.spec.ts (WS1-P1).
// This file covers the SIX remaining anonymous provision flows so all seven
// services have a real-backend, cohort-safe, reaped LIVE spec:
//
//   /vector/new  /cache/new  /nosql/new  /queue/new  /storage/new  /webhook/new
//
// It mirrors the WS1-P1 smoke spec EXACTLY (E2E_LIVE=1 gating, cohort branding,
// ledger-before-assert, inline reap + afterAll backstop + standalone reaper) so
// the safety properties proven there carry over unchanged. The only new thing
// is breadth: a single registry (PROVISION_FLOWS) drives one identical test per
// service, so adding/removing a service is a one-line table edit and a future
// route-iterating done-bar test (rule 18) can see all flows as covered without
// a hand-typed checklist.
//
// ── Gating ───────────────────────────────────────────────────────────────────
// Gated behind E2E_LIVE=1. In normal PR CI (no live backend) the whole file
// SKIPS loudly — normal CI must NEVER depend on a live backend. It runs only
// when an operator/scheduled job sets E2E_LIVE=1 + E2E_API_URL to a reachable
// (staging) api. A 503 from a per-service provisioning backend ALSO skips
// (loudly) for that service only, so a stack with (say) NATS disabled reports
// queue as skipped rather than a false red.
//
// ── Cohort safety (rule 24) ──────────────────────────────────────────────────
// Every provisioned resource is cohort-branded (cohortName) and recorded to the
// on-disk cleanup ledger the instant it is created — BEFORE any throwing
// assertion — then reaped inline on the happy path, by afterAll on a thrown
// assertion, and by the out-of-process reap-cohort.ts in CI teardown if the
// whole process dies. Anonymous resources also carry a 24h TTL, but per rule 24
// we never rely on it — we reap explicitly.
//
// Until the backend skip-cohort guards ship (separate api/worker PR), run this
// against STAGING, not prod — see cohort.ts:14-19.

import { expect, test, type APIRequestContext } from '@playwright/test'

import { cohortName, COHORT_MARKER, assertSafeApiTarget, anonProvisionHeaders } from './cohort'
import {
  recordEntity,
  loadLedger,
  reapEntities,
  clearLedger,
  type CohortEntity,
} from './cleanup-ledger'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = (process.env.E2E_API_URL ?? process.env.AGENT_API_URL ?? '')
  .toString()
  .replace(/\/$/, '')

/** HTTP 201 — every /S/new provision returns Created. */
const STATUS_CREATED = 201
/** HTTP 503 — per-service backend disabled in this stack: skip (not a red). */
const STATUS_BACKEND_UNAVAILABLE = 503

/**
 * One anonymous provision flow. `connKey` is the response field carrying the
 * usable connection/URL (webhook uses `receive_url`, everything else
 * `connection_url`). `connPattern` proves the value is a real, usable endpoint
 * for that service (a live backend really minted it). `extra` runs any
 * service-specific shape assertion (e.g. storage echoes `mode`).
 */
interface ProvisionFlow {
  /** Human label, also used in the cohort name + ledger note. */
  label: string
  /** Anon provision endpoint, e.g. `/cache/new`. */
  path: string
  /** Response field holding the usable connection string / URL. */
  connKey: 'connection_url' | 'receive_url'
  /** Regex the connection value must match (proves a usable, real endpoint). */
  connPattern: RegExp
  /** Optional extra per-service assertion on the parsed JSON body. */
  extra?: (body: Record<string, unknown>) => void
}

// The registry. The matrix's seventh service (db) is covered by
// live-provision-smoke.spec.ts; the six below complete the set. Editing this
// table is the ONLY change needed to add/remove a covered service.
const PROVISION_FLOWS: ProvisionFlow[] = [
  {
    label: 'vector',
    path: '/vector/new',
    connKey: 'connection_url',
    connPattern: /^postgres(ql)?:\/\//,
    extra: (b) =>
      expect(b.extension, 'vector provision echoes pgvector extension').toBe('pgvector'),
  },
  {
    label: 'cache',
    path: '/cache/new',
    connKey: 'connection_url',
    connPattern: /^rediss?:\/\//,
  },
  {
    label: 'nosql',
    path: '/nosql/new',
    connKey: 'connection_url',
    connPattern: /^mongodb(\+srv)?:\/\//,
  },
  {
    label: 'queue',
    path: '/queue/new',
    connKey: 'connection_url',
    connPattern: /^nats:\/\//,
    extra: (b) =>
      // auth_mode is legacy_open in prod today (CLAUDE.md P1) but the field
      // must always be present so the caller can branch on it.
      expect(b.auth_mode, 'queue provision echoes an auth_mode').toBeTruthy(),
  },
  {
    label: 'storage',
    path: '/storage/new',
    connKey: 'connection_url',
    // Bucket URL — http(s) (DO Spaces public endpoint) or s3:// form.
    connPattern: /^(https?|s3):\/\//,
    extra: (b) =>
      // /storage/new always echoes the resolved isolation mode (rule: surface
      // the tenant's real isolation). prefix-scoped on today's do-spaces prod.
      expect(b.mode, 'storage provision echoes a resolved isolation mode').toBeTruthy(),
  },
  {
    label: 'webhook',
    path: '/webhook/new',
    connKey: 'receive_url',
    connPattern: /^https?:\/\/.+\/webhook\/receive\//,
  },
]

test.describe('LIVE — every anonymous provision flow → backend-assert → reap', () => {
  test.describe.configure({ mode: 'serial' })

  // Hard skip in normal CI: the LIVE harness must never make the per-PR gate
  // depend on a reachable backend.
  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend anon-provision suite is opt-in. Set E2E_LIVE=1 + ' +
      'E2E_API_URL=<staging api> to run it.',
  )
  test.skip(
    LIVE && !API_URL,
    'E2E_LIVE=1 but E2E_API_URL/AGENT_API_URL is unset — no backend to target.',
  )

  // Prod-target safety (item 3): refuse an un-sanctioned prod target; allow it
  // only for a minted-account run (E2E_ACCOUNT_TOKEN/E2E_SESSION_JWT present).
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  // Backstop reaper (rule 24): even if a per-service test throws before its
  // inline reap, afterAll reaps every still-ledgered entity. The standalone
  // reap-cohort.ts re-runs this same path in CI teardown if the whole process
  // dies — belt, braces, and a 24h TTL we never rely on.
  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[anon-provision afterAll] reaped attempted=${result.attempted} ` +
          `deleted=${result.deleted} alreadyGone=${result.alreadyGone} ` +
          `failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  for (const flow of PROVISION_FLOWS) {
    test(`provision anon ${flow.label} (${flow.path}), assert usable + tier+env, then reap`, async ({
      request,
    }: {
      request: APIRequestContext
    }) => {
      const name = cohortName(`anon-${flow.label}`)

      // ── Create: real anonymous provision against the live api ──────────────
      // anonProvisionHeaders() adds the X-E2E-Test-Token fingerprint-bypass when
      // E2E_TEST_TOKEN is set (the only thing that gets past prod's per-
      // fingerprint recycle gate, which ignores X-Forwarded-For) plus a unique
      // XFF for staging/local. A cohort name is always sent: /vector & /db
      // REQUIRE a name (CLAUDE.md) and it is harmless (cohort-tagging) on the rest.
      const resp = await request.fetch(`${API_URL}${flow.path}`, {
        method: 'POST',
        headers: anonProvisionHeaders(),
        data: JSON.stringify({ name }),
        failOnStatusCode: false,
      })

      test.skip(
        resp.status() === STATUS_BACKEND_UNAVAILABLE,
        `${flow.label} service returned 503 at ${API_URL} — provisioning backend not ` +
          `enabled in this stack; cannot create a resource to reap. Reports skipped.`,
      )

      expect(
        resp.status(),
        `POST ${flow.path} should return ${STATUS_CREATED}; got ${resp.status()}. ` +
          `Body: ${await resp.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_CREATED)

      const body = (await resp.json()) as Record<string, unknown>
      const token = String(body.token ?? '')

      // ── Record to the ledger IMMEDIATELY, before any throwing assertion, so a
      //    failed assert below still leaves a reapable record (rule 24). ───────
      const entity: Omit<CohortEntity, 'recordedAt'> = {
        kind: 'resource',
        id: token,
        apiUrl: API_URL,
        note: `${flow.label} ${name}`,
      }
      recordEntity(entity)
      // Storage objects are tenant-prefix-scoped under the owning resource; log
      // the prefix entry so the reaper report shows the bucket prefix is reaped
      // via its owning resource (deletePath() no-ops on this kind).
      if (flow.label === 'storage') {
        recordEntity({
          kind: 'storage-prefix',
          id: token,
          apiUrl: API_URL,
          note: `storage prefix for ${name}`,
        })
      }

      // ── Backend assertions: a real, usable resource was created. ───────────
      expect(body.ok, `${flow.label}/new ok flag`).toBe(true)
      expect(token, `${flow.path} must return a resource token`).toBeTruthy()
      expect(body.id, `${flow.path} must return a resource id`).toBeTruthy()
      expect(body.tier, `anon ${flow.label} provision is tier=anonymous`).toBe('anonymous')
      // env is echoed on every provision (rule 11 — default 'development').
      expect(body.env, `${flow.path} must echo the resolved env (rule 11)`).toBeTruthy()
      // The usable connection/URL — proves a real backend minted a live endpoint.
      const conn = String(body[flow.connKey] ?? '')
      expect(
        conn,
        `${flow.path} must return a usable ${flow.connKey} matching ${flow.connPattern} ` +
          `(proves a real ${flow.label} endpoint was provisioned); got '${conn}'`,
      ).toMatch(flow.connPattern)
      // Cohort branding round-trips through the backend — confirms the marker
      // the future skip-cohort guards key on actually lands on the row's name.
      expect(
        body.name,
        `provisioned name must carry the cohort marker '${COHORT_MARKER}' so backend ` +
          `guards can identify it; got '${String(body.name)}'`,
      ).toContain(COHORT_MARKER)
      // Per-service extra shape assertion (mode / extension / auth_mode / …).
      flow.extra?.(body)

      // ── Reap inline (happy path). afterAll + reap-cohort.ts are the backstops
      //    if this is skipped by a thrown assertion above. ────────────────────
      const result = await reapEntities(request, [
        { ...entity, recordedAt: new Date().toISOString() },
      ])
      expect(
        result.failed.length,
        `reaping the provisioned ${flow.label} resource failed: ${JSON.stringify(result.failed)}`,
      ).toBe(0)
      expect(
        result.deleted + result.alreadyGone,
        `the ${flow.label} resource should be deleted (or already gone) after reap`,
      ).toBeGreaterThan(0)

      // Clear the ledger so afterAll doesn't re-try a now-deleted token (a no-op
      // 404, but keeps the ledger truthful between serial tests in this file).
      clearLedger()
    })
  }
})
