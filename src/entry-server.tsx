/* entry-server.tsx — SSR entry used by scripts/prerender.mjs at build time.
 *
 * The prerender script imports `render` from this module, calls it once per
 * pre-renderable route, and writes the resulting HTML into per-route files
 * inside dist/. Crawlers (Google, Bing, Perplexity, ChatGPT search, etc.)
 * fetch one of those files and see real content instead of an empty
 * <div id="root"></div>. That is the entire SEO/GEO fix.
 *
 * Why this file has its own route tree instead of reusing App.tsx's:
 *
 * The browser-side App.tsx uses React.lazy() for every secondary marketing
 * page (PricingPage, BlogPage, DocsPage, UseCasesPage, etc.) so Rollup
 * splits them into separate chunks and the homepage cold-load doesn't
 * carry their bytes. React.lazy is async by design — during renderToString
 * it suspends and the parent <Suspense> renders the fallback, NOT the
 * page's content. That would defeat SEO entirely: every pre-rendered HTML
 * would contain only the loading fallback.
 *
 * To fix that without bundling all marketing pages into the client entry,
 * this file re-declares AppRoutes with SYNCHRONOUS imports for the lazy
 * pages. The SSR bundle (dist-ssr/entry-server.mjs) is built separately
 * by Vite via `build({ ssr: 'src/entry-server.tsx' })` — its module graph
 * is completely independent of the client bundle, so static imports here
 * don't bloat the client output.
 *
 * Keep the route table here in sync with App.tsx's AppRoutes. The /app/*
 * subtree is omitted because auth-gated pages are never pre-rendered. */

import { StrictMode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'

// Public marketing pages — synchronous imports so renderToString resolves
// every component to real HTML instead of a Suspense fallback.
import { MarketingPage } from './pages/MarketingPage'
import { PricingPage } from './pages/PricingPage'
import { ForAgentsPage } from './pages/ForAgentsPage'
import { StatusPage } from './pages/StatusPage'
import { IncidentsPage } from './pages/IncidentsPage'
import { BlogPage } from './pages/BlogPage'
import { BlogPostPage } from './pages/BlogPostPage'
import { DocsPage } from './pages/DocsPage'
import { UseCasesPage } from './pages/UseCasesPage'
import { UseCaseDetailPage } from './pages/UseCaseDetailPage'
import { ChangelogPage } from './pages/ChangelogPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'
// NotFoundPage (B1-P1, 2026-05-20) — pre-rendered into dist/404.html
// so GitHub Pages's 404 fallback ships a body that actually says "not
// found" instead of the SPA shell that booted and Navigate'd silently
// to /. Imported synchronously like every other SSR'd page.
import { NotFoundPage } from './pages/NotFoundPage'
// SecurityPage + LegalDocPage (B1-P1, 2026-05-20) — replace the
// footer's raw-markdown link with a real HTML route. SSR'd so a
// procurement reviewer pasting /security into a browser sees the real
// content on first byte instead of waiting for hydration.
import { SecurityPage, LegalDocPage } from './pages/SecurityPage'

// SSRRoutes — the SSG-only route tree. Mirrors the public surface of the
// client AppRoutes (everything reachable without auth). The /app/* subtree
// is intentionally omitted: scripts/prerender.mjs never pre-renders auth-
// gated routes (they'd crash on localStorage anyway).
function SSRRoutes() {
  return (
    <Routes>
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
      <Route path="/changelog" element={<ChangelogPage />} />
      {/* W12 H15: privacy / terms pre-rendered with their stop-gap
          placeholder copy so the footer links resolve to a real page
          for crawlers and direct visitors alike. */}
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/security" element={<SecurityPage />} />
      <Route path="/legal/:slug" element={<LegalDocPage />} />
      {/* B1-P1 (2026-05-20): the SSG path renders NotFoundPage for
          every unmatched URL — both the explicit /404 route used by
          prerender.mjs and any URL StaticRouter doesn't know about.
          Was: <Navigate to="/" replace />, which silently dumped the
          visitor on the homepage with the wrong URL in the bar. */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export function render(url: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <SSRRoutes />
      </StaticRouter>
    </StrictMode>
  )
}
