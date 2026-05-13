/* RouteTracker.test.tsx — unit tests for the New Relic page-view tracker.
 *
 * Covers:
 *   1. Calls setPageViewName(pathname) on initial mount.
 *   2. Calls setCustomAttribute for tier, is_admin, commit_id on mount.
 *   3. Re-fires setPageViewName + attributes when the route changes
 *      (this is the SPA-soft-nav case the agent's pro_plus_spa mode is
 *      designed to capture).
 *   4. Does NOT crash when window.newrelic is absent (fail-open).
 *   5. Falls back to "anonymous" / false when ctx.me is null
 *      (pre-auth marketing browse).
 *   6. Reflects tier upgrades — re-stamps the new tier when ctx.me.team.tier
 *      changes (the upgrade-webhook path).
 *
 * useDashboardCtx is mocked module-level so we can vary `me` per test
 * without touching the real subscription store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

// ─── Mock useDashboardCtx ────────────────────────────────────────────────
// Mutated per-test to flip tier / admin flag / null-me.
let mockMe: {
  user?: { id: string; email: string }
  team?: { tier: string }
  is_platform_admin?: boolean
} | null = null

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: mockMe,
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [],
    billing: null,
    billingLoading: false,
  }),
}))

// Imported after the mock so the module under test resolves the stubbed hook.
import { RouteTracker } from './RouteTracker'

type NRStub = {
  setPageViewName: ReturnType<typeof vi.fn>
  setCustomAttribute: ReturnType<typeof vi.fn>
}

function installNewrelicStub(): NRStub {
  const stub: NRStub = {
    setPageViewName: vi.fn(),
    setCustomAttribute: vi.fn(),
  }
  ;(window as unknown as { newrelic: NRStub }).newrelic = stub
  return stub
}

describe('RouteTracker', () => {
  let originalNewrelic: unknown

  beforeEach(() => {
    originalNewrelic = (window as unknown as { newrelic?: unknown }).newrelic
    mockMe = null
  })

  afterEach(() => {
    if (originalNewrelic === undefined) {
      delete (window as unknown as { newrelic?: unknown }).newrelic
    } else {
      ;(window as unknown as { newrelic?: unknown }).newrelic = originalNewrelic
    }
  })

  it('calls setPageViewName with the initial pathname', () => {
    const nr = installNewrelicStub()
    render(
      <MemoryRouter initialEntries={['/app/resources']}>
        <RouteTracker />
      </MemoryRouter>,
    )
    expect(nr.setPageViewName).toHaveBeenCalledWith('/app/resources')
  })

  it('stamps tier / is_admin / commit_id custom attributes', () => {
    mockMe = {
      user: { id: 'u1', email: 'a@b.test' },
      team: { tier: 'pro' },
      is_platform_admin: true,
    }
    const nr = installNewrelicStub()
    render(
      <MemoryRouter initialEntries={['/app']}>
        <RouteTracker />
      </MemoryRouter>,
    )
    // The three custom attributes we promise to stamp on every page view.
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('tier', 'pro')
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('is_admin', true)
    // commit_id is sourced from VITE_COMMIT_ID; in test it's "dev".
    const commitCalls = nr.setCustomAttribute.mock.calls.filter((c) => c[0] === 'commit_id')
    expect(commitCalls.length).toBeGreaterThanOrEqual(1)
    expect(typeof commitCalls[0][1]).toBe('string')
    expect((commitCalls[0][1] as string).length).toBeGreaterThan(0)
  })

  it('falls back to anonymous tier and is_admin=false when ctx.me is null', () => {
    mockMe = null // unauthenticated
    const nr = installNewrelicStub()
    render(
      <MemoryRouter initialEntries={['/pricing']}>
        <RouteTracker />
      </MemoryRouter>,
    )
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('tier', 'anonymous')
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('is_admin', false)
  })

  it('re-fires setPageViewName when the route changes (SPA soft nav)', () => {
    const nr = installNewrelicStub()

    // Helper inside the router that triggers navigation post-mount.
    function Nav() {
      const navigate = useNavigate()
      useEffect(() => {
        navigate('/app/billing')
      }, [navigate])
      return null
    }

    render(
      <MemoryRouter initialEntries={['/app/resources']}>
        <RouteTracker />
        <Routes>
          <Route path="/app/resources" element={<Nav />} />
          <Route path="/app/billing" element={<div>billing</div>} />
        </Routes>
      </MemoryRouter>,
    )

    // First mount: /app/resources. Then the Nav effect pushes /app/billing.
    // setPageViewName must have been called for BOTH pathnames.
    const names = nr.setPageViewName.mock.calls.map((c) => c[0])
    expect(names).toContain('/app/resources')
    expect(names).toContain('/app/billing')
  })

  it('does not crash when window.newrelic is absent (fail-open)', () => {
    delete (window as unknown as { newrelic?: unknown }).newrelic
    expect(() =>
      render(
        <MemoryRouter initialEntries={['/login']}>
          <RouteTracker />
        </MemoryRouter>,
      ),
    ).not.toThrow()
  })

  it('stamps the new tier when team.tier changes (upgrade webhook path)', () => {
    // First render: hobby
    mockMe = { user: { id: 'u', email: 'x@y' }, team: { tier: 'hobby' } }
    const nr = installNewrelicStub()
    const { rerender } = render(
      <MemoryRouter initialEntries={['/app']}>
        <RouteTracker />
      </MemoryRouter>,
    )
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('tier', 'hobby')

    // Simulate the upgrade webhook flipping the ctx state.
    nr.setCustomAttribute.mockClear()
    mockMe = { user: { id: 'u', email: 'x@y' }, team: { tier: 'pro' } }
    rerender(
      <MemoryRouter initialEntries={['/app']}>
        <RouteTracker />
      </MemoryRouter>,
    )
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('tier', 'pro')
  })

  it('renders no markup (null)', () => {
    const { container } = render(
      <MemoryRouter>
        <RouteTracker />
      </MemoryRouter>,
    )
    // The component returns null; nothing should be appended.
    expect(container.firstChild).toBeNull()
  })
})
