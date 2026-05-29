// useDashboardCtx — single source of truth for the dashboard's "ambient
// state": the signed-in user, their team, the active env, and the live
// resource/vault counts shown in the sidebar.
//
// Env scope — IMPORTANT:
//   The backend does NOT yet honor a multi-env filter on resources/stacks.
//   The only surface where `env` is genuinely backed by per-env data is
//   VaultPage (vault_secrets.env is real). Everywhere else, `env` is a
//   cosmetic display value snapshotted at provision time and surfacing
//   filter chips would imply a backend capability that doesn't exist yet
//   (env promotion is the §10.17 Pro-tier feature still in development).
//
//   Keep `env` / `envs` / `setEnv` / `addEnv` here for VaultPage and for
//   the sidebar's vault subtitle. Do NOT add new env-filter call sites
//   without also wiring a real server-side filter behind them.

import { useEffect, useSyncExternalStore } from 'react'
import * as api from '../api'
import { registerLogoutHook } from '../api'
import type { AuthMeResponse, BillingDetails, Resource } from '../api'

const ENV_KEY = 'instanode.env'

export type DashboardCtx = {
  me: AuthMeResponse | null
  meErr: string | null
  meLoading: boolean
  env: string
  envs: string[]                // dynamically populated from resource list
  counts: { resources: number; deployments: number; vault: number; team: number }
  /** All resources across envs — minimal shape used for layout-level
   *  signals like the expiry-warning banner. Filtered views still
   *  re-fetch on the page itself. */
  resources: Resource[]
  /** Billing snapshot for the sidebar upgrade card. `null` while loading or
   *  if `/billing` is unreachable — chrome must render a skeleton, not
   *  fabricate numbers. */
  billing: BillingDetails | null
  billingLoading: boolean
}

// state is populated from initialState at module load; resetBootstrap()
// restores it to initialState on logout (D08 fix).
let state: DashboardCtx = {
  me: null,
  meErr: null,
  meLoading: true,
  env: typeof window !== 'undefined' ? (localStorage.getItem(ENV_KEY) ?? 'production') : 'production',
  envs: ['production', 'staging', 'development'],
  counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
  resources: [],
  billing: null,
  billingLoading: true,
}
// Note: initialState is defined AFTER the first `state` declaration because
// it needs the same env expression. TypeScript module evaluation is top-to-
// bottom, so the two initialisers are order-dependent. The ordering is:
//   1. state = { ...literal with meLoading:true for the initial app mount }
//   2. initialState = { ...same literal but meLoading:false for post-logout }
// This asymmetry is intentional: the first mount shows a loading spinner;
// the post-logout state does not (the user has navigated to /login and the
// /app/* subtree is not mounted).

const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function snapshot(): DashboardCtx {
  return state
}

export function setEnv(next: string) {
  if (next === state.env) return
  state = { ...state, env: next }
  if (typeof window !== 'undefined') {
    localStorage.setItem(ENV_KEY, next)
    window.dispatchEvent(new CustomEvent('instanode:env-changed', { detail: next }))
  }
  emit()
  // Re-fetch counts for the new env.
  refreshCounts()
}

// BUG-DASH-001 (P0) + BUG-DASH-002:
//
//   Pre-fix this function accepted env names of arbitrary length and
//   stripped characters silently, then persisted the result to
//   localStorage. A 67-char paste → every subsequent /api/v1/* call
//   carried `?env=<67-char-name>` → vault 400 invalid_env, resources
//   200 with empty list, no UI affordance to delete the bad value
//   (user had to clear localStorage from devtools).
//
//   The api regex is `^[a-z0-9-]{1,32}$` (see api/internal/handlers/env.go
//   + the `invalid_env` 400 branch). Underscores are NOT part of the
//   api regex; the pre-fix JS regex `[^a-z0-9_-]` permitted them,
//   producing names that the api would later reject — a different
//   class of the same "client says yes, server says no" gap.
//
//   Fix: align the JS regex with the api regex, enforce the 32-char
//   cap up front, and return early if validation fails. The caller
//   (EnvSwitcher) already gates `addEnv` behind a non-empty draft so
//   no UI plumbing changes are required.
const ENV_REGEX = /^[a-z0-9-]{1,32}$/
const ENV_MAX_LEN = 32

export function addEnv(name: string) {
  // Lowercase + strip api-invalid chars; underscores no longer survive
  // (BUG-DASH-002). Clip to the api cap of 32 chars (BUG-DASH-001).
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, ENV_MAX_LEN)
  // Final regex gate: empty / leading-dash-only / any drift from the
  // api regex → bail out without persisting. setEnv is NOT called, so
  // the live env stays on the previous valid value (no broken state).
  if (!ENV_REGEX.test(clean)) return
  if (!state.envs.includes(clean)) {
    state = { ...state, envs: [...state.envs, clean] }
    emit()
  }
  setEnv(clean)
}

