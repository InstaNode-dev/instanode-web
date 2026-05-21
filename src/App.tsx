import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'

// RouteTracker — eagerly imported. Tiny component (~1KB) that watches
// useLocation and forwards every change to the New Relic browser agent
// via setPageViewName + setCustomAttribute. Has to live INSIDE
// <BrowserRouter> (useLocation needs router context) so we mount it as a
// sibling of <AppRoutes>. Renders null — no markup contribution.
import { RouteTracker } from './components/RouteTracker'

// Homepage — eagerly imported. It's the cold-load path and the most-visited
// public surface, so it stays in the main entry chunk.
import { MarketingPage } from './pages/MarketingPage'

// Auth surfaces — eagerly imported. A marketing visitor can land on /login
// directly (deep link, "Sign in" button), and the login form is small.
import { LoginPage } from './pages/LoginPage'
import { LoginCallbackPage } from './pages/LoginCallbackPage'
import { ClaimPage } from './pages/ClaimPage'

// Secondary public marketing surfaces — lazy-loaded on the client so Rollup
// splits each one into its own chunk and a homepage visitor never pays for
// the bytes of pages they didn't navigate to. A click on the nav fetches
// the chunk on demand.
//
// SSR note: scripts/prerender.mjs uses src/entry-server.tsx, which defines
// its OWN AppRoutes with synchronous imports — so renderToString sees real
// components and the pre-rendered HTML contains every word of content.
// React.lazy() during renderToString would otherwise resolve to the
// Suspense fallback and ship empty HTML to crawlers, killing SEO.
const PricingPage = lazy(() =>
  import('./pages/PricingPage').then((m) => ({ default: m.PricingPage })),
)
const ForAgentsPage = lazy(() =>
  import('./pages/ForAgentsPage').then((m) => ({ default: m.ForAgentsPage })),
)
const StatusPage = lazy(() =>
  import('./pages/StatusPage').then((m) => ({ default: m.StatusPage })),
)
const IncidentsPage = lazy(() =>
  import('./pages/IncidentsPage').then((m) => ({ default: m.IncidentsPage })),
)
const BlogPage = lazy(() =>
  import('./pages/BlogPage').then((m) => ({ default: m.BlogPage })),
)
const BlogPostPage = lazy(() =>
  import('./pages/BlogPostPage').then((m) => ({ default: m.BlogPostPage })),
)
const DocsPage = lazy(() =>
  import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })),
)
const UseCasesPage = lazy(() =>
  import('./pages/UseCasesPage').then((m) => ({ default: m.UseCasesPage })),
)
const UseCaseDetailPage = lazy(() =>
  import('./pages/UseCaseDetailPage').then((m) => ({ default: m.UseCaseDetailPage })),
)
// ChangelogPage (W12 B4) — public /changelog. The DPA, subprocessor list,
// and trust-residency egress section all reference /changelog as the
// contractual change-notice channel; before this route existed every doc
// that linked to it 404'd. Lazy-loaded for parity with the other
// secondary marketing surfaces (Blog, Docs, Use cases) — a homepage
// visitor doesn't pay for these bytes.
const ChangelogPage = lazy(() =>
  import('./pages/ChangelogPage').then((m) => ({ default: m.ChangelogPage })),
)
// PrivacyPage / TermsPage (W12 H15) — stop-gap placeholders for the footer
// legal links. Both /privacy and /terms used to 404 (App.tsx had no route)
// so the MarketingPage and PublicShell footers were dead. The pages render
// honest placeholder copy with a contact-legal email so customers know
// where to ask. Replace with real binding copy when legal sign-off lands.
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })),
)
const TermsPage = lazy(() =>
  import('./pages/TermsPage').then((m) => ({ default: m.TermsPage })),
)

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
// StacksPage retired 2026-05-12 — duplicate of DeploymentsPage. UI says
// "Deployments" (user language); the API stays /api/v1/stacks (existing
// data model). One page, one route.
//
// StackCreatePage (W9) — human-driven /stacks/new wizard. Lives behind
// /app/stacks/new because POST /stacks/new is a multipart-only endpoint
// that's hostile to curl-shy customers. This is the one place the
// dashboard intentionally drives a write itself (vs. the agent-driven
// PromptCard pattern) because agents can't tar up source either.
const StackCreatePage = lazy(() =>
  import('./pages/StackCreatePage').then((m) => ({ default: m.StackCreatePage })),
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
const ContractsPage = lazy(() =>
  import('./pages/ContractsPage').then((m) => ({ default: m.ContractsPage })),
)
// CheckoutPage (W12) — landing page for the /pricing CTA. Lives at
// /app/checkout so the AuthGate kicks unauthenticated users to /login first
// (with state.from preserved so they land back here post-login). The page
// reads ?plan= + ?frequency= from the URL, POSTs to /api/v1/billing/checkout,
// then either redirects to Razorpay's short_url or renders a friendly
// fallback when Razorpay isn't configured for the requested tier.
const CheckoutPage = lazy(() =>
  import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })),
)
// ConfirmDeletionPage (Wave FIX-I) — landing page for the email-link
// /auth/email/confirm-deletion → /app/confirm-deletion redirect. The
// API 302s the click here with ?t=<token>&id=<resource_id>&kind={deploy|stack}
// on the query string; the page renders "Are you sure?" and on confirm
// POSTs to /api/v1/{deployments|stacks}/:id/confirm-deletion. Lives
// inside /app so AuthGate kicks unauthenticated users to /login first
// (the email is sent to the team's owner — they must be the one
// confirming).
const ConfirmDeletionPage = lazy(() =>
  import('./pages/ConfirmDeletionPage').then((m) => ({ default: m.ConfirmDeletionPage })),
)
// AdminCustomersPage — founder console at /app/admin/customers. The page
// itself reads ctx.me.is_platform_admin and renders a Navigate when the
// caller isn't an admin, so non-admins never see the route exists. We
// still lazy-load it so the bytes don't ship for regular users.
const AdminCustomersPage = lazy(() =>
  import('./pages/AdminCustomersPage').then((m) => ({ default: m.AdminCustomersPage })),
)
// NotFoundPage (B1-P1, 2026-05-20) — the catch-all route used to
// <Navigate to="/" replace />, silently swallowing every unknown URL
// and dumping the visitor on the homepage. Now we render a real 404
// page; SSG also pre-renders it into dist/404.html so a bogus URL
// returns HTTP 404 with a body that actually says "not found". Lazy-
// loaded because the homepage cold-load path never needs it.
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)
// SecurityPage / LegalDocPage (B1-P1, 2026-05-20) — the footer
// "Security" link used to point to /docs/public/security.md, which GH
// Pages served as raw `text/markdown`. A visitor saw the unrendered
// `## Reporting a vulnerability` source. /security and /legal/:slug
// render the same markdown through the shared minimal pipeline so the
// footer link reaches a real HTML page.
const SecurityPage = lazy(() =>
  import('./pages/SecurityPage').then((m) => ({ default: m.SecurityPage })),
)
const LegalDocPage = lazy(() =>
  import('./pages/SecurityPage').then((m) => ({ default: m.LegalDocPage })),
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

// LegacyRedirect — <Navigate to="/app/resources/:id"> sends a literal ":id"
// string instead of the captured route param (Navigate is dumb — it doesn't
// interpolate). This wrapper reads the param and constructs the real
// destination so /resources/<token> → /app/resources/<token> works.
function LegacyResourceRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/app/resources/${id}`} replace />
}
function LegacyDeploymentRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/app/deployments/${id}`} replace />
}

