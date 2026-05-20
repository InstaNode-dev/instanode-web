/* PricingPage.test.tsx — W12 funnel + chrome fixes.
 *
 * The /pricing page used to route every paid-tier CTA at `/checkout?…`,
 * but App.tsx never registered `/checkout` — the catch-all redirect to `/`
 * silently broke the entire acquisition funnel. These tests pin the new
 * contract so a future refactor can't regress it again:
 *
 *   1. CTAs point at /app/checkout (under AuthGate). Every tier with a
 *      paid Razorpay subscription path renders both a monthly and a
 *      yearly CTA aimed at /app/checkout?plan=…&frequency=….
 *   2. The FAQ no longer claims "Cancel anytime" — that contradicted the
 *      no-self-serve-cancel policy. We assert the new copy mentions
 *      support@instanode.dev so the BillingPage and PricingPage copy
 *      stay in lock-step.
 *   3. M11 source-of-truth-risk regression: the four public tier cards
 *      (anonymous, hobby, pro, team) are all present. The pricing matrix
 *      is hardcoded today (mirrors api/plans.yaml), so a silent deletion
 *      would ship undetected without this assertion. The source-of-truth
 *      comment block in PricingPage.tsx documents the coupling explicitly.
 *
 *      Note: hobby_plus was removed from the PUBLIC marketing grid on
 *      2026-05-15 (W12 pricing pass). It still exists in api/plans.yaml
 *      and is offered via dashboard upsell flows (quota wall, custom-domain
 *      prompts) — it is not a public funnel entry and therefore has no
 *      card on /pricing. Tests referencing hobby_plus were updated here
 *      to reflect the settled product decision.
 *
 * jsdom note: PricingPage uses localStorage on mount to hydrate the
 * monthly/yearly toggle. vitest's jsdom environment provides a working
 * implementation, so no shim is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PricingPage } from './PricingPage'

beforeEach(() => {
  // Clear any cached frequency from a sibling test run — the toggle
  // persists to localStorage and a stale 'yearly' would flip the
  // monthly-CTA assertions.
  window.localStorage.clear()
})
afterEach(() => cleanup())

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/pricing']}>
      <PricingPage />
    </MemoryRouter>,
  )
}

// ─── 1. CTA hrefs ─────────────────────────────────────────────────────────

describe('PricingPage — CTAs point at /app/checkout (W12 C1)', () => {
  it('Hobby monthly CTA points at /app/checkout?plan=hobby&frequency=monthly', () => {
    renderPage()
    const cta = screen.getByTestId('pricing-cta-hobby') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/app/checkout?plan=hobby&frequency=monthly')
  })

  it('Pro monthly CTA points at /app/checkout?plan=pro&frequency=monthly', () => {
    renderPage()
    const cta = screen.getByTestId('pricing-cta-pro') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/app/checkout?plan=pro&frequency=monthly')
  })

  it('Hobby yearly CTA points at /app/checkout?plan=hobby&frequency=yearly', () => {
    renderPage()
    // Switch to yearly via the toggle.
    fireEvent.click(screen.getByTestId('pricing-frequency-yearly'))
    const cta = screen.getByTestId('pricing-cta-hobby') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/app/checkout?plan=hobby&frequency=yearly')
  })

  it('Pro yearly CTA points at /app/checkout?plan=pro&frequency=yearly', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('pricing-frequency-yearly'))
    const cta = screen.getByTestId('pricing-cta-pro') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/app/checkout?plan=pro&frequency=yearly')
  })

  it('no CTA points at the legacy /checkout (no /app prefix) — that route was unregistered and bounced to /', () => {
    renderPage()
    // Sweep every anchor on the page; none should hit the legacy path.
    // The legacy path was `/checkout?...` with no `/app/` prefix.
    const all = Array.from(document.querySelectorAll('a[href]'))
    for (const a of all) {
      const href = a.getAttribute('href') ?? ''
      // Use a non-anchored match so /app/checkout? is excluded.
      expect(href.startsWith('/checkout?')).toBe(false)
      expect(href === '/checkout').toBe(false)
    }
  })
})

// ─── 2. FAQ rewrite (H14) ─────────────────────────────────────────────────

describe('PricingPage — FAQ matches no-self-serve-cancel policy (W12 H14)', () => {
  it("no longer says 'Cancel anytime' — that contradicted the support-only cancel policy", () => {
    renderPage()
    // The FAQ <details> renders the question + answer text into the DOM
    // even when collapsed (only the panel's height is animated), so a
    // text search hits.
    const body = document.body.textContent ?? ''
    expect(body).not.toContain('Cancel anytime')
  })

  it("mentions support@instanode.dev with the 24h SLA — matches BillingPage copy", () => {
    renderPage()
    const body = document.body.textContent ?? ''
    expect(body).toContain('support@instanode.dev')
    expect(body).toContain('within 24h')
  })
})

// ─── 3. M11 source-of-truth regression ────────────────────────────────────

describe('PricingPage — four public tier cards present (M11 regression guard)', () => {
  it('renders one card per public tier (anonymous / hobby / pro / team)', () => {
    renderPage()
    // Each tier column has data-tier=<key> on the header cell. Four public
    // tiers means four header cells with the unique tier keys.
    // hobby_plus is intentionally absent from the marketing grid (W12, 2026-05-15):
    // it is offered via dashboard upsell flows only, not the public pricing ladder.
    for (const tier of ['anonymous', 'hobby', 'pro', 'team']) {
      const headerCells = Array.from(
        document.querySelectorAll(`[role="columnheader"][data-tier="${tier}"]`),
      )
      expect(headerCells.length).toBeGreaterThan(0)
    }
  })

  it('hobby_plus has no card on the public /pricing page (upsell-only tier)', () => {
    renderPage()
    const hobbyPlusCells = Array.from(
      document.querySelectorAll('[data-tier="hobby_plus"]'),
    )
    expect(hobbyPlusCells.length).toBe(0)
  })

  it('paid-tier CTAs are clickable links (not disabled spans) for hobby / pro', () => {
    renderPage()
    for (const tier of ['hobby', 'pro']) {
      const cta = screen.getByTestId(`pricing-cta-${tier}`)
      // <a> with href, not <span aria-disabled>.
      expect(cta.tagName).toBe('A')
      expect(cta.getAttribute('href')).toBeTruthy()
    }
  })
})

// ─── 4. B2-P1-1 / B2-P1-2: URL params + anchors (BugBash 2026-05-20) ──────

describe('PricingPage — URL params + hash anchors (BugBash B2-P1-1 / B2-P1-2)', () => {
  it('?frequency=yearly URL param hydrates the toggle to yearly', () => {
    render(
      <MemoryRouter initialEntries={['/pricing?frequency=yearly']}>
        <PricingPage />
      </MemoryRouter>,
    )
    // The yearly toggle is aria-checked=true once the URL param is applied.
    const yearlyBtn = screen.getByTestId('pricing-frequency-yearly')
    expect(yearlyBtn.getAttribute('aria-checked')).toBe('true')
  })

  it('?frequency=monthly URL param overrides stale localStorage=yearly', () => {
    window.localStorage.setItem('instant.billing.plan_frequency', 'yearly')
    render(
      <MemoryRouter initialEntries={['/pricing?frequency=monthly']}>
        <PricingPage />
      </MemoryRouter>,
    )
    const monthlyBtn = screen.getByTestId('pricing-frequency-monthly')
    expect(monthlyBtn.getAttribute('aria-checked')).toBe('true')
  })

  it('per-tier id is rendered for shareable #anchor links (B2-P1-2)', () => {
    renderPage()
    // /pricing#pro and /pricing?tier=pro both rely on an element with
    // id="pricing-tier-pro" existing on the page so the browser can
    // scroll into view. Hash-without-id was a no-op.
    for (const tier of ['anonymous', 'hobby', 'pro', 'team']) {
      const el = document.getElementById(`pricing-tier-${tier}`)
      expect(el).toBeTruthy()
    }
  })
})

// ─── 5. B2-P1-3 / B2-P1-4: FAQ disambiguation (BugBash 2026-05-20) ────────

describe('PricingPage — FAQ disambiguation (BugBash B2-P1-3 / B2-P1-4)', () => {
  it('explicitly says no trial — pay from day one on Hobby/Pro/Team', () => {
    renderPage()
    const body = document.body.textContent ?? ''
    // The new FAQ entry says "you pay from day one" + "free trial" in
    // the question. Pin both halves so a copy edit can't accidentally
    // drop the no-trial half.
    expect(body).toContain('pay from day one')
    expect(body.toLowerCase()).toContain('free trial')
  })

  it('discloses Hobby Plus + Growth exist as API-only tiers', () => {
    renderPage()
    const body = document.body.textContent ?? ''
    expect(body).toContain('Hobby Plus')
    expect(body).toContain('Growth')
  })
})
