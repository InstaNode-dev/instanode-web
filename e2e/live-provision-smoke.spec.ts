// WS1-P1 — real-backend SMOKE spec proving the LIVE safety harness works
// end-to-end (cohort identity → create → backend-assert → ledger → reap).
//
// Plan: docs/sessions/2026-06-04/OBSERVABILITY-AND-INTELLIGENCE-PLAN.md, WS1
// (flow U4: provision db). This is NOT yet a full UI journey — WS1-P3 layers
// the dashboard-driven version on top. WS1-P1's job is to prove the SCAFFOLDING
// is safe: a real resource is created against E2E_API_URL, its existence is
// asserted from the backend, it's recorded to the cleanup ledger BEFORE any
// throwing assertion, and it's reaped in afterAll AND by the standalone
// reaper (rule 24 — never leak a billable resource).
//
// ── Gating ───────────────────────────────────────────────────────────────
// Gated behind E2E_LIVE=1. In normal PR CI (no live backend) the whole file
// SKIPS loudly — normal CI must NEVER depend on a live backend. It runs only
// when an operator/scheduled job sets E2E_LIVE=1 + E2E_API_URL to a reachable
// (staging) api. A 503 from the provisioning backend ALSO skips (loudly), so a
// stack without the db backend enabled reports skipped, not a false red.
//
// ── Cohort safety ──────────────────────────────────────────────────────────
// The provisioned resource is cohort-branded (cohortName) so the FUTURE
// backend skip-cohort guards (separate api/worker PR) can no-op quota/churn/
// billing for it. Until those guards ship, run this against STAGING, not prod.

import { expect, test, type APIRequestContext } from '@playwright/test'

import { cohortName, COHORT_MARKER, assertSafeApiTarget, provisionIdentity } from './cohort'
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

interface DbProvision {
  ok: boolean
  id: string
  token: string
  name: string
  connection_url: string
  tier: string
}

