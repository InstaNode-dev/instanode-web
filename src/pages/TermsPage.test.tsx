/* TermsPage.test.tsx — coverage tests for the static legal stop-gap page. */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TermsPage } from './TermsPage'

describe('TermsPage', () => {
  it('renders the terms heading and testid wrapper', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )
    const section = screen.getByTestId('terms-page')
    expect(section).toBeTruthy()
    expect(section.textContent).toContain('Terms')
  })

  it('exposes a mailto link for the legal contact', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )
    const links = document.querySelectorAll('a[href^="mailto:"]')
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0].getAttribute('href')).toBe('mailto:legal@instanode.dev')
  })

  it('links to the public status page (T-tier SLA wording)', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )
    const status = document.querySelector('a[href="https://status.instanode.dev"]')
    expect(status).toBeTruthy()
  })

  it('mentions billing via Razorpay (no free trial copy)', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )
    expect(document.body.textContent ?? '').toContain('Razorpay')
  })
})
