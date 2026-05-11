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
import { Navigate, Route, Routes } from 'react-router-dom'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'

// Public marketing pages — synchronous imports so renderToString resolves
// every component to real HTML instead of a Suspense fallback.
import { MarketingPage } from './pages/MarketingPage'
import { PricingPage } from './pages/PricingPage'
import { ForAgentsPage } from './pages/ForAgentsPage'
import { StatusPage } from './pages/StatusPage'
import { BlogPage } from './pages/BlogPage'
import { BlogPostPage } from './pages/BlogPostPage'
import { DocsPage } from './pages/DocsPage'
import { UseCasesPage } from './pages/UseCasesPage'
import { UseCaseDetailPage } from './pages/UseCaseDetailPage'

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
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/blog/:slug" element={<BlogPostPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/use-cases" element={<UseCasesPage />} />
      <Route path="/use-cases/:slug" element={<UseCaseDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
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
