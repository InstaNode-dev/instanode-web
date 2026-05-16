/* FailureAutopsyPanel.test.tsx — Phase 0 Failure Autopsy
 *
 * What we assert:
 *   1. Panel is absent when status is not 'failed'.
 *   2. "Diagnostics pending" banner renders when status=failed but failure=undefined.
 *   3. Full autopsy panel renders for each DeploymentFailureReason with the
 *      correct humanised heading.
 *   4. Hint renders as the primary explanation.
 *   5. exit_code and event render as supporting detail.
 *   6. last_lines log block is collapsed by default; expander reveals lines;
 *      clicking again collapses.
 *   7. Panel is absent when status='healthy' (non-failure state).
 *   8. Panel handles failure with no last_lines gracefully (no toggle shown).
 *   9. Panel handles failure with no event gracefully (no event block shown).
 *  10. occurred_at renders (the RelTime span is present).
 */

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { FailureAutopsyPanel, FAILURE_REASON_LABELS } from './FailureAutopsyPanel'
import type { DeploymentFailure, DeploymentFailureReason } from '../api/types'

afterEach(() => {
  cleanup()
})

// ─── Test fixture ─────────────────────────────────────────────────────────

function failure(overrides: Partial<DeploymentFailure> = {}): DeploymentFailure {
  return {
    reason: 'OOMKilled',
    exit_code: 137,
    event: 'Container OOMKilled; memory limit 256Mi exceeded',
    last_lines: ['Starting server...', 'Listening on port 8080', 'FATAL: out of memory'],
    hint: 'Your container exceeded its memory limit. Try reducing memory usage in your app or upgrade to a plan with a higher memory limit.',
    occurred_at: '2026-05-16T10:30:00Z',
    ...overrides,
  }
}

// ─── 1. Panel absent when status is not 'failed' ─────────────────────────

describe('FailureAutopsyPanel — absent on non-failed status', () => {
  const nonFailedStatuses = ['healthy', 'running', 'building', 'deploying', 'stopped', 'expired'] as const

  for (const status of nonFailedStatuses) {
    it(`renders nothing when status="${status}"`, () => {
      const { container } = render(
        <FailureAutopsyPanel status={status} failure={failure()} />,
      )
      expect(container.querySelector('[data-testid="failure-autopsy-panel"]')).toBeNull()
      expect(container.querySelector('[data-testid="failure-autopsy-pending"]')).toBeNull()
    })
  }
})

// ─── 2. "Diagnostics pending" when status=failed but failure absent ───────

describe('FailureAutopsyPanel — diagnostics pending fallback', () => {
  it('renders the pending banner when status=failed but failure is undefined', () => {
    render(<FailureAutopsyPanel status="failed" failure={undefined} />)
    expect(screen.getByTestId('failure-autopsy-pending')).toBeTruthy()
    // Full panel must NOT appear.
    expect(screen.queryByTestId('failure-autopsy-panel')).toBeNull()
  })

  it('pending banner does not crash — copy includes "diagnostics pending"', () => {
    render(<FailureAutopsyPanel status="failed" failure={undefined} />)
    const banner = screen.getByTestId('failure-autopsy-pending')
    expect(banner.textContent ?? '').toMatch(/diagnostics pending/i)
  })
})

// ─── 3. Full panel renders for each reason with humanised heading ─────────

describe('FailureAutopsyPanel — humanised heading per reason', () => {
  const reasons = Object.keys(FAILURE_REASON_LABELS) as DeploymentFailureReason[]

  for (const reason of reasons) {
    it(`renders the correct heading for reason="${reason}"`, () => {
      render(
        <FailureAutopsyPanel
          status="failed"
          failure={failure({ reason })}
        />,
      )
      const heading = screen.getByTestId('failure-autopsy-heading')
      expect(heading.textContent).toBe(FAILURE_REASON_LABELS[reason])
    })
  }

  it('falls back to the raw reason string for an unrecognised reason', () => {
    render(
      <FailureAutopsyPanel
        status="failed"
        failure={failure({ reason: 'SomeNewReason' as DeploymentFailureReason })}
      />,
    )
    const heading = screen.getByTestId('failure-autopsy-heading')
    expect(heading.textContent).toBe('SomeNewReason')
  })
})

// ─── 4. Hint renders ─────────────────────────────────────────────────────

describe('FailureAutopsyPanel — hint', () => {
  it('renders the hint text as the primary explanation', () => {
    const hint = 'Your container exceeded its memory limit. Upgrade to Pro for 1GB.'
    render(<FailureAutopsyPanel status="failed" failure={failure({ hint })} />)
    expect(screen.getByTestId('failure-autopsy-hint').textContent).toBe(hint)
  })
})

// ─── 5. exit_code and event as supporting detail ──────────────────────────

