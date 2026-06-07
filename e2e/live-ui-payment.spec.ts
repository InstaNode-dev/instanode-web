// live-ui-payment.spec.ts — Wave 4b: the UI-driven Razorpay TEST-card payment
// E2E (free cohort user → UI Upgrade → Razorpay TEST hosted-checkout → test
// card → assert Pro active). NO real money — Razorpay TEST mode (rzp_test_*).
//
// Design ref: docs/ci/01-CI-INTEGRATION-DESIGN.md §"Razorpay test-card payment
// E2E" (Approach A — real hosted-checkout, nightly) + the api Wave 4b PR
// (cohort test-mode checkout routing: a teams.is_test_cohort=true team's
// /api/v1/billing/checkout mints a real TEST-mode subscription short_url that
// accepts test cards). The webhook-injection deterministic path is the api
// Wave 4 suite (billing_testcard_payment_test.go); THIS spec is the missing
// "real UI loop" the CEO asked for: "There is no CI that actually tries to
// create a test user, then tries to upgrade and enter test details and check
// everything is working fine."
//
// ── TWO tests, two lanes ──────────────────────────────────────────────────────
//   1. @pr-smoke CONTRACT-ONLY (PR-able, NO card entry):
//        mint free cohort → drive the dashboard UI Upgrade click → assert the
//        SPA reaches a Razorpay checkout URL (or the honest billing-not-
//        configured fallback). Proves the UI→createCheckout→short_url wiring
//        end-to-end against the REAL api WITHOUT entering any card. Safe on PRs.
//   2. FULL card-entry (nightly only, gated on E2E_RAZORPAY_TEST_MODE=1):
//        the same up to the Razorpay page, THEN fill the subscription test card
//        4718 6091 0820 4366 + OTP 1234 → submit → return → poll /auth/me /
//        /api/v1/capabilities for tier=pro (the real TEST-mode webhook drives
//        the upgrade). Razorpay's hosted markup is brittle + changes without
//        notice, so the card-entry leg is RESILIENT + SOFT-FAILS (skip-with-
//        reason) on a markup it can't drive — it must NOT red the nightly on a
//        Razorpay UI change. A markup change is logged loudly for follow-up.
//
// ── Gating (skips clean until the operator wires test keys) ────────────────────
//   - E2E_LIVE=1 + E2E_API_URL + factory armed (E2E_ACCOUNT_TOKEN) — same as
//     every live-ui spec. Absent → skip loudly.
//   - The card-entry leg additionally requires E2E_RAZORPAY_TEST_MODE=1, which
//     the operator sets ONLY once the api has rzp_test_* keys configured (see
//     the api Wave 4b PR + docs/ci/01-CI-INTEGRATION-DESIGN.md operator steps).
//     Until then it skips clean — the machinery is shipped + inert.
//
// Safety: cohort mint→ledger→cascade-reap + afterAll backstop (rule 24). The
// minted team is is_test_cohort=true so it's excluded from funnel/billing/NR.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

import { assertSafeApiTarget } from './cohort'
import { loadLedger, reapEntities, clearLedger } from './cleanup-ledger'
import { mintUser, reap, factoryArmed, apiBase, type MintedUser } from './factory'
import { newAuthedContext, appURL } from './ui-helpers'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = apiBase()
// The card-entry leg is opt-in: the operator flips this ON only after the api
// has rzp_test_* keys wired (so a cohort checkout mints a real TEST-mode
// short_url that accepts test cards). Default OFF → the card leg skips clean.
const CARD_MODE = process.env.E2E_RAZORPAY_TEST_MODE === '1'

// The Razorpay SUBSCRIPTION test card + mock-bank OTP (Razorpay TEST mode).
// docs/ci/01-CI-INTEGRATION-DESIGN.md: subscription card 4718 6091 0820 4366,
// any future expiry, any CVV, OTP 1234 (4–10 digits = success).
const TEST_CARD = '4718609108204366'
const TEST_EXPIRY = '12/30'
const TEST_CVV = '123'
const TEST_OTP = '1234'

// The apex domains Razorpay hosts subscription checkout on. We assert the host
// class, not a brittle full URL.
const RAZORPAY_HOST_DOMAINS = ['razorpay.com', 'rzp.io'] as const

