/* UserMenu.test.tsx — coverage for the topbar avatar dropdown that lets
 * users log out of the dashboard. Bug context: there used to be no UI
 * surface that called api.logout() — the avatar was a static <div>. This
 * suite locks the new behaviour:
 *
 *   1. Trigger renders the avatar with the email's first letter.
 *   2. Clicking the trigger opens a dropdown (role="menu" visible).
 *   3. Clicking outside the dropdown closes it.
 *   4. Escape key closes the dropdown.
 *   5. "Log out" calls api.logout() + navigates to /login.
 *   6. "Account settings" navigates to /app/settings.
 *
 * Styling is intentionally not asserted — the layout tokens are expected
 * to evolve and we don't want to burn tests on every visual tweak. We
 * pin the behaviour with financial / auth consequences. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ─── Module-level mocks ──────────────────────────────────────────────────
// Mock the api so logout() is a spy we can assert against (and so it never
// touches localStorage during the test run).
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    logout: vi.fn().mockResolvedValue({ ok: true }),
  }
})

// Stub useDashboardCtx so we control what the menu reads. We intentionally
// only populate the fields the component reads — `experiments` and other
// /auth/me extensions must NOT be required by the menu.
const FIXTURE_ME = {
  user: { id: 'u_test', email: 'aanya@acme.dev', tier: 'pro', team_id: 't_test', created_at: '' },
  team: { id: 't_test', name: 'acme-corp', slug: 'acme-corp', owner_id: 'u_test', member_count: 1, tier: 'pro', created_at: '' },
}

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: FIXTURE_ME,
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [],
    billing: null,
    billingLoading: false,
  }),
}))

import * as api from '../api'
import { UserMenu } from './UserMenu'

// ─── Helpers ─────────────────────────────────────────────────────────────

// Render the menu inside a MemoryRouter with extra routes wired up so we
// can observe navigation by what react-router actually paints. The "*"
// catch-all route renders the current path as text — assertions read
// the route-shadow div instead of mocking useNavigate.
function renderMenu(initialPath = '/app') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/app/*" element={<UserMenu />} />
        <Route path="/login" element={<div data-testid="route-login">on-login</div>} />
        <Route path="/app/settings" element={<div data-testid="route-settings">on-settings</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  ;(api.logout as unknown as ReturnType<typeof vi.fn>).mockClear()
})
afterEach(() => cleanup())

// ─── Tests ───────────────────────────────────────────────────────────────

describe('UserMenu — trigger', () => {
  it('renders the avatar with the first letter of the email', () => {
    renderMenu()
    const trigger = screen.getByTestId('user-menu-trigger')
    expect(trigger.textContent).toBe('A')
    // Email is exposed for screen readers via the title attribute so
    // users hovering over the avatar see whose account is signed in.
    expect(trigger.getAttribute('title')).toBe('aanya@acme.dev')
  })
})

describe('UserMenu — open / close', () => {
  it('click trigger opens the dropdown', () => {
    renderMenu()
    expect(screen.queryByTestId('user-menu-dropdown')).toBeNull()

    fireEvent.click(screen.getByTestId('user-menu-trigger'))

    const dropdown = screen.getByTestId('user-menu-dropdown')
    expect(dropdown).toBeTruthy()
    expect(dropdown.getAttribute('role')).toBe('menu')
    // The user's email + team identity must surface in the dropdown so
    // they know which account they're about to log out of.
    expect(screen.getByTestId('user-menu-email').textContent).toBe('aanya@acme.dev')
    expect(screen.getByTestId('user-menu-team-name').textContent).toBe('acme-corp')
    expect(screen.getByTestId('user-menu-tier-badge').textContent).toBe('pro')
  })

  it('click outside the dropdown closes it', () => {
    render(
      <MemoryRouter>
        <div>
          <button data-testid="outside">outside</button>
          <Routes>
            <Route path="/" element={<UserMenu />} />
          </Routes>
        </div>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId('user-menu-trigger'))
    expect(screen.getByTestId('user-menu-dropdown')).toBeTruthy()

    // mousedown on a node outside the wrapper must close — the click-
    // outside listener is wired up on `mousedown` (not `click`) so it
    // fires before any other handler can re-open.
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('user-menu-dropdown')).toBeNull()
  })

  it('Escape key closes the dropdown', () => {
    renderMenu()
    fireEvent.click(screen.getByTestId('user-menu-trigger'))
    expect(screen.getByTestId('user-menu-dropdown')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('user-menu-dropdown')).toBeNull()
  })
})

describe('UserMenu — actions', () => {
  it('Log out calls api.logout() and navigates to /login', async () => {
    renderMenu()
    fireEvent.click(screen.getByTestId('user-menu-trigger'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('user-menu-logout'))
      // Flush microtasks so the awaited api.logout() promise + the
      // navigate() that follows commit before assertions.
      await Promise.resolve()
    })

    expect(api.logout).toHaveBeenCalledTimes(1)
    // react-router actually unmounts the menu route and mounts the
    // login route — proves navigation, not just a spy call.
    expect(screen.getByTestId('route-login')).toBeTruthy()
  })

  it('Account settings navigates to /app/settings', () => {
    renderMenu()
    fireEvent.click(screen.getByTestId('user-menu-trigger'))

    fireEvent.click(screen.getByTestId('user-menu-settings'))

    expect(screen.getByTestId('route-settings')).toBeTruthy()
  })
})
