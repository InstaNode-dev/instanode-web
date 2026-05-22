/* PrivacyPage.test.tsx — static legal stop-gap page. */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PrivacyPage } from './PrivacyPage'

afterEach(() => cleanup())

describe('PrivacyPage', () => {
  it('renders the privacy section with the legal contact mailto', () => {
    render(<PrivacyPage />)
    expect(screen.getByTestId('privacy-page')).toBeTruthy()
    const links = screen.getAllByRole('link', { name: /legal@instanode\.dev/i })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0].getAttribute('href')).toBe('mailto:legal@instanode.dev')
  })

  it('states it is a placeholder and not a contract', () => {
    render(<PrivacyPage />)
    expect(screen.getByText(/placeholder/i)).toBeTruthy()
    expect(screen.getByText(/What we collect/i)).toBeTruthy()
  })
})