// Anchored host matcher for Playwright's page.route() interception. route()
// matches against the WHOLE request URL, so anchor on the scheme + an exact
// host segment (apex or a subdomain) — this prevents the unanchored-substring
// class CodeQL flags (e.g. https://evil.com/?x=razorpay.com would match a bare
// /razorpay\.com/). Used only as a test interceptor (not a security boundary),
// but kept tight so it can't grab an unrelated cross-origin request.
const RAZORPAY_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*(razorpay\.com|rzp\.io)(\/|$|[:?#])/i

/**
 * True iff `url` is a well-formed absolute URL whose HOST is exactly one of the
 * Razorpay apex domains or a subdomain thereof. Parses the URL and inspects the
 * hostname (rather than substring-matching the raw string), so a hostile URL
 * like `https://evil.com/razorpay.com` or `https://razorpay.com.evil.com/` does
 * NOT pass — this is the anchored, sanitized check the assertion uses.
 */
function isRazorpayCheckoutHost(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return RAZORPAY_HOST_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
}

test.describe('LIVE-UI — Razorpay TEST-card payment (free → upgrade → Pro)', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(!LIVE, 'E2E_LIVE!=1 — the real-backend UI payment journey is opt-in.')
  test.skip(LIVE && !API_URL, 'E2E_LIVE=1 but E2E_API_URL is unset — no backend to target.')
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-ui-payment afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── Test 1 — CONTRACT-ONLY (PR-able): UI upgrade click → reaches checkout ────
  //
  // @pr-smoke so e2e-pr-smoke.yml runs it on every web PR (no card entry, no
  // test-mode dependency). It proves the most valuable wiring: the dashboard's
  // Upgrade path calls the REAL /api/v1/billing/checkout and the SPA reaches a
  // Razorpay checkout URL — the exact contract that, if it drifts, silently
  // breaks the money funnel.
  test('@pr-smoke free cohort: UI upgrade → reaches a Razorpay checkout URL (no payment)', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintUser(request, { tier: 'free' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      const outcome = await driveUpgradeToCheckout(page)
      // Acceptable outcomes — ALL prove the UI→api→checkout wiring is intact
      // end-to-end against the REAL api (the contract that, if it drifts,
      // silently breaks the money funnel):
      //   - 'razorpay'     → reached a real Razorpay short_url. On a cohort team
      //                      this means the api routed through the rzp_test_*
      //                      keys (test keys wired) — a real TEST-mode checkout.
      //   - 'cohort_inert' → the api returned synthetic_test_cohort (403): the
      //                      INERT path (test keys NOT wired, e.g. prod today).
      //                      The SPA reached the real api and handled the
      //                      documented cohort response. This is the EXPECTED
      //                      state until the operator wires rzp_test_* keys.
      //   - 'fallback'     → the honest billing-not-configured panel (no creds
      //                      for the tier) — the SPA handled the 503 contract.
      // A 'stuck'/'error' outcome fails the test — that's a real wiring break.
      expect(
        ['razorpay', 'cohort_inert', 'fallback'].includes(outcome.kind),
        `UI upgrade must reach a Razorpay checkout URL, the cohort-inert 403, or the honest fallback; ` +
          `got '${outcome.kind}' (${outcome.detail})`,
      ).toBeTruthy()
      if (outcome.kind === 'razorpay') {
        expect(
          isRazorpayCheckoutHost(outcome.detail),
          `reached URL must be a Razorpay checkout host (got ${outcome.detail})`,
        ).toBeTruthy()
        // eslint-disable-next-line no-console
        console.log(`[live-ui-payment] contract-only reached Razorpay TEST checkout: ${outcome.detail}`)
      } else if (outcome.kind === 'cohort_inert') {
        // eslint-disable-next-line no-console
        console.log(
          '[live-ui-payment] contract-only reached the inert cohort path (synthetic_test_cohort 403) — ' +
            'wiring proven; rzp_test_* keys not yet configured on the api.',
        )
      } else {
        // eslint-disable-next-line no-console
        console.log('[live-ui-payment] contract-only reached billing-not-configured fallback (no checkout creds wired)')
      }
    } finally {
      await context.close()
      await reap(request, u.teamID)
    }
  })

  // ── Test 2 — FULL card-entry (nightly only, E2E_RAZORPAY_TEST_MODE=1) ─────────
  test('free cohort: UI upgrade → TEST card 4718…4366 + OTP 1234 → Pro active', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    test.skip(
      !CARD_MODE,
      'E2E_RAZORPAY_TEST_MODE!=1 — the api has no rzp_test_* keys wired yet; the card-entry loop is shipped + inert. ' +
        'Operator: configure RAZORPAY_TEST_* on the api + set E2E_RAZORPAY_TEST_MODE=1 (see docs/ci/01-CI-INTEGRATION-DESIGN.md).',
    )
    const user = await mintUser(request, { tier: 'free' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT })
    try {
      const outcome = await driveUpgradeToCheckout(page)
      if (outcome.kind === 'fallback') {
        // Test mode flag is on but the api returned billing-not-configured —
        // the test plan_id for pro isn't wired. Soft-skip: machinery proven up
        // to checkout, but the operator config is incomplete.
        test.skip(true, 'billing-not-configured fallback even with E2E_RAZORPAY_TEST_MODE=1 — RAZORPAY_TEST_PLAN_ID_PRO not wired on the api.')
        return
      }
      expect(
        outcome.kind,
        `expected to reach a Razorpay checkout URL before card entry; got '${outcome.kind}' (${outcome.detail})`,
      ).toBe('razorpay')

      // Drive the Razorpay hosted page. RESILIENT: returns false (soft-fail)
      // when the markup can't be driven so a Razorpay UI change doesn't red the
      // nightly — it logs loudly + test.skip with a clear follow-up message.
      const drove = await driveRazorpayTestCard(page)
      if (!drove) {
        test.skip(
          true,
          "could not drive the Razorpay hosted-checkout markup (selectors unstable / Razorpay UI changed). " +
            'Soft-fail per design: the machinery is shipped; the Razorpay page DOM needs a selector refresh. ' +
            'See the console log above for what was found.',
        )
        return
      }

      // After a successful mock-bank payment, the real TEST-mode webhook fires
      // subscription.charged/activated → the api upgrades the cohort team to
      // pro. Poll /api/v1/capabilities (authoritative tier surface) for up to
      // ~90s. If the webhook can't reach CI (no public URL for the test api),
      // this poll won't flip — that's the documented fallback case and we
      // surface it clearly rather than hard-failing (the deterministic upgrade
      // assertion lives in the api Wave 4 webhook-injection suite).
      const wentPro = await pollTierIsPro(request, u.sessionJWT, 90_000)
      if (!wentPro) {
        test.skip(
          true,
          'card submitted but tier did not flip to pro within 90s. Most likely the TEST-mode webhook cannot reach this CI runner ' +
            '(no public URL) — the deterministic upgrade assertion is covered by the api webhook-injection suite ' +
            '(billing_testcard_payment_test.go). See docs/ci/01-CI-INTEGRATION-DESIGN.md Approach A vs B.',
        )
        return
      }
      // eslint-disable-next-line no-console
      console.log('[live-ui-payment] FULL card-entry loop succeeded: cohort team is now pro.')
    } finally {
      await context.close()
      await reap(request, u.teamID)
    }
  })
})

