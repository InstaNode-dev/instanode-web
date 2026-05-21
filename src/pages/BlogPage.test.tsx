/* BlogPage.test.tsx — coverage for the public blog index. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BlogPage } from './BlogPage'
import { POSTS } from '../content/posts'

let originalTitle = ''
beforeEach(() => {
  originalTitle = document.title
  document.title = 'instanode · Real infrastructure for AI agents'
})
afterEach(() => {
  document.title = originalTitle
  cleanup()
})

describe('BlogPage', () => {
  it('sets document.title to "Blog · instanode" on mount', () => {
    render(
      <MemoryRouter>
        <BlogPage />
      </MemoryRouter>,
    )
    expect(document.title).toBe('Blog · instanode')
  })

  it('restores the previous document.title on unmount', () => {
    const { unmount } = render(
      <MemoryRouter>
        <BlogPage />
      </MemoryRouter>,
    )
    unmount()
    expect(document.title).toBe('instanode · Real infrastructure for AI agents')
  })

  it('renders a card for every post, with link to /blog/<slug>', () => {
    if (POSTS.length === 0) return
    render(
      <MemoryRouter>
        <BlogPage />
      </MemoryRouter>,
    )
    for (const p of POSTS) {
      const link = document.querySelector(`a[href="/blog/${p.slug}"]`)
      expect(link, `missing link for ${p.slug}`).toBeTruthy()
    }
  })

  it('renders posts in reverse-chronological order', () => {
    if (POSTS.length < 2) return
    render(
      <MemoryRouter>
        <BlogPage />
      </MemoryRouter>,
    )
    const cards = Array.from(document.querySelectorAll('a.blog-card-link'))
    const slugs = cards.map((c) => (c.getAttribute('href') || '').replace('/blog/', ''))
    const sorted = [...POSTS].sort((a, b) => b.date.localeCompare(a.date)).map((p) => p.slug)
    expect(slugs).toEqual(sorted)
  })
})
