/* CheckoutPage.test.tsx — /app/checkout Razorpay session bootstrap. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CheckoutPage } from './CheckoutPage'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, createCheckout: vi.fn() }
})

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({ me: { user: { email: 'founder@acme.dev' } } }),
}))

import * as api from '../api'

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/checkout${search}`]}>
      <CheckoutPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  delete (window as any).location
  ;(window as any).location = { assign: vi.fn(), origin: 'http://localhost' }
})
afterEach(() => cleanup())

describe('CheckoutPage', () => {
  it('rejects a missing plan param', async () => {
    ;(api.createCheckout as any).mockReturnValue(new Promise(() => {}))
    renderAt('')
    await waitFor(() => expect(screen.getByTestId('checkout-invalid')).toBeTruthy())
    expect(screen.getByTestId('checkout-invalid').textContent).toContain('Missing required')
    expect(api.createCheckout).not.toHaveBeenCalled()
  })

  it('rejects an unknown plan', async () => {
    renderAt('?plan=enterprise')
    await waitFor(() => expect(screen.getByTestId('checkout-invalid').textContent).toContain('Unknown plan'))
  })

  it('rejects an unknown frequency', async () => {
    renderAt('?plan=pro&frequency=weekly')
    await waitFor(() => expect(screen.getByTestId('checkout-invalid').textContent).toContain('Unknown frequency'))
  })

  it('redirects to the Razorpay short_url on success', async () => {
    ;(api.createCheckout as any).mockResolvedValue({ short_url: 'https://rzp.io/x' })
    renderAt('?plan=pro&frequency=monthly')
    await waitFor(() => expect(screen.getByTestId('checkout-redirecting')).toBeTruthy())
    expect((window as any).location.assign).toHaveBeenCalledWith('https://rzp.io/x')
    expect(api.createCheckout).toHaveBeenCalledWith('pro', 'monthly')
  })

  it('defaults frequency to monthly when omitted', async () => {
    ;(api.createCheckout as any).mockResolvedValue({ short_url: 'https://rzp.io/y' })
    renderAt('?plan=hobby')
    await waitFor(() => expect(api.createCheckout).toHaveBeenCalledWith('hobby', 'monthly'))
  })

  it('errors when the response is missing short_url', async () => {
    ;(api.createCheckout as any).mockResolvedValue({})
    renderAt('?plan=pro')
    await waitFor(() => expect(screen.getByTestId('checkout-error').textContent).toContain('missing short_url'))
  })

  it('renders the fallback panel on 503 billing_not_configured', async () => {
    ;(api.createCheckout as any).mockRejectedValue({ status: 503, code: 'billing_not_configured' })
    renderAt('?plan=pro')
    await waitFor(() => expect(screen.getByTestId('checkout-fallback')).toBeTruthy())
  })

  it('renders the verify-email banner on a 403 email_not_verified error', async () => {
    ;(api.createCheckout as any).mockRejectedValue({ status: 403, code: 'email_not_verified' })
    renderAt('?plan=pro')
    await waitFor(() => expect(screen.getByTestId('checkout-email-not-verified')).toBeTruthy())
  })

  it('surfaces a generic error otherwise', async () => {
    ;(api.createCheckout as any).mockRejectedValue({ message: 'boom' })
    renderAt('?plan=team')
    await waitFor(() => expect(screen.getByTestId('checkout-error').textContent).toContain('boom'))
  })
})
