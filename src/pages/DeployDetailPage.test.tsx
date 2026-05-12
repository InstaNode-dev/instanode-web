/* DeployDetailPage.test.tsx — coverage for the env-aware "Environments"
 * grid added in the env-aware deployments workstream (§10.17 follow-up).
 *
 * Scope: we drive the exported EnvironmentsGrid in isolation rather than
 * the whole DeployDetailPage. The page itself depends on SSE streaming +
 * react-router + useDashboardCtx, so spinning up the full mount tree just
 * to test a grid would be wasteful. The grid is the only piece of new UI
 * behaviour the workstream introduced — everything else on the page is
 * unchanged.
 *
 * What we assert:
 *   1. Loading skeleton renders while fetchStackFamily is in flight.
 *   2. Multi-env family renders one card per env (production / staging / dev)
 *      with the env pill, URL, and a Promote prompt for non-root members.
 *   3. Single-env family renders the production root only with no Promote
 *      prompt (root has nothing to promote from).
 *   4. upgrade_required failure renders nothing (parent component handles
 *      the upsell card — see PromoteUpsell, asserted in DeployDetailPage's
 *      existing tier-gate path).
 *   5. unknown / not_found failure renders nothing (silent fallback so a
 *      transient API hiccup never blocks the page).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { EnvironmentsGrid } from './DeployDetailPage'
import type { StackFamilyMember } from '../api'

// Mock the api module — every test installs its own fetchStackFamily
// return shape. We don't touch fetch directly because the page imports
// `import * as api from '../api'` and we want the mock to apply through
// that namespace.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchStackFamily: vi.fn(),
  }
})

import * as api from '../api'

const mockFetchFamily = api.fetchStackFamily as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockFetchFamily.mockReset()
})
afterEach(() => {
  cleanup()
})

// ─── helpers ─────────────────────────────────────────────────────────────

function member(overrides: Partial<StackFamilyMember>): StackFamilyMember {
  return {
    slug: 'stk-prod',
    name: 'demo',
    env: 'production',
    status: 'running',
    tier: 'pro',
    url: 'https://demo.deployment.instanode.dev',
    is_root: true,
    parent_stack_id: '',
    last_deploy_at: '2026-05-12T01:00:00Z',
    created_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('EnvironmentsGrid — loading state', () => {
  it('renders the 3-tile skeleton while the API call is in flight', () => {
    // Never-resolving promise so the loading branch persists.
    mockFetchFamily.mockReturnValueOnce(new Promise(() => {}))
    render(<EnvironmentsGrid slug="stk-x" stackName="demo" />)
    expect(screen.getByTestId('env-grid-skeleton')).toBeTruthy()
  })
})

describe('EnvironmentsGrid — multi-env family', () => {
  it('renders one tile per env with the env pill + URL', async () => {
    mockFetchFamily.mockResolvedValueOnce({
      ok: true,
      slug: 'stk-prod',
      total: 3,
      family: [
        member({ slug: 'stk-prod', env: 'production', is_root: true }),
        member({
          slug: 'stk-staging',
          env: 'staging',
          is_root: false,
          parent_stack_id: 'root-id',
          url: 'https://staging-demo.deployment.instanode.dev',
        }),
        member({
          slug: 'stk-dev',
          env: 'dev',
          is_root: false,
          parent_stack_id: 'root-id',
          url: 'https://dev-demo.deployment.instanode.dev',
        }),
      ],
    } as any)

    render(<EnvironmentsGrid slug="stk-prod" stackName="demo" />)
    await waitFor(() => expect(screen.getByTestId('env-grid')).toBeTruthy())

    // One env card per env name (data-testid="env-card-<env>").
    expect(screen.getByTestId('env-card-production')).toBeTruthy()
    expect(screen.getByTestId('env-card-staging')).toBeTruthy()
    expect(screen.getByTestId('env-card-dev')).toBeTruthy()

    // Non-root cards expose a Promote PromptCard for their env → production.
    // Root does NOT — there's nothing to promote FROM the root.
    const stagingCard = screen.getByTestId('env-card-staging')
    expect(stagingCard.textContent).toContain('Promote staging → production')
    const prodCard = screen.getByTestId('env-card-production')
    expect(prodCard.textContent).not.toContain('Promote production →')
  })
})

describe('EnvironmentsGrid — single-env family', () => {
  it('renders only the root with no Promote prompt', async () => {
    mockFetchFamily.mockResolvedValueOnce({
      ok: true,
      slug: 'stk-prod',
      total: 1,
      family: [member({ slug: 'stk-prod', env: 'production', is_root: true })],
    } as any)

    render(<EnvironmentsGrid slug="stk-prod" stackName="demo" />)
    await waitFor(() => expect(screen.getByTestId('env-grid')).toBeTruthy())

    const prodCard = screen.getByTestId('env-card-production')
    expect(prodCard).toBeTruthy()
    // No staging / dev cards — single-env family.
    expect(screen.queryByTestId('env-card-staging')).toBeNull()
    expect(screen.queryByTestId('env-card-dev')).toBeNull()
    // Root has no per-card promote prompt.
    expect(prodCard.textContent).not.toContain('Promote')
  })
})

describe('EnvironmentsGrid — failure modes render nothing', () => {
  it("renders null on upgrade_required (parent shows PromoteUpsell)", async () => {
    mockFetchFamily.mockResolvedValueOnce({ ok: false, reason: 'upgrade_required' } as any)
    const { container } = render(<EnvironmentsGrid slug="stk-x" stackName="demo" />)
    await waitFor(() => expect(mockFetchFamily).toHaveBeenCalled())
    // Container is rendered but its only child is the EnvironmentsGrid,
    // which on failure returns null. So no grid, no skeleton, no empty card.
    expect(container.querySelector('[data-testid="env-grid"]')).toBeNull()
    expect(container.querySelector('[data-testid="env-grid-skeleton"]')).toBeNull()
    expect(container.querySelector('[data-testid="env-grid-empty"]')).toBeNull()
  })

  it("renders null on reason='unknown' so transient API failures don't block the page", async () => {
    mockFetchFamily.mockResolvedValueOnce({ ok: false, reason: 'unknown' } as any)
    const { container } = render(<EnvironmentsGrid slug="stk-x" stackName="demo" />)
    await waitFor(() => expect(mockFetchFamily).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="env-grid"]')).toBeNull()
  })
})

describe('EnvironmentsGrid — empty family fallback', () => {
  it("renders the empty-state hint when ok=true but family is empty (degraded API)", async () => {
    mockFetchFamily.mockResolvedValueOnce({ ok: true, slug: 'stk-x', total: 0, family: [] } as any)
    render(<EnvironmentsGrid slug="stk-x" stackName="demo" />)
    await waitFor(() => expect(screen.getByTestId('env-grid-empty')).toBeTruthy())
  })
})
