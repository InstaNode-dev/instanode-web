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
    updateDeploymentAccess: vi.fn(),
    // W12 H12: Audit tab on DeployDetailPage now reuses the
    // ResourceDetailPage AuditPanel, which calls fetchResourceAudit.
    // Mocked here so the audit-tab tests can drive load/empty states
    // without firing a real network call.
    fetchResourceAudit: vi.fn(),
  }
})

import * as api from '../api'

const mockFetchFamily = api.fetchStackFamily as unknown as ReturnType<typeof vi.fn>
const mockGetDeployment = api.getDeployment as unknown as ReturnType<typeof vi.fn>
const mockListStacks = api.listStacks as unknown as ReturnType<typeof vi.fn>
const mockListResources = api.listResources as unknown as ReturnType<typeof vi.fn>
const mockUpdateAccess = api.updateDeploymentAccess as unknown as ReturnType<typeof vi.fn>
const mockFetchAudit = api.fetchResourceAudit as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockFetchFamily.mockReset()
  mockGetDeployment.mockReset()
  mockListStacks.mockReset()
  mockListResources.mockReset()
  mockUpdateAccess.mockReset()
  mockFetchAudit.mockReset()
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

// ─── DeployDetailPage — privacy panel (Track B) ──────────────────────────
//
// Coverage for the deploy's privacy state surface:
//   1. Public deploy renders the public hint, no `private` badge.
//   2. Private deploy renders the badge, IP allow-list (disabled), and
//      the "N IPs allowed" status line.
//   3. Pro+ tier (the mocked useDashboardCtx default) gets the edit
//      button; clicking it reveals the toggle + IpAllowList.
//   4. Save calls updateDeploymentAccess. A 404 (Track A endpoint not yet
//      shipped) surfaces the "edits pending backend" hint instead of a
//      raw error.
import { fireEvent } from '@testing-library/react'

describe('DeployDetailPage — privacy panel', () => {
  it('renders the public-hint card when the deploy is public', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ private: false, allowed_ips: [] }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(screen.getByTestId('privacy-panel')).toBeTruthy())
    expect(screen.getByTestId('privacy-public-hint')).toBeTruthy()
    // No `private` badge in the header for a public deploy.
    expect(screen.queryByTestId('privacy-badge')).toBeNull()
    expect(screen.getByTestId('privacy-state').textContent).toContain('public')
  })

  it('renders the private badge + IP list (disabled) for a private deploy', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({
        private: true,
        allowed_ips: ['8.8.8.8', '10.0.0.0/8'],
      }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(screen.getByTestId('privacy-panel')).toBeTruthy())
    expect(screen.getByTestId('privacy-badge')).toBeTruthy()
    expect(screen.getByTestId('privacy-state').textContent).toContain('private')
    expect(screen.getByTestId('privacy-state').textContent).toContain('2 IPs allowed')
    // The IpAllowList renders its chips (disabled mode hides × buttons).
    expect(screen.getByTestId('ip-allow-list-chip-8.8.8.8')).toBeTruthy()
    expect(screen.getByTestId('ip-allow-list-chip-10.0.0.0/8')).toBeTruthy()
  })

  it('renders the empty-allowlist hint for private with no allowed_ips', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ private: true, allowed_ips: [] }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(screen.getByTestId('privacy-panel')).toBeTruthy())
    expect(screen.getByTestId('privacy-empty-allowlist')).toBeTruthy()
  })

  it('Pro+ tier sees the edit button; click reveals the toggle + IpAllowList', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ private: false, allowed_ips: [] }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(screen.getByTestId('privacy-panel')).toBeTruthy())
    const editBtn = screen.getByTestId('privacy-edit-btn')
    fireEvent.click(editBtn)
    expect(screen.getByTestId('privacy-edit-private-toggle')).toBeTruthy()
    // Toggle Private on → IpAllowList appears.
    const toggle = screen.getByTestId('privacy-edit-private-toggle') as HTMLInputElement
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
    expect(screen.getByTestId('ip-allow-list')).toBeTruthy()
  })

  it('save calls updateDeploymentAccess with the edited state', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ private: false, allowed_ips: [] }),
    })
    mockUpdateAccess.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ private: true, allowed_ips: ['8.8.8.8'] }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(screen.getByTestId('privacy-panel')).toBeTruthy())
    fireEvent.click(screen.getByTestId('privacy-edit-btn'))
    fireEvent.click(screen.getByTestId('privacy-edit-private-toggle'))
    const input = screen.getByTestId('ip-allow-list-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '8.8.8.8' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('privacy-edit-save'))
    await waitFor(() => expect(mockUpdateAccess).toHaveBeenCalled())
    expect(mockUpdateAccess.mock.calls[0]).toEqual([
      deployment().id,
      true,
      ['8.8.8.8'],
    ])
  })

  it('surfaces a friendly "edits pending backend" hint on 404 from updateDeploymentAccess', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ private: false, allowed_ips: [] }),
    })
    mockUpdateAccess.mockRejectedValueOnce(
      Object.assign(new Error('not_found'), { status: 404 }),
    )
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(screen.getByTestId('privacy-panel')).toBeTruthy())
    fireEvent.click(screen.getByTestId('privacy-edit-btn'))
    fireEvent.click(screen.getByTestId('privacy-edit-private-toggle'))
    const input = screen.getByTestId('ip-allow-list-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '8.8.8.8' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('privacy-edit-save'))
    await waitFor(() => expect(mockUpdateAccess).toHaveBeenCalled())
    const errBanner = await waitFor(() => screen.getByTestId('privacy-edit-error'))
    expect(errBanner.textContent ?? '').toMatch(/PATCH endpoint|still rolling out/i)
  })

  it('save button is disabled when Private is on but allowed_ips is empty', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ private: false, allowed_ips: [] }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(screen.getByTestId('privacy-panel')).toBeTruthy())
    fireEvent.click(screen.getByTestId('privacy-edit-btn'))
    fireEvent.click(screen.getByTestId('privacy-edit-private-toggle'))
    const save = screen.getByTestId('privacy-edit-save') as HTMLButtonElement
    // private=true, allowed_ips=[] → save disabled (matches backend
    // validation: 400 on empty list when private).
    expect(save.disabled).toBe(true)
  })
})

