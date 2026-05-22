/* PricingPage.extra.test.tsx — CtaStrip copy-button coverage.
 *
 * The sibling PricingPage.test.tsx covers the CTAs / FAQ / tier grid. This
 * file drives the "Try it without signup" curl copy button — both the
 * success (button flips to "copied") and clipboard-refused branches. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../components/Common', async () => {
  const actual = await vi.importActual<typeof import('../components/Common')>('../components/Common')
  return { ...actual, copyToClipboard: vi.fn() }
})

import { PricingPage } from './PricingPage'
import * as common from '../components/Common'

const copyToClipboard = common.copyToClipboard as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})
afterEach(() => cleanup())

function renderPage() {
  return render(<MemoryRouter initialEntries={['/pricing']}><PricingPage /></MemoryRouter>)
}

describe('PricingPage — CtaStrip copy', () => {
  it('flips the copy button to "copied" on a successful copy', async () => {
    copyToClipboard.mockResolvedValue(true)
    renderPage()
    const btn = screen.getByLabelText('Copy curl command to clipboard')
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByText('copied')).toBeTruthy())
    expect(copyToClipboard).toHaveBeenCalled()
  })

  it('does NOT flip to "copied" when the clipboard refuses', async () => {
    copyToClipboard.mockResolvedValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderPage()
    fireEvent.click(screen.getByLabelText('Copy curl command to clipboard'))
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText('copied')).toBeNull()
    warn.mockRestore()
  })
})