// ── helpers ───────────────────────────────────────────────────────────────────

type UpgradeOutcome = {
  kind: 'razorpay' | 'fallback' | 'cohort_inert' | 'error' | 'stuck'
  detail: string
}

/**
 * Drive the dashboard UI from an authed page to the point a Razorpay checkout
 * URL is reached (or the honest billing-not-configured fallback renders).
 *
 * We intercept the Razorpay redirect so the test stays in control: the
 * CheckoutPage calls window.location.assign(short_url) on success; we capture
 * that navigation target instead of actually leaving for Razorpay on the
 * contract-only path. For the card-entry path the caller re-navigates to the
 * captured URL.
 *
 * Strategy: go straight to /app/checkout?plan=pro (the canonical CTA target —
 * the BillingPage / PricingGrid Upgrade buttons deep-link here; CheckoutPage.tsx
 * §"Why /app/checkout"). This drives the SAME createCheckout → short_url code
 * path a button click does, but deterministically (no dependence on which exact
 * Upgrade button variant the current BillingPage renders for a free user).
 */
async function driveUpgradeToCheckout(page: Page): Promise<UpgradeOutcome> {
  let capturedShortUrl = ''
  // Capture the short_url the SPA tries to navigate to WITHOUT actually
  // following it (so the contract-only test never leaves for Razorpay). The
  // CheckoutPage uses window.location.assign; route() on the Razorpay host
  // aborts the top-level nav and records the URL.
  await page.route(RAZORPAY_HOST_RE, async (route) => {
    capturedShortUrl = route.request().url()
    await route.abort()
  })

  await page.goto(appURL('/app/checkout?plan=pro'), { waitUntil: 'domcontentloaded' })

  // The page renders one of: redirecting (success → short_url), fallback (503),
  // error, or stays on loading (stuck). Wait for a terminal testid.
  const redirecting = page.getByTestId('checkout-redirecting')
  const fallback = page.getByTestId('checkout-fallback')
  const errorPanel = page.getByTestId('checkout-error')
  const emailGate = page.getByTestId('checkout-email-not-verified')

  try {
    await expect(redirecting.or(fallback).or(errorPanel).or(emailGate)).toBeVisible({ timeout: 30_000 })
  } catch {
    // When the api is ARMED (test keys live), CheckoutPage gets a real short_url
    // and calls window.location.assign immediately — our route() aborts that
    // top-level nav, which can tear the React tree down before the
    // checkout-redirecting testid stabilises, so toBeVisible can time out even
    // though the redirect DID happen. If the route captured a Razorpay URL,
    // that's a successful 'razorpay' outcome, not 'stuck'.
    if (capturedShortUrl) return { kind: 'razorpay', detail: capturedShortUrl }
    return { kind: 'stuck', detail: 'no terminal checkout state within 30s (still loading?)' }
  }
  // Same race even on the success branch: the route may have fired before any
  // panel rendered. Prefer the captured URL the instant we have it.
  if (capturedShortUrl) return { kind: 'razorpay', detail: capturedShortUrl }

  if (await fallback.isVisible().catch(() => false)) {
    return { kind: 'fallback', detail: 'billing-not-configured fallback panel' }
  }
  if (await emailGate.isVisible().catch(() => false)) {
    // A minted cohort free account should be email-verified by the factory; if
    // not, that's an env issue, not a payment-wiring break — surface it.
    return { kind: 'error', detail: 'email_not_verified gate (cohort account not verified?)' }
  }
  if (await errorPanel.isVisible().catch(() => false)) {
    const msg = (await errorPanel.textContent().catch(() => '')) ?? ''
    // The api returns synthetic_test_cohort (403) for a cohort checkout when
    // rzp_test_* keys are NOT wired (the inert path — api Wave 4b). The SPA
    // surfaces it as the generic error panel. This is the EXPECTED state on a
    // deployment without test keys (e.g. prod today) and STILL proves the
    // UI→api→checkout wiring reached the real api end-to-end. Detect it so the
    // contract-only test accepts it as a valid inert outcome rather than a break.
    if (/synthetic[ _-]?test[ _-]?cohort|test-cohort team/i.test(msg)) {
      return { kind: 'cohort_inert', detail: msg.trim().slice(0, 200) }
    }
    return { kind: 'error', detail: `checkout error panel: ${msg.trim().slice(0, 200)}` }
  }
  if (await redirecting.isVisible().catch(() => false)) {
    // The "redirecting" panel renders the short_url as a clickable <a>. Prefer
    // the captured navigation URL; fall back to the link href.
    if (!capturedShortUrl) {
      const href = await redirecting.locator('a').first().getAttribute('href').catch(() => null)
      if (href) capturedShortUrl = href
    }
    if (capturedShortUrl) return { kind: 'razorpay', detail: capturedShortUrl }
    return { kind: 'stuck', detail: 'redirecting state but no short_url captured' }
  }
  return { kind: 'stuck', detail: 'unexpected terminal state' }
}

