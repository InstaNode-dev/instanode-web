/* PendingDeletionBanner.test.tsx — Wave FIX-I.
 *
 * Coverage:
 *   - Renders the masked email + countdown text.
 *   - Cancel button fires the api.cancelDeploymentDeletion / cancelStackDeletion
 *     based on the kind prop.
 *   - Success callback fires after a successful cancel.
 *   - API error surfaces in-banner without throwing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    cancelDeploymentDeletion: vi.fn(),
    cancelStackDeletion: vi.fn(),
  }
})

import * as api from '../api'
import { PendingDeletionBanner } from './PendingDeletionBanner'

beforeEach(() => {
  ;(api.cancelDeploymentDeletion as ReturnType<typeof vi.fn>).mockReset()
  ;(api.cancelStackDeletion as ReturnType<typeof vi.fn>).mockReset()
})

afterEach(() => {
  cleanup()
})

describe('PendingDeletionBanner', () => {
  it('renders the masked recipient + countdown', () => {
    const future = new Date(Date.now() + 12 * 60 * 1000).toISOString()
    render(
      <PendingDeletionBanner
        id="app-fixi-1"
        kind="deploy"
        sentTo="a***@example.com"
        expiresAt={future}
      />,
    )
    expect(screen.getByTestId('pending-deletion-banner')).toBeTruthy()
    expect(screen.getByText(/a\*\*\*@example\.com/)).toBeTruthy()
    expect(screen.getByTestId('pending-deletion-countdown')).toBeTruthy()
  })

  it('routes Cancel through the deploy api when kind=deploy', async () => {
    ;(api.cancelDeploymentDeletion as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      deletion_status: 'cancelled',
    })
    const onCancelled = vi.fn()
    render(
      <PendingDeletionBanner
        id="app-fixi-2"
        kind="deploy"
        sentTo="b***@example.com"
        expiresAt={new Date(Date.now() + 600_000).toISOString()}
        onCancelled={onCancelled}
      />,
    )

    fireEvent.click(screen.getByTestId('pending-deletion-cancel'))
    await waitFor(() => {
      expect(api.cancelDeploymentDeletion).toHaveBeenCalledWith('app-fixi-2')
    })
    expect(api.cancelStackDeletion).not.toHaveBeenCalled()
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1))
  })

  it('routes Cancel through the stack api when kind=stack', async () => {
    ;(api.cancelStackDeletion as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      deletion_status: 'cancelled',
    })
    render(
      <PendingDeletionBanner
        id="my-stack"
        kind="stack"
        sentTo="c***@example.com"
        expiresAt={new Date(Date.now() + 600_000).toISOString()}
      />,
    )

    fireEvent.click(screen.getByTestId('pending-deletion-cancel'))
    await waitFor(() => {
      expect(api.cancelStackDeletion).toHaveBeenCalledWith('my-stack')
    })
    expect(api.cancelDeploymentDeletion).not.toHaveBeenCalled()
  })

  it('surfaces an api error in-banner without crashing', async () => {
    ;(api.cancelDeploymentDeletion as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('Pending row is already resolved'), {
        code: 'deletion_token_invalid',
      }),
    )
    render(
      <PendingDeletionBanner
        id="app-fixi-3"
        kind="deploy"
        sentTo="d***@example.com"
        expiresAt={new Date(Date.now() + 600_000).toISOString()}
      />,
    )

    fireEvent.click(screen.getByTestId('pending-deletion-cancel'))
    await waitFor(() => {
      expect(screen.getByText(/Pending row is already resolved|Cancel failed/)).toBeTruthy()
    })
  })
})
