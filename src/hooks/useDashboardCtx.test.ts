/* useDashboardCtx.test.ts — singleton ambient-state store.
 *
 * The store is module-level state, so we mock ../api before importing it
 * and use vi.resetModules() between specs to get a fresh, un-bootstrapped
 * store each time. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'

const fetchMe = vi.fn()
const listResources = vi.fn()
const listVault = vi.fn()
const listDeployments = vi.fn()
const fetchBilling = vi.fn()
const getToken = vi.fn()
const registerLogoutHook = vi.fn()

vi.mock('../api', () => ({
  fetchMe,
  listResources,
  listVault,
  listDeployments,
  fetchBilling,
  getToken,
  registerLogoutHook,
}))

async function load() {
  return await import('./useDashboardCtx')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  try { localStorage.clear() } catch { /* ignore */ }
  fetchMe.mockResolvedValue({ user: { email: 'a@b.com' }, team: { id: 't1' } })
  listResources.mockResolvedValue({ items: [{ env: 'production' }, { env: 'staging' }], total: 2 })
  listVault.mockResolvedValue({ entries: [{ key: 'X' }] })
  listDeployments.mockResolvedValue({ ok: true, items: [{ id: 'd1' }], total: 1 })
  fetchBilling.mockResolvedValue({ billing: { status: 'active', current_period_end: null, razorpay_configured: true } })
  getToken.mockReturnValue('tok')
})
afterEach(() => cleanup())

describe('useDashboardCtx', () => {
  it('registers a logout hook at module load', async () => {
    await load()
    expect(registerLogoutHook).toHaveBeenCalledTimes(1)
  })

  it('bootstraps identity + counts + billing when a token is present', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    expect(result.current.me?.user.email).toBe('a@b.com')
    await waitFor(() => expect(result.current.billing?.status).toBe('active'))
    // production filter → 1 of the 2 resources; deployments 1; vault 1.
    expect(result.current.counts.resources).toBe(1)
    expect(result.current.counts.deployments).toBe(1)
    expect(result.current.counts.vault).toBe(1)
    // env merged from resource list.
    expect(result.current.envs).toContain('staging')
  })

  it('does NOT bootstrap when there is no token', async () => {
    getToken.mockReturnValue('')
    const mod = await load()
    renderHook(() => mod.useDashboardCtx())
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMe).not.toHaveBeenCalled()
  })

  it('skips dependent fetches when /auth/me fails', async () => {
    fetchMe.mockRejectedValue(new Error('401'))
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.meErr).toBe('401'))
    expect(listResources).not.toHaveBeenCalled()
    expect(fetchBilling).not.toHaveBeenCalled()
  })

  it('setEnv updates env, persists to localStorage, and re-fetches counts', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    listResources.mockClear()
    await act(async () => { mod.setEnv('staging') })
    expect(result.current.env).toBe('staging')
    expect(localStorage.getItem('instanode.env')).toBe('staging')
    await waitFor(() => expect(listResources).toHaveBeenCalled())
    // staging filter → 1 resource.
    await waitFor(() => expect(result.current.counts.resources).toBe(1))
  })

  it('setEnv is a no-op when the env is unchanged', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    const before = result.current.env
    listResources.mockClear()
    await act(async () => { mod.setEnv(before) })
    expect(listResources).not.toHaveBeenCalled()
  })

  it('addEnv sanitises the name, appends it, and selects it', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    await act(async () => { mod.addEnv('  My Env!! ') })
    expect(result.current.envs).toContain('myenv')
    expect(result.current.env).toBe('myenv')
  })

  it('addEnv ignores an all-invalid name', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    const envsBefore = [...result.current.envs]
    await act(async () => { mod.addEnv('!!!') })
    expect(result.current.envs).toEqual(envsBefore)
  })

  // BUG-DASH-001 (P0): pre-fix a 67-char input persisted to
  // localStorage and broke every subsequent API call. Now the input is
  // clipped to the api cap (32 chars). The clipped string must still
  // match the api regex `^[a-z0-9-]{1,32}$`.
  it('addEnv clips an over-32-char input to the api cap', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    const longInput = 'a'.repeat(67) // 67 chars of valid char class
    await act(async () => { mod.addEnv(longInput) })
    // The persisted env name must be ≤ 32 chars (api cap).
    expect(result.current.env.length).toBeLessThanOrEqual(32)
    expect(result.current.env).toMatch(/^[a-z0-9-]{1,32}$/)
  })

  // BUG-DASH-002: pre-fix the JS regex permitted underscores even
  // though the api regex bans them. Underscore inputs would persist
  // locally and then 400 on every API call. Now the underscore is
  // stripped.
  it('addEnv strips underscores (api regex forbids them)', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    await act(async () => { mod.addEnv('my_env_name') })
    // Underscore-stripped form is "myenvname" — the only valid api shape.
    expect(result.current.envs.some((e: string) => e.includes('_'))).toBe(false)
    expect(result.current.env).toMatch(/^[a-z0-9-]{1,32}$/)
  })

  // BUG-DASH-001 belt: a paste that's entirely punctuation must NOT
  // change the live env. Pre-fix the empty-string fall-through worked
  // because of `if (!clean)`; we keep that guard via the final regex
  // gate.
  it('addEnv leaves live env unchanged on all-invalid + over-cap input', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    const envBefore = result.current.env
    await act(async () => { mod.addEnv('!!! !!! !!!') })
    expect(result.current.env).toBe(envBefore)
  })

  it('resetBootstrap clears state and allows a fresh bootstrap', async () => {
    const mod = await load()
    const { result, rerender } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.me).not.toBeNull())
    act(() => { mod.resetBootstrap() })
    expect(result.current.me).toBeNull()
    expect(result.current.meLoading).toBe(false)
    // ensureBootstrap fires again on next mount.
    fetchMe.mockClear()
    rerender()
    mod.ensureBootstrap()
    await waitFor(() => expect(fetchMe).toHaveBeenCalled())
  })

  it('tolerates billing fetch failure (renders null, not a crash)', async () => {
    fetchBilling.mockRejectedValue(new Error('boom'))
    const mod = await load()
    const { result } = renderHook(() => mod.useDashboardCtx())
    await waitFor(() => expect(result.current.billingLoading).toBe(false))
    expect(result.current.billing).toBeNull()
  })

  it('useEnvSync returns just the env string', async () => {
    const mod = await load()
    const { result } = renderHook(() => mod.useEnvSync())
    await waitFor(() => expect(typeof result.current).toBe('string'))
    expect(result.current).toBe('production')
  })
})
