/* OverviewPage.unlimited.test.tsx — exercises the storage-tile unlimited (∞)
 * branch. No tier in plans.yaml has an unlimited object-storage cap today, so
 * the only way to reach the `storageUnlimited ? '∞'` path (and cover that line)
 * is to mock the per-tier limit helper to return -1. This guarantees the tile
 * renders ∞ honestly if a future tier ever sets storage_storage_mb: -1. */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const listResourcesMock = vi.fn().mockResolvedValue({ ok: true, items: [], total: 0 })
const fetchActivityMock = vi.fn().mockResolvedValue({ ok: true, items: [] })
const listDeploymentsMock = vi.fn().mockResolvedValue({ ok: true, items: [], total: 0 })

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listResources: (...a: unknown[]) => listResourcesMock(...a),
    fetchActivity: (...a: unknown[]) => fetchActivityMock(...a),
    listDeployments: (...a: unknown[]) => listDeploymentsMock(...a),
  }
})

vi.mock('../hooks/useDashboardCtx', () => ({ useDashboardCtx: vi.fn() }))

// Force the object-storage cap to -1 (unlimited) for this suite only.
vi.mock('../lib/planLimits', async () => {
  const actual = await vi.importActual<typeof import('../lib/planLimits')>('../lib/planLimits')
  return {
    ...actual,
    objectStorageLimitGBFor: () => -1,
  }
})

import { OverviewPage } from './OverviewPage'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Overview object-storage tile — unlimited (∞) branch', () => {
  it('renders "∞" in the tile label when the tier object cap is -1', async () => {
    vi.mocked(useDashboardCtx).mockReturnValue({
      me: { user: { id: 'u', email: 'e', tier: 'team' }, team: { id: 't', slug: 's', name: 's', tier: 'team' } },
      meErr: null,
      meLoading: false,
      env: 'production',
      envs: ['production'],
      counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
      resources: [],
    } as never)

    const { container } = render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(listResourcesMock).toHaveBeenCalled())

    const tiles = Array.from(container.querySelectorAll('.stat .k'))
    const objTile = tiles.find((k) => (k.textContent ?? '').includes('object storage'))
    expect(objTile).toBeTruthy()
    expect(objTile!.textContent).toContain('∞')
    // sub-line also reflects unlimited
    await waitFor(() => {
      expect(container.textContent).toContain('unlimited · team tier')
    })
  })
})
