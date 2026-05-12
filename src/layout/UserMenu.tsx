// UserMenu — clickable avatar with dropdown for account actions.
//
// Why this exists: the dashboard had a static avatar div in the AppShell
// topbar with no way to log out from the UI. `api.logout()` existed and
// the /auth/logout endpoint was referenced in ContractsPage, but no UI
// surface called it. Users were stuck unless they cleared localStorage
// by hand. This component fixes that gap.
//
// Behaviour:
//   - Trigger: circular avatar showing the first letter of the email.
//   - Click toggles a dropdown anchored bottom-right of the trigger.
//   - Dropdown shows email, team name + tier badge, then a divider,
//     "Account settings" link, and a "Log out" button.
//   - Click outside or pressing Escape closes the dropdown.
//   - Logout calls api.logout() (which clears the token) then navigates
//     to /login.
//
// We intentionally read only the fields we need from the dashboard ctx
// (`me.user.email`, `me.team.name`, `me.team.tier`) so unrelated /auth/me
// surface additions like the just-landed `experiments` field don't break
// the menu.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

const SETTINGS_PATH = '/app/settings'
const LOGIN_PATH = '/login'

export function UserMenu() {
  const ctx = useDashboardCtx()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const email = ctx.me?.user?.email ?? ''
  const teamName = ctx.me?.team?.name ?? ctx.me?.team?.slug ?? 'workspace'
  const tier = ctx.me?.team?.tier ?? '—'
  const initial = (email[0] ?? 'A').toUpperCase()

  // Click-outside + Escape close. Both listeners are attached only while
  // the dropdown is open so we don't pay the cost when it isn't.
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const node = wrapRef.current
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function handleLogout() {
    // logout() is best-effort and never throws — see api/index.ts:222.
    // Swallow defensively anyway so a hypothetical future change can't
    // strand the user on a half-logged-out screen.
    try {
      await api.logout()
    } catch {
      /* swallow — token is cleared regardless */
    }
    setOpen(false)
    navigate(LOGIN_PATH)
  }

  return (
    <div ref={wrapRef} className="user-menu-wrap" data-testid="user-menu" style={{ position: 'relative' }}>
      <button
        type="button"
        className="avatar"
        title={email}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open user menu"
        data-testid="user-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: 'pointer', border: 0 }}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          data-testid="user-menu-dropdown"
          className="user-menu-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 220,
            background: 'var(--elevated)',
            border: '1px solid var(--border-hi)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 50,
            padding: 6,
            fontSize: 13,
          }}
        >
          <div
            style={{
              padding: '8px 10px 10px',
              borderBottom: '1px solid var(--border)',
              marginBottom: 6,
            }}
          >
            <div
              data-testid="user-menu-email"
              style={{
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                wordBreak: 'break-all',
              }}
            >
              {email}
            </div>
            <div
              style={{
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--text)',
              }}
            >
              <span data-testid="user-menu-team-name" style={{ fontWeight: 500 }}>
                {teamName}
              </span>
              <span
                data-testid="user-menu-tier-badge"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  letterSpacing: '0.02em',
                  textTransform: 'lowercase',
                }}
              >
                {tier}
              </span>
            </div>
          </div>

          <Link
            role="menuitem"
            data-testid="user-menu-settings"
            to={SETTINGS_PATH}
            onClick={() => setOpen(false)}
            style={{
              display: 'block',
              padding: '8px 10px',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--text)',
            }}
          >
            Account settings
          </Link>

          <button
            type="button"
            role="menuitem"
            data-testid="user-menu-logout"
            onClick={handleLogout}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--rose)',
              fontFamily: 'inherit',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
