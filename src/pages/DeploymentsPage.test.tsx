/* DeploymentsPage.test.tsx — list-surface coverage for /app/deployments.
 *
 * Scope: the page now reads GET /api/v1/deployments via listDeployments()
 * (was: listStacks(), which showed an empty list for /deploy/new
 * deployments). We assert:
 *   1. Empty state copy no longer mentions "Phase 1" / kubectl. It points
 *      the user at the agent prompt instead.
 *   2. Non-empty state renders real rows: name, URL, env pill, status pill.
 *   3. Failure path renders the same honest empty state (no fabricated rows).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock the api module so the page's useEffect resolves with controlled
// shapes. We don't touch fetch() directly because the page imports the
// api as a namespace.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listDeployments: vi.fn(),
  }
})

import { DeploymentsPage } from './DeploymentsPage'
import * as api from '../api'
import type { DashboardDeployment } from '../api'

const mockListDeployments = api.listDeployments as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockListDeployments.mockReset()
})
afterEach(() => cleanup())

function withRouter(ui: React.ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>
}

function dep(overrides: Partial<DashboardDeployment> = {}): DashboardDeployment {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    app_id: '6fffcc21',
    name: '6fffcc21',
    url: 'https://6fffcc21.deployment.instanode.dev',
    status: 'running',
    env: 'production',
    port: 8080,
    tier: 'pro',
    env_vars: {},
    created_at: '2026-05-12T11:00:00Z',
    last_deploy_at: '2026-05-12T11:30:00Z',
    ...overrides,
  }
}

describe('DeploymentsPage — empty state', () => {
  it('shows the agent-prompt copy (not the legacy "Phase 1 / kubectl" hint)', async () => {
    mockListDeployments.mockResolvedValueOnce({ ok: true, items: [], total: 0 })
    render(withRouter(<DeploymentsPage />))

    const empty = await screen.findByTestId('deployments-empty')
    expect(empty).toBeTruthy()
    const text = empty.textContent ?? ''

    // Negative assertions — the legacy copy must be gone.
    expect(text).not.toMatch(/Phase 1/)
    expect(text).not.toMatch(/kubectl/)
    expect(text).not.toMatch(/your own cluster/)

    // Positive — the new copy nudges the user toward the agent prompt.
    expect(text).toMatch(/Ask your agent/i)
    expect(text).toMatch(/POST/)
    expect(text).toMatch(/\/deploy\/new/)
  })

  it('renders the same honest empty state when listDeployments rejects', async () => {
    // The page swallows errors and falls back to the empty state — better
    // than rendering a fabricated row. The contract test in index.test.ts
    // asserts the API helper *does* propagate so a future surface could
    // render a real error banner; this surface chooses empty for now.
    mockListDeployments.mockRejectedValueOnce(new Error('network'))
    render(withRouter(<DeploymentsPage />))
    const empty = await screen.findByTestId('deployments-empty')
    expect(empty.textContent).toMatch(/No deployments yet/)
  })
})

describe('DeploymentsPage — non-empty state', () => {
  it('renders one row per deployment with name, URL, and status pill', async () => {
    mockListDeployments.mockResolvedValueOnce({
      ok: true,
      total: 2,
      items: [
        dep({ id: 'uuid-a', app_id: 'app-a', name: 'app-a', url: 'https://app-a.deployment.instanode.dev', status: 'running', env: 'production' }),
        dep({ id: 'uuid-b', app_id: 'app-b', name: 'app-b', url: 'https://app-b.deployment.instanode.dev', status: 'building', env: 'staging' }),
      ],
    })

    const { container } = render(withRouter(<DeploymentsPage />))

    // Wait for the rows to appear (post-fetch). The non-empty marker is
    // simply the absence of the deployments-empty cell.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="deployments-empty"]')).toBeNull(),
    )

    // Each row is a <Link to="/deployments/:app_id"> — we route by app_id
    // (not the UUID `id`) because GET /api/v1/deployments/:id on the
    // agent API resolves `:id` against the app_id column. Routing by
    // UUID would 404.
    const links = Array.from(container.querySelectorAll('a[href^="/deployments/"]'))
    expect(links.length).toBe(2)
    expect(links.map((a) => a.getAttribute('href'))).toContain('/deployments/app-a')
    expect(links.map((a) => a.getAttribute('href'))).toContain('/deployments/app-b')

    // URL column renders the hostname (https:// stripped). Use textContent
    // on the full page rather than scoping to row — the row uses CSS grid
    // and inline children, no semantic <a> wrapping.
    expect(container.textContent).toContain('app-a.deployment.instanode.dev')
    expect(container.textContent).toContain('app-b.deployment.instanode.dev')

    // Status pill renders 'healthy' for running, 'building' for building.
    expect(container.textContent).toMatch(/healthy/)
    expect(container.textContent).toMatch(/building/)
  })

  it("emits 'building' pill for a deploy in 'deploying' phase (no separate styling)", async () => {
    mockListDeployments.mockResolvedValueOnce({
      ok: true,
      total: 1,
      items: [dep({ id: 'c', app_id: 'c', name: 'c', status: 'deploying' as any })],
    })
    const { container } = render(withRouter(<DeploymentsPage />))
    await waitFor(() =>
      expect(container.querySelector('[data-testid="deployments-empty"]')).toBeNull(),
    )
    // deploying → building in the shared pill so users see a single
    // "in-progress" visual rather than two near-identical states.
    expect(container.textContent).toMatch(/building/)
  })
})