// CliAuthRedirect — defensive fallback for the /cli-auth path.
//
// The canonical CLI device-flow URL the api emits today is
// /login?cli_session=<id>. /cli-auth was never a real route on
// instanode.dev — but it appears as a stale URL in:
//   - cli/cmd/testapi_test.go (hermetic test mock — "?s=test")
//   - any old terminal scrollback / chat transcript a user pastes
//   - any external docs we missed
// Until the test mock is rewritten AND every CLI binary in the wild
// has rotated, /cli-auth must not 404. We normalize ?s=<id> and
// ?cli_session=<id> to the canonical /login?cli_session=<id> path so
// the user lands on the real login form with the session preserved.
//
// Note: NO query param → still redirect to /login. The LoginPage's
// session_expired banner and OAuth start paths both work without a
// cli_session, so this is safe.
// Exported for unit testing in App.cli-auth.test.tsx — keeps the redirect
// logic verifiable without mounting the full lazy-loaded route tree.
export function CliAuthRedirect() {
  if (typeof window === 'undefined') {
    // SSR: emit a Navigate without a query string. The client will
    // re-run and pick the query up from window.location.search.
    return <Navigate to="/login" replace />
  }
  const params = new URLSearchParams(window.location.search)
  const session = params.get('cli_session') || params.get('s') || ''
  const dest = session ? `/login?cli_session=${encodeURIComponent(session)}` : '/login'
  return <Navigate to={dest} replace />
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

// PublicLoadingFallback — shown while a lazy-loaded public marketing page
// chunk is in flight (e.g. /pricing, /docs, /blog). We render an empty
// span instead of "Loading…" text so a flash of loader copy never appears
// over the layout for a sub-100ms chunk fetch on a warm cache.
//
// Note: this fallback only ever appears in the browser. The SSG path in
// scripts/prerender.mjs uses src/entry-server.tsx, which declares its own
// route tree with synchronous imports — so renderToString resolves real
// content into every pre-rendered HTML file and crawlers never see this.
function PublicLoadingFallback() {
  return <span aria-hidden="true" />
}

// PricingPage and ForAgentsPage both wrap themselves in <PublicShell>, and
// MarketingPage inlines its own nav. So routes mount the page directly —
// no extra shell wrapper needed (would cause double nav rendering).

// AppRoutes is the browser-side route tree. The SSR entry
// (src/entry-server.tsx) declares its own equivalent tree with synchronous
// imports — see the comment at the top of that file for why.
//
// The outer <Suspense> here catches the lazy public pages (Pricing, Blog,
// Docs, etc.) while their chunks load. The inner <Suspense> inside the
// /app route handles the lazy /app/* pages — kept separate so a click in
// /app doesn't blank the marketing shell.
export function AppRoutes() {
  return (
    <Suspense fallback={<PublicLoadingFallback />}>
      <Routes>
        {/* ─── public marketing surfaces ─────────────────────────── */}
        <Route path="/" element={<MarketingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/for-agents" element={<ForAgentsPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/blog" element={<BlogPage />} />
        <Route path="/blog/:slug" element={<BlogPostPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/use-cases" element={<UseCasesPage />} />
        <Route path="/use-cases/:slug" element={<UseCaseDetailPage />} />
        {/* W12 B4: /changelog — referenced by DPA §6 (sub-processor
            change notification), subprocessors.md, and trust-residency
            egress section. Used to 404 because no route existed. */}
        <Route path="/changelog" element={<ChangelogPage />} />
        {/* W12 H15: /privacy and /terms used to 404 — footer links were
            dead. Stop-gap pages render placeholder copy with a legal@
            email until binding language ships. */}
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        {/* B1-P1 (2026-05-20): /security replaces the footer link to
            /docs/public/security.md (raw markdown). /legal/:slug
            exposes the DPA, subprocessor list, trust-residency and
            breach-notification pages through the same renderer. */}
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/legal/:slug" element={<LegalDocPage />} />

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
          {/* W9: /app/stacks/new is the human-driven "Create stack"
              wizard. We deliberately keep the path under /stacks/ (not
              /deployments/) because the underlying api endpoint is
              POST /stacks/new — preserving the user→api vocabulary
              parity helps when someone hits the "open in curl" path. */}
          <Route path="stacks/new" element={<StackCreatePage />} />
          <Route path="vault" element={<VaultPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="contracts" element={<ContractsPage />} />
          {/* W12 C1: /app/checkout is the landing point for /pricing CTAs.
              The page reads ?plan= + ?frequency=, POSTs to the billing
              checkout endpoint, and redirects to Razorpay. AuthGate above
              kicks anonymous visitors to /login first. */}
          <Route path="checkout" element={<CheckoutPage />} />
          {/* Wave FIX-I — email-confirmed deletion landing surface. The
              API's /auth/email/confirm-deletion endpoint 302s every email
              click to this page with the plaintext token + resource id on
              the query string. AuthGate above ensures only the signed-in
              owner can complete the POST. */}
          <Route path="confirm-deletion" element={<ConfirmDeletionPage />} />
          {/* Admin-only — the page itself renders <Navigate to="/" /> for
              non-admin users so the route 404s instead of 403s. */}
          <Route path="admin/customers" element={<AdminCustomersPage />} />
        </Route>

        {/* Back-compat: every legacy unprefixed path that used to be a
            dashboard route now redirects under /app. Parameterized routes
            use a wrapper that interpolates the captured param — see
            LegacyResourceRedirect / LegacyDeploymentRedirect above
            (Navigate's `to` is literal, not parameterized). */}
        <Route path="/resources" element={<Navigate to="/app/resources" replace />} />
        <Route path="/resources/:id" element={<LegacyResourceRedirect />} />
        <Route path="/deployments" element={<Navigate to="/app/deployments" replace />} />
        <Route path="/deployments/:id" element={<LegacyDeploymentRedirect />} />
        {/* /stacks legacy path retired with the route (b13b8ee). Falls
            through to the catch-all → /. */}
        <Route path="/vault" element={<Navigate to="/app/vault" replace />} />
        <Route path="/team" element={<Navigate to="/app/team" replace />} />
        <Route path="/billing" element={<Navigate to="/app/billing" replace />} />
        <Route path="/settings" element={<Navigate to="/app/settings" replace />} />
        {/* /cli-auth — defensive redirect to the canonical /login?cli_session=<s>.
            The api has always emitted /login?cli_session=...; /cli-auth was
            never a real route. But it surfaces in the CLI test mock and in
            any stale terminal scrollback / chat transcript a user pastes.
            Without this route, /cli-auth fell through to the catch-all 404.
            See CliAuthRedirect above for the param-preservation logic. */}
        <Route path="/cli-auth" element={<CliAuthRedirect />} />

        {/* B1-P1 (2026-05-20): real 404 page replaces the silent
            redirect-to-homepage. The same NotFoundPage is also
            pre-rendered into dist/404.html by scripts/prerender.mjs so
            GitHub Pages returns HTTP 404 with a body that actually says
            "not found" instead of the homepage HTML. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

export function App() {
  return (
    // B1-P1-6 (BugBash 2026-05-20): opt-in to React Router v7 future flags
    // so the console stops emitting the two `v7_startTransition` /
    // `v7_relativeSplatPath` deprecation warnings on every prod load.
    // These are forward-compatibility opt-ins — they don't change v6
    // semantics today, but mute the noise + let us validate the v7
    // behaviours under real traffic before the major bump lands. See
    // https://reactrouter.com/v6/upgrading/future for the contract.
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      {/* RouteTracker must sit inside the router so its useLocation() has a
          context, and outside any Suspense boundary so it never unmounts
          during a lazy-chunk fetch (an unmount would skip the
          setPageViewName for that navigation). */}
      <RouteTracker />
      <AppRoutes />
    </BrowserRouter>
  )
}
