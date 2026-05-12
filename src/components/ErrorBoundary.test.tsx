/* ErrorBoundary.test.tsx — unit tests for the top-level error boundary.
 *
 * Covers:
 *   1. Renders children when no error thrown (happy path)
 *   2. Catches a render-time error and shows the fallback UI
 *   3. Calls window.newrelic.noticeError with commit_id when the agent is
 *      present, and does NOT crash when it's absent
 *   4. Respects the optional `fallback` prop override
 *
 * Note: we silence React's expected console.error noise during the throw —
 * React logs the boundary catch to the console even when handled, which
 * pollutes the test output without being a real failure signal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { ErrorBoundary } from './ErrorBoundary'

// A tiny child component that throws on render — the canonical way to
// trigger an error boundary in tests. The `JSX.Element` return-type is a
// lie (we never return) but TS demands a JSX-compatible signature so this
// can be mounted via <BoomChild />.
function BoomChild({ message = 'kaboom' }: { message?: string }): JSX.Element {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  // Loosely typed — vitest's MockInstance generic inference fights with
  // strict mode here, and we only need .mockRestore() at teardown.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleErrorSpy: any
  let originalNewrelic: unknown

  beforeEach(() => {
    // React logs the caught error via console.error even though the boundary
    // handles it. Silence to keep test output clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    originalNewrelic = (window as unknown as { newrelic?: unknown }).newrelic
  })

  afterEach(() => {
    consoleErrorSpy?.mockRestore()
    // Restore the agent global so tests don't leak into one another.
    if (originalNewrelic === undefined) {
      delete (window as unknown as { newrelic?: unknown }).newrelic
    } else {
      ;(window as unknown as { newrelic?: unknown }).newrelic = originalNewrelic
    }
  })

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <span data-testid="kid">hello</span>
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('kid')).toBeDefined()
  })

  it('catches a render-time error and shows the default fallback', () => {
    render(
      <ErrorBoundary>
        <BoomChild />
      </ErrorBoundary>,
    )
    // Default fallback renders an alert role with a "Reload" button.
    const alert = screen.getByRole('alert')
    expect(alert).toBeDefined()
    expect(alert.textContent).toContain('Something went wrong')
    expect(screen.getByRole('button', { name: /reload/i })).toBeDefined()
  })

  it('calls window.newrelic.noticeError with commit_id when the agent is present', () => {
    const noticeError = vi.fn()
    ;(window as unknown as { newrelic: { noticeError: typeof noticeError } }).newrelic = { noticeError }

    render(
      <ErrorBoundary>
        <BoomChild message="render-fail" />
      </ErrorBoundary>,
    )

    expect(noticeError).toHaveBeenCalledTimes(1)
    const call = noticeError.mock.calls[0] as [Error, Record<string, string>]
    const err = call[0]
    const attrs = call[1]
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('render-fail')
    // commit_id must always be set — defaults to "dev" when VITE_COMMIT_ID is empty.
    expect(attrs).toHaveProperty('commit_id')
    expect(typeof attrs.commit_id).toBe('string')
    expect(attrs.commit_id.length).toBeGreaterThan(0)
  })

  it('does not crash when window.newrelic is absent', () => {
    // Ensure the agent really is missing for this test.
    delete (window as unknown as { newrelic?: unknown }).newrelic

    // The act of rendering with a thrown child should still produce the
    // fallback even though the telemetry call is a no-op.
    expect(() =>
      render(
        <ErrorBoundary>
          <BoomChild />
        </ErrorBoundary>,
      ),
    ).not.toThrow()
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('renders the custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">oops</div>}>
        <BoomChild />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('custom-fallback')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
