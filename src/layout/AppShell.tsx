import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Brand, ScopePill } from '../components/Common'
import { useState, type ReactNode } from 'react'
import { addEnv, setEnv, useDashboardCtx, type DashboardCtx } from '../hooks/useDashboardCtx'

type Scope = 'read' | 'write' | 'agent'

/* Page-meta map — title + scope are static (a route's name doesn't change).
   The crumb is computed at render time from live ctx — see computeCrumb(). */
interface PageMeta { title: string; scope: Scope }

const m = (title: string, scope: Scope): PageMeta => ({ title, scope })

export const PAGE_META: Record<string, PageMeta> = {
  '/':                m('Overview',      'read'),
  '/resources':       m('Resources',     'read'),
  '/resources/:id':   m('flashcards-db', 'read'),
  '/deployments':     m('Deployments',   'read'),
  '/deployments/:id': m('flashcards',    'read'),
  '/stacks':          m('Stacks',        'read'),
  '/agent':           m('Ask agent',     'agent'),
  '/vault':           m('Vault',         'read'),
  '/team':            m('Team',          'read'),
  '/billing':         m('Billing',       'write'),
  '/settings':        m('Settings',      'read'),
  '/contracts':       m('API contracts', 'read')
}

function getMeta(path: string): PageMeta {
  return PAGE_META[path] ?? m('', 'read')
}

// computeCrumb — derive the breadcrumb tail from the live dashboard ctx and
// the current location. Replaces the old hardcoded crumb strings so the
// chrome reflects real counts/env/tier instead of design-mock fixtures.
function computeCrumb(routeKey: string, pathname: string, ctx: DashboardCtx): string {
  switch (routeKey) {
    case '/':
      return ctx.env
    case '/resources':
      return `${ctx.env} · ${ctx.counts.resources} active`
    case '/resources/:id': {
      // Try to resolve resource_type from the loaded resource list (the
      // detail page id appears in the URL). Fall back to em-dash if we
      // haven't fetched it yet.
      const id = pathname.split('/')[2] ?? ''
      const found = (ctx as DashboardCtx & { resources?: { id: string; resource_type: string }[] }).resources?.find((r) => r.id === id)
      const kind = found?.resource_type ?? '—'
      return `resources / ${kind}`
    }
    case '/deployments':
      return `${ctx.env} · ${ctx.counts.deployments} active`
    case '/deployments/:id':
      return 'deployments / live'
    case '/stacks':
      return ctx.env
    case '/agent':
      return 'prompt library · ⌘K'
    case '/vault':
      return `${ctx.env} · ${ctx.counts.vault} entries`
    case '/team': {
      const slug = ctx.me?.team?.slug ?? ctx.me?.team?.id?.slice(0, 8) ?? 'workspace'
      const n = ctx.counts.team
      return `${slug} · ${n} member${n !== 1 ? 's' : ''}`
    }
    case '/billing':
      return ctx.me?.team?.tier ?? '—'
    case '/settings':
      return 'profile'
    case '/contracts':
      return 'api reference'
    default:
      return ''
  }
}

