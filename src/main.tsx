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
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
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
// Lazy + idle deferral (perf/bugbash-bundle-split-2026-05-20):
//
// Both the `@newrelic/browser-agent` loader and our buildBrowserAgentOptions
// helper live behind dynamic imports so they land in a separate Rollup chunk
// (newrelic-vendor) instead of bloating the main entry. The chunk only
// downloads + parses when initNewRelic() actually runs, which we kick off
// from a `requestIdleCallback` (or a 1s setTimeout fallback) so the agent
// boots after the first paint completes — never blocking LCP. Two stable
// guarantees the prior implementation already provided are preserved here:
//
//   1. window.onerror/unhandledrejection coverage during the pre-init window.
//      The early-error queue below buffers any errors that fire before the
//      agent installs its own handlers and replays them via noticeError once
//      it boots. A render-time crash during the first 50–500ms of paint
//      still reaches NR.
//   2. Fail-open. When VITE_NEWRELIC_LICENSE_KEY is empty (local dev, PR
//      previews, anyone running their own fork) we skip the dynamic import
//      entirely — the chunk is never fetched.
//
// Feature flags inside buildBrowserAgentOptions are explicit (vs. relying on
// defaults) so the pro_plus_spa mode is readable from one file. See
// src/lib/newrelic-config.ts for the full enumeration.
function initNewRelic(): void {
  const licenseKey = import.meta.env.VITE_NEWRELIC_LICENSE_KEY
  const applicationID = import.meta.env.VITE_NEWRELIC_APP_ID
  if (!licenseKey || !applicationID) {
    // Local dev / unconfigured env — bail silently. No console.warn to
    // keep the dev console clean; the absence of NR is intentional here.
    return
  }

  // Pre-init error queue. Browsers fire `error` + `unhandledrejection`
  // synchronously the moment a crash happens; since we're deferring the
  // agent's own install, capture into a buffer and replay below.
  type QueuedErr = { kind: 'error' | 'rejection'; value: unknown }
  const queue: QueuedErr[] = []
  const onErr = (e: ErrorEvent) => queue.push({ kind: 'error', value: e.error ?? e.message })
  const onRej = (e: PromiseRejectionEvent) => queue.push({ kind: 'rejection', value: e.reason })
  window.addEventListener('error', onErr)
  window.addEventListener('unhandledrejection', onRej)

  const boot = async () => {
    try {
      // Two dynamic imports. Rollup bundles both into the same
      // newrelic-vendor chunk (configured in vite.config.ts manualChunks),
      // so this resolves with one network round-trip post-paint.
      const [{ BrowserAgent }, { buildBrowserAgentOptions }] = await Promise.all([
        import('@newrelic/browser-agent/loaders/browser-agent'),
        import('./lib/newrelic-config'),
      ])
      new BrowserAgent(buildBrowserAgentOptions({ licenseKey, applicationID }))
      // Stamp every event with the build SHA. The agent exposes setCustomAttribute
      // on window.newrelic once it finishes booting; do it best-effort.
      const nr = (window as Window & { newrelic?: { setCustomAttribute?: (k: string, v: string) => void; noticeError?: (e: unknown) => void } }).newrelic
      if (nr && typeof nr.setCustomAttribute === 'function') {
        nr.setCustomAttribute('commit_id', import.meta.env.VITE_COMMIT_ID || 'dev')
      }
      // Replay any errors that fired before the agent installed its own
      // handlers, then drop the temp listeners. The agent's listeners now
      // own the surface.
      if (nr && typeof nr.noticeError === 'function') {
        for (const q of queue) nr.noticeError(q.value)
      }
      queue.length = 0
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    } catch {
      // Telemetry init must never break the app. If the agent throws on
      // construct (network blocked, malformed key, ad-blocker), swallow and
      // continue rendering — the ErrorBoundary still catches render errors,
      // it just won't be able to ship them.
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }

  // Defer boot until the browser is idle. Falls back to a 1s setTimeout in
  // browsers without requestIdleCallback (Safari ≤16.3 etc.) so we still
  // get the post-paint deferral even when the idle API is missing.
  type Win = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  const win = window as Win
  if (typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(boot, { timeout: 2000 })
  } else {
    setTimeout(boot, 1000)
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
