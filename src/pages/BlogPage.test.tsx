/* BlogPage.test.tsx — coverage for the public /blog index. */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BlogPage } from './BlogPage'
import { POSTS } from '../content/posts'

let originalTitle = ''
beforeEach(() => {
  originalTitle = document.title
  document.title = 'instanode · home'
})
afterEach(() => {
  document.title = originalTitle
  cleanup()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/blog']}>
      <BlogPage />
    </MemoryRouter>,
  )
}

describe('BlogPage', () => {
  it('renders the hero heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Blog' })).toBeTruthy()
  })

  it('renders one card per post with a link to /blog/:slug', () => {
    renderPage()
    const list = screen.getByRole('list', { name: 'Posts' })
    expect(list).toBeTruthy()
    // Every post slug should appear as a card link.
    for (const p of POSTS) {
      const link = document.querySelector(`a[href="/blog/${p.slug}"]`)
      expect(link).toBeTruthy()
    }
  })

  it('formats post dates as human-readable (Month Day, Year)', () => {
    renderPage()
    const times = document.querySelectorAll('time.blog-card-date')
    expect(times.length).toBe(POSTS.length)
    // formatDate emits e.g. "May 22, 2026" — assert at least one matches.
    if (times.length > 0) {
      expect(times[0].textContent).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)
    }
  })

  it('sets document.title on mount and restores on unmount', () => {
    const { unmount } = renderPage()
    expect(document.title).toBe('Blog · instanode')
    unmount()
    expect(document.title).toBe('instanode · home')
  })
})
