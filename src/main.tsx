/* main.tsx — dashboard entrypoint.
 *
 * Order matters here:
 *   1. Init the New Relic browser agent FIRST, before any other code that
 *      can throw. The agent installs window.onerror + unhandledrejection
 *      handlers on construction, so calling the constructor early means
 *      bugs in React imports / module-eval also get reported.
 *   2. Then mount React, wrapped in <ErrorBoundary> so render-time crashes
 *      surface as NR `noticeError` calls instead of a blank screen.
 *
 * Mode: pro_plus_spa
 * ──────────────────
 * The `@newrelic/browser-agent` npm package exposes three loader shapes:
 *
 *   - `loaders/browser-agent-lite`     → jserrors only
 *   - `loaders/browser-agent`          → jserrors + page_view_event +
 *                                        page_view_timing + ajax + metrics
 *                                        + session_trace + generic_events +
 *                                        logging + soft_navigations
 *                                        (this is the full "pro_plus_spa")
 *   - `loaders/browser-agent-no-replay`→ same as above minus session_replay
 *
 * The dashboard IS an SPA (React Router, route-level lazy chunks under
 * /app/*), so the right shape is the full BrowserAgent loader. It already
 * pulls in `soft_navigations` (SPA route-change instrumentation) and
 * `page_view_timing` (LCP / FID / CLS / FCP / TTFB web vitals) which the
 * lite loader does NOT include. See:
 *   node_modules/@newrelic/browser-agent/src/loaders/browser-agent.js
 *
 * We pass an explicit `init.soft_navigations.enabled = true` to make the
 * intent unambiguous in this file (the default IS true, but tying the
 * mode to a config flag means a future refactor that disables features
 * surface in code review here, not in NR's dashboard going dark).
 *
 * Fail-open: when VITE_NEWRELIC_LICENSE_KEY is empty (local dev, PR
 * previews, anyone running their own fork) we skip init entirely. This
 * mirrors how the Go services treat an empty NEW_RELIC_LICENSE_KEY — no
 * agent, no telemetry, no crash. */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserAgent } from '@newrelic/browser-agent/loaders/browser-agent'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { buildBrowserAgentOptions } from './lib/newrelic-config'
import './styles/tokens.css'

// initNewRelic — boot the browser agent when both keys are present. The
// agent attaches itself to `window.newrelic` so ErrorBoundary.componentDidCatch
// and RouteTracker can call `noticeError`/`setPageViewName`/`setCustomAttribute`
// later without holding a reference here.
//
// We pass VITE_COMMIT_ID as a global custom attribute via the init config so
// every JS error, AJAX failure, page action, and SPA route change collected
// by the agent is automatically stamped with the dashboard's build SHA.
//
// Feature flags below are explicit (vs. relying on defaults) so the mode is
// readable from this file alone. All of these default to `true` in the
// upstream agent, but we set them anyway to lock the contract:
//   - soft_navigations:  SPA route-change events (the "spa" in pro_plus_spa)
//   - page_view_event:   classic full-page-load PageView event
//   - page_view_timing:  LCP / FID / CLS / FCP / TTFB → transmitted as
//                        PageViewTiming events; viewable on NR's Page Views UI
//   - ajax:              fetch/XHR waterfalls (AjaxRequest events)
//   - distributed_tracing: cross-origin trace propagation to the Go API
function initNewRelic(): void {
  const licenseKey = import.meta.env.VITE_NEWRELIC_LICENSE_KEY
  const applicationID = import.meta.env.VITE_NEWRELIC_APP_ID
  if (!licenseKey || !applicationID) {
    // Local dev / unconfigured env — bail silently. No console.warn to
    // keep the dev console clean; the absence of NR is intentional here.
    return
  }
  try {
    // The actual options live in src/lib/newrelic-config.ts so a unit test
    // can assert the pro_plus_spa shape (page_view_event, page_view_timing,
    // soft_navigations, ajax, metrics all on) without instantiating the
    // real agent (which hits the network + installs window listeners).
    new BrowserAgent(buildBrowserAgentOptions({ licenseKey, applicationID }))
    // Stamp every event with the build SHA. The agent exposes setCustomAttribute
    // on window.newrelic once it finishes booting; do it best-effort.
    const nr = (window as Window & { newrelic?: { setCustomAttribute?: (k: string, v: string) => void } }).newrelic
    if (nr && typeof nr.setCustomAttribute === 'function') {
      nr.setCustomAttribute('commit_id', import.meta.env.VITE_COMMIT_ID || 'dev')
    }
  } catch {
    // Telemetry init must never break the app. If the agent throws on
    // construct (network blocked, malformed key, ad-blocker), swallow and
    // continue rendering — the ErrorBoundary still catches render errors,
    // it just won't be able to ship them.
  }
}

initNewRelic()

// Stale-deploy self-heal.
//
// GitHub Pages stamps `Cache-Control: max-age=600` on the HTML entry
// documents (/app/index.html, /404.html) and we can't override it. So
// for ~10 min after every dashboard deploy, a returning visitor can
// load a CACHED HTML document that references a hashed JS chunk the new
// deploy already deleted. The chunk 404s, the lazy import rejects, and
// React Router's route-level dynamic import fails — the page looks
// stuck on a 404.
//
// Vite fires `vite:preloadError` on window when a dynamically-imported
// chunk fails to load. We catch it and force ONE full reload — which
// re-fetches the HTML, gets the current bundle hash, and recovers.
// The sessionStorage guard prevents an infinite reload loop if the
// reload itself somehow still fails (genuine outage vs. stale cache).
window.addEventListener('vite:preloadError', () => {
  const KEY = 'instanode.chunkReloadAt'
  const last = Number(sessionStorage.getItem(KEY) || 0)
  // Only auto-reload once per 30s — a real, persistent chunk failure
  // (CDN outage) must not trap the user in a reload loop.
  if (Date.now() - last > 30_000) {
    sessionStorage.setItem(KEY, String(Date.now()))
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
