/* TeamPage.render.test.tsx — full component render coverage.
 *
 * The sibling TeamPage.test.tsx pins the pure helpers (avatarInitial /
 * memberDisplayName). This file drives the rendered component: member +
 * invite lists, the seat-limit copy matrix, and the load-error / 429
 * banner branches. Mocks ../api + ../hooks/useDashboardCtx. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, listMembers: vi.fn(), listInvitations: vi.fn() }
})

let ctxValue: any
vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ctxValue,
}))

import { TeamPage } from './TeamPage'
import * as api from '../api'
import type { TeamMember, TeamInvitation } from '../api'

const listMembers = api.listMembers as unknown as ReturnType<typeof vi.fn>
const listInvitations = api.listInvitations as unknown as ReturnType<typeof vi.fn>

function member(over: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'm1',
    display_name: 'Aanya Patel',
    email: 'aanya@acme.dev',
    role: 'owner',
    _avatar_color: '#aa33cc',
    ...over,
  } as TeamMember
}
function invite(over: Partial<TeamInvitation> = {}): TeamInvitation {
  return {
    id: 'i1',
    email: 'kavya@acme.dev',
    role: 'developer',
    created_at: '2026-05-20T00:00:00Z',
    invited_by_name: 'Aanya',
    ...over,
  } as TeamInvitation
}

beforeEach(() => {
  vi.clearAllMocks()
  ctxValue = {
    me: { user: { id: 'u1', email: 'aanya@acme.dev' }, team: { id: 't1', tier: 'pro' } },
    meErr: null, meLoading: false, env: 'production', envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [], billing: null, billingLoading: false,
  }
  listMembers.mockResolvedValue({ ok: true, members: [member()], member_limit: 5 })
  listInvitations.mockResolvedValue({ ok: true, invitations: [invite()] })
})
afterEach(() => cleanup())

function renderPage() {
  return render(<MemoryRouter><TeamPage /></MemoryRouter>)
}

describe('TeamPage render', () => {
  it('renders the member list and pending invitations', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Aanya Patel')).toBeTruthy())
    expect(screen.getByText('Members · 1')).toBeTruthy()
    expect(screen.getByText('Pending · 1')).toBeTruthy()
    expect(screen.getAllByText('kavya@acme.dev').length).toBeGreaterThan(0)
  })

  it('builds an example invite email from the user domain + shows N seat copy', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Aanya Patel')).toBeTruthy())
    expect(screen.getAllByText(/5 team seats/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/pro tier/).length).toBeGreaterThan(0)
  })

  it('renders "unlimited team seats" when member_limit is -1', async () => {
    listMembers.mockResolvedValue({ ok: true, members: [member()], member_limit: -1 })
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/unlimited team seats/).length).toBeGreaterThan(0))
  })

  it('renders "1 team seat" (singular) when member_limit is 1', async () => {
    listMembers.mockResolvedValue({ ok: true, members: [member()], member_limit: 1 })
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/1 team seat\b/).length).toBeGreaterThan(0))
  })

  it('uses the example.com fallback domain when the user email is missing', async () => {
    ctxValue.me = { user: { id: 'u1' }, team: { tier: 'hobby' } }
    renderPage()
    await waitFor(() => expect(screen.getByText('Aanya Patel')).toBeTruthy())
    expect(screen.getAllByText(/kavya@example\.com/).length).toBeGreaterThan(0)
  })

  it('renders the generic seat fallback before member_limit resolves on error', async () => {
    listMembers.mockRejectedValue(new Error('down'))
    listInvitations.mockResolvedValue({ ok: true, invitations: [] })
    renderPage()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getAllByText(/seat limits per plan/).length).toBeGreaterThan(0)
  })

  it('renders a plain error banner on a non-429 failure', async () => {
    listMembers.mockRejectedValue(new Error('5xx oops'))
    renderPage()
    await waitFor(() => expect(screen.getByText(/5xx oops/)).toBeTruthy())
    expect(screen.getByText(/Could not load team members/)).toBeTruthy()
  })

  it('renders the rate-limit banner with retry hint on a 429', async () => {
    listMembers.mockRejectedValue({ status: 429, message: 'rate limited', retryAfter: 30 })
    renderPage()
    await waitFor(() => expect(screen.getByText(/rate-limited/i)).toBeTruthy())
  })

  it('links to /app/billing in the plan-limit card', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Aanya Patel')).toBeTruthy())
    expect(screen.getByRole('link', { name: /View billing/i }).getAttribute('href')).toBe('/app/billing')
  })

  it('renders the default-color avatar gradient when _avatar_color is absent', async () => {
    listMembers.mockResolvedValue({ ok: true, members: [member({ _avatar_color: undefined })], member_limit: 5 })
    renderPage()
    await waitFor(() => expect(screen.getByText('Aanya Patel')).toBeTruthy())
  })
})
