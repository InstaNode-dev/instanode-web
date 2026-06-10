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
  it('services headline + MCP tools card count match the rendered SERVICES cards (registry-derived, not hand-typed)', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const text = container.textContent ?? ''
    // 2026-06-11 display-detail audit: the headline said "Seven services"
    // above EIGHT rendered cards (vector joined SERVICES on 2026-05-20 but
    // the count copy was never bumped), and the MCP card said "Seven
    // provisioning tools" while omitting `vector` (mcp registers
    // create_vector). Per rule 18, derive the expected count from the live
    // registry (the rendered service cards) instead of a hand-typed word so
    // adding service #9 without bumping the copy fails this test.
    const cardCount = container.querySelectorAll('.mkt-service-card').length
    expect(cardCount).toBeGreaterThan(0)
    const COUNT_WORDS = [
      'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
      'Nine', 'Ten', 'Eleven', 'Twelve',
    ]
    const word = COUNT_WORDS[cardCount]
    expect(word).toBeDefined()
    expect(text).toContain(`${word} services. One bundle.`)
    expect(text).toContain(`${word} provisioning tools`)
    // The MCP tools card must list every provisioning service shown in the
    // cards row — anti-regression for the dropped-webhook (T18 P1-4) and
    // dropped-vector (2026-06-11) bugs — plus the management tools.
    for (const svc of ['postgres', 'vector', 'redis', 'mongo', 'queue', 'storage', 'webhook', 'deploy']) {
      expect(text).toContain(svc)
    }
    expect(text).toMatch(/list_deployments/)
  })

  it('mock provision visual shows real prod facts: nyc3 region, 201 for /db/new, usr_/db_ name prefixes', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const html = container.innerHTML
    // 2026-06-11 display-detail audit: prod runs on DigitalOcean nyc3 —
    // "iad-1" was a fabricated region we never ran in.
    expect(html).toContain('nyc3 · us-east')
    expect(html).not.toContain('iad-1')
    // POST /db/new provisions synchronously → 201 Created (openapi.json);
    // "202 accepted" belongs to /deploy/new + /stacks/new only.
    expect(html).toContain('201 created')
    expect(html).not.toContain('202 accepted')
    // Claim-card sample URL uses the provisioner's canonical usr_/db_
    // prefixes, not the fabricated u_/d_ ones.
    expect(html).toContain('usr_xY9')
    expect(html).not.toContain('postgres://u_xY9')
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

  // TEAM-GATE reconciliation (2026-06-08): the homepage Team tile's CTA used
  // to point at the self-serve /app/checkout?plan=team path — a tier the
  // server-side gate rejects with 400 tier_not_yet_available, so the homepage
  // was marketing a plan the platform can't actually sell. Team is
  // contact-sales only until its delivery is proven built (CEO TEAM-GATE
  // directive). These guards pin the homepage Team CTA to a contact-sales
  // mailto and forbid the self-serve checkout link from creeping back, AND
  // confirm Team is NOT badged "Most popular" (Pro is the highlighted tier).
  it('homepage Team tile CTA is a contact-sales mailto, NOT a self-serve checkout', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const teamCta = findAnchorByText('Contact sales →')
    expect(teamCta).not.toBeNull()
    expect(teamCta!.getAttribute('href')).toContain('mailto:sales@instanode.dev')
    // The retired self-serve Team checkout link must not exist anywhere on the page.
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((h) => h.includes('plan=team'))).toBe(false)
    // And the old buyable label must be gone.
    expect(findAnchorByText('Start team →')).toBeNull()
  })

  it('only Pro is badged "Most popular" — Team must not be highlighted/badged as buyable', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
    const badges = Array.from(container.querySelectorAll('.mkt-featured-flag')).filter(
      (el) => (el.textContent ?? '').trim() === 'Most popular',
    )
    expect(badges.length).toBe(1)
    // The badge sits inside the Pro card, not the Team card.
    const card = badges[0].closest('.mkt-price-card')
    expect(card?.textContent).toContain('Pro')
    expect(card?.textContent).not.toContain('Team')
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

// ─── 2026-06-11 a11y + email-standardization fixes ─────────────────────────
describe('MarketingPage — a11y + support-email consistency', () => {
  function renderHome() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <MarketingPage />
      </MemoryRouter>,
    )
  }

  it("brand link aria-label contains the visible text 'instanode.dev' (WCAG 2.5.3 Label in Name)", () => {
    renderHome()
    const brand = document.querySelector('a.mkt-brand-link') as HTMLAnchorElement
    expect(brand).not.toBeNull()
    const label = brand.getAttribute('aria-label') ?? ''
    // The brand renders "instanode.dev" — the accessible name must include it.
    expect(label).toContain('instanode.dev')
    // The visible text the brand renders, sans markup.
    expect((brand.textContent ?? '').replace(/\s+/g, '')).toContain('instanode.dev')
  })

  it('footer column headers are <h3>, not <h4> (no skipped heading level)', () => {
    renderHome()
    const footerCols = Array.from(document.querySelectorAll('.mkt-footer-col'))
    const headers = footerCols.map((c) => c.querySelector('h1,h2,h3,h4,h5,h6'))
    // Every footer column has a heading and it's an <h3>.
    expect(headers.length).toBeGreaterThanOrEqual(2)
    for (const h of headers) {
      expect(h).not.toBeNull()
      expect(h!.tagName).toBe('H3')
    }
    // And no <h4> anywhere skips the level on the page.
    expect(document.querySelector('.mkt-footer-col h4')).toBeNull()
  })

  it('heading levels never skip (no <hN> without an <hN-1> before it)', () => {
    renderHome()
    const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
      Number(h.tagName[1]),
    )
    let max = 0
    for (const lvl of levels) {
      // A heading may be at most one deeper than the deepest seen so far.
      expect(lvl).toBeLessThanOrEqual(max + 1)
      if (lvl > max) max = lvl
    }
  })

  it("general-contact CTA uses the canonical contact@ address, not hello@", () => {
    renderHome()
    const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(
      (a) => a.getAttribute('href') ?? '',
    )
    // No hello@ anywhere on the homepage.
    expect(mailtos.some((h) => h.includes('hello@instanode.dev'))).toBe(false)
    // The "talk to us" CTA points at contact@.
    const talk = findAnchorByText('talk to us')
    expect(talk).not.toBeNull()
    expect(talk!.getAttribute('href')).toContain('mailto:contact@instanode.dev')
  })

  it('Team CTA still uses sales@ (lead capture is a deliberate split)', () => {
    renderHome()
    const teamCta = findAnchorByText('Contact sales →')
    expect(teamCta).not.toBeNull()
    expect(teamCta!.getAttribute('href')).toContain('mailto:sales@instanode.dev')
  })
})
