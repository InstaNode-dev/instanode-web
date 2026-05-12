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
 * Fail-open: when VITE_NEWRELIC_LICENSE_KEY is empty (local dev, PR
 * previews, anyone running their own fork) we skip init entirely. This
 * mirrors how the Go services treat an empty NEW_RELIC_LICENSE_KEY — no
 * agent, no telemetry, no crash. */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserAgent } from '@newrelic/browser-agent/loaders/browser-agent'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/tokens.css'

// initNewRelic — boot the browser agent when both keys are present. The
// agent attaches itself to `window.newrelic` so ErrorBoundary.componentDidCatch
// can call `noticeError` later without holding a reference here.
//
// We pass VITE_COMMIT_ID as a global custom attribute via the init config so
// every JS error, AJAX failure, page action, and SPA route change collected
// by the agent is automatically stamped with the dashboard's build SHA.
function initNewRelic(): void {
  const licenseKey = import.meta.env.VITE_NEWRELIC_LICENSE_KEY
  const applicationID = import.meta.env.VITE_NEWRELIC_APP_ID
  if (!licenseKey || !applicationID) {
    // Local dev / unconfigured env — bail silently. No console.warn to
    // keep the dev console clean; the absence of NR is intentional here.
    return
  }
  try {
    new BrowserAgent({
      info: {
        beacon: 'bam.nr-data.net',
        errorBeacon: 'bam.nr-data.net',
        licenseKey,
        applicationID,
        sa: 1,
      },
      // loader_config mirrors `info` for the bootstrap fetch — same account.
      loader_config: {
        accountID: applicationID,
        trustKey: applicationID,
        agentID: applicationID,
        licenseKey,
        applicationID,
      },
      init: {
        distributed_tracing: { enabled: true },
        privacy: { cookies_enabled: true },
        ajax: { deny_list: ['bam.nr-data.net'] },
      },
    })
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
