/* SettingsPage.tier-gate.test.tsx — DeployTtlPolicyCard tier gating.
 *
 * Companion to SettingsPage.test.tsx (which mocks useDashboardCtx as a fixed
 * pro-tier owner). This file overrides the dashboard context per-test so we
 * can verify:
 *   • free tier sees the card with every radio disabled + an "Upgrade" hint
 *   • paid tier (pro) reflects the current policy in the radio group + the
 *     "Permanent" radio fires PATCH /api/v1/team/settings
 *   • the static help text is always present
 *   • "Custom hours" is disabled-with-tooltip on every tier until the api
 *     accepts per-team hours (today PATCH /team/settings enum is two-valued).
 *
 * Lives in its own file because vi.mock('../hooks/useDashboardCtx') has a
 * factory hoisted to module scope — overriding the returned tier per-test
 * is cleanest with a mutable factory closure (see `ctxOverride` below).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listAPIKeys: vi.fn(),
    listMembers: vi.fn(),
    getTeamSettings: vi.fn(),
    updateTeamSettings: vi.fn(),
  }
})

// Mutable context — each test sets the tier it wants before render. The
// factory captures the live reference so the mock returns whatever the
// current test left in `ctxOverride`.
const ctxOverride: { tier: string } = { tier: 'pro' }

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: {
      user: { id: 'u1', email: 'me@instanode.dev' },
      team: { id: 't1', tier: ctxOverride.tier },
    },
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

vi.mock('../components/Common', async () => {
  const actual = await vi.importActual<typeof import('../components/Common')>('../components/Common')
  return { ...actual, copyToClipboard: vi.fn() }
})

import { SettingsPage } from './SettingsPage'
import * as api from '../api'

const m = {
  listAPIKeys: api.listAPIKeys as unknown as ReturnType<typeof vi.fn>,
  listMembers: api.listMembers as unknown as ReturnType<typeof vi.fn>,
  getTeamSettings: api.getTeamSettings as unknown as ReturnType<typeof vi.fn>,
  updateTeamSettings: api.updateTeamSettings as unknown as ReturnType<typeof vi.fn>,
}

beforeEach(() => {
  vi.clearAllMocks()
  ctxOverride.tier = 'pro'
  m.listAPIKeys.mockResolvedValue({ ok: true, items: [] })
  m.listMembers.mockResolvedValue({
    ok: true,
    members: [{ id: 'u1', user_id: 'u1', role: 'owner' }],
    member_limit: 5,
  })
  m.getTeamSettings.mockResolvedValue({
    ok: true,
    settings: { default_deployment_ttl_policy: 'auto_24h' },
  })
  m.updateTeamSettings.mockResolvedValue({
    ok: true,
    settings: { default_deployment_ttl_policy: 'permanent' },
  })
})
afterEach(() => cleanup())

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

describe('DeployTtlPolicyCard — paid tier (pro, owner)', () => {
  it('reflects current policy in the radio group and saves "Permanent" via PATCH', async () => {
    ctxOverride.tier = 'pro'
    renderPage()
    await waitFor(() => expect(screen.getByTestId('deploy-ttl-policy-card')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('ttl-policy-auto-24h')).toBeTruthy())

    // Initial state — server returned auto_24h, so that radio is checked.
    const auto = screen.getByTestId('ttl-policy-auto-24h') as HTMLInputElement
    const perm = screen.getByTestId('ttl-policy-permanent') as HTMLInputElement
    expect(auto.checked).toBe(true)
    expect(perm.checked).toBe(false)
    expect(auto.disabled).toBe(false)
    expect(perm.disabled).toBe(false)

    // Flip to permanent → PATCH /api/v1/team/settings.
    fireEvent.click(perm)
    await waitFor(() =>
      expect(m.updateTeamSettings).toHaveBeenCalledWith({
        default_deployment_ttl_policy: 'permanent',
      }),
    )
    await waitFor(() => expect(screen.getByTestId('ttl-policy-saved')).toBeTruthy())
  })

  it('saves "Auto-expire after 24h" when the user flips back from permanent', async () => {
    ctxOverride.tier = 'pro'
    // Start in permanent, then flip to auto_24h — covers save('auto_24h').
    m.getTeamSettings.mockResolvedValue({
      ok: true,
      settings: { default_deployment_ttl_policy: 'permanent' },
    })
    m.updateTeamSettings.mockResolvedValue({
      ok: true,
      settings: { default_deployment_ttl_policy: 'auto_24h' },
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('ttl-policy-auto-24h')).toBeTruthy())
    const auto = screen.getByTestId('ttl-policy-auto-24h') as HTMLInputElement
    expect(auto.checked).toBe(false)
    fireEvent.click(auto)
    await waitFor(() =>
      expect(m.updateTeamSettings).toHaveBeenCalledWith({
        default_deployment_ttl_policy: 'auto_24h',
      }),
    )
  })

  it('keeps the static help text visible', async () => {
    ctxOverride.tier = 'pro'
    renderPage()
    await waitFor(() => expect(screen.getByTestId('ttl-policy-help')).toBeTruthy())
    expect(screen.getByTestId('ttl-policy-help').textContent).toMatch(
      /applies to all NEW deploys.*Existing deploys keep their per-deploy setting/i,
    )
  })

  it('disables "Custom hours" with a coming-soon tooltip even on paid tier', async () => {
    ctxOverride.tier = 'pro'
    renderPage()
    await waitFor(() => expect(screen.getByTestId('ttl-policy-custom')).toBeTruthy())
    const custom = screen.getByTestId('ttl-policy-custom') as HTMLInputElement
    expect(custom.disabled).toBe(true)

    // Tooltip lives on the wrapping label so the user gets it on hover.
    const row = screen.getByTestId('ttl-policy-custom-row')
    expect(row.getAttribute('title')).toMatch(/coming soon/i)

    // The hours text input is rendered but disabled.
    const input = screen.getByTestId('ttl-policy-custom-hours-input') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })
})

describe('DeployTtlPolicyCard — free tier (owner)', () => {
  it('renders the card with every radio disabled and an "Upgrade to change" tooltip', async () => {
    ctxOverride.tier = 'free'
    renderPage()

    // Card visible (the surface stays so the user can SEE the current default).
    await waitFor(() => expect(screen.getByTestId('deploy-ttl-policy-card')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('ttl-policy-auto-24h')).toBeTruthy())

    const auto = screen.getByTestId('ttl-policy-auto-24h') as HTMLInputElement
    const perm = screen.getByTestId('ttl-policy-permanent') as HTMLInputElement
    const custom = screen.getByTestId('ttl-policy-custom') as HTMLInputElement

    // Every radio disabled on free tier — server enforces too (rule 1).
    expect(auto.disabled).toBe(true)
    expect(perm.disabled).toBe(true)
    expect(custom.disabled).toBe(true)

    // Tooltip via the wrapping label's title attribute.
    expect(screen.getByTestId('ttl-policy-auto-24h-row').getAttribute('title')).toBe(
      'Upgrade to change',
    )
    expect(screen.getByTestId('ttl-policy-permanent-row').getAttribute('title')).toBe(
      'Upgrade to change',
    )

    // Upgrade hint card surfaces an explicit billing link.
    expect(screen.getByTestId('ttl-policy-upgrade-hint')).toBeTruthy()
  })

  it('does NOT call updateTeamSettings when a disabled radio is clicked', async () => {
    ctxOverride.tier = 'free'
    renderPage()
    await waitFor(() => expect(screen.getByTestId('ttl-policy-permanent')).toBeTruthy())
    fireEvent.click(screen.getByTestId('ttl-policy-permanent'))
    // jsdom won't fire onChange on a disabled radio; even if it did, the
    // handler bails because !isPaidTier. Either way: no API call.
    await new Promise((r) => setTimeout(r, 50))
    expect(m.updateTeamSettings).not.toHaveBeenCalled()
  })
})
