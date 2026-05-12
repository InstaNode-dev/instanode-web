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
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DeployDetailPage, EnvironmentsGrid } from './DeployDetailPage'
import type { DashboardDeployment, Resource, StackFamilyMember } from '../api'

// Mock streamSSE so the log panel doesn't try to open a real connection
// (jsdom has no SSE). We capture the path the page asks for so the log
// SSE URL contract can be asserted.
const sseCalls: string[] = []
vi.mock('../lib/sseStream', () => ({
  streamSSE: vi.fn((path: string) => {
    sseCalls.push(path)
    return () => {}
  }),
}))

// Mock useDashboardCtx so the page has a stable tier (the chrome reads
// ctx.me.user.tier to decide whether to show the custom-domain panel).
vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: {
      user: { id: 'u', email: 'me@test', tier: 'pro' },
      team: { id: 't', slug: 'test', name: 'test', tier: 'pro' },
    },
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 1, vault: 0, team: 1 },
  }),
}))

// Mock the api module — every test installs its own fetchStackFamily
// return shape. We don't touch fetch directly because the page imports
// `import * as api from '../api'` and we want the mock to apply through
// that namespace.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchStackFamily: vi.fn(),
    getDeployment: vi.fn(),
    listStacks: vi.fn(),
    listResources: vi.fn(),
  }
})

import * as api from '../api'

const mockFetchFamily = api.fetchStackFamily as unknown as ReturnType<typeof vi.fn>
const mockGetDeployment = api.getDeployment as unknown as ReturnType<typeof vi.fn>
const mockListStacks = api.listStacks as unknown as ReturnType<typeof vi.fn>
const mockListResources = api.listResources as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockFetchFamily.mockReset()
  mockGetDeployment.mockReset()
  mockListStacks.mockReset()
  mockListResources.mockReset()
  sseCalls.length = 0
  // Sensible defaults so tests that don't care about these don't blow up
  // on undefined returns.
  mockFetchFamily.mockResolvedValue({ ok: false, reason: 'unknown' })
  mockListStacks.mockResolvedValue({ ok: true, items: [], total: 0 })
  mockListResources.mockResolvedValue({ ok: true, items: [], total: 0 })
})
afterEach(() => {
  cleanup()
})

// ─── Helpers for the new DeployDetailPage tests ──────────────────────────

function deployment(overrides: Partial<DashboardDeployment> = {}): DashboardDeployment {
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

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/deployments/:id" element={<DeployDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

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

// ─── DeployDetailPage — env_vars panel ───────────────────────────────────
//
// The Env vars tab used to render a hardcoded "Phase 1 coming soon" hint.
// It now parses the deployment's env_vars map and renders real rows, with
// vault refs (vault://env/KEY) tagged via a "vault" badge. We drive the
// whole page (not just the panel) so the parent's data fetch + tab-switch
// flow is exercised — that's where the bug lived.
describe('DeployDetailPage — env_vars panel parses + renders real rows', () => {
  it('renders one row per env_var, with vault badges on vault refs', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({
        env_vars: {
          DATABASE_URL: 'vault://env/DATABASE_URL',
          NODE_ENV: 'production',
          PORT: '8080',
        },
      }),
    })

    const { container } = renderPage(`/deployments/${deployment().id}`)

    // Wait for the chrome to render past the skeleton.
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())

    // Switch to the Env vars tab (default is Overview). The tab is a
    // button labelled "Env vars" in the chrome.
    const envTab = await waitFor(() => screen.getByText('Env vars'))
    envTab.click()

    await waitFor(() => expect(screen.getByTestId('env-vars-panel')).toBeTruthy())

    // Three rows, one per env var (sorted alphabetically by key).
    expect(screen.getByTestId('env-var-row-DATABASE_URL')).toBeTruthy()
    expect(screen.getByTestId('env-var-row-NODE_ENV')).toBeTruthy()
    expect(screen.getByTestId('env-var-row-PORT')).toBeTruthy()

    // Only the vault-ref value gets the vault badge.
    expect(screen.getByTestId('env-var-vault-badge-DATABASE_URL')).toBeTruthy()
    expect(container.querySelector('[data-testid="env-var-vault-badge-NODE_ENV"]')).toBeNull()
    expect(container.querySelector('[data-testid="env-var-vault-badge-PORT"]')).toBeNull()
  })

  it('renders the empty-state hint when env_vars is empty', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ env_vars: {} }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())
    const envTab = await waitFor(() => screen.getByText('Env vars'))
    envTab.click()
    await waitFor(() => expect(screen.getByTestId('env-vars-empty')).toBeTruthy())
  })
})

