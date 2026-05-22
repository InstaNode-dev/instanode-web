/* CustomerDetailDrawer.test.tsx — admin customer detail slide-in. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type {
  AdminCustomerDetailResponse,
  AdminCustomerSummary,
} from '../api/types'
import { formatBytes, CustomerDetailDrawer } from './CustomerDetailDrawer'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getAdminCustomer: vi.fn() }
})

// Replace heavy modals with markers + a button that fires the success cb.
vi.mock('./IssuePromoModal', () => ({
  IssuePromoModal: ({ onClose, onIssued }: any) => (
    <div data-testid="issue-promo-modal">
      <button onClick={onIssued}>fire-issued</button>
      <button onClick={onClose}>close-promo</button>
    </div>
  ),
}))
vi.mock('./TierChangeModal', () => ({
  TierChangeModal: ({ onClose, onChanged }: any) => (
    <div data-testid="tier-change-modal">
      <button onClick={onChanged}>fire-changed</button>
      <button onClick={onClose}>close-tier</button>
    </div>
  ),
}))

import * as api from '../api'

const SUMMARY: AdminCustomerSummary = {
  team_id: 'team_abcdef0123',
  primary_email: 'founder@acme.dev',
  name: 'Acme',
  tier: 'pro',
  mrr_monthly: 4900,
  mrr_yearly: 49000,
  storage_bytes: 1024 * 1024 * 5,
  deployments_active: 2,
  last_active: '2026-05-21T00:00:00Z',
  created_at: '2026-04-01T00:00:00Z',
}

function makeDetail(over: Partial<AdminCustomerDetailResponse> = {}): AdminCustomerDetailResponse {
  return {
    ok: true,
    team: { id: 'team_abcdef0123', name: 'acme', slug: 'acme', owner_id: 'u1', member_count: 1, tier: 'pro', created_at: '2026-04-01T00:00:00Z', display_name: 'Acme', default_env: 'production' } as any,
    users: [{ id: 'u1' } as any],
    resources: [],
    audit_log: [],
    deploys: [],
    subscription: { status: 'active', razorpay_subscription_id: 'sub_xyz', next_renewal_at: '2026-06-01T00:00:00Z' },
    promos: [],
    ...over,
  }
}

function renderDrawer(onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <CustomerDetailDrawer summary={SUMMARY} onClose={onClose} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(api.getAdminCustomer as any).mockResolvedValue(makeDetail())
})
afterEach(() => cleanup())

describe('formatBytes', () => {
  it('handles nullish and non-positive', () => {
    expect(formatBytes(null)).toBe('0 B')
    expect(formatBytes(undefined)).toBe('0 B')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
  })
  it('scales through units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 * 1024 * 200)).toBe('200 MB')
  })
})

describe('CustomerDetailDrawer', () => {
  it('loads then renders the overview tab', async () => {
    renderDrawer()
    expect(screen.getByTestId('drawer-loading')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('drawer-overview')).toBeTruthy())
    expect(screen.getByTestId('drawer-email').textContent).toBe('founder@acme.dev')
    expect(screen.getByTestId('drawer-mrr')).toBeTruthy()
  })

  it('shows an error when the fetch fails', async () => {
    ;(api.getAdminCustomer as any).mockRejectedValue(new Error('nope'))
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('drawer-error').textContent).toBe('nope'))
  })

  it('closes on overlay click, close button, and Escape', async () => {
    const onClose = vi.fn()
    renderDrawer(onClose)
    await waitFor(() => screen.getByTestId('drawer-overview'))
    fireEvent.click(screen.getByTestId('customer-drawer-overlay'))
    fireEvent.click(screen.getByTestId('drawer-close'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('switches between tabs', async () => {
    renderDrawer()
    await waitFor(() => screen.getByTestId('drawer-overview'))
    await userEvent.click(screen.getByTestId('drawer-tab-resources'))
    expect(screen.getByTestId('drawer-resources-empty')).toBeTruthy()
    await userEvent.click(screen.getByTestId('drawer-tab-activity'))
    expect(screen.getByTestId('drawer-activity-empty')).toBeTruthy()
    await userEvent.click(screen.getByTestId('drawer-tab-promos'))
    expect(screen.getByTestId('drawer-promos-empty')).toBeTruthy()
  })

  it('renders populated resources/activity/promos', async () => {
    ;(api.getAdminCustomer as any).mockResolvedValue(makeDetail({
      resources: [{ id: 'r1', token: 'tok_1', resource_type: 'postgres', tier: 'pro', status: 'active', name: 'db', env: 'production', storage_bytes: 2048, storage_limit_bytes: 1e9, storage_exceeded: false, expires_at: '2026-07-01T00:00:00Z', created_at: '2026-05-01T00:00:00Z' } as any],
      audit_log: [{ id: 'a1', kind: 'provision', summary: 'created db', at: '2026-05-20T00:00:00Z' }],
      promos: [
        { id: 'p1', code: 'WELCOME15', kind: 'percent_off', value: 15, applies_to: 3, valid_for_days: 30, expires_at: '2026-06-01T00:00:00Z', created_at: '2026-05-01T00:00:00Z' },
        { id: 'p2', code: 'FREE1', kind: 'first_month_free', value: 0, applies_to: 0, valid_for_days: 30, expires_at: null, created_at: '2026-05-01T00:00:00Z' },
        { id: 'p3', code: 'OFF49', kind: 'amount_off', value: 49, applies_to: 0, valid_for_days: 30, expires_at: null, created_at: '2026-05-01T00:00:00Z' },
      ],
    }))
    renderDrawer()
    await waitFor(() => screen.getByTestId('drawer-overview'))
    await userEvent.click(screen.getByTestId('drawer-tab-resources'))
    expect(screen.getByTestId('drawer-resource-r1')).toBeTruthy()
    await userEvent.click(screen.getByTestId('drawer-tab-activity'))
    expect(screen.getByTestId('drawer-activity-row-a1')).toBeTruthy()
    await userEvent.click(screen.getByTestId('drawer-tab-promos'))
    expect(screen.getByText('WELCOME15')).toBeTruthy()
    expect(screen.getByText('15% off · first 3 mo')).toBeTruthy()
    expect(screen.getByText('first month free · ongoing')).toBeTruthy()
    expect(screen.getByText('$49 off · ongoing')).toBeTruthy()
  })

  it('renders "none" subscription + missing renewal when no subscription', async () => {
    ;(api.getAdminCustomer as any).mockResolvedValue(makeDetail({ subscription: null }))
    renderDrawer()
    await waitFor(() => expect(screen.getByText('none')).toBeTruthy())
  })

  it('opens the tier-change modal and refetches on success', async () => {
    renderDrawer()
    await waitFor(() => screen.getByTestId('drawer-overview'))
    await userEvent.click(screen.getByTestId('drawer-change-tier'))
    expect(screen.getByTestId('tier-change-modal')).toBeTruthy()
    await userEvent.click(screen.getByText('fire-changed'))
    await waitFor(() => expect(api.getAdminCustomer).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByText('close-tier'))
    await waitFor(() => expect(screen.queryByTestId('tier-change-modal')).toBeNull())
  })

  it('opens the issue-promo modal (header + promos tab) and refetches', async () => {
    renderDrawer()
    await waitFor(() => screen.getByTestId('drawer-overview'))
    await userEvent.click(screen.getByTestId('drawer-issue-promo'))
    expect(screen.getByTestId('issue-promo-modal')).toBeTruthy()
    await userEvent.click(screen.getByText('fire-issued'))
    await waitFor(() => expect(api.getAdminCustomer).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByText('close-promo'))
    await waitFor(() => expect(screen.queryByTestId('issue-promo-modal')).toBeNull())
    // also via the promos-tab "Issue new" button
    await userEvent.click(screen.getByTestId('drawer-tab-promos'))
    await userEvent.click(screen.getByTestId('drawer-promos-issue-new'))
    expect(screen.getByTestId('issue-promo-modal')).toBeTruthy()
  })
})
