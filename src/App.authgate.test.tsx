/* App.authgate.test.tsx — covers AuthGate redirect behavior added 2026-05-29
 *
 * DOG-9 / BUG-P013: the App-level AuthGate previously redirected to a bare
 * `/login` (only React Router `state.from` carried the path). That state does
 * NOT survive an OAuth or magic-link callback round-trip — the server
 * redirects to /auth/callback → /login → /app, and the in-memory state is
 * gone. Net effect: a logged-out user clicking "Start hobby →" landed on
 * /login, signed in, then ended up on /app/dashboard with all plan + frequency
 * context lost.
 *
 * Fix: AuthGate now encodes the requested path as ?next=<encoded> on the
 * redirect URL too. LoginPage already reads `next` from the query string
 * FIRST (then falls back to loc.state.from). This test pins the contract:
 * unauthenticated /app/checkout?plan=X visit → /login?next=%2Fapp%2Fcheckout%3Fplan%3DX.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

beforeEach(() => {
  window.localStorage.clear()
})

// Mock the New Relic agent + RouteTracker so we don't pull telemetry into the
// test runtime. The App-level RouteTracker is the only other place that touches
// the browser agent on mount; mocking keeps the test fast and offline.
vi.mock('./components/RouteTracker', () => ({ RouteTracker: () => null }))

// Import the real AuthGate (now exported from App.tsx after DOG-9 fix). Using
// the real export means the patch-coverage gate counts these tests against
// the actual AuthGate lines, not a parallel implementation.
import { AuthGate } from './App'

function PathProbe() {
  const loc = useLocation()
  return (
    <div data-testid="path-probe">
      {loc.pathname}
      {loc.search}
    </div>
  )
}

describe('AuthGate — preserves ?next=<path> on unauth redirect (DOG-9 / BUG-P013)', () => {
  it('redirects /app/checkout?plan=hobby&frequency=monthly → /login?next=<encoded>', () => {
    render(
      <MemoryRouter initialEntries={['/app/checkout?plan=hobby&frequency=monthly']}>
        <Routes>
          <Route
            path="/app/checkout"
            element={
              <AuthGate>
                <div data-testid="checkout">checkout body</div>
              </AuthGate>
            }
          />
          <Route path="/login" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    // Did NOT render the checkout body.
    expect(screen.queryByTestId('checkout')).toBeNull()
    const probe = screen.getByTestId('path-probe').textContent ?? ''
    expect(probe).toContain('/login')
    expect(probe).toContain('next=')
    expect(decodeURIComponent(probe)).toContain('/app/checkout?plan=hobby&frequency=monthly')
  })

  it('redirects bare /app → /login (no ?next= for the default destination)', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route
            path="/app"
            element={
              <AuthGate>
                <div data-testid="app">app body</div>
              </AuthGate>
            }
          />
          <Route path="/login" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    const probe = screen.getByTestId('path-probe').textContent ?? ''
    expect(probe).toBe('/login')
  })

  it('renders children when token is present', () => {
    window.localStorage.setItem('instanode.token', 'fake-token-for-test')
    render(
      <MemoryRouter initialEntries={['/app/checkout?plan=pro']}>
        <Routes>
          <Route
            path="/app/checkout"
            element={
              <AuthGate>
                <div data-testid="checkout">checkout body</div>
              </AuthGate>
            }
          />
          <Route path="/login" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('checkout')).toBeTruthy()
  })
})
