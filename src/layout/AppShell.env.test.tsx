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
      counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
      resources: [],
      billing: null,
      billingLoading: false,
    }),
  }
})

import { AppShell } from './AppShell'

afterEach(() => cleanup())

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
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
