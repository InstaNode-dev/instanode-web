// WS1-P1 — cleanup ledger + reaper fixture for real-backend (LIVE) E2E.
//
// Plan: docs/sessions/2026-06-04/OBSERVABILITY-AND-INTELLIGENCE-PLAN.md, WS1.
// Enforces rule 24: a test run NEVER leaks a provisioned (and billable) DO
// resource. Every entity a LIVE spec creates is recorded here; an afterEach +
// afterAll reaps them, and a standalone `reap-cohort.ts` re-runs the same
// deletion in CI teardown so cleanup happens even when the test process dies.
//
// Design notes:
//   - The ledger is persisted to disk (E2E_LEDGER_PATH, default
//     e2e/.cleanup-ledger.json) so the OUT-OF-PROCESS reaper can read it after
//     a crash/timeout that skipped the in-process afterAll.
//   - Each entry carries enough to delete it WITHOUT the page: the api base
//     URL, the auth token (if any), the entity kind, and its id/token.
//   - Deletion is best-effort + idempotent: a 404 (already gone) is success;
//     other failures are collected and reported but do not throw past the
//     reaper, so one stuck entity can't strand the rest.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

import type { APIRequestContext } from '@playwright/test'

export type CohortEntityKind =
  | 'resource'
  | 'deployment'
  | 'team'
  | 'storage-prefix'
  // A SECONDARY ephemeral cohort account minted via POST /internal/e2e/account
  // (Batch B W-TEAM member-mgmt isolation). It is NOT reapable by a team-scoped
  // bearer DELETE — there is no DELETE /api/v1/team/:id route, and DELETE
  // /api/v1/team would purge the SECONDARY's own team only via its own bearer.
  // The canonical reap is the guarded internal cascade DELETE
  // /internal/e2e/account/:team_id with the mint token (E2E_ACCOUNT_TOKEN), the
  // SAME path the workflow teardown uses for the primary account. So this kind
  // gets a dedicated reap path that uses the token header, not a Bearer.
  | 'e2e-account'

// The header the api's internal e2e mint/reap surface honours
// (internal_e2e_account.go e2eAccountTokenHeader). Named const per the
// no-hardcoded-strings rule.
export const E2E_ACCOUNT_TOKEN_HEADER = 'X-E2E-Token'

export interface CohortEntity {
  /** What to delete. */
  kind: CohortEntityKind
  /** The id/token used to address the DELETE (resource token, deploy id, etc.). */
  id: string
  /** Absolute api base URL the entity lives on (e.g. https://staging-api...). */
  apiUrl: string
  /** Bearer token authorizing the DELETE, when the entity is team-scoped. */
  token?: string
  /** Free-form, for the reaper log + post-mortem (e.g. resource_type, name). */
  note?: string
  /** When it was recorded (ISO) — lets the reaper age-out backstop sweeps. */
  recordedAt: string
}

export interface ReapResult {
  attempted: number
  deleted: number
  alreadyGone: number
  failed: Array<{ entity: CohortEntity; status: number; error: string }>
}

const DEFAULT_LEDGER_PATH = 'e2e/.cleanup-ledger.json'

export function ledgerPath(): string {
  return process.env.E2E_LEDGER_PATH || DEFAULT_LEDGER_PATH
}

function readLedger(path: string): CohortEntity[] {
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CohortEntity[]) : []
  } catch {
    // Corrupt/partial ledger: treat as empty rather than crash the reaper.
    return []
  }
}

function writeLedger(path: string, entities: CohortEntity[]): void {
  const dir = dirname(path)
  if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(entities, null, 2), 'utf8')
}

/**
 * Append an entity to the on-disk ledger. Called the instant a LIVE spec
 * creates something, BEFORE any assertion that might throw — so a failed
 * assertion still leaves a reapable record (rule 24).
 */
export function recordEntity(entity: Omit<CohortEntity, 'recordedAt'>): void {
  const path = ledgerPath()
  const current = readLedger(path)
  current.push({ ...entity, recordedAt: new Date().toISOString() })
  writeLedger(path, current)
}

