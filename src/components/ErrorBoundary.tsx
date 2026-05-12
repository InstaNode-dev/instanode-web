/* ErrorBoundary.tsx — top-level React error boundary.
 *
 * React's render/lifecycle errors bubble up to the nearest class component
 * with `componentDidCatch` (or `getDerivedStateFromError`). Without one, a
 * thrown render error unmounts the entire tree and the user sees a blank
 * page with a console error nobody reads. This component sits just inside
 * <App /> in main.tsx, catches those errors, ships them to New Relic with
 * the dashboard's build SHA as a custom attribute, and renders a minimal
 * fallback UI so the user can recover by reloading.
 *
 * New Relic surface: when the browser agent has booted, `window.newrelic`
 * is the global handle. We call `noticeError` with the error and a small
 * attribute bag — currently just `commit_id` (the VITE_COMMIT_ID injected
 * at build time). If the agent is absent (no license key, agent not
 * loaded yet, ad-blocker etc.) we no-op silently. Fail-open mirrors the
 * Go services' behaviour on a missing NEW_RELIC_LICENSE_KEY.
 *
 * Note: error boundaries do NOT catch event-handler errors, async errors
 * from setTimeout / promises, or SSR errors. Those still need their own
 * try/catch or window.onerror — which the NR browser agent installs
 * automatically on init.
 */

import { Component, ReactNode } from 'react'

// noticeError accepts (error, customAttributes) per the browser-agent API.
// We type it loosely because the agent attaches at runtime and may be absent.
type NRWindow = Window & {
  newrelic?: {
    noticeError?: (err: Error, attrs?: Record<string, string | number | boolean>) => void
  }
}

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional override for the fallback UI. Defaults to a minimal inline panel. */
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // React calls this synchronously during render after a descendant throws,
    // and uses the returned state to re-render the fallback on the next
    // commit. Keep this side-effect-free — telemetry goes in componentDidCatch.
    return { hasError: true, error }
  }

  componentDidCatch(error: Error): void {
    // Best-effort report to New Relic. Stamp every error with the build's
    // commit_id so we can correlate a runtime stack to the bundle hash that
    // produced it — same telemetry shape the Go services emit on log lines.
    try {
      const nr = (window as NRWindow).newrelic
      if (nr && typeof nr.noticeError === 'function') {
        nr.noticeError(error, {
          commit_id: import.meta.env.VITE_COMMIT_ID || 'dev',
        })
      }
    } catch {
      // Telemetry must never crash the fallback path. Swallow.
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback
      // Minimal inline-styled fallback so it renders even if the page's CSS
      // is the thing that crashed. Mirrors the inline style approach in
      // AppLoadingFallback (src/App.tsx).
      return (
        <div
          role="alert"
          style={{
            padding: '2rem',
            fontFamily: 'system-ui, sans-serif',
            color: 'var(--text, #1a1a1a)',
            maxWidth: '40rem',
            margin: '4rem auto',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
            Something went wrong.
          </h1>
          <p style={{ color: 'var(--text-muted, #666)', fontSize: '0.875rem' }}>
            The dashboard hit an unexpected error. Try reloading the page.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
