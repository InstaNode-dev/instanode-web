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

// ─── T18 P1-1 / P1-2 / P1-4 / P1-6 regression guards ──────────────────────
//
// These tests pin the post-bug-bash invariants on the homepage nav and
// the page's own claim copy. They iterate the shared PUBLIC_NAV_LINKS
// constant rather than a hand-typed list, so adding a public surface to
// the nav automatically extends the coverage to both shells (the
// equivalent PublicShell guard lives in PublicShell.test.tsx if a future
// agent adds one). See CLAUDE.md rule 18 — registry-iterating regression
// tests, not hand-typed slices.
import { PUBLIC_NAV_LINKS } from '../layout/publicNav'

describe('MarketingPage — public nav drift guards (T18 P1-1 / P1-2)', () => {
  it('renders every shared PUBLIC_NAV_LINKS entry in the homepage nav', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    // Both nav surfaces (desktop bar + mobile disclosure panel) hydrate
    // from PUBLIC_NAV_LINKS. We assert at least one anchor with matching
    // label + href appears for every link in the registry.
    for (const link of PUBLIC_NAV_LINKS) {
      const anchors = Array.from(container.querySelectorAll('a')).filter(
        (a) => (a.textContent ?? '').trim() === link.label,
      )
      expect(anchors.length).toBeGreaterThan(0)
      // At least one anchor for that label must point at the real route,
      // not a same-page `#anchor` (T18 P1-2: 'For agents' used to scroll
      // to a homepage section, drifting from PublicShell's real /for-agents
      // route).
      const hrefs = anchors.map((a) => a.getAttribute('href') ?? '')
      expect(hrefs).toContain(link.href)
    }
  })

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
})