// ─── DeployDetailPage — Metrics + Audit tabs render content (W12 H12) ────
//
// Pre-W12 these two tabs rendered nothing — the chrome shipped a
// "blocked" pill in the tab header and clicking the tab dropped the
// user on an empty page body. The fix: Metrics shows an honest empty
// state pointing at the per-resource metrics surface, Audit renders
// the same AuditPanel ResourceDetailPage uses (when the deploy is bound
// to a resource) or its own empty state.

describe('DeployDetailPage — Metrics tab (W12 H12)', () => {
  it('renders an honest empty state that points at per-resource metrics for a bound resource', async () => {
    const resourceID = '99999999-9999-4999-8999-999999999999'
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ resource_id: resourceID }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())
    const tab = await waitFor(() => screen.getByText('Metrics'))
    tab.click()
    const empty = await waitFor(() => screen.getByTestId('deploy-metrics-empty'))
    // Honest copy — no fake charts, no "your metrics will appear here".
    expect(empty.textContent ?? '').toContain('Deploy metrics coming soon')
    // Deep-link to /app/resources/:id when a resource_id is bound.
    const link = empty.querySelector(`a[href="/app/resources/${resourceID}"]`)
    expect(link).not.toBeNull()
  })

  it('falls back to /app/resources when no resource_id is bound', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ resource_id: undefined }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())
    const tab = await waitFor(() => screen.getByText('Metrics'))
    tab.click()
    const empty = await waitFor(() => screen.getByTestId('deploy-metrics-empty'))
    const link = empty.querySelector('a[href="/app/resources"]')
    expect(link).not.toBeNull()
  })

  it("tab header no longer shows the stale 'blocked' tag — the tab is reachable, not blocked", async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment(),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())
    // The Metrics tab button must contain "Metrics" but NOT "blocked"
    // — pre-W12 the chrome rendered a <span class="tag">blocked</span>.
    const metricsTab = await waitFor(() => screen.getByText('Metrics'))
    // Walk up to the <button> ancestor so we capture any sibling tag spans.
    const button = metricsTab.closest('button')
    expect(button).not.toBeNull()
    expect((button!.textContent ?? '').toLowerCase()).not.toContain('blocked')
  })
})

describe('DeployDetailPage — Audit tab (W12 H12)', () => {
  it('renders the AuditPanel when a resource_id is bound to the deploy', async () => {
    const resourceID = '99999999-9999-4999-8999-999999999999'
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ resource_id: resourceID }),
    })
    // AuditPanel calls fetchResourceAudit on mount — stub with a clean
    // empty response so the panel renders its no-events state instead of
    // surfacing an error banner.
    mockFetchAudit.mockResolvedValueOnce({
      ok: true,
      items: [],
      total_returned: 0,
      next_cursor: null,
      lookback_days: 1,
      tier: 'pro',
    })

    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())
    const tab = await waitFor(() => screen.getByText('Audit'))
    tab.click()
    // The wrapper renders before the panel's async load resolves, so we
    // can assert the slot is mounted immediately.
    await waitFor(() => expect(screen.getByTestId('deploy-audit-panel')).toBeTruthy())
    // And the panel's own request fired with the right resource id.
    await waitFor(() => expect(mockFetchAudit).toHaveBeenCalledWith(resourceID, expect.anything()))
  })

  it('renders the empty state when no resource_id is bound', async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment({ resource_id: undefined }),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())
    const tab = await waitFor(() => screen.getByText('Audit'))
    tab.click()
    const empty = await waitFor(() => screen.getByTestId('deploy-audit-empty'))
    expect(empty.textContent ?? '').toContain('No bound resource')
    // fetchResourceAudit must NOT fire — we don't have a resource id to
    // scope the request against.
    expect(mockFetchAudit).not.toHaveBeenCalled()
  })

  it("tab header no longer shows the stale 'blocked' tag — the audit panel is wired", async () => {
    mockGetDeployment.mockResolvedValueOnce({
      ok: true,
      deployment: deployment(),
    })
    renderPage(`/deployments/${deployment().id}`)
    await waitFor(() => expect(mockGetDeployment).toHaveBeenCalled())
    const auditTab = await waitFor(() => screen.getByText('Audit'))
    const button = auditTab.closest('button')
    expect(button).not.toBeNull()
    expect((button!.textContent ?? '').toLowerCase()).not.toContain('blocked')
  })
})
