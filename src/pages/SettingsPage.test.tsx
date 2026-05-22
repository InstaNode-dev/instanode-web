/* SettingsPage.test.tsx — PAT management + deploy-TTL policy card.
 *
 * Mocks ../api for every endpoint the page touches and ../hooks/useDashboardCtx
 * so the page renders deterministically with a known signed-in user. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listAPIKeys: vi.fn(),
    createAPIKey: vi.fn(),
    revokeAPIKey: vi.fn(),
    listMembers: vi.fn(),
    getTeamSettings: vi.fn(),
    updateTeamSettings: vi.fn(),
  }
})

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: { user: { id: 'u1', email: 'me@instanode.dev' }, team: { id: 't1', tier: 'pro' } },
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
import * as common from '../components/Common'
import type { APIKey } from '../api'

const m = {
  listAPIKeys: api.listAPIKeys as unknown as ReturnType<typeof vi.fn>,
  createAPIKey: api.createAPIKey as unknown as ReturnType<typeof vi.fn>,
  revokeAPIKey: api.revokeAPIKey as unknown as ReturnType<typeof vi.fn>,
  listMembers: api.listMembers as unknown as ReturnType<typeof vi.fn>,
  getTeamSettings: api.getTeamSettings as unknown as ReturnType<typeof vi.fn>,
  updateTeamSettings: api.updateTeamSettings as unknown as ReturnType<typeof vi.fn>,
  copyToClipboard: common.copyToClipboard as unknown as ReturnType<typeof vi.fn>,
}

function key(over: Partial<APIKey> = {}): APIKey {
  return {
    id: 'key-abcdef12-0000',
    name: 'laptop',
    scopes: ['read', 'write'],
    created_at: '2026-05-01T00:00:00Z',
    last_used_at: null,
    revoked: false,
    ...over,
  } as APIKey
}

beforeEach(() => {
  vi.clearAllMocks()
  m.listAPIKeys.mockResolvedValue({ ok: true, items: [] })
  m.listMembers.mockResolvedValue({ ok: true, members: [{ id: 'u1', user_id: 'u1', role: 'owner' }], member_limit: 5 })
  m.getTeamSettings.mockResolvedValue({ ok: true, settings: { default_deployment_ttl_policy: 'auto_24h' } })
  m.updateTeamSettings.mockResolvedValue({ ok: true, settings: { default_deployment_ttl_policy: 'permanent' } })
})
afterEach(() => cleanup())

describe('SettingsPage — profile + token list', () => {
  it('renders profile/team fields from the dashboard context', async () => {
    render(<SettingsPage />)
    expect(screen.getByText('me@instanode.dev')).toBeTruthy()
    expect(screen.getByText('pro')).toBeTruthy()
    await waitFor(() => expect(m.listAPIKeys).toHaveBeenCalled())
  })

  it('shows the empty state when there are no tokens', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByText(/no tokens yet/i)).toBeTruthy())
  })

  it('renders a row per token, with revoked badge for revoked keys', async () => {
    m.listAPIKeys.mockResolvedValue({
      ok: true,
      items: [key({ id: 'k1-aaaa-bbbb', name: 'ci' }), key({ id: 'k2-cccc-dddd', name: 'old', revoked: true, last_used_at: new Date(Date.now() - 5000).toISOString() })],
    })
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('pat-list')).toBeTruthy())
    expect(screen.getByText('ci')).toBeTruthy()
    expect(screen.getByText('old')).toBeTruthy()
    expect(screen.getByText(/revoked/i)).toBeTruthy()
    expect(screen.getByText(/used .*s ago/i)).toBeTruthy()
  })

  it('surfaces a load error', async () => {
    m.listAPIKeys.mockRejectedValue(new Error('boom load'))
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByText('boom load')).toBeTruthy())
  })
})

describe('SettingsPage — create PAT flow', () => {
  it('validates required name', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(m.listAPIKeys).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('new-pat'))
    fireEvent.submit(screen.getByTestId('create-form'))
    await waitFor(() => expect(screen.getByText(/Name is required/i)).toBeTruthy())
    expect(m.createAPIKey).not.toHaveBeenCalled()
  })

  it('creates a token and shows the one-time banner', async () => {
    m.createAPIKey.mockResolvedValue({ key: 'inst_pat_secret123' })
    render(<SettingsPage />)
    await waitFor(() => expect(m.listAPIKeys).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('new-pat'))
    fireEvent.change(screen.getByTestId('pat-name'), { target: { value: 'my-token' } })
    fireEvent.submit(screen.getByTestId('create-form'))
    await waitFor(() => expect(screen.getByTestId('pat-created')).toBeTruthy())
    expect((screen.getByTestId('created-token-value') as HTMLTextAreaElement).value).toBe('inst_pat_secret123')
    expect(m.createAPIKey).toHaveBeenCalledWith({ name: 'my-token', scopes: ['read', 'write'] })
  })

  it('surfaces a create error', async () => {
    m.createAPIKey.mockRejectedValue(new Error('create failed x'))
    render(<SettingsPage />)
    await waitFor(() => expect(m.listAPIKeys).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('new-pat'))
    fireEvent.change(screen.getByTestId('pat-name'), { target: { value: 'x' } })
    fireEvent.submit(screen.getByTestId('create-form'))
    await waitFor(() => expect(screen.getByText('create failed x')).toBeTruthy())
  })

  it('reveals + toggles the advanced admin scope with a warning', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(m.listAPIKeys).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('new-pat'))
    fireEvent.click(screen.getByTestId('show-advanced-scopes'))
    const adminBox = screen.getByTestId('scope-admin')
    fireEvent.click(adminBox)
    expect(screen.getByTestId('admin-scope-warning')).toBeTruthy()
  })

  it('toggles read/write scopes', async () => {
    m.createAPIKey.mockResolvedValue({ key: 'k' })
    render(<SettingsPage />)
    await waitFor(() => expect(m.listAPIKeys).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('new-pat'))
    fireEvent.click(screen.getByTestId('scope-write')) // turn write off
    fireEvent.change(screen.getByTestId('pat-name'), { target: { value: 'ro' } })
    fireEvent.submit(screen.getByTestId('create-form'))
    await waitFor(() => expect(m.createAPIKey).toHaveBeenCalledWith({ name: 'ro', scopes: ['read'] }))
  })

  it('cancels the create form', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(m.listAPIKeys).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('new-pat'))
    expect(screen.getByTestId('create-form')).toBeTruthy()
    fireEvent.click(screen.getByText('cancel'))
    expect(screen.queryByTestId('create-form')).toBeNull()
  })
})

describe('SettingsPage — PatCreatedBanner copy', () => {
  beforeEach(() => {
    m.createAPIKey.mockResolvedValue({ key: 'tok-xyz' })
  })

  async function openBanner() {
    render(<SettingsPage />)
    await waitFor(() => expect(m.listAPIKeys).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('new-pat'))
    fireEvent.change(screen.getByTestId('pat-name'), { target: { value: 'n' } })
    fireEvent.submit(screen.getByTestId('create-form'))
    await waitFor(() => expect(screen.getByTestId('pat-created')).toBeTruthy())
  }

  it('shows success when clipboard copy works', async () => {
    m.copyToClipboard.mockResolvedValue(true)
    await openBanner()
    fireEvent.click(screen.getByTestId('pat-copy-button'))
    await waitFor(() => expect(screen.getByTestId('pat-copy-success')).toBeTruthy())
  })

  it('shows the failed-copy fallback when clipboard refuses', async () => {
    m.copyToClipboard.mockResolvedValue(false)
    await openBanner()
    fireEvent.click(screen.getByTestId('pat-copy-button'))
    await waitFor(() => expect(screen.getByTestId('pat-copy-failed')).toBeTruthy())
  })

  it('dismisses the banner', async () => {
    await openBanner()
    fireEvent.click(screen.getByText('dismiss'))
    await waitFor(() => expect(screen.queryByTestId('pat-created')).toBeNull())
  })

  it('selects the token textarea on click', async () => {
    await openBanner()
    const ta = screen.getByTestId('created-token-value') as HTMLTextAreaElement
    ta.select = vi.fn()
    fireEvent.click(ta)
    expect(ta.select).toHaveBeenCalled()
  })
})

describe('SettingsPage — revoke flow', () => {
  beforeEach(() => {
    m.listAPIKeys.mockResolvedValue({ ok: true, items: [key({ id: 'revk1234-aaaa', name: 'doomed' })] })
  })

  it('expands to a type-to-confirm input and revokes on exact match', async () => {
    m.revokeAPIKey.mockResolvedValue(undefined)
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('pat-list')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pat-revoke-revk1234'))
    const confirm = screen.getByTestId('pat-revoke-confirm-revk1234')
    fireEvent.change(confirm, { target: { value: 'doomed' } })
    fireEvent.click(screen.getByTestId('pat-revoke-submit-revk1234'))
    await waitFor(() => expect(m.revokeAPIKey).toHaveBeenCalledWith('revk1234-aaaa'))
  })

  it('keeps confirm disabled until the name matches', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('pat-list')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pat-revoke-revk1234'))
    fireEvent.change(screen.getByTestId('pat-revoke-confirm-revk1234'), { target: { value: 'wrong' } })
    const submit = screen.getByTestId('pat-revoke-submit-revk1234') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(m.revokeAPIKey).not.toHaveBeenCalled()
  })

  it('surfaces a revoke error', async () => {
    m.revokeAPIKey.mockRejectedValue(new Error('revoke nope'))
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('pat-list')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pat-revoke-revk1234'))
    fireEvent.change(screen.getByTestId('pat-revoke-confirm-revk1234'), { target: { value: 'doomed' } })
    fireEvent.click(screen.getByTestId('pat-revoke-submit-revk1234'))
    await waitFor(() => expect(screen.getByText('revoke nope')).toBeTruthy())
  })

  it('cancels the revoke confirm', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('pat-list')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pat-revoke-revk1234'))
    expect(screen.getByTestId('pat-revoke-confirm-revk1234')).toBeTruthy()
    fireEvent.click(screen.getByText('cancel'))
    expect(screen.queryByTestId('pat-revoke-confirm-revk1234')).toBeNull()
  })
})

describe('SettingsPage — DeployTtlPolicyCard', () => {
  it('renders the card for owner/admin and saves a policy change', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('deploy-ttl-policy-card')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('ttl-policy-permanent')).toBeTruthy())
    fireEvent.click(screen.getByTestId('ttl-policy-permanent'))
    await waitFor(() => expect(m.updateTeamSettings).toHaveBeenCalledWith({ default_deployment_ttl_policy: 'permanent' }))
    await waitFor(() => expect(screen.getByText('saved')).toBeTruthy())
  })

  it('hides the card for non-admin members', async () => {
    m.listMembers.mockResolvedValue({ ok: true, members: [{ id: 'u1', user_id: 'u1', role: 'developer' }], member_limit: 5 })
    render(<SettingsPage />)
    await waitFor(() => expect(m.listMembers).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('deploy-ttl-policy-card')).toBeNull())
  })

  it('hides the card when role lookup fails (fail closed)', async () => {
    m.listMembers.mockRejectedValue(new Error('rbac down'))
    render(<SettingsPage />)
    await waitFor(() => expect(m.listMembers).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('deploy-ttl-policy-card')).toBeNull())
  })

  it('surfaces a settings load error', async () => {
    m.getTeamSettings.mockRejectedValue(new Error('settings boom'))
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('deploy-ttl-policy-card')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('settings boom')).toBeTruthy())
  })

  it('surfaces a settings save error', async () => {
    m.updateTeamSettings.mockRejectedValue(new Error('save boom'))
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('ttl-policy-permanent')).toBeTruthy())
    fireEvent.click(screen.getByTestId('ttl-policy-permanent'))
    await waitFor(() => expect(screen.getByText('save boom')).toBeTruthy())
  })
})