// refreshMe resolves to `true` only when the identity fetch succeeded.
// ensureBootstrap uses that to decide whether to fire the dependent
// counts/billing fetches — see the L-01 note there.
async function refreshMe(): Promise<boolean> {
  state = { ...state, meLoading: true, meErr: null }
  emit()
  try {
    const me = await api.fetchMe()
    state = { ...state, me, meLoading: false }
    emit()
    return true
  } catch (e: any) {
    state = { ...state, me: null, meErr: e?.message ?? 'auth failed', meLoading: false }
    emit()
    return false
  }
}

async function refreshCounts() {
  try {
    // Deployments live in their own table (GET /api/v1/deployments) — they
    // are NOT rows in the `resources` list (resource_type === 'deploy' never
    // appears there), so the sidebar deployments count must be sourced from
    // api.listDeployments(), not a filter over `resources`.
    const [r, v, d] = await Promise.all([
      api.listResources().catch(() => ({ items: [], total: 0 })),
      api.listVault(state.env).catch(() => ({ entries: [] })),
      api.listDeployments(state.env).catch(() => ({ ok: true as const, items: [], total: 0 })),
    ])
    // Merge envs from resources too — surfaces real env names.
    const fromAPI = new Set(state.envs)
    for (const it of (r as any).items ?? []) if (it.env) fromAPI.add(it.env)
    const envs = Array.from(fromAPI)

    const items = ((r as any).items ?? []) as Resource[]
    const filtered = items.filter((x) => (x.env ?? 'production') === state.env)
    state = {
      ...state,
      envs,
      resources: items,
      counts: {
        resources: filtered.length,
        deployments: ((d as any).items ?? []).length,
        vault: ((v as any).entries ?? []).length,
        team: 1, // no /team/members endpoint; placeholder
      },
    }
    emit()
  } catch {
    /* ignore — counts are non-critical */
  }
}

async function refreshBilling() {
  // Billing fetch failures are non-fatal — the sidebar upgrade card renders
  // a skeleton or hides itself rather than spilling fake numbers. Keep the
  // loading flag so consumers can distinguish "still fetching" from "fetch
  // returned null".
  state = { ...state, billingLoading: true }
  emit()
  try {
    const r = await api.fetchBilling()
    state = { ...state, billing: r.billing, billingLoading: false }
    emit()
  } catch {
    state = { ...state, billing: null, billingLoading: false }
    emit()
  }
}

let bootstrapped = false

// initialState is the zero-value DashboardCtx — factored out so resetBootstrap
// can restore it without duplicating the literal.
const initialState: DashboardCtx = {
  me: null,
  meErr: null,
  meLoading: false, // false on reset so consumers don't show a spinner before re-login
  env: typeof window !== 'undefined' ? (localStorage.getItem(ENV_KEY) ?? 'production') : 'production',
  envs: ['production', 'staging', 'development'],
  counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
  resources: [],
  billing: null,
  billingLoading: false,
}

// resetBootstrap clears all cached state and resets the bootstrapped flag so
// the next ensureBootstrap() call (triggered by the first /app/* page mount
// after login) performs a fresh identity fetch.
//
// D08 (P1): without this, a same-tab logout+re-login scenario serves the
// PREVIOUS user's identity (email, team, tier, admin "Customers" nav link)
// to the new user because `bootstrapped = true` prevented a fresh
// /auth/me call. Callers: api.logout() (index.ts) and any component that
// needs to force a full identity refresh (e.g. after an account switch).
export function resetBootstrap() {
  bootstrapped = false
  state = { ...initialState }
  emit()
}

export function ensureBootstrap() {
  if (bootstrapped) return
  // Skip bootstrap on public pages (no session yet). RouteTracker mounts
  // outside AuthGate so it sees every URL including /login, /pricing,
  // and /login/callback. Without this guard those public mounts fire
  // four authenticated calls that all 401, and the centralized 401
  // handler in src/api/index.ts calls clearToken() on each, racing the
  // JWT that LoginCallbackPage.setToken() just stored. Net effect:
  // GitHub OAuth + magic-link both bounce the user back to /login with
  // empty localStorage. Surfaced live 2026-05-14 via Playwright debug.
  if (!api.getToken()) return
  bootstrapped = true
  void refreshMe().then((ok) => {
    // L-01: only fan out the dependent fetches when /auth/me actually
    // succeeded. A visitor carrying a STALE token (expired session left in
    // localStorage) used to fire all five calls — refreshMe + the three
    // counts calls + billing — and every one 401'd, polluting the browser
    // console and NR RUM on the public marketing pages. fetchMe()'s 401
    // already cleared the token via the central interceptor; skipping the
    // dependent fetches here cuts the noise from 5 failed requests to 1.
    if (!ok) return
    // Counts and billing are independent — fire in parallel once auth resolves.
    void refreshCounts()
    void refreshBilling()
  })
}

export function useDashboardCtx(): DashboardCtx {
  const ctx = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    ensureBootstrap()
  }, [])
  return ctx
}

export function useEnvSync(): string {
  // Lighter-weight hook for components that only care about the env string.
  return useDashboardCtx().env
}

// D08 (P1): register resetBootstrap as a logout hook so api.logout() triggers
// a full identity reset. Registration happens at module-evaluation time (once
// per app lifetime). registerLogoutHook is idempotent so hot-module-reloading
// in Vite dev mode does not produce duplicate registrations.
registerLogoutHook(resetBootstrap)