// ─── DeployDetailPage — bound resources surface from env_vars ────────────
describe('DeployDetailPage — bound resources from env_vars', () => {
  it('surfaces a resource row when an env_var value is a UUID that matches a user resource', async () => {
    const resourceID = '99999999-9999-4999-8999-999999999999'
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({
        env_vars: {
          DATABASE_URL: resourceID,
          SOMETHING_ELSE: 'not-a-uuid',
        },
      }),
    })
    mockListResources.mockResolvedValueOnce({
      ok: true,
      total: 1,
      items: [
        {
          id: resourceID,
          token: resourceID,
          resource_type: 'postgres',
          tier: 'pro',
          status: 'active',
          name: 'my-app-db',
          env: 'production',
          storage_bytes: 0,
          storage_limit_bytes: 0,
          storage_exceeded: false,
          created_at: '2026-05-12T10:00:00Z',
          expires_at: null,
        } as Resource,
      ],
    })

    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())

    const tab = await waitFor(() => screen.getByText('Resources'))
    tab.click()

    await waitFor(() => expect(screen.getByTestId('bound-resources-panel')).toBeTruthy())
    expect(screen.getByTestId('bound-resource-row-DATABASE_URL')).toBeTruthy()

    // The matching resource is listed; the non-matching env var is not.
    const panel = screen.getByTestId('bound-resources-panel')
    expect(panel.textContent).toContain('my-app-db')
    expect(panel.textContent).not.toContain('SOMETHING_ELSE')
  })

  it('renders the empty-state hint when no env_var values match a user resource', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ env_vars: { FOO: 'bar', PORT: '8080' } }),
    })
    mockListResources.mockResolvedValueOnce({ ok: true, items: [], total: 0 })

    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())
    const tab = await waitFor(() => screen.getByText('Resources'))
    tab.click()

    await waitFor(() => expect(screen.getByTestId('bound-resources-empty')).toBeTruthy())
    // No "(mocked)" admission anywhere in the panel — the page is honest now.
    expect(screen.getByTestId('bound-resources-empty').textContent).not.toContain('mocked')
  })
})

// ─── DeployDetailPage — log SSE URL points at /deploy/:id/logs ───────────
//
// The previous build streamed logs from /api/v1/stacks/:slug/logs/web,
// which was wrong for /deploy/new deployments. The fix sends the page to
// GET /deploy/:id/logs (single-container SSE) when a deployment is
// loaded, and keeps the stack URL when a stack is loaded.
describe('DeployDetailPage — log SSE URL', () => {
  it('subscribes to /deploy/:app_id/logs for a /deploy/new deployment', async () => {
    const d = deployment()
    mockGetDeployment.mockResolvedValueOnce({ ok: true, deployment: d })

    renderPage(`/deployments/${d.app_id}`)
    // The Overview tab renders LiveBuild inline, so the SSE call fires
    // even without an explicit tab switch.
    await waitFor(() => expect(sseCalls.length).toBeGreaterThan(0))

    // The agent API resolves /deploy/:id against the app_id column —
    // routing the SSE by UUID would 404. Locking that contract in.
    expect(sseCalls[0]).toBe(`/deploy/${d.app_id}/logs`)
    // Critically, we are NOT hitting the legacy stack endpoint.
    expect(sseCalls.some((p) => p.startsWith('/api/v1/stacks/'))).toBe(false)
  })

  it('falls back to /api/v1/stacks/:slug/logs/web for a legacy stack deploy', async () => {
    // Deployment lookup returns null → page falls through to listStacks.
    mockGetDeployment.mockResolvedValueOnce({ ok: true, deployment: null })
    mockListStacks.mockResolvedValueOnce({
      ok: true,
      total: 1,
      items: [{
        id: 'stk-1',
        slug: 'demo-prod',
        name: 'demo',
        status: 'running',
        url: 'https://demo.deployment.instanode.dev',
        created_at: 'x',
        team_id: '',
        env: 'production',
        tier: 'pro',
      } as any],
    })

    renderPage(`/deployments/stk-1`)
    await waitFor(() => expect(sseCalls.length).toBeGreaterThan(0))

    expect(sseCalls[0]).toBe('/api/v1/stacks/demo-prod/logs/web')
  })
})
