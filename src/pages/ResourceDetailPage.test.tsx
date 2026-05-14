/* ResourceDetailPage.test.tsx — API-contract panel + tabs.
 *
 * History:
 *   - 2026-05-13 (P3 founder persona, PR #54): both /metrics and /audit
 *     advertised as status="gap"; replaced with an early-access CTA.
 *   - 2026-05-14 (W7-F): /metrics shipped (status="live"). Audit remained
 *     gap; CTA testid renamed to `audit-early-access`.
 *   - 2026-05-14 (W11 honesty patch): /audit is now wired to the
 *     team-level GET /api/v1/audit endpoint (filtered client-side for
 *     metadata.resource_id matches). Both /metrics and /audit are
 *     status="live"; the `audit-early-access` CTA is removed. The
 *     Audit tab tag (`blocked`) is removed.
 *
 * Pins:
 *   - Zero `.meta.gap` rows on the per-resource contract panel.
 *   - audit-early-access CTA never renders.
 *   - Nine `.meta.ok` rows (the existing eight + /audit).
 *   - The Audit tab renders <AuditPanel /> on click — pinned via the
 *     `audit-loading` / `audit-empty` testids depending on mock state.
 *   - The PauseResumeButton renders inside the right-rail Pause card —
 *     pinned via the `pause-resume-button` testid (P3 #58 regression
 *     would have shipped the contract line without the actual button).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ResourceDetailPage } from './ResourceDetailPage'
import type { Resource } from '../api'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    getResource: vi.fn(),
    fetchResourceAudit: vi.fn(),
    getResourceMetrics: vi.fn(),
  }
})

import * as api from '../api'

const mockGetResource = api.getResource as unknown as ReturnType<typeof vi.fn>
const mockFetchResourceAudit = api.fetchResourceAudit as unknown as ReturnType<typeof vi.fn>
const mockGetResourceMetrics = api.getResourceMetrics as unknown as ReturnType<typeof vi.fn>

function makeResource(): Resource {
  return {
    id: 'res_abc',
    token: 'tok_abc',
    resource_type: 'postgres',
    tier: 'pro',
    status: 'active',
    name: 'orders-db',
    env: 'production',
    storage_bytes: 100_000_000,
    storage_limit_bytes: 5_000_000_000,
    storage_exceeded: false,
    connections_in_use: 1,
    connections_limit: 20,
    cloud_vendor: 'aws',
    country_code: 'IN',
    expires_at: null,
    created_at: '2026-04-01T00:00:00Z',
    connection_url: 'postgres://u:p@pg.instanode.dev:5432/db',
  }
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/resources/${id}`]}>
      <Routes>
        <Route path="/app/resources/:id" element={<ResourceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockGetResource.mockReset()
  mockFetchResourceAudit.mockReset()
  mockGetResourceMetrics.mockReset()
  // Default: empty audit window so the Audit tab renders the empty
  // state when a test doesn't override. The mock never rejects unless
  // an individual test sets it to.
  mockFetchResourceAudit.mockResolvedValue({
    ok: true,
    items: [],
    total_returned: 0,
    next_cursor: null,
    lookback_days: 90,
    tier: 'pro',
  })
  // Default metrics mock: empty resource_metrics response so the
  // Metrics tab can render without throwing if a test happens to
  // mount it. Tests that exercise the Metrics tab override this.
  mockGetResourceMetrics.mockResolvedValue({
    ok: true,
    resource_id: 'res_abc',
    resource_type: 'postgres',
    window_seconds: 3600,
    samples_count: 0,
    sample_interval_seconds: 60,
    metrics: {
      latency_p50_ms: [],
      latency_p95_ms: [],
      latency_p99_ms: [],
      connections_active: [],
      storage_bytes: [],
      error_rate_pct: [],
    },
    data_source: 'stub',
  })
})
afterEach(() => cleanup())

describe('ResourceDetailPage — API contract panel', () => {
  it('shows ZERO gap rows on the per-resource contract panel (W11 honesty)', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    const { container } = renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    // W11 honesty patch (2026-05-14): /audit flipped from gap to live.
    // Both /metrics and /audit are wired; every contract row is live.
    const gapBadges = container.querySelectorAll('.meta.gap')
    expect(gapBadges.length).toBe(0)
  })

  it('does NOT render the old audit-early-access CTA (it was removed when /audit went live)', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })
    // The CTA must be gone — leaving it would be visible-but-stale UI.
    expect(screen.queryByTestId('audit-early-access')).toBeNull()
  })

  it('renders nine live contract lines (eight previously live + /audit now live)', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    const { container } = renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    // Nine rows with status="live": GET resource, POST rotate-credentials,
    // POST pause, POST resume, POST provision-twin, GET credentials,
    // DELETE, GET metrics, GET audit (W11 honesty patch upgraded /audit
    // from gap to live).
    const liveNodes = container.querySelectorAll('.meta.ok')
    expect(liveNodes.length).toBe(9)
  })
})

describe('ResourceDetailPage — Audit tab wiring (W11 honesty)', () => {
  it('renders the AuditPanel empty state when there are no events', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    // Click the Audit tab.
    const auditTab = screen.getByRole('button', { name: /^Audit$/ })
    fireEvent.click(auditTab)

    await waitFor(() => {
      expect(screen.getByTestId('audit-empty')).toBeTruthy()
    })
    // The Audit tab should have called fetchResourceAudit with the
    // resource's UUID (the row id, NOT the public token).
    expect(mockFetchResourceAudit).toHaveBeenCalledWith('res_abc', expect.any(Number))
  })

  it('renders audit rows for events whose metadata.resource_id matches', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    mockFetchResourceAudit.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          id: 'ev_1',
          kind: 'resource.rotate',
          created_at: '2026-05-14T10:00:00Z',
          actor_user_id: 'u1',
          actor_email_masked: 'm***@example.com',
          metadata: { resource_id: 'res_abc' },
        },
        {
          id: 'ev_2',
          kind: 'resource.pause',
          created_at: '2026-05-14T11:30:00Z',
          actor_user_id: 'u1',
          actor_email_masked: 'm***@example.com',
          metadata: { resource_id: 'res_abc' },
        },
      ],
      total_returned: 2,
      next_cursor: null,
      lookback_days: 90,
      tier: 'pro',
    })
    renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /^Audit$/ }))

    await waitFor(() => {
      expect(screen.getByTestId('audit-table')).toBeTruthy()
    })
    expect(screen.getByTestId('audit-row-ev_1')).toBeTruthy()
    expect(screen.getByTestId('audit-row-ev_2')).toBeTruthy()
    expect(screen.getByTestId('audit-row-ev_1').textContent).toContain('resource.rotate')
    expect(screen.getByTestId('audit-row-ev_1').textContent).toContain('m***@example.com')
  })

  it('renders the upgrade-required state when the API returns 402', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    const err: any = new Error('Audit log export requires the Hobby plan or higher.')
    err.status = 402
    mockFetchResourceAudit.mockRejectedValueOnce(err)
    renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /^Audit$/ }))

    await waitFor(() => {
      expect(screen.getByTestId('audit-upgrade-required')).toBeTruthy()
    })
  })

  it('does NOT render the legacy "blocked" tag next to the Audit tab', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    const auditTab = screen.getByRole('button', { name: /^Audit$/ })
    // The legacy `blocked` tag is gone — the tab no longer renders any
    // `.tag` span. The text content must be exactly "Audit".
    expect(auditTab.textContent?.trim()).toBe('Audit')
    expect(auditTab.querySelector('.tag')).toBeNull()
  })
})

describe('ResourceDetailPage — PauseResumeButton presence (W11 regression pin)', () => {
  // P3 #58 regression: the PR claimed pause/resume support but no
  // PauseResumeButton component file shipped — grep confirmed zero
  // `pause|resume` references in dashboard/src/ at the time. The
  // component DID ship in W9-B1 (PR #58 follow-up), but a page-level
  // pin keeps the surface from silently going missing again: a future
  // refactor that drops the import would break this test, not a user.
  //
  // The presence test lives at the page level (not just on
  // PauseResumeButton.test.tsx) because the failure mode the persona
  // hit was "the component isn't mounted", not "the component is
  // broken" — only an integration-level assertion catches that.
  it('renders the PauseResumeButton on the Overview tab', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })
    // The PauseResumeButton lives in the right-rail "Pause this
    // resource" card on the Overview tab. It self-renders nothing for
    // terminal statuses but our makeResource() fixture has
    // status='active', so the button is expected to be present.
    expect(screen.getByTestId('pause-resume-button')).toBeTruthy()
  })
})