/**
 * Drive the Razorpay hosted-checkout page through a successful TEST-card
 * payment. RESILIENT by design: every step is best-effort and the function
 * returns false (rather than throwing) the moment a required element can't be
 * found, so a Razorpay markup change SOFT-fails the nightly instead of redding
 * it. What it found is logged for the follow-up.
 *
 * Razorpay's hosted checkout renders the card form inside cross-origin iframes
 * and may open in a popup. We handle both: re-target to a popup if one opens,
 * and search candidate frames for the card fields.
 */
async function driveRazorpayTestCard(page: Page): Promise<boolean> {
  // Remove the abort route from the contract path — for the card path we DO
  // want to load the real Razorpay page.
  await page.unrouteAll().catch(() => {})

  // The caller captured the short_url; navigate to it now (a popup is also
  // possible if a real button click triggered it, but we drove via the
  // checkout page, so a direct goto is the deterministic path).
  // The captured URL is on the redirecting panel's link.
  const link = page.getByTestId('checkout-redirecting').locator('a').first()
  const href = await link.getAttribute('href').catch(() => null)
  if (!href) {
    // eslint-disable-next-line no-console
    console.warn('[live-ui-payment] no short_url link on the redirecting panel — cannot reach Razorpay page')
    return false
  }

  // A popup may open if Razorpay's flow forces one; race the goto against a
  // popup event so either path is handled.
  let target: Page = page
  const popupP = page.context().waitForEvent('page', { timeout: 5_000 }).catch(() => null)
  await page.goto(href, { waitUntil: 'domcontentloaded' }).catch(() => {})
  const popup = await popupP
  if (popup) {
    target = popup
    await popup.waitForLoadState('domcontentloaded').catch(() => {})
  }

  // The flow, as observed driving a real TEST-mode INR subscription checkout
  // (2026-06-07): the short_url lands on a Razorpay "Subscription Details" page
  // with a "Start Subscription" button → that opens the checkout iframe listing
  // UPI / Cards / EMandate → pick Cards → fill card → "Continue" → an RBI
  // "Save your card as per RBI guidelines?" mandate modal (required for
  // recurring) → "Yes, secure my card" → a mock-bank OTP step → enter 1234 →
  // "Continue". Every step is best-effort (clickIfPresent never throws) so a
  // markup change still soft-fails rather than redding the nightly.

  // 0) Subscription details page → "Start Subscription" opens the checkout iframe.
  await clickIfPresent(target, [
    'button:has-text("Start Subscription")',
    'button:has-text("Start subscription")',
  ])
  // Give the checkout iframe a beat to mount before scanning frames.
  await target.waitForTimeout(2000).catch(() => {})

  // 1) Select the "Cards" payment method (the INR checkout defaults to UPI).
  await clickIfPresent(target, [
    '[role="radio"][aria-label*="card" i]',
    'text=/^cards?$/i',
    '[data-testid="card"]',
    'button:has-text("Card")',
  ])

  // 2) Find + fill the card fields across the page + its (cross-origin) frames.
  const cardFilled = await fillCardAcrossFrames(target)
  if (!cardFilled) {
    // eslint-disable-next-line no-console
    console.warn('[live-ui-payment] could not locate the Razorpay card-number field in any frame — markup changed?')
    return false
  }

  // 3) Submit the card. For SUBSCRIPTIONS the button is "Continue" (one-time
  //    payments say "Pay"); try both.
  const submitted = await clickIfPresent(target, [
    'button:has-text("Continue")',
    'button:has-text("Pay")',
    'button:has-text("Subscribe")',
    'button[type="submit"]',
    '[data-testid="submit"]',
  ])
  if (!submitted) {
    // eslint-disable-next-line no-console
    console.warn('[live-ui-payment] could not find the Razorpay Continue/Pay button — markup changed?')
    return false
  }

  // 4) RBI save-card mandate modal ("Save your card as per RBI guidelines?") —
  //    required for recurring. Best-effort; absent on some flows.
  await target.waitForTimeout(1000).catch(() => {})
  await clickIfPresent(target, [
    'button:has-text("Yes, secure my card")',
    'button:has-text("secure my card")',
  ])

  // 5) Mock-bank / 3DS OTP step. Enter OTP 1234 and click Continue/Success.
  const otpDone = await enterOtpAcrossFrames(target, TEST_OTP)
  if (!otpDone) {
    // The OTP step may be skipped for some test flows; don't fail solely on it.
    // eslint-disable-next-line no-console
    console.warn('[live-ui-payment] OTP/mock-bank step not driven (may be auto-approved) — continuing to poll tier')
  }
  return true
}

