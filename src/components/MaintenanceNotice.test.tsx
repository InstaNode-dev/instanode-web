/* MaintenanceNotice.test.tsx — full coverage for the scheduled-maintenance
 * notice. The component is flag-gated (VITE_MAINTENANCE_MODE), so the tests
 * drive the ON branch via the `enabled` prop and the per-route modal logic
 * via the `pathname` prop — no need to stub import.meta.env or mount a
 * router. The env-read helper (isMaintenanceEnabled) is covered separately.
 *
 * Coverage targets (every line of the new component):
 *   - enabled=false  → renders nothing (the default everywhere except Pages)
 *   - enabled=true   → sticky banner with the headline + body copy
 *   - modal shows on /app + /app/* + /login* and NOT on marketing routes
 *   - dismiss via button, overlay click, and Escape key — all close it and
 *     persist the dismissal in sessionStorage
 *   - a persisted dismissal keeps the modal closed on remount
 *   - isMaintenanceEnabled() reads the env flag
 *   - modalAppliesTo() route predicate
 *   - sessionStorage-throws fail-open paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  MaintenanceNotice,
  isMaintenanceEnabled,
  modalAppliesTo,
  MAINTENANCE_HEADLINE,
  MAINTENANCE_BODY,
} from './MaintenanceNotice'

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MaintenanceNotice — flag gating', () => {
  it('renders nothing when disabled', () => {
    const { container } = render(<MaintenanceNotice enabled={false} pathname="/app" />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('maintenance-banner')).toBeNull()
    expect(screen.queryByTestId('maintenance-modal')).toBeNull()
  })

  it('renders nothing when called with no props and the env flag is off (default test env)', () => {
    // In the unit-test env VITE_MAINTENANCE_MODE is unset, so the default
    // (enabled omitted → isMaintenanceEnabled()) is false. This covers the
    // env-read default-argument branch.
    const { container } = render(<MaintenanceNotice />)
    expect(container.firstChild).toBeNull()
  })
})

describe('MaintenanceNotice — sticky banner', () => {
  it('shows the banner with headline + body when enabled, on any route', () => {
    render(<MaintenanceNotice enabled pathname="/" />)
    const banner = screen.getByTestId('maintenance-banner')
    expect(banner).toBeTruthy()
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.textContent).toContain(MAINTENANCE_HEADLINE)
    expect(banner.textContent).toContain('Your data is safe')
  })

  it('does NOT show the modal on a marketing route', () => {
    render(<MaintenanceNotice enabled pathname="/pricing" />)
    expect(screen.getByTestId('maintenance-banner')).toBeTruthy()
    expect(screen.queryByTestId('maintenance-modal')).toBeNull()
  })

  it('resolves the current path from window.location when pathname is omitted', () => {
    // No `pathname` prop → resolvePathname() reads window.location.pathname.
    // jsdom defaults to "/", a marketing path, so the banner shows but the
    // modal does not. This covers the resolvePathname window branch.
    render(<MaintenanceNotice enabled />)
    expect(screen.getByTestId('maintenance-banner')).toBeTruthy()
    expect(screen.queryByTestId('maintenance-modal')).toBeNull()
  })
})

describe('MaintenanceNotice — modal on /app + /login', () => {
  it('shows the modal on /app', () => {
    render(<MaintenanceNotice enabled pathname="/app" />)
    const modal = screen.getByTestId('maintenance-modal')
    expect(modal).toBeTruthy()
    expect(modal.getAttribute('aria-modal')).toBe('true')
    expect(modal.textContent).toContain(MAINTENANCE_HEADLINE)
  })

  it('shows the modal on a nested /app/* route', () => {
    render(<MaintenanceNotice enabled pathname="/app/resources" />)
    expect(screen.getByTestId('maintenance-modal')).toBeTruthy()
  })

  it('shows the modal on /login', () => {
    render(<MaintenanceNotice enabled pathname="/login?next=%2Fapp" />)
    expect(screen.getByTestId('maintenance-modal')).toBeTruthy()
  })

  it('closes the modal and persists the dismissal when the button is clicked', () => {
    render(<MaintenanceNotice enabled pathname="/app" />)
    expect(screen.getByTestId('maintenance-modal')).toBeTruthy()
    fireEvent.click(screen.getByTestId('maintenance-modal-dismiss'))
    expect(screen.queryByTestId('maintenance-modal')).toBeNull()
    expect(window.sessionStorage.getItem('instanode.maintenanceModalDismissed')).toBe('1')
    // Banner persists after dismiss.
    expect(screen.getByTestId('maintenance-banner')).toBeTruthy()
  })

  it('closes the modal on overlay (backdrop) click', () => {
    render(<MaintenanceNotice enabled pathname="/app" />)
    const overlay = screen.getByTestId('maintenance-modal')
    fireEvent.click(overlay)
    expect(screen.queryByTestId('maintenance-modal')).toBeNull()
  })

  it('does NOT close when clicking inside the dialog card (event target is a child)', () => {
    render(<MaintenanceNotice enabled pathname="/app" />)
    // Clicking the headline inside the card must not bubble-dismiss.
    fireEvent.click(screen.getByText(MAINTENANCE_HEADLINE, { selector: 'h2' }))
    expect(screen.getByTestId('maintenance-modal')).toBeTruthy()
  })

  it('closes the modal on Escape and ignores other keys', () => {
    render(<MaintenanceNotice enabled pathname="/app" />)
    // A non-Escape key is a no-op (covers the `if (e.key === 'Escape')` false branch).
    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.getByTestId('maintenance-modal')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('maintenance-modal')).toBeNull()
    expect(window.sessionStorage.getItem('instanode.maintenanceModalDismissed')).toBe('1')
  })

  it('keeps the modal closed on a fresh mount once dismissed this session', () => {
    window.sessionStorage.setItem('instanode.maintenanceModalDismissed', '1')
    render(<MaintenanceNotice enabled pathname="/app" />)
    expect(screen.queryByTestId('maintenance-modal')).toBeNull()
    // Banner still shows.
    expect(screen.getByTestId('maintenance-banner')).toBeTruthy()
  })
})

describe('MaintenanceNotice — sessionStorage failure is non-fatal', () => {
  // jsdom's sessionStorage is an exotic Storage object whose methods can't be
  // replaced via vi.spyOn (the spy is silently ignored). To exercise the
  // fail-open catch branches we swap the whole window.sessionStorage for a
  // throwing stub via Object.defineProperty, then restore it after.
  function withThrowingSessionStorage(stub: Partial<Storage>, fn: () => void) {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      value: stub,
      configurable: true,
      writable: true,
    })
    try {
      fn()
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original)
    }
  }

  it('shows the modal when sessionStorage.getItem throws (fail-open on read)', () => {
    withThrowingSessionStorage(
      {
        getItem() {
          throw new Error('blocked')
        },
        setItem() {},
      },
      () => {
        render(<MaintenanceNotice enabled pathname="/app" />)
        expect(screen.getByTestId('maintenance-modal')).toBeTruthy()
      },
    )
  })

  it('still closes the modal when sessionStorage.setItem throws (fail-open on write)', () => {
    withThrowingSessionStorage(
      {
        getItem() {
          return null
        },
        setItem() {
          throw new Error('blocked')
        },
      },
      () => {
        render(<MaintenanceNotice enabled pathname="/app" />)
        fireEvent.click(screen.getByTestId('maintenance-modal-dismiss'))
        expect(screen.queryByTestId('maintenance-modal')).toBeNull()
      },
    )
  })
})

describe('MaintenanceNotice — helpers', () => {
  it('isMaintenanceEnabled reflects the (off) env flag in the test env', () => {
    expect(isMaintenanceEnabled()).toBe(false)
  })

  it('modalAppliesTo matches only /app* and /login*', () => {
    expect(modalAppliesTo('/app')).toBe(true)
    expect(modalAppliesTo('/app/billing')).toBe(true)
    expect(modalAppliesTo('/login')).toBe(true)
    expect(modalAppliesTo('/login/callback')).toBe(true)
    expect(modalAppliesTo('/')).toBe(false)
    expect(modalAppliesTo('/pricing')).toBe(false)
    expect(modalAppliesTo('/docs')).toBe(false)
  })

  it('exposes stable copy constants used by both surfaces', () => {
    expect(MAINTENANCE_HEADLINE).toBe('Scheduled maintenance')
    expect(MAINTENANCE_BODY).toContain('temporarily unavailable')
    expect(MAINTENANCE_BODY).toContain('back shortly')
  })
})
