import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Brand, ExpiryWarningBanner, ScopePill, useExpiryTick } from '../components/Common'
import { useEffect, useState, type ReactNode } from 'react'
import { addEnv, setEnv, useDashboardCtx, type DashboardCtx } from '../hooks/useDashboardCtx'
import * as api from '../api'
import type { TeamSummary } from '../api'
import { UserMenu } from './UserMenu'

type Scope = 'read' | 'write' | 'agent'

/* Page-meta map — title + scope are static (a route's name doesn't change).
   The crumb is computed at render time from live ctx — see computeCrumb(). */
interface PageMeta { title: string; scope: Scope }

const m = (title: string, scope: Scope): PageMeta => ({ title, scope })

export const PAGE_META: Record<string, PageMeta> = {
  '/':                m('Overview',      'read'),
  '/resources':       m('Resources',     'read'),
  // '/resources/:id' is intentionally omitted from PAGE_META — the H1 is
  // resolved dynamically from ctx.resources by computeMeta() below so it
  // reflects the loaded resource's real name. The page itself also renders
  // its own header. (§10.21.)
  '/deployments':     m('Deployments',   'read'),
  '/deployments/:id': m('Deployment',    'read'),
  '/vault':           m('Vault',         'read'),
  '/billing':         m('Billing',       'write'),
  '/settings':        m('Settings',      'read'),
  '/contracts':       m('API contracts', 'read'),
  '/admin/customers': m('Customers',      'write'),
}

function getMeta(path: string): PageMeta {
  return PAGE_META[path] ?? m('', 'read')
}