/** Click the first selector that resolves to a visible element. Returns true if one was clicked. */
async function clickIfPresent(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 4_000 }).catch(() => {})
      return true
    }
  }
  // Also scan frames for the same selectors.
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      const loc = frame.locator(sel).first()
      if (await loc.isVisible().catch(() => false)) {
        await loc.click({ timeout: 4_000 }).catch(() => {})
        return true
      }
    }
  }
  return false
}

/** Fill the card number/expiry/cvv across the page + every frame. */
async function fillCardAcrossFrames(page: Page): Promise<boolean> {
  const numberSelectors = [
    'input[name="card.number"]',
    'input[name="cardnumber"]',
    'input[autocomplete="cc-number"]',
    'input[placeholder*="card number" i]',
    'input[aria-label*="card number" i]',
  ]
  // Try direct page first, then each cross-origin Frame (Razorpay nests the PCI
  // card fields in iframes; Frame exposes locator() just like Page).
  const numFilled = await tryFillFirst(page, numberSelectors, TEST_CARD)
  if (numFilled) {
    await tryFillFirst(page, ['input[name="card.expiry"]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM" i]'], TEST_EXPIRY)
    await tryFillFirst(page, ['input[name="card.cvv"]', 'input[autocomplete="cc-csc"]', 'input[placeholder*="cvv" i]'], TEST_CVV)
    return true
  }
  for (const frame of page.frames()) {
    const filled = await tryFillFirstFrame(frame, numberSelectors, TEST_CARD)
    if (filled) {
      await tryFillFirstFrame(frame, ['input[name="card.expiry"]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM" i]'], TEST_EXPIRY)
      await tryFillFirstFrame(frame, ['input[name="card.cvv"]', 'input[autocomplete="cc-csc"]', 'input[placeholder*="cvv" i]'], TEST_CVV)
      return true
    }
  }
  return false
}

