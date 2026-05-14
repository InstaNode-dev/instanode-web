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

export function addEnv(name: string) {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!clean) return
  if (!state.envs.includes(clean)) {
    state = { ...state, envs: [...state.envs, clean] }
    emit()
  }
  setEnv(clean)
}

async function refreshMe() {
  state = { ...state, meLoading: true, meErr: null }
  emit()
  try {
    const me = await api.fetchMe()
    state = { ...state, me, meLoading: false }
    emit()
  } catch (e: any) {
    state = { ...state, me: null, meErr: e?.message ?? 'auth failed', meLoading: false }
    emit()
  }
}

async function refreshCounts() {
  try {
    const [r, v] = await Promise.all([
      api.listResources().catch(() => ({ items: [], total: 0 })),
      api.listVault(state.env).catch(() => ({ entries: [] })),
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
        deployments: filtered.filter((x) => x.resource_type === 'deploy').length,
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
  void refreshMe().then(() => {
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
