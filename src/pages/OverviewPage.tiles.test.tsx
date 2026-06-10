/* OverviewPage.tiles.test.tsx — 2026-06-11 tile-accuracy fix coverage.
 *
 * Two confirmed production bugs on real dashboards:
 *   1. CONNECTION LIMIT tile read "∞" for a Pro user (cap is 20) because the
 *      old code summed per-resource connections_limit and any -1 resource
 *      (redis/queue/storage/webhook are legitimately -1) flipped it to ∞.
 *   2. OBJECT-STORAGE denominator read a conflated ~81 GiB sum of every
 *      per-service cap. Pro's object cap is 50 GB.
 *   3. Recent-activity rendered ~20 blank "—" rows when audit summaries were
 *      empty.
 *
 * These tests render the page with a Pro tier + a Redis resource present (the
 * exact trigger for bug 1) and assert the honest values.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Resource, ActivityItem } from '../api'

const listResourcesMock = vi.fn()
const fetchActivityMock = vi.fn()
const listDeploymentsMock = vi.fn()

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listResources: (...a: unknown[]) => listResourcesMock(...a),
    fetchActivity: (...a: unknown[]) => fetchActivityMock(...a),
    listDeployments: (...a: unknown[]) => listDeploymentsMock(...a),
  }
})

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: vi.fn(),
}))

import { OverviewPage } from './OverviewPage'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function ctxFor(tier: string) {
  return {
    me: { user: { id: 'u', email: 'me@test', tier }, team: { id: 't', slug: 's', name: 's', tier } },
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [],
  }
}

function makeResource(over: Partial<Resource>): Resource {
  return {
    id: over.id ?? 'r1',
    token: over.token ?? 'tok_abc',
    resource_type: over.resource_type ?? 'postgres',
    tier: (over.tier ?? 'pro') as Resource['tier'],
    status: 'active',
    name: over.name ?? 'db',
    env: 'production',
    storage_bytes: over.storage_bytes ?? 0,
    storage_limit_bytes: over.storage_limit_bytes ?? 0,
    storage_exceeded: false,
    connections_limit: over.connections_limit,
    created_at: new Date().toISOString(),
    expires_at: null,
    ...over,
  } as Resource
}

async function renderOverview(tier: string, resources: Resource[], activity: ActivityItem[] = []) {
  vi.mocked(useDashboardCtx).mockReturnValue(ctxFor(tier) as never)
  listResourcesMock.mockResolvedValue({ ok: true, items: resources, total: resources.length })
  fetchActivityMock.mockResolvedValue({ ok: true, items: activity })
  listDeploymentsMock.mockResolvedValue({ ok: true, items: [], total: 0 })
  const r = render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>,
  )
  // Wait for the async useEffect to settle (loading cleared).
  await waitFor(() => expect(listResourcesMock).toHaveBeenCalled())
  return r
}

// Helper: find the .stat tile whose .k label contains `label`, return its .v.
function statValue(container: HTMLElement, label: string): string {
  const tiles = Array.from(container.querySelectorAll('.stat'))
  const tile = tiles.find((t) => (t.querySelector('.k')?.textContent ?? '').includes(label))
  if (!tile) throw new Error(`no stat tile with label containing "${label}"`)
  return tile.querySelector('.v')?.textContent?.trim() ?? ''
}
function statLabel(container: HTMLElement, label: string): string {
  const tiles = Array.from(container.querySelectorAll('.stat'))
  const tile = tiles.find((t) => (t.querySelector('.k')?.textContent ?? '').includes(label))
  if (!tile) throw new Error(`no stat tile with label containing "${label}"`)
  return tile.querySelector('.k')?.textContent ?? ''
}

describe('Overview connection-limit tile (bug 1)', () => {
  it('Pro with a Redis resource present shows 20, NOT ∞', async () => {
    // The exact production trigger: a -1 (redis) resource alongside finite dbs.
    const { container } = await renderOverview('pro', [
      makeResource({ id: 'pg', resource_type: 'postgres', connections_limit: 20 }),
      makeResource({ id: 'rd', resource_type: 'redis', connections_limit: -1 }),
    ])
    await waitFor(() => {
      expect(statValue(container, 'connection limit')).toBe('20')
    })
    expect(statValue(container, 'connection limit')).not.toBe('∞')
  })

  it('free shows 2 (its real per-db cap)', async () => {
    const { container } = await renderOverview('free', [])
    await waitFor(() => expect(statValue(container, 'connection limit')).toBe('2'))
  })

  it('team shows 100', async () => {
    const { container } = await renderOverview('team', [])
    await waitFor(() => expect(statValue(container, 'connection limit')).toBe('100'))
  })
})

describe('Overview object-storage tile (bug 2)', () => {
  it('Pro denominator is the 50 GB object cap, not a conflated sum', async () => {
    // Resources whose summed storage_limit_bytes would be huge — but only the
    // object-store cap should drive the denominator.
    const { container } = await renderOverview('pro', [
      makeResource({ id: 'pg', resource_type: 'postgres', storage_bytes: 1e9, storage_limit_bytes: 10 * 1024 ** 3 }),
      makeResource({ id: 'mg', resource_type: 'mongodb', storage_bytes: 5e8, storage_limit_bytes: 5 * 1024 ** 3 }),
      makeResource({ id: 'st', resource_type: 'storage', storage_bytes: 2e9, storage_limit_bytes: -1 }),
    ])
    await waitFor(() => {
      expect(statLabel(container, 'object storage')).toContain('50 GB')
    })
    // numerator = object-store bytes (2e9) in GiB ≈ 1.86, not the pg/mongo sum.
    // (.v includes the "GiB" unit span — assert the numeric prefix.)
    expect(statValue(container, 'object storage')).toContain((2e9 / 1024 ** 3).toFixed(2))
  })

  it('free shows its real 0.0097 GB cap label (not ∞)', async () => {
    const { container } = await renderOverview('free', [])
    await waitFor(() => {
      const label = statLabel(container, 'object storage')
      expect(label).not.toContain('∞')
      // free object cap is 10 MB == 10/1024 GB.
      expect(label).toContain((10 / 1024).toString())
    })
  })
})

describe('Overview recent-activity empty-state (bug 3)', () => {
  it('renders a single empty-state row, not blank rows, when summaries are empty', async () => {
    const blank: ActivityItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`,
      at: new Date().toISOString(),
      level: 'info',
      text: '   ', // whitespace-only / empty summary — the bug input
    })) as unknown as ActivityItem[]
    await renderOverview('pro', [makeResource({})], blank)
    await waitFor(() => {
      expect(screen.getByTestId('recent-activity-empty')).toBeTruthy()
    })
    // No content-ful feed rows survived the filter.
    const feedRows = document.querySelectorAll('.feed-row')
    expect(feedRows.length).toBe(1) // only the empty-state row
  })

  it('renders real rows and drops only the empty ones', async () => {
    const mixed: ActivityItem[] = [
      { id: 'a1', at: new Date().toISOString(), level: 'info', text: 'agent provisioned postgres tok_x' },
      { id: 'a2', at: new Date().toISOString(), level: 'info', text: '' },
      { id: 'a3', at: new Date().toISOString(), level: 'info', text: 'agent provisioned redis tok_y' },
    ] as unknown as ActivityItem[]
    await renderOverview('pro', [makeResource({})], mixed)
    await waitFor(() => {
      expect(screen.queryByTestId('recent-activity-empty')).toBeNull()
    })
    const feed = document.querySelector('.feed') as HTMLElement
    const texts = Array.from(feed.querySelectorAll('.feed-row .text')).map((n) => n.textContent)
    expect(texts).toEqual(['agent provisioned postgres tok_x', 'agent provisioned redis tok_y'])
  })
})
