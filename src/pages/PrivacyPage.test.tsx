/* PrivacyPage.test.tsx — coverage tests for the static legal stop-gap page. */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  it('renders the privacy heading and testid wrapper', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )
    const section = screen.getByTestId('privacy-page')
    expect(section).toBeTruthy()
    expect(section.textContent).toContain('Privacy')
  })

  it('exposes a mailto link for the legal contact', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )
    const links = document.querySelectorAll('a[href^="mailto:"]')
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0].getAttribute('href')).toBe('mailto:legal@instanode.dev')
  })

  it('mentions our sub-processors so reviewers can see them', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )
    expect(document.body.textContent ?? '').toContain('Razorpay')
    expect(document.body.textContent ?? '').toContain('Resend')
  })
})
