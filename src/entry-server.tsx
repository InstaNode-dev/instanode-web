/* entry-server.tsx — SSR entry used by scripts/prerender.mjs at build time.
 *
 * The prerender script imports `render` from this module, calls it once per
 * pre-renderable route, and writes the resulting HTML into per-route files
 * inside dist/. Crawlers (Google, Bing, Perplexity, ChatGPT search, etc.)
 * fetch one of those files and see real content instead of an empty
 * <div id="root"></div>. That is the entire SEO/GEO fix.
 *
 * Keep this surface tiny — just `render(url)`. The route tree itself lives
 * in App.tsx and is shared with the browser entry. */

import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { AppRoutes } from './App'

export function render(url: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <AppRoutes />
      </StaticRouter>
    </StrictMode>
  )
}
