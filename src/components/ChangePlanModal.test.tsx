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

  it('exposes pro / team / growth as upgrade targets for a hobby user', () => {
    render(<ChangePlanModal currentTier="hobby" onClose={() => {}} />)
    expect(screen.queryByTestId('change-plan-target-pro')).toBeTruthy()
    expect(screen.queryByTestId('change-plan-target-team')).toBeTruthy()
    expect(screen.queryByTestId('change-plan-target-growth')).toBeTruthy()
  })

  it('hides hobby/growth as downgrades for a pro user — only team remains', () => {
    render(<ChangePlanModal currentTier="pro" onClose={() => {}} />)
    expect(screen.queryByTestId('change-plan-target-hobby')).toBeNull()
    expect(screen.queryByTestId('change-plan-target-growth')).toBeNull()
    expect(screen.queryByTestId('change-plan-target-team')).toBeTruthy()
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
    expect(link.href).toContain('mailto:support@instanode.dev')
  })

  it('preselects defaultTargetTier when it is a valid upgrade', () => {
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="team" onClose={() => {}} />)
    const team = screen.getByTestId('change-plan-target-team') as HTMLInputElement
    expect(team.checked).toBe(true)
  })

  it('drops defaultTargetTier when it would be a downgrade and picks the lowest upgrade', () => {
    // Pro user with a defaultTargetTier of hobby → the upgrade list is just
    // ['team'], and the modal should preselect team rather than honour the
    // (illegal) hobby suggestion.
    render(<ChangePlanModal currentTier="pro" defaultTargetTier="hobby" onClose={() => {}} />)
    const team = screen.getByTestId('change-plan-target-team') as HTMLInputElement
    expect(team.checked).toBe(true)
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

  it('forwards the chosen frequency when the user picks Annual', async () => {
    ;(api.changePlan as any).mockResolvedValue({ ok: true, immediate: true })
    render(<ChangePlanModal currentTier="hobby" defaultTargetTier="pro" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('change-plan-frequency-yearly'))
    fireEvent.click(screen.getByTestId('change-plan-confirm'))
    await waitFor(() => {
      expect((api.changePlan as any).mock.calls.length).toBe(1)
    })
    expect((api.changePlan as any).mock.calls[0]).toEqual(['pro', 'yearly'])
  })

  it('honors defaultFrequency=yearly without an extra click', async () => {
    ;(api.changePlan as any).mockResolvedValue({ ok: true, immediate: true })
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
      expect((api.changePlan as any).mock.calls[0]).toEqual(['pro', 'yearly'])
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
