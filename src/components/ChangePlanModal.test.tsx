/* ChangePlanModal.test.tsx — unit coverage for the in-dashboard tier-swap
 * dialog. Verifies:
 *   - upgrade-only target list (no downgrades, no same-tier)
 *   - confirm calls api.changePlan with the right args
 *   - short_url response navigates to Razorpay
 *   - immediate:true response refreshes billing + shows success
 *   - 5xx surfaces the Contact-support fallback
 *   - users on the highest tier see the "contact support" empty state
 *
 * Strategy mirrors the existing BillingPage.test.tsx: stub window.location
 * with a swap-able mock so we can intercept href writes without triggering
 * a real navigation in jsdom 24.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ChangePlanModal } from './ChangePlanModal'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    changePlan: vi.fn(),
    createCheckout: vi.fn(),
  }
})

import * as api from '../api'

// jsdom 24 ships window.location.href as a non-configurable setter; the
// same swap-the-whole-object dance BillingPage tests use.
let hrefSetTo: string | null = null
let originalLocation: Location | null = null
function installLocationHrefSpy() {
  hrefSetTo = null
  if (!originalLocation) originalLocation = window.location
  const mock = {
    get href() { return hrefSetTo ?? 'http://localhost/' },
    set href(v: string) { hrefSetTo = v },
    pathname: '/billing',
    search: '',
    origin: 'http://localhost',
    replace: (v: string) => { hrefSetTo = v },
    assign: (v: string) => { hrefSetTo = v },
    reload: () => {},
    toString: () => hrefSetTo ?? 'http://localhost/',
  }
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: mock,
  })
}

function restoreLocation() {
  if (originalLocation) {
    try {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      })
    } catch { /* best-effort */ }
  }
}

beforeEach(() => {
  installLocationHrefSpy()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  restoreLocation()
})

