/* ConfirmDeletionPage.test.tsx — Wave FIX-I.
 *
 * Coverage:
 *   - Empty/missing token renders the failure state.
 *   - Confirm click POSTs to confirmDeploymentDeletion with the right
 *     (id, token).
 *   - kind=stack routes through confirmStackDeletion instead.
 *   - 410 (deletion_token_invalid) surfaces a user-readable error.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    confirmDeploymentDeletion: vi.fn(),
    confirmStackDeletion: vi.fn(),
  }
})

import * as api from '../api'
import { APIError } from '../api'
import { ConfirmDeletionPage } from './ConfirmDeletionPage'

beforeEach(() => {
  ;(api.confirmDeploymentDeletion as ReturnType<typeof vi.fn>).mockReset()
  ;(api.confirmStackDeletion as ReturnType<typeof vi.fn>).mockReset()
})

afterEach(() => {
  cleanup()
})

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmDeletionPage />
    </MemoryRouter>,
  )
}

describe('ConfirmDeletionPage', () => {
  it('renders failure state when ?t= is missing', async () => {
    renderAt('/app/confirm-deletion')
    await waitFor(() => {
      expect(screen.getByTestId('confirm-failure')).toBeTruthy()
    })
    expect(screen.getByText(/missing a confirmation token/i)).toBeTruthy()
  })

  it('routes Confirm through deploy api by default', async () => {
    ;(api.confirmDeploymentDeletion as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      deletion_status: 'confirmed',
      agent_action: 'Tell the user the slot is free.',
    })
    renderAt('/app/confirm-deletion?t=del_xyz&id=app-fixi&label=deployment%20my-app')

    fireEvent.click(screen.getByTestId('confirm-button'))
    await waitFor(() => {
      expect(api.confirmDeploymentDeletion).toHaveBeenCalledWith('app-fixi', 'del_xyz')
    })
    expect(api.confirmStackDeletion).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('confirm-success')).toBeTruthy()
    })
  })

  it('routes Confirm through stack api when kind=stack', async () => {
    ;(api.confirmStackDeletion as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      deletion_status: 'confirmed',
      agent_action: '',
    })
    renderAt('/app/confirm-deletion?t=del_abc&id=my-stack&kind=stack&label=stack%20my-stack')

    fireEvent.click(screen.getByTestId('confirm-button'))
    await waitFor(() => {
      expect(api.confirmStackDeletion).toHaveBeenCalledWith('my-stack', 'del_abc')
    })
    expect(api.confirmDeploymentDeletion).not.toHaveBeenCalled()
  })

  it('surfaces deletion_token_invalid with a friendly message', async () => {
    ;(api.confirmDeploymentDeletion as ReturnType<typeof vi.fn>).mockRejectedValue(
      new APIError(410, 'deletion_token_invalid', 'expired'),
    )
    renderAt('/app/confirm-deletion?t=del_old&id=app-fixi')

    fireEvent.click(screen.getByTestId('confirm-button'))
    await waitFor(() => {
      expect(screen.getByTestId('confirm-failure')).toBeTruthy()
    })
    expect(screen.getByText(/expired or has already been used/i)).toBeTruthy()
  })
})
