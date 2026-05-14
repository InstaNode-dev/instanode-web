/* AuditPanel.test.tsx — per-resource audit tab renderer.
 *
 * The panel calls api.fetchResourceAudit(resourceId, 24) on mount. The
 * underlying api helper hits GET /api/v1/audit?since=<24h-ago>&limit=200
 * and filters client-side for rows whose metadata.resource_id matches —
 * the panel doesn't re-filter, it trusts the helper.
 *
 * State pins:
 *   - loading → renders <skel>
 *   - ready + 0 rows → empty state with `audit-empty` testid
 *   - ready + N rows → table with `audit-row-<id>` per row
 *   - 402 → upgrade-required CTA
 *   - other error → error banner
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { AuditPanel } from './AuditPanel'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    fetchResourceAudit: vi.fn(),
  }
})
import * as api from '../api'
const mockFetch = api.fetchResourceAudit as unknown as ReturnType<typeof vi.fn>

beforeEach(() => mockFetch.mockReset())
afterEach(() => cleanup())

describe('AuditPanel — load states', () => {
  it('shows the skeleton while the audit fetch is in flight', () => {
    mockFetch.mockReturnValueOnce(new Promise(() => { /* never resolves */ }))
    render(<AuditPanel resourceId="res_abc" />)
    expect(screen.getByTestId('audit-loading')).toBeTruthy()
  })

  it('shows the empty state when the fetch resolves with zero events', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      items: [],
      total_returned: 0,
      next_cursor: null,
      lookback_days: 90,
      tier: 'pro',
    })
    render(<AuditPanel resourceId="res_abc" />)
    await waitFor(() => expect(screen.getByTestId('audit-empty')).toBeTruthy())
    // Empty-state copy must NOT lie ("No audit events"). Sanity-check.
    expect(screen.getByTestId('audit-empty').textContent).toMatch(/no audit events/i)
  })

  it('renders one row per event when the fetch resolves with data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          id: 'ev_1',
          kind: 'resource.rotate',
          created_at: '2026-05-14T10:00:00Z',
          actor_user_id: 'u1',
          actor_email_masked: 'm***@example.com',
          metadata: { resource_id: 'res_abc', source: 'agent' },
        },
        {
          id: 'ev_2',
          kind: 'resource.delete',
          created_at: '2026-05-14T11:00:00Z',
          actor_user_id: null,
          actor_email_masked: null,
          metadata: { resource_id: 'res_abc' },
        },
      ],
      total_returned: 2,
      next_cursor: null,
      lookback_days: 90,
      tier: 'pro',
    })
    render(<AuditPanel resourceId="res_abc" />)
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeTruthy())
    expect(screen.getByTestId('audit-row-ev_1')).toBeTruthy()
    expect(screen.getByTestId('audit-row-ev_2')).toBeTruthy()
    expect(screen.getByTestId('audit-row-ev_1').textContent).toContain('resource.rotate')
    expect(screen.getByTestId('audit-row-ev_1').textContent).toContain('m***@example.com')
    // Rows with no actor render "system" rather than a blank cell.
    expect(screen.getByTestId('audit-row-ev_2').textContent).toContain('system')
  })

  it('renders the upgrade-required CTA on 402', async () => {
    const err: any = new Error('Audit log export requires the Hobby plan or higher.')
    err.status = 402
    mockFetch.mockRejectedValueOnce(err)
    render(<AuditPanel resourceId="res_abc" />)
    await waitFor(() => expect(screen.getByTestId('audit-upgrade-required')).toBeTruthy())
    // The CTA must surface the pricing link so users have a path forward.
    const link = screen
      .getByTestId('audit-upgrade-required')
      .querySelector('a[href*="pricing"]') as HTMLAnchorElement
    expect(link).toBeTruthy()
  })

  it('renders an error banner on a non-402 failure', async () => {
    const err: any = new Error('db_failed')
    err.status = 503
    mockFetch.mockRejectedValueOnce(err)
    render(<AuditPanel resourceId="res_abc" />)
    await waitFor(() => expect(screen.getByTestId('audit-error')).toBeTruthy())
    expect(screen.getByTestId('audit-error').textContent).toContain('db_failed')
  })
})
