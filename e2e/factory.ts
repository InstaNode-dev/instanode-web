// e2e/factory.ts — Wave 3 multi-tier test-user FACTORY (TS wrapper).
//
// Design ref: docs/ci/01-CI-INTEGRATION-DESIGN.md (Wave 3) + the live api
// endpoint POST/DELETE /internal/e2e/account (api/internal/handlers/
// internal_e2e_account.go, shipped 61afc5b). This module is the thin TS
// wrapper the real-backend UI journey specs (live-ui-*.spec.ts) use to mint a
// cohort-tagged, is_test_cohort=true account at ANY non-team tier, optionally
// pre-seeded, drive the ACTUAL dashboard against it, then reap — never leaking
// a billable resource (CLAUDE.md rule 24).
//
// Why a wrapper (not inline curls in every spec): the journeys mint at several
// tiers (pro for headroom, hobby at the deployments_apps cap, free for the
// 402-gate, a SECONDARY account as a team invitee). Centralising the mint/reap
// + ledger registration here keeps every spec's safety machinery identical and
// keeps the cohort contract (the X-E2E-Token header, the team-cascade reap) in
// ONE place that the ledger reaper already understands (kind 'e2e-account').
//
// Gating (mirrors the existing live specs): the factory is INERT unless the
// e2e mint token is configured. The endpoint is also inert-by-default on the
// api (404 when the token is wrong / unarmed). A caller with no token gets a
// null/skip signal rather than a hard failure, so a fork/secret-less PR run
// SKIPS cleanly instead of redding (the e2e-prod workflow exports the token).

import type { APIRequestContext } from '@playwright/test'

import { COHORT_MARKER } from './cohort'
import { recordEntity, E2E_ACCOUNT_TOKEN_HEADER } from './cleanup-ledger'

// ── Config / env ─────────────────────────────────────────────────────────────

/**
 * The mint-guard secret. The e2e-prod workflow exports it into the test step
 * env (E2E_ACCOUNT_TOKEN). Empty on a local / fork / secret-less run → the
 * factory is inert (mintUser returns null; specs SKIP loudly). Read lazily via
 * a getter so a test can set process.env before the first call.
 */
export function accountToken(): string {
  return process.env.E2E_ACCOUNT_TOKEN ?? ''
}

/** True when the factory can mint (the guard token is configured). */
export function factoryArmed(): boolean {
  return accountToken().length > 0
}

/** Resolve the api base the factory mints against (absolute, trailing-slash-stripped). */
export function apiBase(): string {
  return (process.env.E2E_API_URL ?? process.env.AGENT_API_URL ?? '').toString().replace(/\/$/, '')
}

// The closed set the api accepts (internal_e2e_account.go e2eAllowedTiers).
// team + growth are deliberately ABSENT — the api 400s them
// (project_team_plan_not_rolled_out). Mirrored here so a typo'd tier fails in
// TS before a wasted round-trip, and so a spec can't ask for a gated tier.
export const MINTABLE_TIERS = ['anonymous', 'free', 'hobby', 'hobby_plus', 'pro'] as const
export type MintableTier = (typeof MINTABLE_TIERS)[number]

// The deploy-cap journey (#4) needs a tier whose deployments_apps limit is
// exactly 1 so deploy #1 fills it and deploy #2 hits the 402 wall. plans.yaml:
// hobby=1, hobby_plus=2. hobby is the canonical "one deploy slot" tier.
export const DEPLOY_CAP_TIER: MintableTier = 'hobby'

// ── The minted account shape ─────────────────────────────────────────────────

/** A minted cohort account + everything a spec needs to drive + reap it. */
export interface MintedUser {
  teamID: string
  userID: string
  email: string
  tier: string
  /** The session JWT the browser sets as localStorage['instanode.token']. */
  sessionJWT: string
  /** Pre-seeded resource tokens (empty unless mintUserWithResources was used). */
  seededTokens: string[]
}

interface MintResponseBody {
  team_id: string
  user_id: string
  email: string
  tier: string
  session_jwt: string
  seeded_tokens?: string[]
  seeded_count?: number
}

// ── Mint ─────────────────────────────────────────────────────────────────────

interface MintOpts {
  tier?: MintableTier
  withResources?: boolean
}