export function loadLedger(): CohortEntity[] {
  return readLedger(ledgerPath())
}

/** Wipe the ledger file (called after a clean reap so the next run starts fresh). */
export function clearLedger(): void {
  const path = ledgerPath()
  if (existsSync(path)) rmSync(path)
}

function deletePath(entity: CohortEntity): string {
  switch (entity.kind) {
    case 'resource':
      return `/api/v1/resources/${entity.id}`
    case 'deployment':
      return `/api/v1/deployments/${entity.id}`
    case 'team':
      return `/api/v1/team/${entity.id}`
    case 'e2e-account':
      // Reaped via the guarded internal cascade (see kind doc above). The path
      // carries the team_id; reapEntities sends the mint-token header instead of
      // a Bearer for this kind.
      return `/internal/e2e/account/${entity.id}`
    case 'storage-prefix':
      // Storage objects are tenant-prefix-scoped; deleting the owning resource
      // (recorded separately as kind:'resource') reaps the bucket prefix. This
      // entry exists for the reaper LOG only and is skipped in deletion.
      return ''
  }
}

/**
 * Delete every entity in `entities` against its recorded api base. Idempotent:
 * a 404/410 counts as alreadyGone (success). Never throws — failures are
 * collected so one stuck entity can't strand the rest. The OUT-OF-PROCESS
 * reaper and the in-process afterAll both call this.
 */
export async function reapEntities(
  request: APIRequestContext,
  entities: CohortEntity[],
): Promise<ReapResult> {
  const result: ReapResult = { attempted: 0, deleted: 0, alreadyGone: 0, failed: [] }
  for (const entity of entities) {
    const path = deletePath(entity)
    if (!path) continue // storage-prefix marker: reaped via its owning resource
    result.attempted++
    const headers: Record<string, string> = {}
    if (entity.kind === 'e2e-account') {
      // The guarded internal cascade is authorized by the mint-token HEADER, not
      // a Bearer. Pull it from the env (the workflow exports E2E_ACCOUNT_TOKEN).
      // When absent, the inline reapSecondaryAccount already deleted it; a
      // header-less DELETE here returns 404 (inert-by-default), counted as
      // alreadyGone below — never a leak signal.
      const mintToken = process.env.E2E_ACCOUNT_TOKEN
      if (mintToken) headers[E2E_ACCOUNT_TOKEN_HEADER] = mintToken
    } else if (entity.token) {
      headers.Authorization = `Bearer ${entity.token}`
    }
    try {
      const resp = await request.fetch(`${entity.apiUrl.replace(/\/$/, '')}${path}`, {
        method: 'DELETE',
        headers,
        failOnStatusCode: false,
      })
      const status = resp.status()
      const bodyText = status >= 200 && status < 300 ? '' : await resp.text().catch(() => '<unreadable>')
      if (status === 404 || status === 410) {
        result.alreadyGone++
      } else if (status >= 200 && status < 300) {
        result.deleted++
      } else if (status === 409 && bodyText.includes('deletion_already_pending')) {
        // A deletion is ALREADY in flight for this entity (the test's own DELETE
        // step started the soft-delete/email flow; the reap's second DELETE races
        // it). The resource is being torn down — not a leak. Count as alreadyGone.
        result.alreadyGone++
      } else if (status === 503 && bodyText.includes('team_lookup_failed')) {
        // The owning team no longer exists — the workflow already reaped the
        // minted account (DELETE /internal/e2e/account) before this ledger sweep,
        // cascading away every resource it owned. The DELETE can't resolve the
        // team, but the entity is gone with the account. Not a leak.
        result.alreadyGone++
      } else {
        result.failed.push({
          entity,
          status,
          error: bodyText,
        })
      }
    } catch (e) {
      result.failed.push({ entity, status: 0, error: String((e as Error)?.message ?? e) })
    }
  }
  return result
}
