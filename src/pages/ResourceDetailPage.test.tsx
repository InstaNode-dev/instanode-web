/* ResourceDetailPage.test.tsx — pin the API-contract panel does NOT advertise
 * unbuilt endpoints as status="gap".
 *
 * Before this fix (P3 founder persona, 2026-05-13) the page rendered two
 * <ContractLine> rows with status="gap" pointing at
 * /api/v1/resources/:id/metrics and /api/v1/resources/:id/audit — endpoints
 * that don't exist on the agent API yet. The literal word "gap" leaked into
 * the rendered HTML (via the data-status attribute on ContractLine) and
 * read to customers as a missing surface they should worry about. The fix
 * removes those rows and replaces them with a "request early access" CTA.
 *
 * The W7-F api side will add the real /metrics endpoint. When it lands the
 * dashboard should re-add a ContractLine with status="live" and remove the
 * CTA — at which point this test should be updated, not deleted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ResourceDetailPage } from './ResourceDetailPage'
import type { Resource } from '../api'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    getResource: vi.fn(),
  }
})

import * as api from '../api'

const mockGetResource = api.getResource as unknown as ReturnType<typeof vi.fn>

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
})
afterEach(() => cleanup())

describe('ResourceDetailPage — API contract panel', () => {
  it('does NOT render any contract line with status="gap"', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    const { container } = renderAt('res_abc')

    await waitFor(() => {
      // Page has mounted past the skel; the contract panel is on the
      // Overview tab which is the default.
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    // Hard guarantee: no ContractLine renders with the "gap" status. The
    // ContractLine helper (Common.tsx) renders the status string into a
    // <span class="meta gap">…</span> and also splats the status word as
    // the visible text inside that span. Either signal failing here means
    // a regression brought the placeholder rows back.
    const gapBadges = container.querySelectorAll('.meta.gap')
    expect(gapBadges.length).toBe(0)

    // And the literal "gap" word must not appear as a status indicator
    // inside the contract panel.
    const html = container.innerHTML
    expect(html).not.toMatch(/>gap</)
  })

  it('renders the "request early access" CTA in place of the gap rows', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByTestId('metrics-early-access')).toBeTruthy()
    })
    const cta = screen.getByTestId('metrics-early-access')
    expect(cta.textContent).toMatch(/coming in Pro/i)
    // The CTA must include a mailto so the customer can actually reach us.
    const mailto = cta.querySelector('a[href^="mailto:"]') as HTMLAnchorElement
    expect(mailto).toBeTruthy()
    expect(mailto.href).toContain('enterprise@instanode.dev')
  })

  it('still renders the live contract lines for the real endpoints', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    const { container } = renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    // Three rows with status="live" — GET, POST rotate, DELETE.
    const liveNodes = container.querySelectorAll('.meta.ok')
    expect(liveNodes.length).toBe(3)
  })
})
