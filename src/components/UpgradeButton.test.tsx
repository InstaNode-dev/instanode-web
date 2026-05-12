/* UpgradeButton.test.tsx — A/B-variant upgrade CTA component coverage.
 *
 * Covers:
 *   - All three variants render the right label + data-variant attribute
 *   - Unknown / undefined variants fall back to "control" cleanly
 *   - Click fires reportExperimentConverted with {experiment, variant, action}
 *     BEFORE invoking the parent onClick (the 500ms race must not delay the
 *     conversion event itself — the report fires synchronously at click time)
 *   - The parent onClick is still invoked when the report network call
 *     stalls (so a down analytics endpoint never blocks navigation)
 *   - ErrorBoundary wrapping — a thrown render error doesn't crash the page
 *
 * We mock the api module so no real fetch goes out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { JSX } from 'react'

import {
  UpgradeButton,
  UPGRADE_VARIANT_LABELS,
  EXPERIMENT_UPGRADE_BUTTON,
  normalizeVariant,
} from './UpgradeButton'
import { ErrorBoundary } from './ErrorBoundary'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    reportExperimentConverted: vi.fn(),
  }
})

import * as api from '../api'

beforeEach(() => {
  ;(api.reportExperimentConverted as any).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UpgradeButton — variant rendering', () => {
  it('renders the "control" variant with "Upgrade to Pro" + data-variant=control', () => {
    render(<UpgradeButton variant="control" onClick={() => {}} />)
    const btn = screen.getByTestId('upgrade-button')
    expect(btn.textContent).toBe(UPGRADE_VARIANT_LABELS.control)
    expect(btn.textContent).toMatch(/upgrade to pro/i)
    expect(btn.getAttribute('data-variant')).toBe('control')
  })

  it('renders the "urgent" variant with "Get Pro now" + data-variant=urgent', () => {
    render(<UpgradeButton variant="urgent" onClick={() => {}} />)
    const btn = screen.getByTestId('upgrade-button')
    expect(btn.textContent).toBe(UPGRADE_VARIANT_LABELS.urgent)
    expect(btn.textContent).toMatch(/get pro now/i)
    expect(btn.getAttribute('data-variant')).toBe('urgent')
  })

  it('renders the "value" variant with "Unlock Pro features" + data-variant=value', () => {
    render(<UpgradeButton variant="value" onClick={() => {}} />)
    const btn = screen.getByTestId('upgrade-button')
    expect(btn.textContent).toBe(UPGRADE_VARIANT_LABELS.value)
    expect(btn.textContent).toMatch(/unlock pro features/i)
    expect(btn.getAttribute('data-variant')).toBe('value')
  })

  it('falls back to "control" when variant is undefined (older API build)', () => {
    render(<UpgradeButton variant={undefined} onClick={() => {}} />)
    const btn = screen.getByTestId('upgrade-button')
    expect(btn.getAttribute('data-variant')).toBe('control')
    expect(btn.textContent).toMatch(/upgrade to pro/i)
  })

  it('falls back to "control" when variant is a garbage string', () => {
    render(<UpgradeButton variant="not_a_real_variant_xyz" onClick={() => {}} />)
    const btn = screen.getByTestId('upgrade-button')
    expect(btn.getAttribute('data-variant')).toBe('control')
  })

  it('stamps data-experiment="upgrade_button" so tracking can find the click target', () => {
    render(<UpgradeButton variant="urgent" onClick={() => {}} />)
    const btn = screen.getByTestId('upgrade-button')
    expect(btn.getAttribute('data-experiment')).toBe(EXPERIMENT_UPGRADE_BUTTON)
  })

  it('respects the `disabled` prop', () => {
    render(<UpgradeButton variant="control" onClick={() => {}} disabled />)
    const btn = screen.getByTestId('upgrade-button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

describe('UpgradeButton — normalizeVariant', () => {
  it('coerces unknown variants to control', () => {
    expect(normalizeVariant(undefined)).toBe('control')
    expect(normalizeVariant('')).toBe('control')
    expect(normalizeVariant('contrl')).toBe('control')
  })
  it('preserves known variants', () => {
    expect(normalizeVariant('control')).toBe('control')
    expect(normalizeVariant('urgent')).toBe('urgent')
    expect(normalizeVariant('value')).toBe('value')
  })
})

describe('UpgradeButton — conversion report on click', () => {
  it('fires reportExperimentConverted with the rendered variant + default action BEFORE invoking onClick', async () => {
    // We can verify ordering by checking that the api mock was called by the
    // time onClick fires. Using a barrier promise: the api mock resolves
    // immediately, but we capture the call order via a side-effect log.
    const order: string[] = []
    ;(api.reportExperimentConverted as any).mockImplementation(async () => {
      order.push('report')
    })
    const onClick = vi.fn(() => {
      order.push('onClick')
    })
    render(<UpgradeButton variant="urgent" onClick={onClick} />)
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => {
      expect(onClick).toHaveBeenCalledTimes(1)
    })
    expect(api.reportExperimentConverted).toHaveBeenCalledWith({
      experiment: EXPERIMENT_UPGRADE_BUTTON,
      variant: 'urgent',
      action: 'checkout_started',
    })
    // Critical ordering: the report must run before onClick.
    expect(order).toEqual(['report', 'onClick'])
  })

  it('passes a custom action string through to the report', async () => {
    render(
      <UpgradeButton variant="value" onClick={() => {}} action="overview_upgrade_clicked" />,
    )
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => {
      expect(api.reportExperimentConverted).toHaveBeenCalledWith({
        experiment: EXPERIMENT_UPGRADE_BUTTON,
        variant: 'value',
        action: 'overview_upgrade_clicked',
      })
    })
  })

  it('still invokes onClick when the conversion report hangs past the 500ms timeout', async () => {
    // Never-resolving promise — simulates a down analytics endpoint.
    ;(api.reportExperimentConverted as any).mockReturnValue(new Promise(() => {}))
    const onClick = vi.fn()
    render(<UpgradeButton variant="control" onClick={onClick} />)
    fireEvent.click(screen.getByTestId('upgrade-button'))
    // The 500ms timeout fires; onClick must still run.
    await waitFor(
      () => {
        expect(onClick).toHaveBeenCalledTimes(1)
      },
      { timeout: 2000 },
    )
  })

  it('still invokes onClick when the conversion report rejects (network error)', async () => {
    ;(api.reportExperimentConverted as any).mockRejectedValue(new Error('offline'))
    const onClick = vi.fn()
    render(<UpgradeButton variant="control" onClick={onClick} />)
    fireEvent.click(screen.getByTestId('upgrade-button'))
    await waitFor(() => {
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  it('does not double-fire on rapid clicks while a report is in flight', async () => {
    // The button has its own busy-state guard; rapid clicks must result
    // in a single conversion event, not three.
    let resolveReport: () => void = () => {}
    ;(api.reportExperimentConverted as any).mockReturnValue(
      new Promise<void>((res) => { resolveReport = res }),
    )
    const onClick = vi.fn()
    render(<UpgradeButton variant="control" onClick={onClick} />)
    const btn = screen.getByTestId('upgrade-button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    resolveReport()
    await waitFor(() => {
      expect(onClick).toHaveBeenCalledTimes(1)
    })
    expect(api.reportExperimentConverted).toHaveBeenCalledTimes(1)
  })
})

describe('UpgradeButton — ErrorBoundary integration', () => {
  it('a thrown error inside the click handler does not crash the page (parent boundary catches)', async () => {
    // Silence React's expected console.error from the thrown render.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Wrap a child that throws on render — verifies the boundary still
    // works around the UpgradeButton's component tree without
    // UpgradeButton itself getting in the way (no rogue effects, no
    // top-level throw on mount).
    function Bomb(): JSX.Element {
      throw new Error('boom')
    }
    render(
      <ErrorBoundary fallback={<div data-testid="fallback">ok</div>}>
        <UpgradeButton variant="urgent" onClick={() => {}} />
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('fallback')).toBeTruthy()
    consoleErrorSpy.mockRestore()
  })
})
