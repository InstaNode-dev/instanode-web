/* ResourceDetailPage.test.tsx — API-contract panel.
 *
 * History:
 *   - 2026-05-13 (P3 founder persona, PR #54): both /metrics and /audit
 *     advertised as status="gap"; replaced with an early-access CTA.
 *   - 2026-05-14 (W7-F): /metrics shipped (status="live"). Audit remains
 *     gap; CTA testid renamed to `audit-early-access`.
 *
 * Pins:
 *   - Only /audit may remain gap; metrics + the three Resource endpoints
 *     are live.
 *   - audit-early-access CTA renders with a mailto.
 *   - Four live ContractLines: GET resource, POST rotate, DELETE, GET metrics.
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
  it('only renders /audit as the remaining gap row', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    const { container } = renderAt('res_abc')

    await waitFor(() => {
      // Page has mounted past the skel; the contract panel is on the
      // Overview tab which is the default.
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    // After W7-F shipped (2026-05-14), only /audit remains gap. The
    // other gap row (/metrics) is now live.
    const gapBadges = container.querySelectorAll('.meta.gap')
    expect(gapBadges.length).toBe(1)
  })

  it('renders the audit "request early access" CTA', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByTestId('audit-early-access')).toBeTruthy()
    })
    const cta = screen.getByTestId('audit-early-access')
    expect(cta.textContent).toMatch(/coming in Pro/i)
    // The CTA must include a mailto so the customer can actually reach us.
    const mailto = cta.querySelector('a[href^="mailto:"]') as HTMLAnchorElement
    expect(mailto).toBeTruthy()
    expect(mailto.href).toContain('enterprise@instanode.dev')
  })

  it('renders the live contract lines for the real endpoints', async () => {
    mockGetResource.mockResolvedValueOnce({ ok: true, resource: makeResource() })
    const { container } = renderAt('res_abc')

    await waitFor(() => {
      expect(screen.getByText('API contract')).toBeTruthy()
    })

    // Eight rows with status="live": GET resource, POST rotate-credentials,
    // POST pause, POST resume, POST provision-twin, GET credentials, DELETE,
    // GET metrics (W8 surfaces the full per-resource contract; metrics
    // upgraded from gap to live in W7-F).
    const liveNodes = container.querySelectorAll('.meta.ok')
    expect(liveNodes.length).toBe(8)
  })
})
