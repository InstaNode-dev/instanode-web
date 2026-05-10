// useDashboardCtx — single source of truth for the dashboard's "ambient
// state": the signed-in user, their team, the active env, and the live
// resource/vault counts shown in the sidebar.
//
// Pages and chrome both read from this so the active env actually drives
// every API call (see api/index.ts — listResources(env) etc.).

import { useEffect, useSyncExternalStore } from 'react'
import * as api from '../api'
import type { AuthMeResponse } from '../api'

const ENV_KEY = 'instanode.env'

export type DashboardCtx = {
  me: AuthMeResponse | null
  meErr: string | null
  meLoading: boolean
  env: string
  envs: string[]                // dynamically populated from resource list
  counts: { resources: number; deployments: number; vault: number; team: number }
}

let state: DashboardCtx = {
  me: null,
  meErr: null,
  meLoading: true,
  env: typeof window !== 'undefined' ? (localStorage.getItem(ENV_KEY) ?? 'production') : 'production',
  envs: ['production', 'staging', 'development'],
  counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
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

    const items = (r as any).items as { env?: string; resource_type: string }[]
    const filtered = items.filter((x) => (x.env ?? 'production') === state.env)
    state = {
      ...state,
      envs,
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

let bootstrapped = false
export function ensureBootstrap() {
  if (bootstrapped) return
  bootstrapped = true
  void refreshMe().then(() => refreshCounts())
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
