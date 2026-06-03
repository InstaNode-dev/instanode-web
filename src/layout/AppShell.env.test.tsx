/* AppShell.env.test.tsx — environment-switcher REMOVAL guard.
 *
 * 2026-06-03: the global environment switcher was removed from the dashboard
 * chrome. The backend supports per-env filtering, but the broader multi-env
 * UX (choosing env at create time, env promotion) is unfinished, so surfacing
 * a global switcher advertised a half-built capability. It's hidden until the
 * feature is done. Per-env vault tabs remain on VaultPage (isolation is real
 * there).
 *
 * These tests pin that the switcher stays gone, so a future refactor can't
 * silently re-introduce it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchTeamSummary: vi.fn().mockResolvedValue({ ok: true, teams: [] }),
  }
})

vi.mock('../hooks/useDashboardCtx', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useDashboardCtx')>(
    '../hooks/useDashboardCtx',
  )
  return {
    ...actual,
    useDashboardCtx: () => ({
      me: {
        user: { id: 'u_test', email: 'aanya@acme.dev', tier: 'pro' },
        team: { id: 't_test', slug: 'acme', name: 'acme', tier: 'pro' },
      },
      meErr: null,
      meLoading: false,
      env: 'development',
      envs: ['development', 'production'],
      counts: { resources: 3, deployments: 2, vault: 5, team: 1 },
      resources: [],
      billing: null,
      billingLoading: false,
    }),
  }
})

import { AppShell } from './AppShell'

afterEach(() => cleanup())

function renderShell(path = '/app') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>,
  )
}

describe('AppShell — global env switcher is hidden (2026-06-03)', () => {
  it('does NOT render a global environment switcher in the chrome', () => {
    renderShell()
    expect(screen.queryByTestId('env-switcher')).toBeNull()
    expect(screen.queryByTestId('env-create-input')).toBeNull()
  })

  it('still renders the org/team block (switcher removal did not break the sidebar)', () => {
    renderShell()
    expect(screen.getByTestId('org')).toBeTruthy()
    expect(screen.getByTestId('org-name')).toBeTruthy()
  })
})

describe('AppShell — breadcrumbs no longer show env (count-only after switcher removal)', () => {
  it('resources crumb shows the count, not the env', () => {
    renderShell('/app/resources')
    expect(screen.getAllByText('3 active').length).toBeGreaterThan(0)
    // env name must not leak into the crumb anymore.
    expect(screen.queryByText(/development · /)).toBeNull()
  })

  it('deployments crumb shows the count, not the env', () => {
    renderShell('/app/deployments')
    expect(screen.getAllByText('2 active').length).toBeGreaterThan(0)
  })

  it('vault crumb shows the entry count, not the env', () => {
    renderShell('/app/vault')
    expect(screen.getAllByText('5 entries').length).toBeGreaterThan(0)
  })
})
