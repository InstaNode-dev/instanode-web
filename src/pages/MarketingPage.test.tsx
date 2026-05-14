/* MarketingPage.test.tsx — W12 footer link regression guards (H15).
 *
 * The MarketingPage footer used to link three legal/agent paths that App.tsx
 * never registered: /privacy, /terms, /llms.txt. The catch-all `*` route
 * redirected every click to `/`, so the footer was dead. The W12 fix:
 *   - /privacy, /terms → real routes (stop-gap placeholder pages).
 *   - /llms.txt        → re-pointed to https://instanode.dev/llms.txt
 *     (served from the apex by the prerender pipeline).
 *
 * These tests pin the hrefs so a future refactor of the footer can't
 * silently kill the links again.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MarketingPage } from './MarketingPage'

afterEach(() => cleanup())

function findAnchorByText(text: string): HTMLAnchorElement | null {
  for (const a of Array.from(document.querySelectorAll('a'))) {
    if ((a.textContent ?? '').trim() === text) return a as HTMLAnchorElement
  }
  return null
}

describe('MarketingPage — legal footer links (W12 H15)', () => {
  it('Privacy link points at /privacy (a real route post-W12)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const a = findAnchorByText('Privacy')
    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('/privacy')
  })

  it('Terms link points at /terms (a real route post-W12)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const a = findAnchorByText('Terms')
    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('/terms')
  })

  it("llms.txt link points at the absolute apex URL (not relative /llms.txt — dashboard host doesn't serve that file)", () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const a = findAnchorByText('llms.txt')
    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('https://instanode.dev/llms.txt')
  })
})
