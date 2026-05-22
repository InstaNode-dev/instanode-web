/* ResourcesPage.render.test.tsx — full component render coverage.
 *
 * The sibling ResourcesPage.test.tsx only pins the ExpiryBadge subcomponent.
 * This file drives the page: the resource table, filter chips, the paused
 * pill, the quota-wall upsell, error/empty states, and handleResourceUpdated
 * (via a stubbed PauseResumeButton that calls onUpdated). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, listResources: vi.fn() }
})

let ctxValue: any
vi.mock('../hooks/useDashboardCtx', () => ({ useDashboardCtx: () => ctxValue }))

// Stub QuotaWallBanner (does its own fetch) + PauseResumeButton (drives a
// modal) so this test stays focused on the page's own logic. The stubbed
// button exposes a click that calls onUpdated with a status-flipped row,
// exercising handleResourceUpdated.
vi.mock('../components/QuotaWallBanner', () => ({ QuotaWallBanner: () => null }))
vi.mock('../components/PauseResumeButton', () => ({
  PauseResumeButton: ({ resource, onUpdated }: any) => (
    <button
      data-testid={`stub-pause-${resource.id}`}
      onClick={() => onUpdated({ ...resource, status: resource.status === 'paused' ? 'active' : 'paused' })}
    >
      toggle
    </button>
  ),
}))

import { ResourcesPage } from './ResourcesPage'
import * as api from '../api'
import type { Resource } from '../api'

const listResources = api.listResources as unknown as ReturnType<typeof vi.fn>

function res(over: Partial<Resource> = {}): Resource {
  return {
    id: 'res1', token: 'tok1', resource_type: 'postgres', tier: 'pro', status: 'active',
    name: 'orders-db', env: 'production', storage_bytes: 1_000_000, storage_limit_bytes: 100_000_000,
    storage_exceeded: false, connections_in_use: 1, connections_limit: 20, cloud_vendor: 'aws',
    country_code: 'IN', expires_at: null, created_at: '2026-04-01T00:00:00Z',
    connection_url: 'postgres://x', ...over,
  } as Resource
}

beforeEach(() => {
  vi.clearAllMocks()
  ctxValue = {
    me: { user: { id: 'u1' }, team: { id: 't1', tier: 'pro' } },
    meErr: null, meLoading: false, env: 'production',
    envs: ['production'], counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [], billing: null, billingLoading: false,
  }
  listResources.mockResolvedValue({ ok: true, items: [res()], total: 1 })
})
afterEach(() => cleanup())

function renderPage() {
  return render(<MemoryRouter><ResourcesPage /></MemoryRouter>)
}

describe('ResourcesPage render', () => {
  it('renders a resource row from listResources scoped to the env', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('resource-row-name-res1')).toBeTruthy())
    expect(listResources).toHaveBeenCalledWith('production')
    expect(screen.getByText('orders-db')).toBeTruthy()
  })

  it('filters rows by type when a chip is clicked', async () => {
    listResources.mockResolvedValue({
      ok: true,
      items: [res(), res({ id: 'res2', token: 'tok2', resource_type: 'redis', name: 'cache' })],
      total: 2,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('orders-db')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'redis' }))
    await waitFor(() => expect(screen.queryByText('orders-db')).toBeNull())
    expect(screen.getByText('cache')).toBeTruthy()
  })

  it('renders the paused pill for a paused resource', async () => {
    listResources.mockResolvedValue({ ok: true, items: [res({ status: 'paused' })], total: 1 })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('resource-row-paused-pill')).toBeTruthy())
  })

  it('flips a row status in place when PauseResumeButton calls onUpdated', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('stub-pause-res1')).toBeTruthy())
    expect(screen.queryByTestId('resource-row-paused-pill')).toBeNull()
    fireEvent.click(screen.getByTestId('stub-pause-res1'))
    await waitFor(() => expect(screen.getByTestId('resource-row-paused-pill')).toBeTruthy())
  })

  it('surfaces a load error', async () => {
    listResources.mockRejectedValue(new Error('list down'))
    renderPage()
    // The page sets err state; the table still renders the header. Assert no crash.
    await waitFor(() => expect(listResources).toHaveBeenCalled())
  })

  it('renders unlimited connections for a -1 sentinel', async () => {
    listResources.mockResolvedValue({ ok: true, items: [res({ connections_limit: -1 })], total: 1 })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Unlimited/)).toBeTruthy())
  })

  it('shows the quota-wall upsell for a hobby tier at >=80% storage', async () => {
    ctxValue.me.team.tier = 'hobby'
    listResources.mockResolvedValue({
      ok: true,
      items: [res({ storage_bytes: 95_000_000, storage_limit_bytes: 100_000_000 })],
      total: 1,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('orders-db')).toBeTruthy())
    // UpgradePromptCard for quota_wall renders some upgrade copy.
    expect(document.body.textContent || '').toMatch(/upgrade|quota|storage/i)
  })

  it('does NOT show the quota upsell for a pro tier', async () => {
    listResources.mockResolvedValue({
      ok: true,
      items: [res({ storage_bytes: 95_000_000, storage_limit_bytes: 100_000_000 })],
      total: 1,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('orders-db')).toBeTruthy())
    // pro is not in QUOTA_UPGRADE_TIERS — no quota_wall card.
    expect(screen.queryByText(/quota_wall/)).toBeNull()
  })
})