describe('FailureAutopsyPanel — exit_code and event', () => {
  it('renders exit_code in the meta line', () => {
    render(<FailureAutopsyPanel status="failed" failure={failure({ exit_code: 137 })} />)
    const exitEl = screen.getByTestId('failure-autopsy-exit-code')
    expect(exitEl.textContent).toContain('137')
  })

  it('omits the exit_code segment when exit_code is null', () => {
    const { container } = render(
      <FailureAutopsyPanel status="failed" failure={failure({ exit_code: null })} />,
    )
    expect(container.querySelector('[data-testid="failure-autopsy-exit-code"]')).toBeNull()
  })

  it('renders the event in the k8s event block', () => {
    const event = 'Container OOMKilled; memory limit 256Mi exceeded'
    render(<FailureAutopsyPanel status="failed" failure={failure({ event })} />)
    expect(screen.getByTestId('failure-autopsy-event').textContent).toBe(event)
  })

  it('omits the event block when event is empty', () => {
    const { container } = render(
      <FailureAutopsyPanel status="failed" failure={failure({ event: '' })} />,
    )
    expect(container.querySelector('[data-testid="failure-autopsy-event"]')).toBeNull()
  })
})

// ─── 6. Log block expander ────────────────────────────────────────────────

describe('FailureAutopsyPanel — log block expander', () => {
  const lines = ['line 1', 'line 2', 'line 3']

  it('log block is collapsed by default (no log-block element)', () => {
    const { container } = render(
      <FailureAutopsyPanel status="failed" failure={failure({ last_lines: lines })} />,
    )
    expect(container.querySelector('[data-testid="failure-autopsy-log-block"]')).toBeNull()
    // Toggle button exists and says "show"
    const toggle = screen.getByTestId('failure-autopsy-log-toggle')
    expect(toggle.textContent ?? '').toMatch(/show/i)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('clicking the toggle expands the log block and renders each line', () => {
    render(
      <FailureAutopsyPanel status="failed" failure={failure({ last_lines: lines })} />,
    )
    const toggle = screen.getByTestId('failure-autopsy-log-toggle')
    fireEvent.click(toggle)

    const block = screen.getByTestId('failure-autopsy-log-block')
    expect(block).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    for (let i = 0; i < lines.length; i++) {
      const lineEl = screen.getByTestId(`failure-log-line-${i}`)
      expect(lineEl.textContent).toBe(lines[i])
    }
  })

  it('clicking the toggle a second time collapses the log block', () => {
    const { container } = render(
      <FailureAutopsyPanel status="failed" failure={failure({ last_lines: lines })} />,
    )
    const toggle = screen.getByTestId('failure-autopsy-log-toggle')
    fireEvent.click(toggle) // expand
    fireEvent.click(toggle) // collapse

    expect(container.querySelector('[data-testid="failure-autopsy-log-block"]')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent ?? '').toMatch(/show/i)
  })

  it('shows the line count in the toggle label', () => {
    const manyLines = Array.from({ length: 200 }, (_, i) => `log line ${i + 1}`)
    render(
      <FailureAutopsyPanel status="failed" failure={failure({ last_lines: manyLines })} />,
    )
    const toggle = screen.getByTestId('failure-autopsy-log-toggle')
    expect(toggle.textContent ?? '').toContain('200')
  })
})

// ─── 8. No last_lines → no toggle shown ─────────────────────────────────

describe('FailureAutopsyPanel — no last_lines', () => {
  it('renders no log toggle when last_lines is empty', () => {
    const { container } = render(
      <FailureAutopsyPanel status="failed" failure={failure({ last_lines: [] })} />,
    )
    expect(container.querySelector('[data-testid="failure-autopsy-log-toggle"]')).toBeNull()
    expect(container.querySelector('[data-testid="failure-autopsy-log-block"]')).toBeNull()
  })
})

// ─── 9. No event → no event block shown ──────────────────────────────────

describe('FailureAutopsyPanel — no event', () => {
  it('renders no event block when event is an empty string', () => {
    const { container } = render(
      <FailureAutopsyPanel status="failed" failure={failure({ event: '' })} />,
    )
    expect(container.querySelector('[data-testid="failure-autopsy-event"]')).toBeNull()
  })
})

// ─── 10. occurred_at renders ─────────────────────────────────────────────

describe('FailureAutopsyPanel — occurred_at timestamp', () => {
  it('renders the occurred_at timestamp in the meta line', () => {
    render(
      <FailureAutopsyPanel
        status="failed"
        failure={failure({ occurred_at: '2026-05-16T10:30:00Z' })}
      />,
    )
    const occurredEl = screen.getByTestId('failure-autopsy-occurred-at')
    // RelTime renders some relative form — just assert the element is present
    // and contains non-empty text.
    expect(occurredEl.textContent?.trim().length).toBeGreaterThan(0)
  })

  it('renders "failure time unknown" when occurred_at is empty', () => {
    render(
      <FailureAutopsyPanel status="failed" failure={failure({ occurred_at: '' })} />,
    )
    const occurredEl = screen.getByTestId('failure-autopsy-occurred-at')
    expect(occurredEl.textContent).toContain('failure time unknown')
  })
})
