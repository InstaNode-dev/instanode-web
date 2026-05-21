/* App.cli-auth.test.tsx — fix/cli-auth-route.
 *
 * Pins the /cli-auth redirect contract.
 *
 * Background: a user reported "That page is not provisioned" hitting
 * https://instanode.dev/cli-auth — the api emits the canonical
 * /login?cli_session=<id> path (since 0c7991c) but /cli-auth still
 * appears in the CLI test mock and any old terminal scrollback /
 * chat transcript a user pastes. Without a route, /cli-auth fell
 * through to the catch-all NotFoundPage.
 *
 * The fix is App.tsx's CliAuthRedirect — a Navigate that normalizes
 *   /cli-auth?cli_session=<id>  → /login?cli_session=<id>
 *   /cli-auth?s=<id>            → /login?cli_session=<id>   (test-mock shape)
 *   /cli-auth                   → /login                    (no param)
 *
 * These tests fail closed if a future refactor drops the param
 * preservation, drops the s→cli_session rename, or routes to the
 * wrong destination.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { CliAuthRedirect } from './App'

// LocationSink — renders the current router pathname + search so the
// test can assert what CliAuthRedirect's <Navigate> landed on. We
// can't read window.location for this because MemoryRouter doesn't
// touch the global — it updates its internal context only. useLocation
// is the right truth surface.
function LocationSink() {
  const loc = useLocation()
  return <div data-testid="landed">{loc.pathname + loc.search}</div>
}

// CliAuthRedirect reads window.location.search directly (so it can
// preserve the query through Navigate). MemoryRouter doesn't update
// window.location, so we stub it per test.
const realLocation = window.location

function stubLocation(search: string) {
  // jsdom's window.location is read-only as a whole, but its
  // individual properties (.search) are configurable. Reassign just
  // what we need.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, search },
    writable: true,
  })
}

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
    writable: true,
  })
  cleanup()
})

// Helper — mount CliAuthRedirect with a sink route that renders the
// landed-on pathname + search so we can assert the redirect target.
function mountAt(initialEntry: string, search: string) {
  stubLocation(search)
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/cli-auth" element={<CliAuthRedirect />} />
        <Route path="/login" element={<LocationSink />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CliAuthRedirect — /cli-auth defensive redirect (fix/cli-auth-route)', () => {
  it('preserves ?cli_session=<id> into /login?cli_session=<id>', () => {
    const { container } = mountAt('/cli-auth?cli_session=abc123', '?cli_session=abc123')
    // The Navigate runs synchronously during render — by the time
    // the assertion runs, the second route should be mounted.
    const landed = container.querySelector('[data-testid="landed"]')
    expect(landed).not.toBeNull()
    expect(landed?.textContent).toContain('/login')
    expect(landed?.textContent).toContain('cli_session=abc123')
  })

  it('rewrites ?s=<id> (test-mock shape) into /login?cli_session=<id>', () => {
    const { container } = mountAt('/cli-auth?s=test', '?s=test')
    const landed = container.querySelector('[data-testid="landed"]')
    expect(landed).not.toBeNull()
    expect(landed?.textContent).toContain('cli_session=test')
    // The original ?s= form must NOT leak through unchanged — that
    // would mean the LoginPage couldn't find the session.
    expect(landed?.textContent).not.toMatch(/[?&]s=/)
  })

  it('falls back to /login (no param) when query is empty', () => {
    const { container } = mountAt('/cli-auth', '')
    const landed = container.querySelector('[data-testid="landed"]')
    expect(landed).not.toBeNull()
    // No cli_session param — bare /login.
    expect(landed?.textContent).toBe('/login')
  })

  it('URL-encodes a session id containing reserved characters', () => {
    // /cli-auth?cli_session=a/b%20d
    // URLSearchParams.get('cli_session') decodes %20 → ' ', leaving 'a/b d'.
    // encodeURIComponent then re-encodes: '/' → '%2F', ' ' → '%20'.
    // Net effect: the canonical /login link is well-formed.
    const { container } = mountAt(
      '/cli-auth?cli_session=a/b%20d',
      '?cli_session=a/b%20d',
    )
    const landed = container.querySelector('[data-testid="landed"]')
    expect(landed).not.toBeNull()
    expect(landed?.textContent).toContain('cli_session=a%2Fb%20d')
    // Unencoded '/' would break a URL parser that interprets the
    // path/query boundary — fail fast if a future refactor drops the
    // encodeURIComponent call.
    expect(landed?.textContent).not.toMatch(/cli_session=a\/b/)
  })

  it('prefers cli_session over s when both are present', () => {
    // Defensive: if a stale link somehow carries both, the canonical
    // name wins.
    const { container } = mountAt(
      '/cli-auth?cli_session=real&s=stale',
      '?cli_session=real&s=stale',
    )
    const landed = container.querySelector('[data-testid="landed"]')
    expect(landed).not.toBeNull()
    expect(landed?.textContent).toContain('cli_session=real')
    expect(landed?.textContent).not.toContain('stale')
  })
})
