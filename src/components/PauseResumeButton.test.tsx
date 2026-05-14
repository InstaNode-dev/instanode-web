/* PauseResumeButton.test.tsx — unit coverage for the pause/resume toggle.
 *
 * Covers:
 *   - Label flips based on resource.status
 *   - Click opens the confirmation modal (no accidental auto-confirm)
 *   - Confirm in modal calls api.pauseResource / api.resumeResource by status
 *   - 402 swaps the modal body for the inline UpgradeButton CTA
 *   - 500 surfaces an inline error and leaves the modal open
 *   - Terminal statuses (expired/tombstoned/deleted) render nothing
 *
 * We mock the api module so no real fetch goes out and so we can control
 * exactly which promise the button awaits. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Resource } from '../api'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    pauseResource: vi.fn(),
    resumeResource: vi.fn(),
    reportExperimentConverted: vi.fn(),
  }
})

import * as api from '../api'
import { PauseResumeButton } from './PauseResumeButton'

const baseResource: Resource = {
  id: 'res_abc123',
  token: 'tok_abc123',
  resource_type: 'postgres',
  tier: 'hobby',
  status: 'active',
  name: 'orders-db',
  env: 'production',
  storage_bytes: 1_000_000,
  storage_limit_bytes: 500_000_000,
  storage_exceeded: false,
  connections_in_use: 1,
  connections_limit: 5,
  cloud_vendor: 'aws',
  country_code: 'IN',
  expires_at: null,
  created_at: '2026-05-01T00:00:00Z',
}

beforeEach(() => {
  ;(api.pauseResource as any).mockReset()
  ;(api.resumeResource as any).mockReset()
  ;(api.reportExperimentConverted as any).mockReset()
  ;(api.reportExperimentConverted as any).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('PauseResumeButton — label per status', () => {
  it('renders "Pause" when status is active', () => {
    render(<PauseResumeButton resource={baseResource} onUpdated={() => {}} />)
    const btn = screen.getByTestId('pause-resume-button')
    expect(btn.textContent).toBe('Pause')
    expect(btn.getAttribute('data-action')).toBe('pause')
  })

  it('renders "Resume" when status is paused', () => {
    const paused: Resource = { ...baseResource, status: 'paused' }
    render(<PauseResumeButton resource={paused} onUpdated={() => {}} />)
    const btn = screen.getByTestId('pause-resume-button')
    expect(btn.textContent).toBe('Resume')
    expect(btn.getAttribute('data-action')).toBe('resume')
  })

  it('renders nothing for expired resources', () => {
    const expired: Resource = { ...baseResource, status: 'expired' }
    const { container } = render(
      <PauseResumeButton resource={expired} onUpdated={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for tombstoned resources', () => {
    const t: Resource = { ...baseResource, status: 'tombstoned' }
    const { container } = render(<PauseResumeButton resource={t} onUpdated={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for deleted resources', () => {
    const d: Resource = { ...baseResource, status: 'deleted' }
    const { container } = render(<PauseResumeButton resource={d} onUpdated={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('PauseResumeButton — modal flow', () => {
  it('does NOT call the api on first click — opens the modal instead', async () => {
    render(<PauseResumeButton resource={baseResource} onUpdated={() => {}} />)
    fireEvent.click(screen.getByTestId('pause-resume-button'))
    await waitFor(() => {
      expect(screen.getByTestId('pause-resume-modal')).toBeTruthy()
    })
    expect(api.pauseResource).not.toHaveBeenCalled()
    expect(api.resumeResource).not.toHaveBeenCalled()
  })

  it('confirming on an active resource calls api.pauseResource(id)', async () => {
    const onUpdated = vi.fn()
    ;(api.pauseResource as any).mockResolvedValue({
      ok: true,
      resource: { ...baseResource, status: 'paused' },
    })
    render(<PauseResumeButton resource={baseResource} onUpdated={onUpdated} />)
    fireEvent.click(screen.getByTestId('pause-resume-button'))
    fireEvent.click(screen.getByTestId('pause-resume-confirm'))
    await waitFor(() => {
      expect(api.pauseResource).toHaveBeenCalledWith('res_abc123')
    })
    expect(api.resumeResource).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paused' }),
      )
    })
  })

  it('confirming on a paused resource calls api.resumeResource(id)', async () => {
    const onUpdated = vi.fn()
    const paused: Resource = { ...baseResource, status: 'paused' }
    ;(api.resumeResource as any).mockResolvedValue({
      ok: true,
      resource: { ...baseResource, status: 'active' },
    })
    render(<PauseResumeButton resource={paused} onUpdated={onUpdated} />)
    fireEvent.click(screen.getByTestId('pause-resume-button'))
    fireEvent.click(screen.getByTestId('pause-resume-confirm'))
    await waitFor(() => {
      expect(api.resumeResource).toHaveBeenCalledWith('res_abc123')
    })
    expect(api.pauseResource).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      )
    })
  })

  it('Cancel button closes the modal without calling the api', async () => {
    render(<PauseResumeButton resource={baseResource} onUpdated={() => {}} />)
    fireEvent.click(screen.getByTestId('pause-resume-button'))
    expect(screen.getByTestId('pause-resume-modal')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pause-resume-cancel'))
    await waitFor(() => {
      expect(screen.queryByTestId('pause-resume-modal')).toBeNull()
    })
    expect(api.pauseResource).not.toHaveBeenCalled()
  })
})

describe('PauseResumeButton — tier-wall (402) handling', () => {
  it('on 402 swaps the modal body for the upgrade CTA and does NOT call onUpdated', async () => {
    const onUpdated = vi.fn()
    const tierErr = Object.assign(new Error('pro tier required'), {
      status: 402,
      code: 'agent_action',
    })
    ;(api.pauseResource as any).mockRejectedValue(tierErr)
    render(<PauseResumeButton resource={baseResource} onUpdated={onUpdated} />)
    fireEvent.click(screen.getByTestId('pause-resume-button'))
    fireEvent.click(screen.getByTestId('pause-resume-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('pause-resume-upgrade')).toBeTruthy()
    })
    // The upgrade CTA itself is the UpgradeButton — surfaced under its
    // own data-testid (pause-resume-upgrade-cta).
    expect(screen.getByTestId('pause-resume-upgrade-cta')).toBeTruthy()
    expect(onUpdated).not.toHaveBeenCalled()
    // No inline error in the 402 path — the tier-wall replaces the entire
    // action row.
    expect(screen.queryByTestId('pause-resume-error')).toBeNull()
  })
})

describe('PauseResumeButton — generic error (5xx / network)', () => {
  it('on 500 surfaces an inline error and leaves the modal open', async () => {
    const onUpdated = vi.fn()
    const serverErr = Object.assign(new Error('upstream timeout'), {
      status: 500,
      code: 'http_500',
    })
    ;(api.pauseResource as any).mockRejectedValue(serverErr)
    render(<PauseResumeButton resource={baseResource} onUpdated={onUpdated} />)
    fireEvent.click(screen.getByTestId('pause-resume-button'))
    fireEvent.click(screen.getByTestId('pause-resume-confirm'))
    await waitFor(() => {
      const err = screen.getByTestId('pause-resume-error')
      expect(err).toBeTruthy()
      expect(err.textContent).toMatch(/upstream timeout/)
    })
    // Modal stays open so the user can retry.
    expect(screen.getByTestId('pause-resume-modal')).toBeTruthy()
    expect(onUpdated).not.toHaveBeenCalled()
    // Confirm button is re-enabled after the error so a retry is possible.
    const confirm = screen.getByTestId('pause-resume-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
  })

  it('on a thrown network error (no status) still surfaces the message', async () => {
    const netErr = new Error('Failed to fetch')
    ;(api.pauseResource as any).mockRejectedValue(netErr)
    render(<PauseResumeButton resource={baseResource} onUpdated={() => {}} />)
    fireEvent.click(screen.getByTestId('pause-resume-button'))
    fireEvent.click(screen.getByTestId('pause-resume-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('pause-resume-error').textContent).toMatch(
        /Failed to fetch/,
      )
    })
  })
})