// ---- icons ----
const icons = {
  overview: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="1" y="1" width="5" height="5" rx="0.8" />
      <rect x="8" y="1" width="5" height="5" rx="0.8" />
      <rect x="1" y="8" width="5" height="5" rx="0.8" />
      <rect x="8" y="8" width="5" height="5" rx="0.8" />
    </svg>
  ),
  resources: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <ellipse cx="7" cy="3" rx="5" ry="2" />
      <path d="M2 3v4c0 1.1 2.2 2 5 2s5-0.9 5-2V3" />
      <path d="M2 7v4c0 1.1 2.2 2 5 2s5-0.9 5-2V7" />
    </svg>
  ),
  deploy: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M7 1v6" />
      <path d="M3 5l4-4 4 4" />
      <rect x="2" y="9" width="10" height="4" rx="0.8" />
    </svg>
  ),
  stacks: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <polygon points="7,1 13,4 7,7 1,4" />
      <polyline points="1,7 7,10 13,7" />
      <polyline points="1,10 7,13 13,10" />
    </svg>
  ),
  agent: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M7 1l1.5 3.5L12 6l-3.5 1.5L7 11l-1.5-3.5L2 6l3.5-1.5z" />
    </svg>
  ),
  vault: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2" y="6" width="10" height="7" rx="1" />
      <path d="M4 6V4a3 3 0 0 1 6 0v2" />
    </svg>
  ),
  team: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="5" cy="5" r="2.5" />
      <circle cx="10" cy="5" r="2" />
      <path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4" />
      <path d="M9 12c0-1.5 0.8-2.8 2-3.5" />
    </svg>
  ),
  billing: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="1" y="3" width="12" height="9" rx="1" />
      <line x1="1" y1="6" x2="13" y2="6" />
    </svg>
  ),
  settings: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="7" cy="7" r="2" />
      <path d="M7 1v2M7 11v2M1 7h2M11 7h2M3 3l1.4 1.4M9.6 9.6l1.4 1.4M3 11l1.4-1.4M9.6 4.4l1.4-1.4" />
    </svg>
  ),
  contracts: (
    <svg className="nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M3 1h6l3 3v9H3z" />
      <path d="M9 1v3h3" />
      <line x1="5" y1="7" x2="10" y2="7" />
      <line x1="5" y1="9.5" x2="10" y2="9.5" />
    </svg>
  )
}