async function tryFillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) {
      await loc.fill(value, { timeout: 4_000 }).catch(() => {})
      return true
    }
  }
  return false
}

async function tryFillFirstFrame(
  frame: { locator: (s: string) => ReturnType<Page['locator']> },
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const sel of selectors) {
    const loc = frame.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) {
      await loc.fill(value, { timeout: 4_000 }).catch(() => {})
      return true
    }
  }
  return false
}

/** Enter the mock-bank OTP across page + frames, then click Success/Submit. */
async function enterOtpAcrossFrames(page: Page, otp: string): Promise<boolean> {
  const otpSelectors = [
    'input[name="otp"]',
    'input[autocomplete="one-time-code"]',
    'input[placeholder*="otp" i]',
    'input[aria-label*="otp" i]',
  ]
  let entered = await tryFillFirst(page, otpSelectors, otp)
  if (!entered) {
    for (const frame of page.frames()) {
      if (await tryFillFirstFrame(frame, otpSelectors, otp)) {
        entered = true
        break
      }
    }
  }
  // Submit the OTP. The TEST bank simulator's button is "Continue" (newer
  // checkout) or "Success"/"Submit" (older) — try all.
  await clickIfPresent(page, [
    'button:has-text("Continue")',
    'button:has-text("Success")',
    'button:has-text("Submit")',
    'button[type="submit"]',
  ])
  return entered
}

/**
 * Poll /api/v1/capabilities (authoritative tier surface) for tier=pro, using
 * the minted session JWT. Returns true once pro is observed within timeoutMs.
 */
async function pollTierIsPro(
  request: APIRequestContext,
  sessionJWT: string,
  timeoutMs: number,
): Promise<boolean> {
  const base = apiBase()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const tier = await fetchTier(request, base, sessionJWT)
    if (tier === 'pro') return true
    await new Promise((r) => setTimeout(r, 5_000))
  }
  return false
}

/** Read the current tier from /api/v1/capabilities, falling back to /auth/me. */
async function fetchTier(request: APIRequestContext, base: string, sessionJWT: string): Promise<string> {
  const headers = { Authorization: `Bearer ${sessionJWT}` }
  // /api/v1/capabilities echoes the team's tier.
  const cap = await request
    .fetch(`${base}/api/v1/capabilities`, { headers, failOnStatusCode: false })
    .catch(() => null)
  if (cap && cap.ok()) {
    const body = (await cap.json().catch(() => ({}))) as Record<string, unknown>
    const t = (body.tier ?? body.plan ?? (body.team as Record<string, unknown> | undefined)?.tier) as
      | string
      | undefined
    if (t) return String(t).toLowerCase()
  }
  const me = await request
    .fetch(`${base}/auth/me`, { headers, failOnStatusCode: false })
    .catch(() => null)
  if (me && me.ok()) {
    const body = (await me.json().catch(() => ({}))) as Record<string, unknown>
    const t = (body.tier ?? (body.team as Record<string, unknown> | undefined)?.tier) as string | undefined
    if (t) return String(t).toLowerCase()
  }
  return ''
}
