/* currency.test.ts — coverage for the defensive invoice-rendering helpers
 * introduced by BugBash T15-P1-4 (2026-05-20).
 *
 * The old BillingPage.tsx rendered `${(i.amount_cents/100).toFixed(2)}` and
 * `new Date(i.issued_at).toLocaleDateString()` unguarded. A partial/legacy
 * Razorpay invoice row produced `$NaN` and the literal string `Invalid Date`
 * — a money UI showing those values destroys trust on contact. These tests
 * pin the defensive fallbacks (formatInvoiceAmount, formatInvoiceDate) so
 * the unguarded pattern can't quietly come back.
 *
 * Existing formatINR / formatUSD / formatMoney behaviour is already exercised
 * via the BillingPage.test.tsx fixture set; this file focuses on the helpers
 * the bug-bash report flagged.
 */

import { describe, it, expect } from 'vitest'
import {
  formatInvoiceAmount,
  formatInvoiceDate,
  resolveInrToUsd,
  INR_TO_USD,
} from './currency'

describe('formatInvoiceAmount — BugBash T15-P1-4 regression gate', () => {
  it('renders a finite cents value as $X.XX', () => {
    expect(formatInvoiceAmount(4900)).toBe('$49.00')
    expect(formatInvoiceAmount(900)).toBe('$9.00')
    expect(formatInvoiceAmount(123)).toBe('$1.23')
    expect(formatInvoiceAmount(0)).toBe('$0.00')
  })

  it('renders large amounts without locale grouping (matches existing UI)', () => {
    // The previous code path did not group thousands; preserving that so the
    // visual layout doesn't shift the moment a customer hits $1,000.
    expect(formatInvoiceAmount(100000)).toBe('$1000.00')
  })

  // ── regression cases — pre-fix these all rendered `$NaN`. ──
  it('returns em-dash for null', () => {
    expect(formatInvoiceAmount(null)).toBe('—')
  })

  it('returns em-dash for undefined', () => {
    expect(formatInvoiceAmount(undefined)).toBe('—')
  })

  it('returns em-dash for NaN', () => {
    expect(formatInvoiceAmount(NaN)).toBe('—')
  })

  it('returns em-dash for Infinity / -Infinity', () => {
    expect(formatInvoiceAmount(Infinity)).toBe('—')
    expect(formatInvoiceAmount(-Infinity)).toBe('—')
  })

  it('renders negative amounts (refund) as -$X.XX rather than em-dash', () => {
    // A real refund row shouldn't be hidden — only non-finite values should.
    expect(formatInvoiceAmount(-2500)).toBe('$-25.00')
  })
})

describe('formatInvoiceDate — BugBash T15-P1-4 regression gate', () => {
  it('renders a valid ISO string as a locale date', () => {
    const out = formatInvoiceDate('2026-05-22T00:00:00Z')
    // toLocaleDateString() is locale/tz dependent — assert it produced a
    // non-empty, non-fallback string.
    expect(out).not.toBe('—')
    expect(out).not.toBe('Invalid Date')
    expect(out.length).toBeGreaterThan(0)
  })

  // ── regression cases — pre-fix these all rendered the literal
  // user-facing string "Invalid Date". ──
  it('returns em-dash for null', () => {
    expect(formatInvoiceDate(null)).toBe('—')
  })

  it('returns em-dash for undefined', () => {
    expect(formatInvoiceDate(undefined)).toBe('—')
  })

  it('returns em-dash for an empty string', () => {
    expect(formatInvoiceDate('')).toBe('—')
  })

  it('returns em-dash for a malformed date string', () => {
    expect(formatInvoiceDate('not-a-date')).toBe('—')
    expect(formatInvoiceDate('2026-13-45')).toBe('—')
    expect(formatInvoiceDate('🍕')).toBe('—')
  })
})

describe('resolveInrToUsd — pre-existing helper, retained sanity', () => {
  it('falls back to the static default for missing input', () => {
    expect(resolveInrToUsd(null)).toBe(INR_TO_USD)
    expect(resolveInrToUsd(undefined)).toBe(INR_TO_USD)
    expect(resolveInrToUsd('')).toBe(INR_TO_USD)
  })

  it('honours a positive numeric override', () => {
    expect(resolveInrToUsd('0.015')).toBe(0.015)
    expect(resolveInrToUsd(0.013)).toBe(0.013)
  })

  it('rejects non-positive overrides', () => {
    expect(resolveInrToUsd('-1')).toBe(INR_TO_USD)
    expect(resolveInrToUsd(0)).toBe(INR_TO_USD)
    expect(resolveInrToUsd('garbage')).toBe(INR_TO_USD)
  })
})