function NavRow({ to, icon, children, badge, badgeStyle }: { to: string; icon: ReactNode; children: ReactNode; badge?: ReactNode; badgeStyle?: React.CSSProperties }) {
  return (
    <NavLink to={to} end={to === '/app'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      {icon}
      {children}
      {badge != null && <span className="badge" style={badgeStyle}>{badge}</span>}
    </NavLink>
  )
}

export function AppShell() {
  const location = useLocation()
  const ctx = useDashboardCtx()
  const routeKey = routeIdToKey(location.pathname, location.pathname)
  const meta = getMeta(routeKey)
  const crumb = computeCrumb(routeKey, location.pathname, ctx)

  // Org / team display — real values from /auth/me, fall back to placeholders
  // on first paint before the call resolves.
  const teamSlug = ctx.me?.team?.slug ?? ctx.me?.team?.id?.slice(0, 8) ?? 'workspace'
  const teamInitial = (teamSlug[0] ?? 'A').toUpperCase()
  const tier = ctx.me?.team?.tier ?? '—'

  return (
    <>
      <header className="doc-bar">
        <div className="doc-bar-inner">
          <Brand />
          <span className="crumbs">
            <span style={{ color: 'var(--text-faint)' }}>app</span>
            <span style={{ color: 'var(--text-ghost)' }}>/</span>
            <span style={{ color: 'var(--text-dim)' }}>{crumb}</span>
          </span>
          <div className="doc-meta">
            <span className="live">live · v0.7</span>
          </div>
        </div>
      </header>

      <main className="frame">
        <div className="app">
          <aside className="sidebar" aria-label="Sidebar">
            <div className="org" data-testid="org">
              <div className="av">{teamInitial}</div>
              <div className="org-info">
                <div className="org-name" data-testid="org-name">{teamSlug}</div>
                <div className="org-env">
                  <EnvSwitcher value={ctx.env} options={ctx.envs} />
                  <span className="switch-hint">{tier}</span>
                </div>
              </div>
            </div>

            <div className="nav-section">workspace</div>
            <NavRow to="/app" icon={icons.overview}>Overview</NavRow>
            <NavRow to="/app/resources" icon={icons.resources} badge={String(ctx.counts.resources)}>Resources</NavRow>
            <NavRow to="/app/deployments" icon={icons.deploy} badge={ctx.counts.deployments > 0 ? String(ctx.counts.deployments) : undefined}>Deployments</NavRow>
            <NavRow to="/app/stacks" icon={icons.stacks}>Stacks</NavRow>

            <div className="nav-section">platform</div>
            <NavRow
              to="/app/agent"
              icon={icons.agent}
              badge="⌘K"
              badgeStyle={{
                background: 'rgba(183,148,246,0.08)',
                color: 'var(--violet)',
                border: '1px solid rgba(183,148,246,0.2)'
              }}
            >
              Ask agent
            </NavRow>
            <NavRow to="/app/vault" icon={icons.vault} badge={String(ctx.counts.vault)}>Vault</NavRow>
            <NavRow to="/app/team" icon={icons.team} badge={String(ctx.counts.team)}>Team</NavRow>
            <NavRow to="/app/billing" icon={icons.billing}>Billing</NavRow>
            <NavRow to="/app/settings" icon={icons.settings}>Settings</NavRow>

            <div className="nav-section">design ref</div>
            <NavRow
              to="/app/contracts"
              icon={icons.contracts}
              badge="11 gaps"
              badgeStyle={{
                background: 'rgba(255,122,138,0.08)',
                color: 'var(--rose)',
                border: '1px solid rgba(255,122,138,0.2)'
              }}
            >
              API contracts
            </NavRow>

            <div className="sidebar-footer">
              <div className="upgrade-card">
                <div className="label">→ pro · live</div>
                <div className="body">
                  <strong>9 days to renewal</strong>
                  <br />
                  <span className="dim">card on file · auto-charges May 19.</span>
                </div>
                <button className="cta">Manage plan →</button>
              </div>
            </div>
          </aside>

          <section className="main">
            <header className="topbar">
              <h1>{meta.title}</h1>
              <div className="breadcrumb">
                <span>acme-corp</span>
                <span className="sep">/</span>
                <span className="cur">{crumb}</span>
              </div>
              <div className="topbar-tools">
                <ScopePill scope={meta.scope} />
                <button className="search">
                  <span style={{ opacity: 0.6 }}>⌕</span>
                  <span>Search…</span>
                  <span className="kbd">⌘ /</span>
                </button>
                <button className="ask-agent" title="Open prompt library — ⌘K">
                  <span style={{ opacity: 0.8 }}>✦</span>
                  <span>Ask agent</span>
                  <span className="kbd">⌘ K</span>
                </button>
                <div className="avatar" title="aanya@acme.dev">A</div>
              </div>
            </header>

            <div className="page-body">
              <Outlet />
            </div>
          </section>
        </div>
      </main>
    </>
  )
}

// react-router gives us route-id strings — coerce to our PAGE_META key
function routeIdToKey(_id: string, pathname: string): string {
  // detail routes
  if (/^\/resources\/[^/]+$/.test(pathname)) return '/resources/:id'
  if (/^\/deployments\/[^/]+$/.test(pathname)) return '/deployments/:id'
  return pathname
}

// ──────────────────────────────────────────────────────────────────────────
// EnvSwitcher — pill-shaped <select> wired to the dashboard ctx. Selecting
// "+ new env" opens a tiny inline input that creates an env locally; the
// next API call carries the new env in the query string.
function EnvSwitcher({ value, options }: { value: string; options: string[] }) {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  if (creating) {
    return (
      <span className="env-pill prod" style={{ display: 'inline-flex', gap: 4, padding: '2px 6px' }}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft.trim()) addEnv(draft); setCreating(false); setDraft('') }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) { addEnv(draft); setCreating(false); setDraft('') }
            if (e.key === 'Escape') { setCreating(false); setDraft('') }
          }}
          placeholder="staging"
          data-testid="env-create-input"
          style={{
            background: 'transparent', border: 0, outline: 'none', color: 'var(--accent)',
            font: 'inherit', width: 80, fontFamily: 'var(--font-mono)', fontSize: 11,
          }}
        />
      </span>
    )
  }
  return (
    <select
      data-testid="env-switcher"
      className="env-pill prod"
      value={value}
      onChange={(e) => {
        if (e.target.value === '__new__') setCreating(true)
        else setEnv(e.target.value)
      }}
      style={{
        appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
        border: '1px solid var(--accent-glow)', background: 'var(--accent-soft)',
        color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11,
        padding: '2px 8px', borderRadius: 4,
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
      <option value="__new__" style={{ color: 'var(--violet)' }}>+ new env…</option>
    </select>
  )
}
