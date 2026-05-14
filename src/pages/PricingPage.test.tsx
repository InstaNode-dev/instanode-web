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
 *   3. M11 source-of-truth-risk regression: the five tier cards
 *      (anonymous, hobby, hobby_plus, pro, team) are all present. The
 *      pricing matrix is hardcoded today (mirrors api/plans.yaml), so a
 *      silent deletion would ship undetected without this assertion. The
 *      source-of-truth comment block in PricingPage.tsx documents the
 *      coupling explicitly.
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

  it('Hobby Plus monthly CTA points at /app/checkout?plan=hobby_plus&frequency=monthly', () => {
    renderPage()
    const cta = screen.getByTestId('pricing-cta-hobby_plus') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/app/checkout?plan=hobby_plus&frequency=monthly')
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

  it('Hobby Plus yearly CTA points at /app/checkout?plan=hobby_plus&frequency=yearly', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('pricing-frequency-yearly'))
    const cta = screen.getByTestId('pricing-cta-hobby_plus') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/app/checkout?plan=hobby_plus&frequency=yearly')
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

describe('PricingPage — five tier cards present (M11 regression guard)', () => {
  it('renders one card per tier (anonymous / hobby / hobby_plus / pro / team)', () => {
    renderPage()
    // Each tier column has data-tier=<key> on the header cell. Five tiers
    // means five header cells with the unique tier keys.
    for (const tier of ['anonymous', 'hobby', 'hobby_plus', 'pro', 'team']) {
      const headerCells = Array.from(
        document.querySelectorAll(`[role="columnheader"][data-tier="${tier}"]`),
      )
      expect(headerCells.length).toBeGreaterThan(0)
    }
  })

  it('paid-tier CTAs are clickable links (not disabled spans) for hobby / hobby_plus / pro', () => {
    renderPage()
    for (const tier of ['hobby', 'hobby_plus', 'pro']) {
      const cta = screen.getByTestId(`pricing-cta-${tier}`)
      // <a> with href, not <span aria-disabled>.
      expect(cta.tagName).toBe('A')
      expect(cta.getAttribute('href')).toBeTruthy()
    }
  })
})
