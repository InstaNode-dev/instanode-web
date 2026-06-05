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

  it('paid-tier CTAs are clickable links for hobby / pro / team', () => {
    renderPage()
    // Hobby/Pro are self-serve (/app/checkout). Team is a clickable
    // contact-sales mailto link (TEAM-GATE 2026-06-04) — still an <a>
    // with an href, just not a checkout one (asserted below).
    for (const tier of ['hobby', 'pro', 'team']) {
      const cta = screen.getByTestId(`pricing-cta-${tier}`)
      // <a> with href, not <span aria-disabled>.
      expect(cta.tagName).toBe('A')
      expect(cta.getAttribute('href')).toBeTruthy()
    }
  })

  it('Team CTA does NOT route to /app/checkout — it is contact-sales (TEAM-GATE 2026-06-04)', () => {
    // TEAM-GATE (2026-06-04 CEO directive): this DELIBERATELY REVERSES
    // DOG-10 (2026-05-29), which had pointed Team at /app/checkout?plan=team.
    // Team ($199 "unlimited") is NOT rolled out and must not be sold
    // self-serve until its unlimited-resource delivery is proven built.
    // The CTA is a sales-assisted mailto, NOT a checkout link. If a future
    // change re-points Team at /app/checkout, this test fails — that is the
    // regression guard. Ref docs/sessions/2026-06-04/TEAM-PLAN-GATE-AND-BUILD.md.
    renderPage()
    const cta = screen.getByTestId('pricing-cta-team')
    const href = cta.getAttribute('href') ?? ''
    expect(href).not.toContain('/app/checkout')
    expect(href).not.toContain('plan=team')
    expect(href.startsWith('mailto:')).toBe(true)
    // Label surfaces a contact-sales / coming-soon affordance, not "Start team".
    expect((cta.textContent ?? '').toLowerCase()).toContain('contact sales')
  })

  it('Team CTA stays contact-sales even when ?frequency=yearly is set (no checkout on yearly)', () => {
    // The yearly toggle must not unlock a self-serve Team checkout. The
    // Team card has no yearly checkout variant, so the CTA falls back to
    // the same contact-sales mailto on both cycles.
    render(
      <MemoryRouter initialEntries={['/pricing?frequency=yearly']}>
        <PricingPage />
      </MemoryRouter>,
    )
    const cta = screen.getByTestId('pricing-cta-team')
    const href = cta.getAttribute('href') ?? ''
    expect(href).not.toContain('/app/checkout')
    expect(href.startsWith('mailto:')).toBe(true)
  })

  it('Team tier shows $199/mo', () => {
    renderPage()
    // Team price still displays on the comparison surface ($199/mo per
    // plans.yaml:375) — the gate removes the self-serve buy path, not the
    // tier's visibility.
    const body = document.body.textContent ?? ''
    expect(body).toContain('$199')
  })
})

// ─── 3b. Enterprise "contact us" wall (task #56) ──────────────────────────

describe('PricingPage — Enterprise contact-us wall (task #56)', () => {
  it('renders an Enterprise column header to the right of Team', () => {
    renderPage()
    const headerCells = Array.from(
      document.querySelectorAll('[role="columnheader"][data-tier="enterprise"]'),
    )
    expect(headerCells.length).toBeGreaterThan(0)
    expect(document.body.textContent ?? '').toContain('Enterprise')
  })

  it('Enterprise CTA is a sales mailto (contact us), NOT a self-serve checkout', () => {
    renderPage()
    const cta = screen.getByTestId('pricing-cta-enterprise')
    const href = cta.getAttribute('href') ?? ''
    expect(href.startsWith('mailto:')).toBe(true)
    // Matches Team's contact address (sales@instanode.dev), Enterprise subject.
    expect(href).toContain('sales@instanode.dev')
    expect(href).not.toContain('/app/checkout')
    expect(href).not.toContain('plan=enterprise')
    expect((cta.textContent ?? '').toLowerCase()).toContain('contact us')
  })

  it('Enterprise has no dollar price — the headline is "Custom"', () => {
    renderPage()
    const header = document.querySelector(
      '[role="columnheader"][data-tier="enterprise"]',
    )
    expect(header).toBeTruthy()
    const headerText = header?.textContent ?? ''
    expect(headerText).toContain('Custom')
    expect(headerText).not.toContain('$')
  })

  it('renders the Enterprise callout card with a Contact-us CTA', () => {
    renderPage()
    expect(screen.getByTestId('pricing-enterprise-callout')).toBeTruthy()
    expect(screen.getByTestId('pricing-enterprise-card')).toBeTruthy()
    const calloutCta = screen.getByTestId('pricing-enterprise-cta')
    expect(calloutCta.tagName).toBe('A')
    expect(calloutCta.getAttribute('href') ?? '').toContain('mailto:sales@instanode.dev')
    expect((calloutCta.textContent ?? '').toLowerCase()).toContain('contact us')
  })

  it('surfaces the Enterprise trigger criteria (caps / dedicated infra / compliance)', () => {
    renderPage()
    const body = document.body.textContent ?? ''
    expect(body).toContain('dedicated')
    expect(body).toContain('multi-region')
    // At least one named compliance ask routes to Enterprise.
    expect(body).toContain('SOC2')
  })

  it('the page introduces NO "unlimited" wording (retired by the strict-margin redesign)', () => {
    renderPage()
    // Case-insensitive: neither the Team column nor the Enterprise wall may
    // reintroduce the retired "unlimited" claim anywhere on /pricing.
    const body = (document.body.textContent ?? '').toLowerCase()
    expect(body).not.toContain('unlimited')
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

// ─── 4b. DOG-3 / BUG-P001: hobby_plus + growth tiers surfaced inline ──────

describe('PricingPage — intermediate tiers visible (DOG-3 / BUG-P001)', () => {
  it('renders the "Between the headline tiers" section with hobby_plus + growth', () => {
    renderPage()
    // DOG-3 (2026-05-29): hobby_plus + growth live in plans.yaml but used to
    // be FAQ-only. The "Self-serve sign-up at every tier" marketing promise
    // requires that every paid tier be discoverable on the public surface,
    // not buried in an accordion. Pin the inline section + per-tier markers.
    expect(screen.getByTestId('pricing-intermediate-tiers')).toBeTruthy()
    expect(screen.getByTestId('intermediate-tier-hobby_plus')).toBeTruthy()
    expect(screen.getByTestId('intermediate-tier-growth')).toBeTruthy()
    const body = document.body.textContent ?? ''
    expect(body).toContain('Hobby Plus · $19/mo')
    expect(body).toContain('Growth · $99/mo')
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
