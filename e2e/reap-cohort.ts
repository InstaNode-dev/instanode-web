// WS1-P1 — standalone cohort reaper (rule 24).
//
// Plan: docs/sessions/2026-06-04/OBSERVABILITY-AND-INTELLIGENCE-PLAN.md, WS1.
//
// Runs OUT OF the Playwright process so cleanup happens even when the test run
// crashed, timed out, or was cancelled before its afterAll could fire. The CI
// `e2e-live` job invokes this in an `if: always()` teardown step; an operator
// can also run it by hand or on a cron to mop up any cohort leftovers.
//
// What it does:
//   1. Reads the on-disk cleanup ledger (E2E_LEDGER_PATH) and deletes every
//      recorded entity, idempotently (404 == already gone).
//   2. (Backstop) — documented but intentionally NOT implemented in this PR:
//      sweeping ALL cohort-branded resources older than 1h via the admin/list
//      surface requires the backend `is_test_cohort` filter (follow-up PR). The
//      per-run ledger is the authoritative cleanup path today.
//
// Exit code: 0 if everything reaped (or already gone); 1 if any deletion
// hard-failed, so a CI teardown surfaces a leak loudly rather than silently.
//
// Invoke:
//   E2E_API_URL=https://staging-api.instanode.dev \
//   npx tsx e2e/reap-cohort.ts
// (Playwright bundles a TS runner; in CI we call it via `npx playwright ...`
//  isn't applicable — we use `npx tsx`. tsx is pulled transitively; if absent,
//  the npm script wires `node --experimental-strip-types`.)

import { request as playwrightRequest } from '@playwright/test'

// NOTE: explicit `.ts` extension — this file is the ONE entry run directly by
// Node (`node e2e/reap-cohort.ts`) in CI teardown, and Node's native TS runner
// requires explicit extensions on relative imports. tsconfig has
// `allowImportingTsExtensions: true` so tsc/Vite accept it too. The spec files
// use extensionless imports (Playwright's transpiler resolves those).
import { clearLedger, loadLedger, reapEntities, ledgerPath } from './cleanup-ledger.ts'

async function main(): Promise<number> {
  const entities = loadLedger()
  if (entities.length === 0) {
    console.log(`[reap-cohort] ledger ${ledgerPath()} empty or absent — nothing to reap.`)
    return 0
  }

  console.log(`[reap-cohort] reaping ${entities.length} ledgered cohort entit(ies)…`)
  const ctx = await playwrightRequest.newContext()
  try {
    const result = await reapEntities(ctx, entities)
    console.log(
      `[reap-cohort] attempted=${result.attempted} deleted=${result.deleted} ` +
        `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
    )
    for (const f of result.failed) {
      console.error(
        `[reap-cohort] FAILED kind=${f.entity.kind} id=${f.entity.id} ` +
          `status=${f.status} note=${f.entity.note ?? ''} err=${f.error}`,
      )
    }
    if (result.failed.length === 0) {
      clearLedger()
      console.log('[reap-cohort] all reaped — ledger cleared.')
      return 0
    }
    console.error(
      `[reap-cohort] ${result.failed.length} entit(ies) NOT reaped — ledger kept for retry.`,
    )
    return 1
  } finally {
    await ctx.dispose()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[reap-cohort] fatal:', err)
    process.exit(1)
  })
