/* newrelic-config.ts — pure, testable construction of the
 * `@newrelic/browser-agent` init options.
 *
 * Extracted from main.tsx so a unit test can assert the shape we pass to
 * `new BrowserAgent({...})` without standing up the agent itself
 * (constructing the real agent hits the network and installs window
 * listeners — neither is safe in a vitest run).
 *
 * Mode: pro_plus_spa
 *   - `soft_navigations` enabled → React Router route changes show up as
 *     SoftNavigation events on the Page Views UI
 *   - `page_view_event` enabled  → classic full-page-load PageView event
 *   - `page_view_timing` enabled → LCP / FID / CLS / FCP / TTFB as
 *     PageViewTiming events
 *   - `ajax` instruments fetch + XHR (waterfalls, AJAX errors)
 *   - `metrics` enabled (default) for the agent's internal supportability
 *
 * Each `enabled: true` here matches the upstream default in
 * node_modules/@newrelic/browser-agent/src/common/config/init.js. We
 * state them anyway to lock the mode into source and to make it obvious
 * in code review when one of them flips off.
 */

export interface BrowserAgentOptions {
  info: {
    beacon: string
    errorBeacon: string
    licenseKey: string
    applicationID: string
    sa: number
  }
  loader_config: {
    accountID: string
    trustKey: string
    agentID: string
    licenseKey: string
    applicationID: string
  }
  init: {
    distributed_tracing: { enabled: boolean }
    privacy: { cookies_enabled: boolean }
    ajax: { deny_list: string[] }
    soft_navigations: { enabled: boolean; autoStart: boolean }
    page_view_event: { enabled: boolean; autoStart: boolean }
    page_view_timing: { enabled: boolean; autoStart: boolean }
    metrics: { enabled: boolean; autoStart: boolean }
    jserrors: { enabled: boolean; autoStart: boolean }
  }
}

/** Tag identifying the configured mode. Read by tests to assert we're
 *  shipping the full SPA+APM feature set, not the lite/errors-only loader. */
export const NR_BROWSER_MODE = 'pro_plus_spa' as const

export function buildBrowserAgentOptions(args: {
  licenseKey: string
  applicationID: string
}): BrowserAgentOptions {
  const { licenseKey, applicationID } = args
  return {
    info: {
      beacon: 'bam.nr-data.net',
      errorBeacon: 'bam.nr-data.net',
      licenseKey,
      applicationID,
      sa: 1,
    },
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
      soft_navigations: { enabled: true, autoStart: true },
      page_view_event: { enabled: true, autoStart: true },
      page_view_timing: { enabled: true, autoStart: true },
      metrics: { enabled: true, autoStart: true },
      jserrors: { enabled: true, autoStart: true },
    },
  }
}
