/* newrelic-config.test.ts — assert the options we pass to
 * `new BrowserAgent({...})` correspond to the pro_plus_spa mode.
 *
 * Why this test exists:
 *   The dashboard is an SPA. If a future refactor accidentally drops to
 *   the lite loader (jserrors-only), NR's Page Views dashboard goes
 *   dark — no page loads, no AJAX waterfalls, no web vitals. This test
 *   pins every feature flag that distinguishes pro_plus_spa from lite,
 *   so a regression shows up in CI instead of in a stale grafana panel.
 */

import { describe, it, expect } from 'vitest'
import { buildBrowserAgentOptions, NR_BROWSER_MODE } from './newrelic-config'

describe('newrelic-config: pro_plus_spa mode', () => {
  const opts = buildBrowserAgentOptions({
    licenseKey: 'NRBR-test-license',
    applicationID: '1234567',
  })

  it('mode tag is pro_plus_spa', () => {
    // Surfaced as a constant so docs / changelogs / debug overlays can
    // reference one place instead of greping for feature combos.
    expect(NR_BROWSER_MODE).toBe('pro_plus_spa')
  })

  it('soft_navigations is enabled (SPA route changes)', () => {
    // This is THE flag that makes the agent "pro_plus_spa" vs plain "pro".
    // Without it, React Router pushState navigations never show up in NR.
    expect(opts.init.soft_navigations).toEqual({ enabled: true, autoStart: true })
  })

  it('page_view_event is enabled (classic page loads)', () => {
    expect(opts.init.page_view_event).toEqual({ enabled: true, autoStart: true })
  })

  it('page_view_timing is enabled (LCP / FID / CLS / FCP / TTFB)', () => {
    // The agent emits PageViewTiming events for each web vital
    // automatically when this feature is on. Required for NR's Core
    // Web Vitals UI.
    expect(opts.init.page_view_timing).toEqual({ enabled: true, autoStart: true })
  })

  it('ajax instrumentation is on with the beacon denylisted', () => {
    // Without deny_list, every NR beacon POST appears in the AJAX
    // waterfall (recursive noise). The agent's own host is excluded.
    expect(opts.init.ajax.deny_list).toContain('bam.nr-data.net')
  })

  it('metrics + jserrors are enabled', () => {
    expect(opts.init.metrics).toEqual({ enabled: true, autoStart: true })
    expect(opts.init.jserrors).toEqual({ enabled: true, autoStart: true })
  })

  it('distributed_tracing is enabled (correlates browser → api spans)', () => {
    // The Go agent on instant-api creates spans for every Fiber handler;
    // this flag tells the browser agent to inject the W3C traceparent
    // header on outgoing fetches so the two halves stitch in NR.
    expect(opts.init.distributed_tracing).toEqual({ enabled: true })
  })

  it('keys and IDs propagate through info + loader_config', () => {
    expect(opts.info.licenseKey).toBe('NRBR-test-license')
    expect(opts.info.applicationID).toBe('1234567')
    expect(opts.loader_config.licenseKey).toBe('NRBR-test-license')
    expect(opts.loader_config.applicationID).toBe('1234567')
    // accountID + trustKey + agentID currently mirror the appID for a
    // single-account install. If we ever move to a sub-account model,
    // this assertion needs to relax.
    expect(opts.loader_config.accountID).toBe('1234567')
    expect(opts.loader_config.trustKey).toBe('1234567')
    expect(opts.loader_config.agentID).toBe('1234567')
  })
})
