import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './layout/AppShell'

// Public marketing surfaces
import { MarketingPage } from './pages/MarketingPage'
import { PricingPage } from './pages/PricingPage'
import { ForAgentsPage } from './pages/ForAgentsPage'
import { StatusPage } from './pages/StatusPage'
import { BlogPage } from './pages/BlogPage'
import { BlogPostPage } from './pages/BlogPostPage'
import { DocsPage } from './pages/DocsPage'
import { UseCasesPage } from './pages/UseCasesPage'

// Auth surfaces
import { LoginPage } from './pages/LoginPage'
import { LoginCallbackPage } from './pages/LoginCallbackPage'
import { ClaimPage } from './pages/ClaimPage'

// Authenticated dashboard surfaces
import { OverviewPage } from './pages/OverviewPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { ResourceDetailPage } from './pages/ResourceDetailPage'
import { DeploymentsPage } from './pages/DeploymentsPage'
import { DeployDetailPage } from './pages/DeployDetailPage'
import { StacksPage } from './pages/StacksPage'
import { VaultPage } from './pages/VaultPage'
import { TeamPage } from './pages/TeamPage'
import { BillingPage } from './pages/BillingPage'
import { SettingsPage } from './pages/SettingsPage'
import { AgentPage } from './pages/AgentPage'
import { ContractsPage } from './pages/ContractsPage'

import { getToken } from './api'

function AuthGate({ children }: { children: JSX.Element }) {
  const loc = useLocation()
  const token = getToken()
  if (!token) {
    return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  }
  return children
}

// PricingPage and ForAgentsPage both wrap themselves in <PublicShell>, and
// MarketingPage inlines its own nav. So routes mount the page directly —
// no extra shell wrapper needed (would cause double nav rendering).

// AppRoutes is the route tree without the surrounding router. Exported so
// the SSR entry (src/entry-server.tsx) can mount it under <StaticRouter>
// for build-time pre-rendering. The browser-side wrapper below stays the
// same — this is just an extraction, no route changes.
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

        {/* ─── auth surfaces (no chrome, dedicated layout) ───────── */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/callback" element={<LoginCallbackPage />} />
        <Route path="/claim" element={<ClaimPage />} />

        {/* ─── authenticated dashboard at /app/* ─────────────────── */}
        <Route
          path="/app"
          element={
            <AuthGate>
              <AppShell />
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
