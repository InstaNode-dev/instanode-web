/* NotFoundPage.test.tsx — coverage tests for the SPA 404 catch-all. */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NotFoundPage } from './NotFoundPage'

describe('NotFoundPage', () => {
  beforeEach(() => {
    // jsdom defaults pathname to '/' — for one test we override.
  })

  it('renders 404 eyebrow and headline', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/404/i)).toBeTruthy()
    expect(screen.getByText(/that page is not provisioned/i)).toBeTruthy()
  })

  it('shows the current URL path in a <code>', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )
    // jsdom default location.pathname is '/' so the rendered code is '/'.
    const code = document.querySelector('code.nf-url')
    expect(code).toBeTruthy()
    expect(code!.textContent).toBe(window.location.pathname || '/')
  })

  it('renders both primary and secondary CTAs', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )
    const home = document.querySelector('a.nf-cta-primary')
    const docs = document.querySelector('a.nf-cta-secondary')
    expect(home?.getAttribute('href')).toBe('/')
    expect(docs?.getAttribute('href')).toBe('/docs')
  })

  it('lists the standard help links (pricing, use-cases, blog, changelog)', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )
    for (const href of ['/pricing', '/use-cases', '/blog', '/changelog']) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeTruthy()
    }
  })
})
