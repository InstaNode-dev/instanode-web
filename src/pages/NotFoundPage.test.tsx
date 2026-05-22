/* NotFoundPage.test.tsx — public 404 + SPA catch-all. */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { NotFoundPage } from './NotFoundPage'

afterEach(() => cleanup())

describe('NotFoundPage', () => {
  it('renders the 404 heading and current path from window.location', () => {
    window.history.pushState({}, '', '/some/missing/url')
    render(<NotFoundPage />)
    expect(screen.getByRole('heading', { name: /not provisioned/i })).toBeTruthy()
    expect(screen.getByText('/some/missing/url')).toBeTruthy()
  })

  it('offers homepage + docs CTAs and helper links', () => {
    render(<NotFoundPage />)
    expect(screen.getByRole('link', { name: /Back to homepage/i }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: /Read the docs/i }).getAttribute('href')).toBe('/docs')
    expect(screen.getByRole('link', { name: '/pricing' }).getAttribute('href')).toBe('/pricing')
    expect(screen.getByRole('link', { name: '/use-cases' }).getAttribute('href')).toBe('/use-cases')
  })

  it('falls back to "/" when location.pathname is empty', () => {
    window.history.pushState({}, '', '/')
    render(<NotFoundPage />)
    // currentPath() returns "/" — rendered inside the <code> element.
    expect(screen.getByText('/', { selector: 'code' })).toBeTruthy()
  })
})
