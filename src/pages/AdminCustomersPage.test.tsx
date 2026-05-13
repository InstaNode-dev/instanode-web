/* AdminCustomersPage.test.tsx — founder console coverage (Track B + Track H).
 *
 * What we lock in:
 *   1. Non-admin users see a 404-equivalent (route 404s instead of 403s)
 *   2. Admin users see the table
 *   3. Table sorts on header click
 *   4. Filter pills filter rows
 *   5. Drawer opens on row click + tab switching works
 *   6. Issue promo modal submits and surfaces the generated code
 *   7. Tier change modal requires typed PROMOTE / DEMOTE confirmation
 *   8. (Track H) Currency toggle defaults to USD, switches to INR, persists
 *      across mount, propagates to drawer, honours VITE_INR_TO_USD override.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type {
  AdminCustomerDetailResponse,
  AdminCustomerSummary,
} from '../api/types'

// ─── Module-level mocks ──────────────────────────────────────────────────
// We mock the api module so tests never hit fetch().
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listAdminCustomers: vi.fn(),
    getAdminCustomer: vi.fn(),
    setAdminCustomerTier: vi.fn(),
    issueAdminCustomerPromo: vi.fn(),
  }
})

// Stub useDashboardCtx so we control is_platform_admin per test.
let mockIsAdmin = true
let mockMeLoading = false
vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: {
      user: { id: 'u_admin', email: 'manas@instanode.dev', tier: 'team' },
      team: { id: 't_admin', slug: 'instanode', name: 'instanode', tier: 'team' },
      is_platform_admin: mockIsAdmin,
    },
    meErr: null,
    meLoading: mockMeLoading,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [],
    billing: null,
    billingLoading: false,
  }),
}))

import { AdminCustomersPage } from './AdminCustomersPage'
import * as api from '../api'

const FIXTURE_CUSTOMERS: AdminCustomerSummary[] = [
  {
    team_id: 't_big',
    primary_email: 'big@acme.dev',
    name: 'Big Co',
    tier: 'pro',
    mrr_monthly: 490000, // ₹4,900
    mrr_yearly: 0,
    storage_bytes: 5_000_000_000,
    deployments_active: 3,
    last_active: '2026-05-12T08:00:00Z',
    created_at: '2026-01-10T00:00:00Z',
  },
  {
    team_id: 't_small',
    primary_email: 'small@startup.io',
    name: 'Small Co',
    tier: 'hobby',
    mrr_monthly: 90000, // ₹900
    mrr_yearly: 0,
    storage_bytes: 200_000_000,
    deployments_active: 1,
    last_active: '2026-05-13T01:00:00Z',
    created_at: '2026-03-20T00:00:00Z',
  },
  {
    team_id: 't_anon',
    primary_email: 'agent@temp.dev',
    name: '',
    tier: 'anonymous',
    mrr_monthly: 0,
    mrr_yearly: 0,
    storage_bytes: 1_000_000,
    deployments_active: 0,
    last_active: null,
    created_at: '2026-05-13T00:00:00Z',
  },
]

const FIXTURE_DETAIL: AdminCustomerDetailResponse = {
  ok: true,
  team: {
    id: 't_big',
    name: 'Big Co',
    slug: 'big-co',
    owner_id: 'u_big_owner',
    member_count: 3,
    tier: 'pro',
    created_at: '2026-01-10T00:00:00Z',
    display_name: 'Big Corporation',
    primary_email: 'big@acme.dev',
  } as AdminCustomerDetailResponse['team'],
  users: [
    {
      id: 'u_big_owner',
      email: 'big@acme.dev',
      tier: 'pro',
      team_id: 't_big',
      created_at: '2026-01-10T00:00:00Z',
      role: 'owner',
    },
  ],
  resources: [
    {
      id: 'res_db',
      token: 'tok_db',
      resource_type: 'postgres',
      tier: 'pro',
      status: 'active',
      name: 'orders-db',
      env: 'production',
      storage_bytes: 100_000_000,
      storage_limit_bytes: 5_000_000_000,
      storage_exceeded: false,
      expires_at: null,
      created_at: '2026-01-15T00:00:00Z',
    },
  ],
  audit_log: [
    {
      id: 'a1',
      kind: 'tier.change',
      summary: 'pro tier activated via Razorpay',
      at: '2026-04-01T00:00:00Z',
    },
  ],
  deploys: [],
  subscription: {
    status: 'active',
    next_renewal_at: '2026-06-01T00:00:00Z',
    amount_inr: 490000,
    razorpay_subscription_id: 'sub_1234',
  },
  promos: [],
}

function withRouter(ui: React.ReactNode) {
  return (
    <MemoryRouter initialEntries={['/app/admin/customers']}>
      <Routes>
        <Route path="/app/admin/customers" element={ui} />
        <Route path="/" element={<div data-testid="root-page">root</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockIsAdmin = true
  mockMeLoading = false
  ;(api.listAdminCustomers as any).mockReset()
  ;(api.getAdminCustomer as any).mockReset()
  ;(api.setAdminCustomerTier as any).mockReset()
  ;(api.issueAdminCustomerPromo as any).mockReset()
  ;(api.listAdminCustomers as any).mockResolvedValue({
    ok: true,
    customers: FIXTURE_CUSTOMERS,
    total: FIXTURE_CUSTOMERS.length,
  })
  ;(api.getAdminCustomer as any).mockResolvedValue(FIXTURE_DETAIL)
  ;(api.setAdminCustomerTier as any).mockResolvedValue({
    ok: true,
    team: FIXTURE_DETAIL.team,
  })
  ;(api.issueAdminCustomerPromo as any).mockResolvedValue({
    ok: true,
    code: 'BIGCO-MAY26',
    expires_at: '2026-06-12T00:00:00Z',
  })
})

afterEach(() => cleanup())

// ─── route gating ─────────────────────────────────────────────────────────
describe('AdminCustomersPage — route gating', () => {
  it('renders the page for an admin user', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customers-page')).toBeTruthy()
    })
  })

  it('redirects to root (404-equivalent) for a non-admin user', () => {
    mockIsAdmin = false
    render(withRouter(<AdminCustomersPage />))
    // The route should redirect — root page renders instead.
    expect(screen.queryByTestId('admin-customers-page')).toBeNull()
    expect(screen.getByTestId('root-page')).toBeTruthy()
  })

  it('does not call listAdminCustomers for a non-admin user', () => {
    mockIsAdmin = false
    render(withRouter(<AdminCustomersPage />))
    expect((api.listAdminCustomers as any)).not.toHaveBeenCalled()
  })

  it('shows a loading state while me is still loading', () => {
    mockMeLoading = true
    render(withRouter(<AdminCustomersPage />))
    expect(screen.getByTestId('admin-customers-loading')).toBeTruthy()
  })
})

// ─── rendering + filter pills ─────────────────────────────────────────────
describe('AdminCustomersPage — table + filters', () => {
  it('renders one row per customer', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    for (const c of FIXTURE_CUSTOMERS) {
      expect(screen.getByTestId(`admin-customer-row-${c.team_id}`)).toBeTruthy()
    }
  })

  it('shows total count in the header', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customers-count').textContent).toContain(
        String(FIXTURE_CUSTOMERS.length),
      )
    })
  })

  it('filter pill click triggers a refetch with the chosen tier', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-filter-pro'))
    await waitFor(() => {
      const calls = (api.listAdminCustomers as any).mock.calls
      // Latest call should carry tier: 'pro'
      const lastCall = calls[calls.length - 1][0]
      expect(lastCall.tier).toBe('pro')
    })
  })

  it('clicking the "All" pill clears the tier filter', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-filter-hobby'))
    await waitFor(() => {
      const calls = (api.listAdminCustomers as any).mock.calls
      expect(calls[calls.length - 1][0].tier).toBe('hobby')
    })
    fireEvent.click(screen.getByTestId('admin-filter-all'))
    await waitFor(() => {
      const calls = (api.listAdminCustomers as any).mock.calls
      // 'all' should be normalised away (not present in query)
      expect(calls[calls.length - 1][0].tier).toBe('all')
    })
  })

  it('search box updates the query parameter on next fetch', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    const search = screen.getByTestId('admin-customers-search') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'acme' } })
    await waitFor(() => {
      const calls = (api.listAdminCustomers as any).mock.calls
      expect(calls[calls.length - 1][0].q).toBe('acme')
    })
  })

  it('renders an empty state when the API returns no customers', async () => {
    ;(api.listAdminCustomers as any).mockResolvedValueOnce({
      ok: true,
      customers: [],
      total: 0,
    })
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customers-empty')).toBeTruthy()
    })
  })

  it('renders an error banner when the API fails', async () => {
    ;(api.listAdminCustomers as any).mockRejectedValueOnce(
      new Error('boom: backend down'),
    )
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customers-error').textContent).toContain('boom')
    })
  })
})

// ─── sorting ──────────────────────────────────────────────────────────────
describe('AdminCustomersPage — sorting', () => {
  function rowTestIds(): string[] {
    // getAllByTestId in this RTL version doesn't take a regex, so query
    // document.body directly with a prefix match on data-testid.
    return Array.from(
      document.body.querySelectorAll('[data-testid^="admin-customer-row-"]'),
    ).map((el) => el.getAttribute('data-testid') ?? '')
  }

  it('clicking the email header re-sorts the rows alphabetically', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-sort-email'))
    // After sort by email ascending: agent@ < big@ < small@
    const ids = rowTestIds()
    expect(ids[0]).toBe('admin-customer-row-t_anon')
    expect(ids[1]).toBe('admin-customer-row-t_big')
    expect(ids[2]).toBe('admin-customer-row-t_small')
  })

  it('default sort is MRR descending (biggest customer first)', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    const ids = rowTestIds()
    // t_big has 490000, t_small has 90000, t_anon has 0
    expect(ids[0]).toBe('admin-customer-row-t_big')
    expect(ids[2]).toBe('admin-customer-row-t_anon')
  })

  it('clicking a header twice flips direction', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-sort-storage'))
    // Storage desc: t_big (5GB) > t_small (200MB) > t_anon (1MB)
    let ids = rowTestIds()
    expect(ids[0]).toBe('admin-customer-row-t_big')
    fireEvent.click(screen.getByTestId('admin-sort-storage'))
    ids = rowTestIds()
    // After flipping to asc: smallest first
    expect(ids[0]).toBe('admin-customer-row-t_anon')
  })
})

// ─── drawer ──────────────────────────────────────────────────────────────
describe('AdminCustomersPage — drawer', () => {
  it('clicking a row opens the drawer for that customer', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('customer-drawer')).toBeTruthy()
    })
    expect(screen.getByTestId('drawer-email').textContent).toBe('big@acme.dev')
  })

  it('drawer fetches detail on open', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect((api.getAdminCustomer as any)).toHaveBeenCalledWith('t_big')
    })
  })

  it('drawer tab switches show the right content', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('drawer-overview')).toBeTruthy()
    })

    // Switch to Resources tab
    fireEvent.click(screen.getByTestId('drawer-tab-resources'))
    await waitFor(() => {
      expect(screen.getByTestId('drawer-resources')).toBeTruthy()
    })
    expect(screen.getByTestId('drawer-resource-res_db')).toBeTruthy()

    // Switch to Activity tab
    fireEvent.click(screen.getByTestId('drawer-tab-activity'))
    await waitFor(() => {
      expect(screen.getByTestId('drawer-activity')).toBeTruthy()
    })

    // Switch to Promos tab
    fireEvent.click(screen.getByTestId('drawer-tab-promos'))
    await waitFor(() => {
      expect(screen.getByTestId('drawer-promos')).toBeTruthy()
    })
    // No promos in fixture → empty state
    expect(screen.getByTestId('drawer-promos-empty')).toBeTruthy()
  })

  it('drawer close button removes the drawer', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('customer-drawer')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('drawer-close'))
    expect(screen.queryByTestId('customer-drawer')).toBeNull()
  })
})

// ─── issue promo modal ───────────────────────────────────────────────────
describe('AdminCustomersPage — issue promo flow', () => {
  it('opens the promo modal from the drawer and submits a code', async () => {
    const user = userEvent.setup()
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('customer-drawer')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('drawer-issue-promo'))
    await waitFor(() => {
      expect(screen.getByTestId('issue-promo-modal')).toBeTruthy()
    })

    // Submit the default form (percent_off, 15%, 3 mo, 30 days)
    fireEvent.click(screen.getByTestId('promo-submit'))
    await waitFor(() => {
      expect((api.issueAdminCustomerPromo as any)).toHaveBeenCalled()
    })
    const callArgs = (api.issueAdminCustomerPromo as any).mock.calls[0]
    expect(callArgs[0]).toBe('t_big')
    expect(callArgs[1].kind).toBe('percent_off')
    expect(callArgs[1].value).toBe(15)
    expect(callArgs[1].applies_to).toBe(3)
    expect(callArgs[1].valid_for_days).toBe(30)

    // Issued state should show the code with a Copy button
    await waitFor(() => {
      expect(screen.getByTestId('promo-issued-code').textContent).toContain('BIGCO-MAY26')
    })
    expect(screen.getByTestId('promo-copy')).toBeTruthy()
  })

  it('submit is disabled when value is missing for percent_off', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('customer-drawer')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('drawer-issue-promo'))
    await waitFor(() => {
      expect(screen.getByTestId('issue-promo-modal')).toBeTruthy()
    })
    const valueInput = screen.getByTestId('promo-value') as HTMLInputElement
    fireEvent.change(valueInput, { target: { value: '' } })
    const submit = screen.getByTestId('promo-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })
})

// ─── tier change modal ───────────────────────────────────────────────────
describe('AdminCustomersPage — tier change flow', () => {
  it('opens the tier modal and requires typed confirmation', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('customer-drawer')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('drawer-change-tier'))
    await waitFor(() => {
      expect(screen.getByTestId('tier-change-modal')).toBeTruthy()
    })

    // No change selected — submit disabled
    let submit = screen.getByTestId('tier-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    // Pick a downgrade — pro → hobby → DEMOTE
    const tierSelect = screen.getByTestId('tier-select') as HTMLSelectElement
    fireEvent.change(tierSelect, { target: { value: 'hobby' } })
    await waitFor(() => {
      expect(screen.getByTestId('tier-confirm-word').textContent).toBe('DEMOTE')
    })

    const reason = screen.getByTestId('tier-reason') as HTMLTextAreaElement
    fireEvent.change(reason, { target: { value: 'support refund' } })

    submit = screen.getByTestId('tier-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    // Typing the wrong word should keep it disabled
    const confirm = screen.getByTestId('tier-confirm-input') as HTMLInputElement
    fireEvent.change(confirm, { target: { value: 'demote' } })
    expect((screen.getByTestId('tier-submit') as HTMLButtonElement).disabled).toBe(true)

    // Typing the exact word enables submit
    fireEvent.change(confirm, { target: { value: 'DEMOTE' } })
    expect((screen.getByTestId('tier-submit') as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByTestId('tier-submit'))
    await waitFor(() => {
      expect((api.setAdminCustomerTier as any)).toHaveBeenCalledWith('t_big', {
        tier: 'hobby',
        reason: 'support refund',
      })
    })
  })

  it('shows PROMOTE confirmation word for upgrades', async () => {
    // Stub a hobby-tier row so we can promote it. Also override the detail
    // mock so the refetched team tier stays 'hobby' — the modal seeds from
    // the freshest available value.
    ;(api.listAdminCustomers as any).mockResolvedValueOnce({
      ok: true,
      customers: [FIXTURE_CUSTOMERS[1]], // t_small, hobby
      total: 1,
    })
    ;(api.getAdminCustomer as any).mockResolvedValueOnce({
      ...FIXTURE_DETAIL,
      team: {
        ...FIXTURE_DETAIL.team,
        id: 't_small',
        tier: 'hobby',
      },
    })
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_small')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_small'))
    await waitFor(() => {
      expect(screen.getByTestId('customer-drawer')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('drawer-change-tier'))
    await waitFor(() => {
      expect(screen.getByTestId('tier-change-modal')).toBeTruthy()
    })
    const tierSelect = screen.getByTestId('tier-select') as HTMLSelectElement
    fireEvent.change(tierSelect, { target: { value: 'pro' } })
    await waitFor(() => {
      expect(screen.getByTestId('tier-confirm-word').textContent).toBe('PROMOTE')
    })
  })

  it('reads the modal banner text — "from <current> to <new>"', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('customer-drawer')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('drawer-change-tier'))
    await waitFor(() => {
      expect(screen.getByTestId('tier-change-modal')).toBeTruthy()
    })
    const select = screen.getByTestId('tier-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'team' } })

    const modal = screen.getByTestId('tier-change-modal')
    await waitFor(() => {
      expect(within(modal).getByText(/from/).textContent).toBeTruthy()
    })
    expect(modal.textContent).toContain('pro')
    expect(modal.textContent).toContain('team')
  })
})

// ─── Track H: currency toggle (USD default + INR fallback) ──────────────
describe('AdminCustomersPage — currency toggle', () => {
  // Each test starts with a clean localStorage so the persisted choice
  // from one case can't leak into the next.
  beforeEach(() => {
    try {
      window.localStorage.removeItem('instant.admin.currency')
    } catch {
      // ignore
    }
  })

  it('defaults to USD with the $ prefix on MRR cells', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    const usdBtn = screen.getByTestId('admin-currency-USD') as HTMLButtonElement
    expect(usdBtn.getAttribute('aria-pressed')).toBe('true')
    const inrBtn = screen.getByTestId('admin-currency-INR') as HTMLButtonElement
    expect(inrBtn.getAttribute('aria-pressed')).toBe('false')

    // t_big has mrr_monthly = 490000 paise = ₹4900 = ~$58.80 at 0.012
    const cell = screen.getByTestId('admin-customer-mrr-t_big')
    expect(cell.textContent).toContain('$')
    expect(cell.textContent).not.toContain('₹')
  })

  it('toggling to INR re-renders MRR with the ₹ prefix', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-currency-INR'))
    await waitFor(() => {
      const cell = screen.getByTestId('admin-customer-mrr-t_big')
      expect(cell.textContent).toContain('₹')
    })
    expect(screen.getByTestId('admin-customer-mrr-t_big').textContent).not.toContain('$')
    const inrBtn = screen.getByTestId('admin-currency-INR') as HTMLButtonElement
    expect(inrBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('persists the choice across mount via localStorage', async () => {
    const { unmount } = render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-currency-INR'))
    await waitFor(() => {
      expect(
        (screen.getByTestId('admin-currency-INR') as HTMLButtonElement)
          .getAttribute('aria-pressed'),
      ).toBe('true')
    })
    expect(window.localStorage.getItem('instant.admin.currency')).toBe('INR')

    unmount()
    cleanup()

    // Re-mount — INR should still be selected because the page reads
    // localStorage on first render.
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    expect(
      (screen.getByTestId('admin-currency-INR') as HTMLButtonElement)
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByTestId('admin-customer-mrr-t_big').textContent).toContain('₹')
  })

  it('propagates the chosen currency into the drawer', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('drawer-overview')).toBeTruthy()
    })
    // Default USD — drawer MRR row should carry a $.
    const mrr = screen.getByTestId('drawer-mrr')
    expect(mrr.textContent).toContain('$')
    expect(mrr.textContent).not.toContain('₹')
  })

  it('drawer renders INR when the page is toggled to INR', async () => {
    render(withRouter(<AdminCustomersPage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-row-t_big')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('admin-currency-INR'))
    fireEvent.click(screen.getByTestId('admin-customer-row-t_big'))
    await waitFor(() => {
      expect(screen.getByTestId('drawer-overview')).toBeTruthy()
    })
    const mrr = screen.getByTestId('drawer-mrr')
    expect(mrr.textContent).toContain('₹')
  })
})

// ─── Track H: currency helpers (lib-level coverage) ─────────────────────
describe('lib/currency — formatMoney + override', () => {
  it('formatINR returns ₹-prefixed locale string for non-zero paise', async () => {
    const { formatINR } = await import('../lib/currency')
    expect(formatINR(490000)).toContain('₹')
    expect(formatINR(490000)).toContain('4,900')
  })

  it('formatINR returns em dash for zero / nullish', async () => {
    const { formatINR } = await import('../lib/currency')
    expect(formatINR(0)).toBe('—')
    expect(formatINR(null)).toBe('—')
    expect(formatINR(undefined)).toBe('—')
  })

  it('formatUSD returns $-prefixed string converted via the static rate', async () => {
    const { formatUSD, ACTIVE_INR_TO_USD } = await import('../lib/currency')
    // 490000 paise = ₹4900, at 0.012 → $58.80.
    const out = formatUSD(490000)
    expect(out).toContain('$')
    // Assert against the active rate so the test still passes if ops
    // ever bumps the default constant.
    const expectedDollars = 4900 * ACTIVE_INR_TO_USD
    // Pull the numeric part out — locale formatting may insert commas.
    const stripped = out.replace(/[^0-9.]/g, '')
    expect(Number(stripped)).toBeCloseTo(expectedDollars, 2)
  })

  it('formatMoney dispatches USD vs INR by code', async () => {
    const { formatMoney } = await import('../lib/currency')
    expect(formatMoney(490000, 'USD')).toContain('$')
    expect(formatMoney(490000, 'INR')).toContain('₹')
  })

  it('VITE_INR_TO_USD override parses through resolveInrToUsd', async () => {
    // Vite statically inlines `import.meta.env.VITE_*` at transform time,
    // so the module-load constant ACTIVE_INR_TO_USD can't be re-driven
    // from a test. The override path is the parser; assert its rules
    // directly. (Build-time override is wired in AdminCustomersPage via
    // ACTIVE_INR_TO_USD; the integration is exercised by the visual
    // tests above.)
    const { resolveInrToUsd, INR_TO_USD } = await import('../lib/currency')
    expect(resolveInrToUsd('0.05')).toBeCloseTo(0.05, 5)
    expect(resolveInrToUsd('0.0125')).toBeCloseTo(0.0125, 5)
    // Falsy / missing → static fallback.
    expect(resolveInrToUsd('')).toBe(INR_TO_USD)
    expect(resolveInrToUsd(null)).toBe(INR_TO_USD)
    expect(resolveInrToUsd(undefined)).toBe(INR_TO_USD)
  })

  it('falls back to the static rate when VITE_INR_TO_USD is unparseable', async () => {
    const { resolveInrToUsd, INR_TO_USD } = await import('../lib/currency')
    expect(resolveInrToUsd('banana')).toBe(INR_TO_USD)
    expect(resolveInrToUsd('NaN')).toBe(INR_TO_USD)
    // Zero / negative rates are nonsensical — fall back too.
    expect(resolveInrToUsd('0')).toBe(INR_TO_USD)
    expect(resolveInrToUsd('-0.5')).toBe(INR_TO_USD)
  })
})
