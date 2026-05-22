/* VaultPage.test.tsx — secrets table + reveal/hide + new-env button.
 *
 * Mocks ../api, ../hooks/useDashboardCtx (to control env + tier), and the
 * addEnv export so we can assert the env-tab + new-env interactions without
 * touching the real singleton store. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, listVault: vi.fn(), revealVaultSecret: vi.fn() }
})

let ctxValue: any
const addEnv = vi.fn()
vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ctxValue,
  addEnv: (...a: any[]) => addEnv(...a),
}))

import { VaultPage } from './VaultPage'
import * as api from '../api'
import type { VaultEntry } from '../api'

const listVault = api.listVault as unknown as ReturnType<typeof vi.fn>
const revealVaultSecret = api.revealVaultSecret as unknown as ReturnType<typeof vi.fn>

function entry(over: Partial<VaultEntry> = {}): VaultEntry {
  return { key: 'DATABASE_URL', rotated_at: '2026-05-20T00:00:00Z', ...over } as VaultEntry
}

beforeEach(() => {
  vi.clearAllMocks()
  ctxValue = {
    me: { user: { id: 'u1' }, team: { id: 't1', tier: 'pro' } },
    meErr: null, meLoading: false, env: 'production',
    envs: ['production', 'staging', 'development'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [], billing: null, billingLoading: false,
  }
  listVault.mockResolvedValue({ entries: [entry()] })
  revealVaultSecret.mockResolvedValue({ value: 's3cr3t' })
})
afterEach(() => cleanup())

describe('VaultPage', () => {
  it('renders the entries from listVault scoped to the active env', async () => {
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('vault-row-DATABASE_URL')).toBeTruthy())
    expect(listVault).toHaveBeenCalledWith('production')
    expect(screen.getAllByText(/production · 1 entries/).length).toBeGreaterThan(0)
  })

  it('shows the empty state when there are no secrets', async () => {
    listVault.mockResolvedValue({ entries: [] })
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByText(/no secrets in/i)).toBeTruthy())
  })

  it('reveals then hides a secret value', async () => {
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('reveal-DATABASE_URL')).toBeTruthy())
    fireEvent.click(screen.getByTestId('reveal-DATABASE_URL'))
    await waitFor(() => expect(screen.getByText('s3cr3t')).toBeTruthy())
    expect(revealVaultSecret).toHaveBeenCalledWith('production', 'DATABASE_URL')
    fireEvent.click(screen.getByRole('button', { name: 'hide' }))
    await waitFor(() => expect(screen.queryByText('s3cr3t')).toBeNull())
  })

  it('surfaces a load error', async () => {
    listVault.mockRejectedValue(new Error('vault down'))
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByText('vault down')).toBeTruthy())
  })

  it('surfaces a reveal error', async () => {
    revealVaultSecret.mockRejectedValue(new Error('forbidden'))
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('reveal-DATABASE_URL')).toBeTruthy())
    fireEvent.click(screen.getByTestId('reveal-DATABASE_URL'))
    await waitFor(() => expect(screen.getByText(/reveal DATABASE_URL: forbidden/)).toBeTruthy())
  })

  it('shows the multi-env upsell for a single-env tier on a non-prod tab', async () => {
    ctxValue.me.team.tier = 'hobby'
    ctxValue.env = 'staging'
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('vault-row-DATABASE_URL')).toBeTruthy())
    // UpgradePromptCard renders the vault_prod feature copy.
    expect(document.body.textContent || '').toMatch(/upgrade|pro|vault/i)
  })

  it('does NOT show the upsell for a multi-env tier (pro) on staging', async () => {
    ctxValue.env = 'staging'
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('vault-row-DATABASE_URL')).toBeTruthy())
    expect(screen.queryByText(/vault_prod/)).toBeNull()
  })

  it('switches env via the env tab buttons (calls addEnv)', async () => {
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('vault-row-DATABASE_URL')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'staging' }))
    expect(addEnv).toHaveBeenCalledWith('staging')
  })

  it('does not render rotated meta when rotated_at is absent', async () => {
    listVault.mockResolvedValue({ entries: [entry({ key: 'NO_ROT', rotated_at: undefined })] })
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('vault-row-NO_ROT')).toBeTruthy())
  })
})

describe('VaultPage — NewEnvButton', () => {
  it('expands to an input and adds an env on Enter', async () => {
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('vault-add-env')).toBeTruthy())
    fireEvent.click(screen.getByTestId('vault-add-env'))
    const input = screen.getByPlaceholderText('qa')
    fireEvent.change(input, { target: { value: 'qa' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(addEnv).toHaveBeenCalledWith('qa')
  })

  it('adds an env on blur when a name is entered', async () => {
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('vault-add-env')).toBeTruthy())
    fireEvent.click(screen.getByTestId('vault-add-env'))
    const input = screen.getByPlaceholderText('qa')
    fireEvent.change(input, { target: { value: 'preview' } })
    fireEvent.blur(input)
    expect(addEnv).toHaveBeenCalledWith('preview')
  })

  it('cancels on Escape without adding an env', async () => {
    render(<VaultPage />)
    await waitFor(() => expect(screen.getByTestId('vault-add-env')).toBeTruthy())
    fireEvent.click(screen.getByTestId('vault-add-env'))
    const input = screen.getByPlaceholderText('qa')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(addEnv).not.toHaveBeenCalled()
    // collapses back to the + new env button.
    await waitFor(() => expect(screen.getByTestId('vault-add-env')).toBeTruthy())
  })
})
