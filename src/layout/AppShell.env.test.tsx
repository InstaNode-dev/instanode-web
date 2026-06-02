/* AppShell.env.test.tsx — environment-switcher clarity guards.
 *
 * Gap (2026-06-03): users reported "no clarity between the environments
 * (production / staging / other) over the dashboard." The EnvSwitcher was a
 * bare, unlabeled pill <select> with no indication of (a) what it does or
 * (b) that `env` is a tag recorded at provision time — NOT a live filter on
 * resource/deployment lists (only vault secrets are genuinely per-env; see
 * the useDashboardCtx header). These tests pin the clarifying affordances so
 * a refactor can't silently strip them, and so the honest copy can't drift
 * back into an over-claim of per-env isolation.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// AppShell mounts and immediately calls fetchTeamSummary; stub it so the
// effect resolves without a network call.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchTeamSummary: vi.fn().mockResolvedValue({ ok: true, teams: [] }),
  }
})

// Control the ambient dashboard ctx so the switcher renders deterministically.
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

describe('AppShell — environment switcher clarity (2026-06-03 gap fix)', () => {
  it('renders a visible "env" label next to the switcher', () => {
    renderShell()
    const switcher = screen.getByTestId('env-switcher')
    const orgEnv = switcher.closest('.org-env')
    expect(orgEnv).not.toBeNull()
    expect(within(orgEnv as HTMLElement).getByText('env')).toBeTruthy()
  })

  it('the switcher carries an explanatory aria-label and a title tooltip', () => {
    renderShell()
    const switcher = screen.getByTestId('env-switcher')
    const aria = switcher.getAttribute('aria-label') ?? ''
    const title = switcher.getAttribute('title') ?? ''
    expect(aria).toMatch(/environment/i)
    expect(aria).toMatch(/defaults to development/i)
    expect(title.length).toBeGreaterThan(0)
  })

  it('the tooltip copy is honest: env is a tag, NOT a per-env list filter', () => {
    renderShell()
    const title = screen.getByTestId('env-switcher').getAttribute('title') ?? ''
    // Anti-overclaim: must not promise per-env isolation/filtering of
    // resources & deployments — the backend only filters vault secrets.
    expect(title).not.toMatch(/isolated per environment/i)
    expect(title).toMatch(/not yet filtered by env/i)
  })
})
