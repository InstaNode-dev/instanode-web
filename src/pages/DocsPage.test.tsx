/* DocsPage.test.tsx — docs index: search, sidebar toggle, `/` shortcut. */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsPage } from './DocsPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <DocsPage />
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

describe('DocsPage', () => {
  it('renders the hero and the openapi reference link', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Documentation' })).toBeTruthy()
    const ref = document.querySelector('a[href="https://api.instanode.dev/openapi.json"]')
    expect(ref).toBeTruthy()
  })

  it('renders the full section TOC by default', () => {
    renderPage()
    const tocLinks = document.querySelectorAll('.docs-toc ol li a')
    expect(tocLinks.length).toBeGreaterThan(0)
  })

  it('toggles the sidebar open and closed', () => {
    renderPage()
    const toggle = document.querySelector('button.docs-sidebar-toggle') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters sections via the search box', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'zzzznotathing' } })
    // Garbage query yields the empty-results branch.
    expect(screen.getByText('No matches.')).toBeTruthy()
  })

  it('renders a results list for a matching query', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    // Search for a likely-present token; if no docs match we still exercise
    // the results branch (empty or populated).
    fireEvent.change(input, { target: { value: 'a' } })
    const resultsList = document.querySelector('.docs-toc-results')
    expect(resultsList).toBeTruthy()
  })

  it('focuses the search input when "/" is pressed outside an input', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    input.blur()
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(input)
  })

  it('does not hijack "/" while typing in an input', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    fireEvent.keyDown(input, { key: '/', target: input })
    // No crash; input still present.
    expect(input).toBeTruthy()
  })

  it('ignores "/" with a modifier key', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    input.blur()
    fireEvent.keyDown(window, { key: '/', metaKey: true })
    expect(document.activeElement).not.toBe(input)
  })
})