describe('ChangePlanModal — target tier rendering', () => {
  it('renders the modal with the change-plan-modal testid', () => {
    render(<ChangePlanModal currentTier="hobby" onClose={() => {}} />)
    expect(screen.getByTestId('change-plan-modal')).toBeTruthy()
  })

  it('shows the current tier on the body copy', () => {
    render(<ChangePlanModal currentTier="hobby" onClose={() => {}} />)
    const current = screen.getByTestId('change-plan-current-tier')
    expect(current.textContent).toContain('Hobby')
  })

  it('hides hobby as a target for a hobby user (no same-tier confirmations)', () => {
    render(<ChangePlanModal currentTier="hobby" onClose={() => {}} />)
    expect(screen.queryByTestId('change-plan-target-hobby')).toBeNull()
  })

  it('exposes hobby_plus / pro as upgrade targets for a hobby user — but NOT team (TEAM-GATE 2026-06-04)', () => {
    // FIX-R9 (W11): hobby_plus is now a real plan in api/plans.yaml ($19/mo)
    // and must show up between Hobby and Pro in the upgrade picker.
    // TEAM-GATE (2026-06-04 CEO directive): `team` is NO LONGER a self-serve
    // in-app upgrade target — Team ($199 "unlimited") is not rolled out. A
    // user wanting Team goes through sales (the no-upgrades / support exit),
    // not this radio. Do NOT re-add the team assertion.
    render(<ChangePlanModal currentTier="hobby" onClose={() => {}} />)
    expect(screen.queryByTestId('change-plan-target-hobby_plus')).toBeTruthy()
    expect(screen.queryByTestId('change-plan-target-pro')).toBeTruthy()
    expect(screen.queryByTestId('change-plan-target-team')).toBeNull()
  })

  it('hides growth AND team from the upgrade picker (sales-only tiers)', () => {
    // Growth is operator-only / sales-only — there is no real growth row
    // reachable via this modal. Team is sales-gated per the 2026-06-04 CEO
    // directive (TEAM-GATE) until its unlimited-resource delivery is built.
    render(<ChangePlanModal currentTier="hobby" onClose={() => {}} />)
    expect(screen.queryByTestId('change-plan-target-growth')).toBeNull()
    expect(screen.queryByTestId('change-plan-target-team')).toBeNull()
  })

  it('shows the no-upgrades empty state for a pro user (only Team is above, and Team is sales-gated)', () => {
    // TEAM-GATE (2026-06-04): a Pro user's only tier up is Team, which is no
    // longer self-serve. With team removed from SELECTABLE_TIERS, the modal
    // has zero valid upgrade targets and falls through to the "highest plan
    // available through self-serve — contact support" empty state. This
    // REVERSES the prior "only team remains" assertion.
    render(<ChangePlanModal currentTier="pro" onClose={() => {}} />)
    expect(screen.queryByTestId('change-plan-target-team')).toBeNull()
    expect(screen.getByTestId('change-plan-no-upgrades')).toBeTruthy()
    expect((screen.getByTestId('change-plan-confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows pro but hides hobby/team for a hobby_plus user (Team is sales-gated)', () => {
    // FIX-R9: hobby_plus users upgrading should see Pro — hobby is below
    // them, growth is not self-serve, and Team is sales-gated (TEAM-GATE
    // 2026-06-04). Pro is the only self-serve upgrade.
    render(<ChangePlanModal currentTier="hobby_plus" onClose={() => {}} />)
    expect(screen.queryByTestId('change-plan-target-hobby')).toBeNull()
    expect(screen.queryByTestId('change-plan-target-hobby_plus')).toBeNull()
    expect(screen.queryByTestId('change-plan-target-pro')).toBeTruthy()
    expect(screen.queryByTestId('change-plan-target-team')).toBeNull()
  })

  it('renders the no-upgrades empty state with a support link for team users', () => {
    render(<ChangePlanModal currentTier="team" onClose={() => {}} />)
    expect(screen.getByTestId('change-plan-no-upgrades')).toBeTruthy()
    // Confirm button stays disabled with nothing to upgrade to.
    expect((screen.getByTestId('change-plan-confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('always renders the downgrade-via-support exit path', () => {
    render(<ChangePlanModal currentTier="hobby" onClose={() => {}} />)
    const link = screen.getByTestId('change-plan-downgrade-support') as HTMLAnchorElement
    expect(link.href).toContain('mailto:contact@instanode.dev')
  })

  it('preselects defaultTargetTier when it is a valid (self-serve) upgrade', () => {
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    const pro = screen.getByTestId('change-plan-target-pro') as HTMLInputElement
    expect(pro.checked).toBe(true)
  })

  it('drops a sales-gated defaultTargetTier=team and falls back to a valid self-serve upgrade (TEAM-GATE)', () => {
    // TEAM-GATE (2026-06-04): a caller (e.g. BillingPage NEXT_CHANGE_PLAN_TIER)
    // may still pass defaultTargetTier="team", but team is no longer a
    // selectable self-serve upgrade. The modal must drop it and preselect the
    // lowest valid upgrade instead of honouring the now-gated team suggestion.
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="team" onClose={() => {}} />)
    expect(screen.queryByTestId('change-plan-target-team')).toBeNull()
    // Lowest valid upgrade above Hobby is Hobby Plus.
    const hobbyPlus = screen.getByTestId('change-plan-target-hobby_plus') as HTMLInputElement
    expect(hobbyPlus.checked).toBe(true)
  })

  it('shows the no-upgrades empty state for a pro user even with a defaultTargetTier (TEAM-GATE)', () => {
    // Pro user with any defaultTargetTier → the only tier above is Team,
    // which is sales-gated, so there are zero valid self-serve upgrades and
    // the modal renders the contact-support empty state.
    render(<ChangePlanModal currentTier="pro" defaultTargetTier="hobby" onClose={() => {}} />)
    expect(screen.getByTestId('change-plan-no-upgrades')).toBeTruthy()
    expect(screen.queryByTestId('change-plan-target-team')).toBeNull()
  })
})

describe('ChangePlanModal — confirm flow', () => {
  it('calls api.changePlan with the selected target + frequency on submit', async () => {
    ;(api.changePlan as any).mockResolvedValue({ ok: true, immediate: true })
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect((api.changePlan as any).mock.calls.length).toBe(1)
    })
    expect((api.changePlan as any).mock.calls[0]).toEqual(['pro', 'monthly'])
  })

  // BugBash T9-P1-1 (2026-05-20): the modal used to call api.changePlan
  // with frequency=yearly, but POST /api/v1/billing/change-plan ignores
  // plan_frequency and Portal.ChangePlan only resolves monthly plan IDs —
  // the user was silently billed monthly. The yearly branch now routes
  // through api.createCheckout (the same path CheckoutPage uses) so the
  // user gets a real annual Razorpay subscription.
  it('routes Annual frequency through createCheckout (BugBash T9-P1-1)', async () => {
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true,
      short_url: 'https://rzp.io/i/annual-checkout',
    })
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('change-plan-frequency-yearly'))
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect((api.createCheckout as any).mock.calls.length).toBe(1)
    })
    // changePlan is NOT called on the yearly branch — that endpoint can't
    // deliver an annual subscription.
    expect((api.changePlan as any).mock.calls.length).toBe(0)
    // createCheckout receives the target tier + 'yearly' so Razorpay opens
    // the annual plan, not the monthly one.
    expect((api.createCheckout as any).mock.calls[0]).toEqual(['pro', 'yearly'])
  })

  it('honors defaultFrequency=yearly without an extra click (routes via createCheckout)', async () => {
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true,
      short_url: 'https://rzp.io/i/annual-checkout',
    })
    render(
      <ChangePlanModal
        currentTier="hobby"
        defaultTargetTier="pro"
        defaultFrequency="yearly"
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect((api.createCheckout as any).mock.calls[0]).toEqual(['pro', 'yearly'])
    })
    expect((api.changePlan as any).mock.calls.length).toBe(0)
  })

  it('navigates to the createCheckout short_url for an Annual upgrade', async () => {
    ;(api.createCheckout as any).mockResolvedValue({
      ok: true,
      short_url: 'https://rzp.io/i/annual-checkout',
    })
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('change-plan-frequency-yearly'))
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect(hrefSetTo).toBe('https://rzp.io/i/annual-checkout')
    })
  })

  it('navigates to short_url when the server returns one', async () => {
    ;(api.changePlan as any).mockResolvedValue({
      ok: true,
      short_url: 'https://rzp.io/i/upgrade',
      immediate: false,
    })
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect(hrefSetTo).toBe('https://rzp.io/i/upgrade')
    })
  })

  it('calls onChanged and shows success on immediate:true', async () => {
    ;(api.changePlan as any).mockResolvedValue({ ok: true, immediate: true })
    const onChanged = vi.fn()
    render(
      <ChangePlanModal
        currentTier="hobby"
        defaultTargetTier="pro"
        onClose={() => {}}
        onChanged={onChanged}
      />,
    )
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('change-plan-success')).toBeTruthy()
  })

  it('does not navigate when the server returns immediate:true (no short_url path)', async () => {
    ;(api.changePlan as any).mockResolvedValue({ ok: true, immediate: true })
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect(screen.queryByTestId('change-plan-success')).toBeTruthy()
    })
    expect(hrefSetTo).toBeNull()
  })

  it('renders an inline error on a 4xx with no support fallback', async () => {
    ;(api.changePlan as any).mockRejectedValue(
      Object.assign(new Error('Already on requested plan'), { status: 400, code: 'same_plan' }),
    )
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('change-plan-error').textContent).toContain('Already on requested plan')
    })
    expect(screen.queryByTestId('change-plan-support-fallback')).toBeNull()
  })

  it('renders the Contact-support fallback on a 5xx', async () => {
    ;(api.changePlan as any).mockRejectedValue(
      Object.assign(new Error('upstream timeout'), { status: 502, code: 'razorpay_error' }),
    )
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('change-plan-support-fallback')).toBeTruthy()
    })
  })

  it('cancel button fires onClose', () => {
    const onClose = vi.fn()
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('change-plan-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('confirm is disabled while a request is in flight', async () => {
    let resolve: (v: any) => void = () => {}
    ;(api.changePlan as any).mockImplementation(
      () => new Promise((res) => { resolve = res }),
    )
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    const btn = screen.getByTestId('change-plan-confirm') as HTMLButtonElement
    fireEvent.click(btn)
    await waitFor(() => {
      expect(btn.disabled).toBe(true)
      expect(btn.textContent).toContain('Changing')
    })
    resolve({ ok: true, immediate: true })
  })
})
