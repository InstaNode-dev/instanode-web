/* RouteTracker.tsx — wires React Router location changes into the New
 * Relic browser agent.
 *
 * What it does on every route change:
 *   1. Calls `newrelic.setPageViewName(pathname)` so NR's page-view UI
 *      shows route-level granularity (`/app/admin/customers` vs
 *      `/app/resources`) instead of every event collapsing under the SPA
 *      shell URL. Without this, soft-nav events carry the previous full
 *      URL (or a generic "/") and the page-load funnel is unreadable.
 *   2. Calls `newrelic.setCustomAttribute(...)` for three dimensions:
 *        - tier:       current paid tier (anonymous|hobby|pro|growth|team)
 *        - is_admin:   whether the signed-in user is a platform admin
 *        - commit_id:  the dashboard build SHA (already stamped by
 *                      main.tsx, but we re-set it here so a single
 *                      PageView/SoftNav event always carries it even if
 *                      the agent's global-attr cache was cleared)
 *
 * Why a component vs. an `init` hook:
 *   `useLocation()` requires a Router context. The simplest correct shape
 *   is a component mounted *inside* <BrowserRouter> that watches
 *   location via a useEffect dependency. App.tsx renders this just below
 *   the router's opening tag — see App.tsx for the placement.
 *
 * Fail-open:
 *   When `window.newrelic` is absent (no license key, ad-blocker, agent
 *   boot failed), every call here is a no-op. Telemetry must never break
 *   the app.
 *
 * Tier + admin sourcing:
 *   We read the live `me` from useDashboardCtx — not from props — so the
 *   tracker rerenders when the user signs in or upgrades. Before /auth/me
 *   resolves, ctx.me is null and we stamp "anonymous"/false for tier and
 *   is_admin (matches the unauthenticated marketing-shell case).
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

// NR API surface — typed loosely because the agent attaches at runtime
// and may be absent (no license key, ad-blocker, agent boot failed).
type NRWindow = Window & {
  newrelic?: {
    setPageViewName?: (name: string, host?: string) => void
    setCustomAttribute?: (key: string, value: string | number | boolean | null) => void
  }
}

// Defaults used when /auth/me hasn't resolved yet (anonymous browse of
// marketing pages) — match the API's anonymous-tier semantics. We don't
// fabricate a different shape just because the page is public.
const TIER_FALLBACK = 'anonymous'
const COMMIT_ID_FALLBACK = 'dev'

export function RouteTracker(): null {
  const location = useLocation()
  const ctx = useDashboardCtx()

  useEffect(() => {
    // The agent might not have booted yet on the first render (the npm
    // BrowserAgent constructor schedules its bootstrap async). Re-check
    // each effect run; once it's there, every subsequent location change
    // gets stamped.
    const nr = (window as NRWindow).newrelic
    if (!nr) return

    const pathname = location.pathname || '/'
    const tier = ctx.me?.team?.tier ?? TIER_FALLBACK
    const isAdmin = Boolean(ctx.me?.is_platform_admin)
    const commitId = import.meta.env.VITE_COMMIT_ID || COMMIT_ID_FALLBACK

    try {
      // setPageViewName: the second arg ("host") is optional; NR fills it
      // from window.location.host when omitted. Skip it so a custom
      // domain (instanode.dev vs preview-*.netlify.app) doesn't drift the
      // grouping.
      nr.setPageViewName?.(pathname)
      nr.setCustomAttribute?.('tier', tier)
      nr.setCustomAttribute?.('is_admin', isAdmin)
      nr.setCustomAttribute?.('commit_id', commitId)
    } catch {
      // Best-effort. A NR API throw must not crash the router.
    }
    // Re-run on path change OR when the user/tier/admin flag changes (sign
    // in, upgrade webhook lands, admin promote). location.search /
    // location.hash deliberately excluded — query-string churn on the same
    // page shouldn't double-count as a new page view.
  }, [location.pathname, ctx.me?.team?.tier, ctx.me?.is_platform_admin])

  return null
}
