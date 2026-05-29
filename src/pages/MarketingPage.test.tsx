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

// ─── T18 P1-2 / P1-4 / P1-6 regression guards ──────────────────────────────
//
// These pin the post-bug-bash invariants on the homepage 'For agents' nav
// link and the page's own claim copy. The nav-drift guard (T18 P1-1) is
// covered by sibling PR #107's MarketingNav shared module, so this PR
// sticks to the residual fixes #107 did not address.
describe('MarketingPage — homepage nav drift (T18 P1-2)', () => {
  it("homepage nav 'For agents' link points at /for-agents (not '#for-agents')", () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    // T18 P1-2: every 'For agents' anchor in the homepage nav routes to
    // the dedicated page. (The page also still has an `id="for-agents"`
    // section so direct hash-links continue to scroll; this test just
    // pins that the nav label routes consistently.)
    const anchors = Array.from(container.querySelectorAll('a')).filter(
      (a) => (a.textContent ?? '').trim() === 'For agents',
    )
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) {
      expect(a.getAttribute('href')).toBe('/for-agents')
    }
  })
})

describe('MarketingPage — claim consistency (T18 P1-4 / P1-6)', () => {
  it("'Seven services' headline matches the MCP tools card (both say seven, listing webhook)", () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const text = container.textContent ?? ''
    // Headline says "Seven services. One bundle."
    expect(text).toMatch(/Seven services\. One bundle\./)
    // MCP tools card must NOT say "Six tools registered" (the dropped-
    // webhook regression). It must say "Seven" and list webhook.
    expect(text).not.toMatch(/Six tools registered/)
    expect(text).toMatch(/Seven tools registered/)
    expect(text).toMatch(/webhook/)
  })

  it("Deploy service card claims a build window consistent with content/llms.txt (~60s, not '<10s')", () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const text = container.textContent ?? ''
    // The previous '<10s' claim contradicted content/llms.txt's ~30–90s
    // kaniko-build window. The honest number is ~60s.
    expect(text).not.toMatch(/<10s/)
    expect(text).toMatch(/~60s/)
  })

  // BIZ-3 (2026-05-29): the landing pricing tile shipped "1 small deployment"
  // and "10 medium deployments" copy from the days when /deploy/new had a
  // deployment_size field. The backend dropped that field; marketing
  // /pricing dropped the size adjectives in the 2026-05-20 sweep; the
  // landing tile lagged. Pin both strings out so a future copy edit can't
  // silently re-introduce a contract claim the API doesn't honor.
  it('landing pricing tile no longer claims "small / medium" deployment sizes', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/small deployment/i)
    expect(text).not.toMatch(/medium deployments/i)
  })
})
