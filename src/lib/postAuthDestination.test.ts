/* postAuthDestination.test.ts — exhaustive per-tier + next-precedence
 * coverage for the commerce-first redirect decision (2026-06-10).
 *
 * The matrix this pins:
 *   tier=free                      → /pricing
 *   tier∈{hobby,hobby_plus,pro,growth} → /app/billing
 *   tier=team                      → /app   (top tier, NEVER a Team checkout)
 *   tier∈{anonymous,'',unknown}    → /app   (degrade — no commerce push)
 *   any explicit safe `next`       → next   (deep-link always wins)
 *   unsafe `next` (off-origin/protocol-relative) → falls through to tier rule
 */

import { describe, it, expect } from 'vitest'
import { TIER_RANK, type Tier } from '../api'
import {
  postAuthDestination,
  isSafeInternalNext,
  DEST_PRICING,
  DEST_BILLING,
  DEST_DASHBOARD,
} from './postAuthDestination'

describe('postAuthDestination — per-tier landing (no next)', () => {
  it('free → /pricing (drive the first purchase)', () => {
    expect(postAuthDestination('free')).toBe(DEST_PRICING)
    expect(DEST_PRICING).toBe('/pricing')
  })

  it.each<Tier>(['hobby', 'hobby_plus', 'pro', 'growth'])(
    'paid+upgrade-eligible tier %s → /app/billing',
    (tier) => {
      expect(postAuthDestination(tier)).toBe(DEST_BILLING)
    },
  )

  it('team (top tier) → /app, NEVER a Team checkout', () => {
    expect(postAuthDestination('team')).toBe(DEST_DASHBOARD)
    // Hard guard: a team user must never be sent to a billing/pricing
    // commerce surface (Team is gated / contact-sales).
    expect(postAuthDestination('team')).not.toBe(DEST_BILLING)
    expect(postAuthDestination('team')).not.toBe(DEST_PRICING)
  })

  it('anonymous → /app (shouldn’t reach here post-auth; degrade safely)', () => {
    expect(postAuthDestination('anonymous')).toBe(DEST_DASHBOARD)
  })

  it.each(['', 'enterprise', 'mystery_tier', null, undefined])(
    'unknown/empty tier %p → /app (degrade, never upsell blind)',
    (tier) => {
      expect(postAuthDestination(tier as any)).toBe(DEST_DASHBOARD)
    },
  )

  // Registry-iterating regression test (rule 18): every tier in the canonical
  // ladder resolves to exactly one of the three known destinations — a future
  // tier added to TIER_RANK can never resolve to an unexpected/empty path or
  // (critically) to a commerce surface for the top tier.
  it('every tier in TIER_RANK resolves to a known, non-Team-checkout destination', () => {
    const allowed = new Set([DEST_PRICING, DEST_BILLING, DEST_DASHBOARD])
    for (const tier of Object.keys(TIER_RANK)) {
      const dest = postAuthDestination(tier)
      expect(allowed.has(dest)).toBe(true)
      // The top tier is NEVER routed to a purchase surface.
      if (tier === 'team') {
        expect(dest).toBe(DEST_DASHBOARD)
      }
    }
  })
})

describe('postAuthDestination — explicit next precedence', () => {
  it.each<Tier>(['anonymous', 'free', 'hobby', 'hobby_plus', 'pro', 'growth', 'team'])(
    'a safe internal next overrides the %s tier rule (deep-link wins)',
    (tier) => {
      expect(postAuthDestination(tier, '/app/checkout?plan=pro')).toBe('/app/checkout?plan=pro')
    },
  )

  it('honours a saved return_to deep-link to /app/billing', () => {
    expect(postAuthDestination('free', '/app/billing')).toBe('/app/billing')
  })

  it('honours a deep-link to /pricing itself without looping back to a tier rule', () => {
    // A user explicitly headed to /pricing must land on /pricing regardless of
    // tier — this is the anti-loop guarantee (pricing→login→pricing).
    expect(postAuthDestination('pro', '/pricing')).toBe('/pricing')
  })

  it('ignores an empty next and falls through to the tier rule', () => {
    expect(postAuthDestination('free', '')).toBe(DEST_PRICING)
    expect(postAuthDestination('pro', null)).toBe(DEST_BILLING)
    expect(postAuthDestination('team', undefined)).toBe(DEST_DASHBOARD)
  })

  it('ignores an off-origin next (absolute URL) and falls through to the tier rule', () => {
    expect(postAuthDestination('free', 'https://evil.example.com')).toBe(DEST_PRICING)
    expect(postAuthDestination('pro', 'http://evil.example.com/app')).toBe(DEST_BILLING)
  })

  it('ignores a protocol-relative next ("//host") and falls through to the tier rule', () => {
    expect(postAuthDestination('free', '//evil.example.com/app')).toBe(DEST_PRICING)
  })

  it('ignores a relative (non-slash-prefixed) next and falls through', () => {
    expect(postAuthDestination('team', 'app/billing')).toBe(DEST_DASHBOARD)
  })
})

describe('isSafeInternalNext', () => {
  it.each(['/app', '/app/billing', '/pricing', '/app/checkout?plan=pro&frequency=monthly'])(
    'accepts safe internal path %p',
    (next) => {
      expect(isSafeInternalNext(next)).toBe(true)
    },
  )

  it.each(['', null, undefined, 'app/billing', 'https://x.com', 'http://x.com', '//x.com', 'javascript:alert(1)'])(
    'rejects unsafe/empty next %p',
    (next) => {
      expect(isSafeInternalNext(next as any)).toBe(false)
    },
  )
})
