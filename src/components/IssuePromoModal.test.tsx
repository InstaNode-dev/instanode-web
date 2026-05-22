/* IssuePromoModal.test.tsx — founder promo-issuance dialog. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, issueAdminCustomerPromo: vi.fn() }
})

import * as api from '../api'
import { IssuePromoModal } from './IssuePromoModal'

function renderModal(over: Partial<Parameters<typeof IssuePromoModal>[0]> = {}) {
  const onClose = vi.fn()
  const onIssued = vi.fn()
  render(
    <IssuePromoModal teamID="team_1" primaryEmail="f@acme.dev" onClose={onClose} onIssued={onIssued} {...over} />,
  )
  return { onClose, onIssued }
}

let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
})
afterEach(() => cleanup())

describe('IssuePromoModal', () => {
  it('renders the form with the value field for percent_off', () => {
    renderModal()
    expect(screen.getByText('Issue promo to f@acme.dev')).toBeTruthy()
    expect(screen.getByTestId('promo-value')).toBeTruthy()
  })

  it('hides the value field for first_month_free', async () => {
    renderModal()
    await userEvent.selectOptions(screen.getByTestId('promo-kind'), 'first_month_free')
    expect(screen.queryByTestId('promo-value')).toBeNull()
  })

  it('closes on Escape, overlay click, and Cancel', async () => {
    const { onClose } = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('issue-promo-modal'))
    await userEvent.click(screen.getByTestId('promo-cancel'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('disables submit on invalid numeric input', async () => {
    renderModal()
    fireEvent.change(screen.getByTestId('promo-value'), { target: { value: '0' } })
    expect((screen.getByTestId('promo-submit') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('promo-value'), { target: { value: '15' } })
    fireEvent.change(screen.getByTestId('promo-valid-days'), { target: { value: '0' } })
    expect((screen.getByTestId('promo-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('issues a promo and shows the issued code with an expiry date', async () => {
    ;(api.issueAdminCustomerPromo as any).mockResolvedValue({ ok: true, code: 'SAVE15', expires_at: '2026-07-01T00:00:00Z' })
    const { onIssued } = renderModal()
    await userEvent.click(screen.getByTestId('promo-submit'))
    await waitFor(() => expect(screen.getByTestId('promo-issued')).toBeTruthy())
    expect(screen.getByText('SAVE15')).toBeTruthy()
    expect(onIssued).toHaveBeenCalled()
    expect(api.issueAdminCustomerPromo).toHaveBeenCalledWith('team_1', {
      kind: 'percent_off', value: 15, applies_to: 3, valid_for_days: 30,
    })
  })

  it('shows "as configured" when there is no expiry', async () => {
    ;(api.issueAdminCustomerPromo as any).mockResolvedValue({ ok: true, code: 'FOREVER', expires_at: null })
    renderModal()
    await userEvent.click(screen.getByTestId('promo-submit'))
    await waitFor(() => expect(screen.getByText(/as configured/)).toBeTruthy())
  })

  it('surfaces an issuance error', async () => {
    ;(api.issueAdminCustomerPromo as any).mockRejectedValue(new Error('rejected'))
    renderModal()
    await userEvent.click(screen.getByTestId('promo-submit'))
    await waitFor(() => expect(screen.getByTestId('promo-error').textContent).toBe('rejected'))
  })

  it('copies the issued code', async () => {
    ;(api.issueAdminCustomerPromo as any).mockResolvedValue({ ok: true, code: 'COPYME', expires_at: null })
    renderModal()
    await userEvent.click(screen.getByTestId('promo-submit'))
    await waitFor(() => screen.getByTestId('promo-copy'))
    await userEvent.click(screen.getByTestId('promo-copy'))
    expect(writeText).toHaveBeenCalledWith('COPYME')
    await waitFor(() => expect(screen.getByTestId('promo-copy').textContent).toBe('Copied'))
  })

  it('closes from the issued "Done" button', async () => {
    ;(api.issueAdminCustomerPromo as any).mockResolvedValue({ ok: true, code: 'X', expires_at: null })
    const { onClose } = renderModal()
    await userEvent.click(screen.getByTestId('promo-submit'))
    await waitFor(() => screen.getByTestId('promo-done'))
    await userEvent.click(screen.getByTestId('promo-done'))
    expect(onClose).toHaveBeenCalled()
  })

  it('submits amount_off without a percent label', async () => {
    ;(api.issueAdminCustomerPromo as any).mockResolvedValue({ ok: true, code: 'AMT', expires_at: null })
    renderModal()
    await userEvent.selectOptions(screen.getByTestId('promo-kind'), 'amount_off')
    fireEvent.change(screen.getByTestId('promo-value'), { target: { value: '49' } })
    await userEvent.click(screen.getByTestId('promo-submit'))
    await waitFor(() => expect(api.issueAdminCustomerPromo).toHaveBeenCalledWith('team_1', expect.objectContaining({ kind: 'amount_off', value: 49 })))
  })
})
