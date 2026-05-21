/* BlogPostPage.test.tsx — BugBash 2026-05-20 fixes.
 *
 * Pins two B3-P1 contracts:
 *   1. stripDuplicateLeadingH1 (B3-P1-5 / B3-P1-6): if the markdown body
 *      starts with `# Heading` that matches the frontmatter title (case-
 *      insensitive, punctuation-normalised), drop that block. Keeps the
 *      <h1 className="post-title"> singleton, prevents the body H1 from
 *      absorbing a following fenced code block when baseHeading='h2'.
 *   2. SPA-nav title application (B3-P1-9): mounting BlogPostPage sets
 *      document.title to "<post title> · instanode blog" and restores
 *      the previous value on unmount.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BlogPostPage, stripDuplicateLeadingH1 } from './BlogPostPage'
import { POSTS } from '../content/posts'

afterEach(() => cleanup())

describe('stripDuplicateLeadingH1 — B3-P1-5 / B3-P1-6', () => {
  it('drops leading `# X` when X matches the title', () => {
    const body = '# Hello world\n\nFirst paragraph.'
    expect(stripDuplicateLeadingH1(body, 'Hello world')).toBe('First paragraph.')
  })

  it('tolerates punctuation / case differences in the match', () => {
    const body = "# Maya's full night\n\nBody."
    expect(stripDuplicateLeadingH1(body, "MAYA'S FULL NIGHT")).toBe('Body.')
  })

  it('leaves the body alone when the leading H1 does not match', () => {
    const body = '# Different heading\n\nBody.'
    const out = stripDuplicateLeadingH1(body, 'Frontmatter title')
    expect(out).toBe(body)
  })

  it('leaves later H1s untouched (only the first is stripped)', () => {
    const body = '# Match\n\nIntro.\n\n# Later H1\n\nMore.'
    expect(stripDuplicateLeadingH1(body, 'Match')).toBe(
      'Intro.\n\n# Later H1\n\nMore.',
    )
  })
})

describe('BlogPostPage — SPA-nav title application (B3-P1-9)', () => {
  let originalTitle = ''
  beforeEach(() => {
    originalTitle = document.title
    document.title = 'instanode · Real infrastructure for AI agents'
  })
  afterEach(() => {
    document.title = originalTitle
  })

  it('sets document.title from the post title on mount', () => {
    // Use the first real post the content loader hydrated. The test
    // exists because building a synthetic fixture would have to inject
    // into POSTS, which is a frozen module export.
    if (POSTS.length === 0) return // .content not synced yet — skip
    const post = POSTS[0]
    render(
      <MemoryRouter initialEntries={[`/blog/${post.slug}`]}>
        <Routes>
          <Route path="/blog/:slug" element={<BlogPostPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(document.title).toBe(`${post.title} · instanode blog`)
  })

  it('restores the previous title on unmount', () => {
    if (POSTS.length === 0) return
    const post = POSTS[0]
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/blog/${post.slug}`]}>
        <Routes>
          <Route path="/blog/:slug" element={<BlogPostPage />} />
        </Routes>
      </MemoryRouter>,
    )
    const before = document.title
    expect(before).toBe(`${post.title} · instanode blog`)
    unmount()
    // Restored to the value set in beforeEach (the marketing homepage
    // default). The cleanup closure swaps the captured snapshot back in.
    expect(document.title).toBe('instanode · Real infrastructure for AI agents')
  })

  it('emits an application/ld+json BlogPosting JSON-LD block', () => {
    if (POSTS.length === 0) return
    const post = POSTS[0]
    render(
      <MemoryRouter initialEntries={[`/blog/${post.slug}`]}>
        <Routes>
          <Route path="/blog/:slug" element={<BlogPostPage />} />
        </Routes>
      </MemoryRouter>,
    )
    const el = document.getElementById('blog-jsonld') as HTMLScriptElement | null
    expect(el).toBeTruthy()
    expect(el!.type).toBe('application/ld+json')
    const payload = JSON.parse(el!.textContent ?? '{}')
    expect(payload['@type']).toBe('BlogPosting')
    expect(payload.headline).toBe(post.title)
    expect(payload.datePublished).toBe(post.date)
  })
})