// computeMeta — resolves PageMeta with route-specific dynamic overrides.
// Today it covers '/resources/:id' so the H1 shows the resource's real
// name instead of a hardcoded label.
function computeMeta(routeKey: string, pathname: string, ctx: DashboardCtx): PageMeta {
  if (routeKey === '/resources/:id') {
    const id = pathname.split('/').filter(Boolean).pop() ?? ''
    const found = ctx.resources?.find((r) => r.id === id)
    return { title: found?.name ?? '', scope: 'read' }
  }
  return getMeta(routeKey)
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
    case '/vault':
      return `${ctx.env} · ${ctx.counts.vault} entries`
    case '/billing':
      return ctx.me?.team?.tier ?? '—'
    case '/settings':
      return 'profile'
    case '/contracts':
      return 'api reference'
    case '/admin/customers':
      return 'platform admin'
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

function NavRow({ to, icon, children, badge, badgeStyle, testId }: { to: string; icon: ReactNode; children: ReactNode; badge?: ReactNode; badgeStyle?: React.CSSProperties; testId?: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/app'}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      data-testid={testId}
    >
      {icon}
      {children}
      {badge != null && <span className="badge" style={badgeStyle}>{badge}</span>}
    </NavLink>
  )
}

export function AppShell() {
  const location = useLocation()
  const ctx = useDashboardCtx()
  // Layout-level tick so countdown text in the banner stays fresh
  // (badges on the page itself re-render naturally via this same tick
  //  whenever the user navigates or interacts).
  const now = useExpiryTick(60_000)
  const routeKey = routeIdToKey(location.pathname, location.pathname)
  const meta = computeMeta(routeKey, location.pathname, ctx)
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
            {/* No build-time version constant exists — leaving the meta slot
                empty until one does. (§10.2.) */}
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

            <div className="nav-section">platform</div>
            <NavRow to="/app/vault" icon={icons.vault} badge={String(ctx.counts.vault)}>Vault</NavRow>
            <NavRow to="/app/billing" icon={icons.billing}>Billing</NavRow>
            <NavRow to="/app/settings" icon={icons.settings}>Settings</NavRow>

            {/* Admin-only — rendered when BOTH server-authoritative
                signals fire: is_platform_admin (caller is on
                ADMIN_EMAILS) AND admin_path_prefix (the API has an
                unguessable admin URL prefix configured; without it, the
                admin URL builder can't construct a request and the page
                would be useless). Non-admin users + admin users on a
                deploy without an admin path both see no link, and the
                page 404-redirects, so the route's existence isn't
                leaked either way. */}
            {ctx.me?.is_platform_admin &&
              typeof ctx.me?.admin_path_prefix === 'string' &&
              ctx.me.admin_path_prefix.length > 0 && (
                <>
                  <div className="nav-section">platform admin</div>
                  <NavRow
                    to="/app/admin/customers"
                    icon={icons.team}
                    testId="nav-admin-customers"
                  >
                    Customers
                  </NavRow>
                </>
              )}

            <div className="nav-section">design ref</div>
            {/* §10.21: removed the "11 gaps" badge — the contracts page is a
                design-ref artifact and the badge promised a gap-tracker that
                doesn't exist. */}
            <NavRow to="/app/contracts" icon={icons.contracts}>
              API contracts
            </NavRow>

            <div className="sidebar-footer">
              <SidebarUpgradeCard ctx={ctx} now={now} />
            </div>
          </aside>

          <section className="main">
            <header className="topbar">
              <h1>{meta.title}</h1>
              <div className="breadcrumb">
                <span>{ctx.me?.team?.name ?? ctx.me?.team?.slug ?? 'workspace'}</span>
                <span className="sep">/</span>
                <span className="cur">{crumb}</span>
              </div>
              <div className="topbar-tools">
                <ScopePill scope={meta.scope} />
                <UserMenu />
              </div>
            </header>

            <div className="page-body">
              <ExpiryWarningBanner resources={ctx.resources} now={now} />
              <Outlet />
            </div>
          </section>
        </div>
      </main>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// SidebarUpgradeCard — replaces the old hardcoded "9 days to renewal / card
// on file · auto-charges May 19" block with live values from ctx.billing.
//
// Three states, three renders:
//   - loading (no billing yet)          → small skeleton, no fake numbers
//   - anonymous / free tier             → CTA to upgrade to Hobby
//   - paid tier (hobby / pro / team)    → real next-renewal + payment hint
//
// "Manage plan →" is navigation, not an action — so it's a <Link>, never a
// <button> with no onClick.
function SidebarUpgradeCard({ ctx, now }: { ctx: DashboardCtx; now: number }) {
  const tier = ctx.me?.team?.tier
  const billing = ctx.billing
  const loading = ctx.billingLoading

  // §10.20: cached team summary feeds the resource/member counts that
  // previously didn't render (the dashboard ctx's `counts` field had no
  // live source for `team` — see useDashboardCtx.refreshCounts which
  // hardcodes `team: 1`). One fetch per session-load amortises against
  // every authenticated page render thanks to the server-side 5-min
  // Redis cache + browser Cache-Control: max-age=300.
  const [summary, setSummary] = useState<TeamSummary | null>(null)
  useEffect(() => {
    // Skip the fetch on anon/free where the card never renders counts
    // (the upgrade CTA below is the only render path). Also skip when
    // there's no team_id yet — the request would 401 anyway.
    if (!ctx.me?.team?.id) return
    if (tier === 'anonymous' || tier === 'free') return
    let alive = true
    api.fetchTeamSummary()
      .then((s) => { if (alive) setSummary(s) })
      .catch(() => { /* sidebar count rendering is non-critical */ })
    return () => { alive = false }
  }, [ctx.me?.team?.id, tier])

  // Loading state — render a quiet skeleton instead of stale fixture text.
  if (loading && !billing) {
    return (
      <div className="upgrade-card" data-testid="sidebar-upgrade-card-loading">
        <div className="skel" style={{ width: '60%', height: 10, marginBottom: 8 }} />
        <div className="skel" style={{ width: '90%', height: 10, marginBottom: 6 }} />
        <div className="skel" style={{ width: '70%', height: 10 }} />
      </div>
    )
  }

  // Anonymous / free tier — there's nothing to renew. Show the upgrade
  // wedge: $9 Hobby.
  if (tier === 'anonymous' || tier === 'free' || tier === undefined) {
    return (
      <div className="upgrade-card" data-testid="sidebar-upgrade-card-anonymous">
        <div className="label">→ hobby</div>
        <div className="body">
          <strong>Upgrade to Hobby</strong>
          <br />
          <span className="dim">$9/mo — keep resources past 24h.</span>
        </div>
        <Link to="/app/billing" className="cta" data-testid="sidebar-upgrade-cta">
          Upgrade →
        </Link>
      </div>
    )
  }

  // Paid tier — render real renewal date + payment hint, only when we
  // actually have them. Never fall back to mock strings.
  const renewalAt = billing?.current_period_end ? new Date(billing.current_period_end).getTime() : null
  const renewalText = renewalAt ? formatDaysUntil(renewalAt, now) : null
  const paymentHint =
    billing?.payment_network && billing?.payment_last4
      ? `${billing.payment_network.toLowerCase()} · ****${billing.payment_last4}`
      : null

  // §10.20: live resource + member counts from the cached team summary.
  // Hidden until the fetch resolves so we never render "0 resources · 0
  // members" misleadingly during load.
  const counts = summary?.counts
  const countsLine = counts
    ? `${counts.resources.total} resource${counts.resources.total === 1 ? '' : 's'} · ${counts.members} member${counts.members === 1 ? '' : 's'}`
    : null

  return (
    <div className="upgrade-card" data-testid="sidebar-upgrade-card-paid">
      <div className="label">{tier ? `→ ${tier} · live` : ''}</div>
      <div className="body">
        {renewalText ? (
          <>
            <strong>{renewalText}</strong>
            <br />
          </>
        ) : null}
        {paymentHint ? <span className="dim">{paymentHint}</span> : null}
        {countsLine ? (
          <>
            <br />
            <span
              className="dim"
              data-testid="sidebar-team-counts"
              style={{ fontSize: 10.5, opacity: 0.75 }}
            >
              {countsLine}
            </span>
          </>
        ) : null}
      </div>
      <Link to="/app/billing" className="cta" data-testid="sidebar-manage-plan">
        Manage plan →
      </Link>
    </div>
  )
}

// Render an ms timestamp as a relative "N days to renewal" / "today" / etc.
// Keeps the chrome honest when the period_end is just a day or two away.
function formatDaysUntil(targetMs: number, nowMs: number): string {
  const diffMs = targetMs - nowMs
  const days = Math.round(diffMs / 86_400_000)
  if (days < 0) return 'renewal overdue'
  if (days === 0) return 'renews today'
  if (days === 1) return '1 day to renewal'
  return `${days} days to renewal`
}

// react-router gives us route-id strings — coerce to our PAGE_META key.
//
// The authenticated app is mounted under `/app/*` (see App.tsx), but PAGE_META
// keys are short (`/resources`, `/deployments/:id`, …) because they predate
// the /app prefix. Strip the prefix here so the lookup hits — otherwise
// every page renders an empty <h1> because getMeta() falls through to its
// default. The /app -> root mapping ('/app' becomes '/') matches the
// Overview page entry. (PR-fixed long-standing CI failure 2026-05-11.)
function routeIdToKey(_id: string, pathname: string): string {
  const stripped = pathname.replace(/^\/app/, '') || '/'
  // detail routes
  if (/^\/resources\/[^/]+$/.test(stripped)) return '/resources/:id'
  if (/^\/deployments\/[^/]+$/.test(stripped)) return '/deployments/:id'
  return stripped
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