test.describe('LIVE smoke — anonymous provision → backend-assert → reap', () => {
  test.describe.configure({ mode: 'serial' })

  // Hard skip in normal CI: LIVE harness must never make the per-PR gate
  // depend on a reachable backend.
  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend smoke is opt-in. Set E2E_LIVE=1 + ' +
      'E2E_API_URL=<staging api> to run it.',
  )
  test.skip(
    LIVE && !API_URL,
    'E2E_LIVE=1 but E2E_API_URL/AGENT_API_URL is unset — no backend to target.',
  )

  // Prod-target safety (item 3): refuse an un-sanctioned prod target; allow it
  // only for a minted-account run (E2E_ACCOUNT_TOKEN/E2E_SESSION_JWT present).
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  // Backstop reaper: even if the in-test cleanup below throws, afterAll reaps
  // every ledgered entity. The standalone reap-cohort.ts re-runs this same
  // path in CI teardown if the whole process dies (rule 24, belt-and-braces).
  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-smoke afterAll] reaped attempted=${result.attempted} ` +
          `deleted=${result.deleted} alreadyGone=${result.alreadyGone} ` +
          `failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  test('provision anon postgres, assert it exists on the backend, then reap', async ({
    request,
  }: {
    request: APIRequestContext
  }) => {
    const name = cohortName('smoke-db')

    // ── Create: real Postgres against the live api ────────────────────────
    // forceAnon: the AUTHED (pro) /db/new path provisions a DEDICATED database
    // for the team, which on prod takes longer than the 90s test timeout (the
    // anon path uses the fast hot-pool). The smoke spec's job is to prove the
    // harness (create → backend-assert → ledger → reap) end-to-end, which the
    // anon path does cleanly: the X-E2E-Test-Token + X-E2E-Source-IP fingerprint
    // bypass gets past the recycle gate (fresh fingerprint per call), and the
    // anon resource is TTL-reaped (no authed DELETE for anon resources — the
    // reap below is best-effort for the no-bearer case). The authed/minted-account
    // (and authed-reap) coverage lives in live-anon-provision.spec.ts via the
    // fast, no-dedicated-DB services (cache/storage/webhook); the dedicated-DB
    // services (db/vector/nosql) all use the fast anon hot-pool there too.
    // /db/new REQUIRES a name (CLAUDE.md) — sent below.
    const id = provisionIdentity({}, /* forceAnon */ true)
    const resp = await request.fetch(`${API_URL}/db/new`, {
      method: 'POST',
      headers: id.headers,
      data: JSON.stringify({ name }),
      failOnStatusCode: false,
    })

    test.skip(
      resp.status() === 503,
      `db service returned 503 at ${API_URL} — provisioning backend not enabled ` +
        `in this stack; harness cannot create a resource to reap. Reports skipped.`,
    )

    expect(
      resp.status(),
      `POST /db/new should return 201; got ${resp.status()}. ` +
        `Body: ${await resp.text().catch(() => '<unreadable>')}`,
    ).toBe(201)

    const db = (await resp.json()) as DbProvision

    // ── Record to the ledger IMMEDIATELY, before any throwing assertion, so a
    //    failed assert below still leaves a reapable record (rule 24). ──────
    const entity: Omit<CohortEntity, 'recordedAt'> = {
      kind: 'resource',
      id: db.token,
      apiUrl: API_URL,
      // Record the provision bearer (minted pro session on prod) so the reaper's
      // authed DELETE /api/v1/resources/:id is authorized → 200, not 401. On the
      // anon path this is undefined and the resource is TTL/staging-reaped.
      token: id.bearer,
      note: `postgres ${name}`,
    }
    recordEntity(entity)

    // ── Backend assertion: the resource really exists. ────────────────────
    expect(db.ok, 'db/new ok flag').toBe(true)
    expect(db.token, 'db/new must return a resource token').toBeTruthy()
    expect(db.id, 'db/new must return a resource id').toBeTruthy()
    // Tier reflects the provision identity: 'pro' when provisioned as the minted
    // account (sanctioned prod run), 'anonymous' on the anon path (staging/local).
    expect(db.tier, `provision tier should be '${id.expectTier}'`).toBe(id.expectTier)
    expect(
      db.connection_url,
      'db/new must return a usable postgres connection_url (proves a real DB was created)',
    ).toMatch(/^postgres(ql)?:\/\//)
    // Cohort branding round-trips through the backend — confirms the marker the
    // future skip-cohort guards key on actually lands on the row's name.
    expect(
      db.name,
      `provisioned name must carry the cohort marker '${COHORT_MARKER}' so backend ` +
        `guards can identify it; got '${db.name}'`,
    ).toContain(COHORT_MARKER)

    // ── Reap inline (the happy path). afterAll + reap-cohort.ts are the
    //    backstops if this is skipped by a failure above. ──────────────────
    const result = await reapEntities(request, [{ ...entity, recordedAt: new Date().toISOString() }])
    if (id.bearer) {
      // Authed resource: the reaper's DELETE is authorized → must succeed.
      expect(
        result.failed.length,
        `reaping the provisioned resource failed: ${JSON.stringify(result.failed)}`,
      ).toBe(0)
      expect(
        result.deleted + result.alreadyGone,
        'the resource should be deleted (or already gone) after reap',
      ).toBeGreaterThan(0)
    } else {
      // Anonymous resource (no bearer): no unauthed resource-delete exists, so
      // the authed DELETE 401s by design. The resource carries a 24h TTL and is
      // TTL-reaped — not a leak. Assert ONLY the expected 401/403 so a different
      // failure (e.g. 500) still reds.
      const onlyAuthFailures = result.failed.every((f) => f.status === 401 || f.status === 403)
      expect(
        onlyAuthFailures,
        `anonymous db reap should only ever fail with 401/403 (no unauthed delete exists; ` +
          `the resource is TTL-reaped). Got: ${JSON.stringify(result.failed)}`,
      ).toBe(true)
    }

    // Clean inline-reaped entity out of the ledger so afterAll doesn't re-try
    // a now-deleted token (a no-op 404, but keeps the ledger truthful).
    clearLedger()
  })
})

// Covered-route manifest (rule 18), defined in the playwright-free sibling so the
// vitest prod-coverage done-bar guard can union it without the @playwright/test
// runtime (matrix §1.B — POST /db/new).
export { coveredRoutes } from './live-provision-smoke.coverage'
