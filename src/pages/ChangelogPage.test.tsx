/* ChangelogPage.test.tsx — BugBash 2026-05-20 (B3-P1-8).
 *
 * Pins the SPA-nav title contract for /changelog. The static prerender
 * writes the correct <title> into dist/changelog/index.html, but SPA
 * nav from / → /changelog never re-applied it before this fix; the tab
 * title stayed as the homepage default. Test that mounting the page
 * swaps document.title and unmounting restores the previous value.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ChangelogPage } from './ChangelogPage'

let originalTitle = ''
beforeEach(() => {
  originalTitle = document.title
  document.title = 'instanode · Real infrastructure for AI agents'
})
afterEach(() => {
  document.title = originalTitle
  cleanup()
})

describe('ChangelogPage — SPA-nav title application (BugBash B3-P1-8)', () => {
  it('sets document.title to "Changelog · instanode" on mount', () => {
    render(
      <MemoryRouter initialEntries={['/changelog']}>
        <ChangelogPage />
      </MemoryRouter>,
    )
    expect(document.title).toBe('Changelog · instanode')
  })

  it('restores the previous title on unmount', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/changelog']}>
        <ChangelogPage />
      </MemoryRouter>,
    )
    expect(document.title).toBe('Changelog · instanode')
    unmount()
    expect(document.title).toBe('instanode · Real infrastructure for AI agents')
  })

  it('exposes the Atom feed link (B3-P1-7 RSS subscribe path)', () => {
    render(
      <MemoryRouter initialEntries={['/changelog']}>
        <ChangelogPage />
      </MemoryRouter>,
    )
    const link = document.querySelector('a[href="/changelog/rss.xml"]')
    expect(link).toBeTruthy()
  })
})
