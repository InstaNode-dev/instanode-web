/* TermsPage.test.tsx — static legal stop-gap page. */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TermsPage } from './TermsPage'

afterEach(() => cleanup())

describe('TermsPage', () => {
  it('renders the terms section with the legal contact mailto', () => {
    render(<TermsPage />)
    expect(screen.getByTestId('terms-page')).toBeTruthy()
    const link = screen.getByRole('link', { name: /legal@instanode\.dev/i })
    expect(link.getAttribute('href')).toBe('mailto:legal@instanode.dev')
  })

  it('shows acceptable-use and billing posture bullets', () => {
    render(<TermsPage />)
    expect(screen.getByText(/Acceptable use/i)).toBeTruthy()
    expect(screen.getByText('Billing.')).toBeTruthy()
    expect(screen.getByText(/Service availability/i)).toBeTruthy()
    expect(screen.getByText(/Liability/i)).toBeTruthy()
  })

  it('links to the status page', () => {
    render(<TermsPage />)
    const status = screen.getByRole('link', { name: /status\.instanode\.dev/i })
    expect(status.getAttribute('href')).toBe('https://status.instanode.dev')
  })
})