/**
 * Mint a cohort account at the given tier (default `free`). Registers it with
 * the cleanup ledger as kind 'e2e-account' BEFORE returning, so the afterAll
 * backstop + the out-of-process reaper (npm run reap:live) cascade-delete it
 * even if the spec throws between mint and inline reap (rule 24).
 *
 * Returns null when the factory is unarmed (no mint token) OR the endpoint is
 * inert (404 — wrong token / not deployed). Callers test.skip on null.
 */
export async function mintUser(
  request: APIRequestContext,
  opts: MintOpts = {},
): Promise<MintedUser | null> {
  if (!factoryArmed()) return null
  const base = apiBase()
  if (!base) return null
  const tier = opts.tier ?? 'free'
  const resp = await request.fetch(`${base}/internal/e2e/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [E2E_ACCOUNT_TOKEN_HEADER]: accountToken() },
    data: JSON.stringify({ tier, with_resources: !!opts.withResources }),
    failOnStatusCode: false,
  })
  // Inert-by-default 404: the token is wrong or the endpoint isn't armed on
  // this stack. Treat as "can't mint" → null (caller SKIPS), never a red.
  if (resp.status() === 404) return null
  if (resp.status() !== 200) {
    const text = await resp.text().catch(() => '<unreadable>')
    throw new Error(
      `factory.mintUser(tier=${tier}) expected 200 from POST /internal/e2e/account; got ` +
        `${resp.status()}. Body: ${text}`,
    )
  }
  const body = (await resp.json()) as MintResponseBody
  // Record the account for cascade reap the instant it exists (rule 24). The
  // 'e2e-account' kind reaps via DELETE /internal/e2e/account/:team_id using
  // the mint-token header (cleanup-ledger.ts handles that path).
  recordEntity({
    kind: 'e2e-account',
    id: body.team_id,
    apiUrl: base,
    note: `factory ${tier} account ${body.email}`,
  })
  return {
    teamID: body.team_id,
    userID: body.user_id,
    email: body.email,
    tier: body.tier,
    sessionJWT: body.session_jwt,
    seededTokens: body.seeded_tokens ?? [],
  }
}

/** Mint a pre-seeded account (one fast row per seed type). See mintUser. */
export function mintUserWithResources(
  request: APIRequestContext,
  opts: Omit<MintOpts, 'withResources'> = {},
): Promise<MintedUser | null> {
  return mintUser(request, { ...opts, withResources: true })
}

/**
 * Mint at the deployments_apps cap: a hobby account (deployments_apps=1). The
 * delete-when-exhausted→replace journey (#4) fills the single slot, asserts the
 * 402 wall in the UI, deletes deploy #1, then ships the replacement into the
 * freed slot.
 */
export function mintAtDeployCap(request: APIRequestContext): Promise<MintedUser | null> {
  return mintUser(request, { tier: DEPLOY_CAP_TIER })
}

// ── Reap ─────────────────────────────────────────────────────────────────────

/**
 * Eagerly reap a minted account out-of-band via the guarded internal cascade
 * (DELETE /internal/e2e/account/:team_id, mint-token-header authorized) — the
 * SAME path the e2e-prod workflow teardown + the ledger reaper use. Idempotent:
 * a 200/202/204/404/410 all count as success. The ledger 'e2e-account' entry is
 * the backstop, so a spec calls this for promptness but never depends on it.
 */
export async function reap(request: APIRequestContext, teamID: string): Promise<void> {
  if (!factoryArmed() || !teamID) return
  const base = apiBase()
  if (!base) return
  const resp = await request.fetch(`${base}/internal/e2e/account/${teamID}`, {
    method: 'DELETE',
    headers: { [E2E_ACCOUNT_TOKEN_HEADER]: accountToken() },
    failOnStatusCode: false,
  })
  const ok = [200, 202, 204, 404, 410].includes(resp.status())
  if (!ok) {
    const text = await resp.text().catch(() => '<unreadable>')
    throw new Error(
      `factory.reap(${teamID}) expected 2xx/404/410 from the cascade DELETE; got ` +
        `${resp.status()}. Body: ${text} — possible leak, investigate.`,
    )
  }
}

// COHORT_MARKER is re-exported so a spec importing only the factory still has
// the shared brand on hand for cohort-name assertions without a second import.
export { COHORT_MARKER }
