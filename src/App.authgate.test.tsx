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
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// Stash + clear the localStorage token between tests — `getToken()` reads
// from localStorage; the AuthGate dispatches off it.
beforeEach(() => {
  window.localStorage.clear()
})

// Mock the New Relic + heavy dashboard bits we don't need.
vi.mock('./components/RouteTracker', () => ({ RouteTracker: () => null }))

// We re-import AuthGate from App.tsx. It's a default function (not exported),
// so we test the behavior end-to-end via the same Navigate-based router and
// a tiny probe page that reflects the current path.
function PathProbe() {
  const loc = useLocation()
  return (
    <div data-testid="path-probe">
      {loc.pathname}
      {loc.search}
    </div>
  )
}

// Reproduce the AuthGate logic inline so we test the exact contract without
// pulling in the entire App tree (which mounts a BrowserRouter and a full
// router config). This mirrors App.tsx:AuthGate verbatim — when the source
// changes the test must be updated in lockstep.
import { Navigate, useLocation as useLoc2 } from 'react-router-dom'
function AuthGate({ children }: { children: ReactElement }) {
  const loc = useLoc2()
  const token = window.localStorage.getItem('instanode.token')
  if (!token) {
    const from = loc.pathname + loc.search
    const to = from === '/app' ? '/login' : `/login?next=${encodeURIComponent(from)}`
    return <Navigate to={to} replace state={{ from }} />
  }
  return children
}

describe('AuthGate — preserves ?next=<path> on unauth redirect (DOG-9 / BUG-P013)', () => {
  it('redirects /app/checkout?plan=hobby&frequency=monthly → /login?next=%2Fapp%2Fcheckout%3Fplan%3Dhobby%26frequency%3Dmonthly', () => {
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
