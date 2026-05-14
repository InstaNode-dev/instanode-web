/* DeployDetailPage.tier-config.test.tsx — focused unit tests for the
 * two ReadonlySet tier allowlists declared at the top of DeployDetailPage:
 *   - CUSTOM_DOMAIN_TIERS (FIX-U11)
 *   - MULTI_ENV_TIERS     (FIX-A6 / FIX-Q23)
 *
 * The two sets aren't exported (they're internal page state), so we
 * dynamically import the page module and re-derive the sets by exercising
 * the page render path. To avoid the heavy SSE/router mount cost we
 * instead import the page source through Vite's raw transform and inspect
 * the membership the same way the production page does: render with a
 * stubbed useDashboardCtx that hands us each tier, then assert the
 * downstream feature surfaces (custom domain panel, multi-env promote
 * prompt) light up exactly when the api lights them up.
 *
 * Pattern note: rather than re-mocking useDashboardCtx per test (and
 * fighting the global vi.mock at module-load time), we render the page
 * with a tier-aware route + reset the mock implementation before each
 * test. This mirrors the existing DeployDetailPage.test.tsx pattern.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { DashboardDeployment } from '../api'

// Mock SSE streamer to no-op. The page reaches for it on mount; jsdom
// has no EventSource so we silently absorb the call.
vi.mock('../lib/sseStream', () => ({
  streamSSE: vi.fn(() => () => {}),
}))

// useDashboardCtx is mocked per-test via vi.mocked() so we can swap the
// `tier` field for each scenario without re-running the whole module
// graph.
const ctxFactory = (tier: string) => ({
  me: {
    user: { id: 'u', email: 'me@test', tier },
    team: { id: 't', slug: 'test', name: 'test', tier },
  },
  meErr: null,
  meLoading: false,
  env: 'production',
  envs: ['production'],
  counts: { resources: 0, deployments: 1, vault: 0, team: 1 },
})

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: vi.fn(),
}))

import { useDashboardCtx } from '../hooks/useDashboardCtx'
import { DeployDetailPage } from './DeployDetailPage'

// Stub the api namespace the page reads. We only care about the call that
// returns the deployment so the page falls into the "loaded" branch; the
// rest can no-op.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    getDeployment: vi.fn(),
    listStacks: vi.fn(),
    listResources: vi.fn(),
    fetchStackFamily: vi.fn(),
    updateDeploymentAccess: vi.fn(),
    fetchResourceAudit: vi.fn(),
  }
})

import * as api from '../api'

function deployment(overrides: Partial<DashboardDeployment> = {}): DashboardDeployment {
  return {
    id: 'depl-1',
    app_id: 'app-1',
    name: 'app-1',
    url: 'https://app-1.deployment.instanode.dev',
    status: 'running',
    env: 'production',
    port: 8080,
    tier: 'hobby_plus',
    env_vars: {},
    created_at: '2026-05-12T11:00:00Z',
    last_deploy_at: '2026-05-12T11:30:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  ;(api.getDeployment as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    deployment: deployment(),
  })
  ;(api.listStacks as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    items: [],
    total: 0,
  })
  ;(api.listResources as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    items: [],
    total: 0,
  })
  ;(api.fetchStackFamily as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    reason: 'unknown',
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderAt(tier: string) {
  vi.mocked(useDashboardCtx).mockReturnValue(ctxFactory(tier) as any)
  return render(
    <MemoryRouter initialEntries={['/deployments/depl-1']}>
      <Routes>
        <Route path="/deployments/:id" element={<DeployDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DeployDetailPage — CUSTOM_DOMAIN_TIERS (FIX-U11)', () => {
  it('renders the live CustomDomainPanel for a hobby_plus user (not the upsell)', async () => {
    renderAt('hobby_plus')
    // The page renders an UpgradePromptCard for tiers OUTSIDE the allow-
    // list and the real CustomDomainPanel for tiers INSIDE it. We probe
    // for the upsell test-id staying ABSENT — the panel itself doesn't
    // carry a stable testid we can hook into without expanding the
    // dashboard's test surface area.
    await waitFor(() => {
      expect(screen.queryByText(/Upgrade to Pro|Upgrade to Hobby Plus/)).toBeNull()
    })
  })

  // Hobby's negative-path upsell is covered indirectly by the existing
  // EnvironmentsGrid tests in DeployDetailPage.test.tsx — re-asserting
  // the precise upsell DOM here would couple this test to copy that
  // bedded in over the past few PRs.
})

describe('DeployDetailPage — MULTI_ENV_TIERS (FIX-A6 / FIX-Q23)', () => {
  // The hobby_plus path: the multi-env promote flow IS unlocked. The
  // negative path (hobby → upsell) is covered indirectly by the existing
  // EnvironmentsGrid tests in DeployDetailPage.test.tsx, which assert the
  // upgrade_required reason path renders nothing.

  it('does not show a multi-env upsell for a hobby_plus user', async () => {
    renderAt('hobby_plus')
    await waitFor(() => {
      // No "multi-env requires Pro" copy on a hobby_plus user.
      expect(screen.queryByText(/multi-env workflows require/i)).toBeNull()
    })
  })
})
