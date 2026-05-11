import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

// Public marketing surfaces — eagerly imported. A marketing visitor might
// click any of these from the homepage nav, so keeping them in the main
// chunk avoids a network round-trip on first interaction. These are also
// the routes that get statically pre-rendered by scripts/prerender.mjs.
import { MarketingPage } from './pages/MarketingPage'
import { PricingPage } from './pages/PricingPage'
import { ForAgentsPage } from './pages/ForAgentsPage'
import { StatusPage } from './pages/StatusPage'
import { BlogPage } from './pages/BlogPage'
import { BlogPostPage } from './pages/BlogPostPage'
import { DocsPage } from './pages/DocsPage'
import { UseCasesPage } from './pages/UseCasesPage'
import { UseCaseDetailPage } from './pages/UseCaseDetailPage'

// Auth surfaces — eagerly imported. A marketing visitor can land on /login
// directly (deep link, "Sign in" button), and the login form is small.
import { LoginPage } from './pages/LoginPage'
import { LoginCallbackPage } from './pages/LoginCallbackPage'
import { ClaimPage } from './pages/ClaimPage'

// Authenticated dashboard surfaces — lazy-loaded. These pages only render
// behind AuthGate (token must be present), so a marketing visitor never
// needs the bytes. Each React.lazy() call ends up in its own chunk; Rollup
// splits these out of the main bundle and the browser fetches them on
// demand when the user navigates into /app/*.
//
// AppShell is also lazy-loaded because it's exclusively the chrome for
// /app/* — the nav rail, breadcrumbs, scope pills. A marketing visitor on
// the homepage never sees it, so its ~10 KB of JSX + the useDashboardCtx
// hook tree it pulls in don't need to ship in the entry bundle.
//
// All page components use named exports, so we adapt them to React.lazy's
// default-export contract inline. The chunkName comment is a hint for
// rollup so the emitted file has a recognizable name in dist/assets/.
const AppShell = lazy(() =>
  import('./layout/AppShell').then((m) => ({ default: m.AppShell })),
)
const OverviewPage = lazy(() =>
  import(/* webpackChunkName: "app-overview" */ './pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
)
const ResourcesPage = lazy(() =>
  import('./pages/ResourcesPage').then((m) => ({ default: m.ResourcesPage })),
)
const ResourceDetailPage = lazy(() =>
  import('./pages/ResourceDetailPage').then((m) => ({ default: m.ResourceDetailPage })),
)
const DeploymentsPage = lazy(() =>
  import('./pages/DeploymentsPage').then((m) => ({ default: m.DeploymentsPage })),
)
const DeployDetailPage = lazy(() =>
  import('./pages/DeployDetailPage').then((m) => ({ default: m.DeployDetailPage })),
)
const StacksPage = lazy(() =>
  import('./pages/StacksPage').then((m) => ({ default: m.StacksPage })),
)
const VaultPage = lazy(() =>
  import('./pages/VaultPage').then((m) => ({ default: m.VaultPage })),
)
const TeamPage = lazy(() =>
  import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })),
)
const BillingPage = lazy(() =>
  import('./pages/BillingPage').then((m) => ({ default: m.BillingPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const AgentPage = lazy(() =>
  import('./pages/AgentPage').then((m) => ({ default: m.AgentPage })),
)
const ContractsPage = lazy(() =>
  import('./pages/ContractsPage').then((m) => ({ default: m.ContractsPage })),
)

import { getToken } from './api'

function AuthGate({ children }: { children: JSX.Element }) {
  const loc = useLocation()
  const token = getToken()
  if (!token) {
    return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  }
  return children
}

// AppLoadingFallback — shown while a lazy-loaded /app/* chunk is in flight.
// Tiny inline style so it renders even before the page's own CSS resolves.
// In practice this fallback is on screen for ~50-150ms on a warm cache.
function AppLoadingFallback() {
  return (
    <div
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--text-muted, #888)',
        fontSize: '0.875rem',
      }}
    >
      Loading…
    </div>
  )
}

// PricingPage and ForAgentsPage both wrap themselves in <PublicShell>, and
// MarketingPage inlines its own nav. So routes mount the page directly —
// no extra shell wrapper needed (would cause double nav rendering).

// AppRoutes is the route tree without the surrounding router. Exported so
// the SSR entry (src/entry-server.tsx) can mount it under <StaticRouter>
// for build-time pre-rendering. The browser-side wrapper below stays the
// same — this is just an extraction, no route changes.
//
// SSR note: scripts/prerender.mjs only renders public routes (see its
// PRERENDER_ROUTES list — no /app/* paths). React.lazy resolves to a
// Suspense fallback during SSR for unrendered chunks, but since SSG never
// visits an /app route, the lazy components are never invoked server-side
// and the build still emits 115 HTML files.
export function AppRoutes() {
  return (
    <Routes>
        {/* ─── public marketing surfaces ─────────────────────────── */}
        <Route path="/" element={<MarketingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/for-agents" element={<ForAgentsPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/blog" element={<BlogPage />} />
        <Route path="/blog/:slug" element={<BlogPostPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/use-cases" element={<UseCasesPage />} />
        <Route path="/use-cases/:slug" element={<UseCaseDetailPage />} />

        {/* ─── auth surfaces (no chrome, dedicated layout) ───────── */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/callback" element={<LoginCallbackPage />} />
        <Route path="/claim" element={<ClaimPage />} />

        {/* ─── authenticated dashboard at /app/* ─────────────────── */}
        {/* Suspense wraps the whole /app subtree so any lazy page below
            shows the same fallback while its chunk loads. We place it
            inside AuthGate so unauthenticated users redirect to /login
            without ever triggering a chunk fetch. */}
        <Route
          path="/app"
          element={
            <AuthGate>
              <Suspense fallback={<AppLoadingFallback />}>
                <AppShell />
              </Suspense>
            </AuthGate>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="resources" element={<ResourcesPage />} />
          <Route path="resources/:id" element={<ResourceDetailPage />} />
          <Route path="deployments" element={<DeploymentsPage />} />
          <Route path="deployments/:id" element={<DeployDetailPage />} />
          <Route path="stacks" element={<StacksPage />} />
          <Route path="vault" element={<VaultPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="agent" element={<AgentPage />} />
          <Route path="contracts" element={<ContractsPage />} />
        </Route>

        {/* Back-compat: every legacy unprefixed path that used to be a
            dashboard route now redirects under /app. */}
        <Route path="/resources" element={<Navigate to="/app/resources" replace />} />
        <Route path="/resources/:id" element={<Navigate to="/app/resources/:id" replace />} />
        <Route path="/deployments" element={<Navigate to="/app/deployments" replace />} />
        <Route path="/deployments/:id" element={<Navigate to="/app/deployments/:id" replace />} />
        <Route path="/stacks" element={<Navigate to="/app/stacks" replace />} />
        <Route path="/vault" element={<Navigate to="/app/vault" replace />} />
        <Route path="/team" element={<Navigate to="/app/team" replace />} />
        <Route path="/billing" element={<Navigate to="/app/billing" replace />} />
        <Route path="/settings" element={<Navigate to="/app/settings" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
