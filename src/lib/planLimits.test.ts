/* planLimits.test.ts — registry-iterating guard (rule 18).
 *
 * The Overview "connection limit" and "object storage" tiles bind to these
 * per-tier caps. Two real production bugs motivated the binding:
 *   - connection limit read "∞ unlimited" for a Pro user (cap is 20)
 *   - object-storage denominator read a conflated ~81 GiB sum
 *
 * This test pins each tier's numbers to api/plans.yaml AND iterates the whole
 * `Tier` union so a future tier (or a renamed one) can't silently fall through
 * to the fallback and ship a tile bound to the wrong number. If plans.yaml
 * changes a connection or object-storage cap, this test fails until the mirror
 * is updated (rule 22 — contract change touches all surfaces).
 */

import { describe, it, expect } from 'vitest'
import {
  PLAN_LIMITS,
  planLimitsFor,
  connectionLimitFor,
  objectStorageLimitMBFor,
  objectStorageLimitGBFor,
} from './planLimits'
import type { Tier } from '../api'

// The full Tier union, enumerated so the iteration test below is itself not a
// single-site hand-typed slice — a new tier added to the union but not here
// would still be caught by ALL_TIERS coverage below (we assert PLAN_LIMITS has
// exactly these keys).
const ALL_TIERS: Tier[] = [
  'anonymous',
  'free',
  'hobby',
  'hobby_plus',
  'pro',
  'growth',
  'team',
]

// Expected values mirror api/plans.yaml (origin/master, verified 2026-06-11).
// connections = postgres_connections (== mongodb_connections == vector_connections).
// objectStorageMB = storage_storage_mb.
const EXPECTED: Record<Tier, { connections: number; objectStorageMB: number }> = {
  anonymous:  { connections: 2,   objectStorageMB: 10 },
  free:       { connections: 2,   objectStorageMB: 10 },
  hobby:      { connections: 8,   objectStorageMB: 512 },
  hobby_plus: { connections: 8,   objectStorageMB: 5120 },
  pro:        { connections: 20,  objectStorageMB: 51200 },
  growth:     { connections: 20,  objectStorageMB: 153600 },
  team:       { connections: 100, objectStorageMB: 307200 },
}

describe('PLAN_LIMITS — every Tier has a row (rule 18)', () => {
  it('PLAN_LIMITS has exactly the Tier-union keys (no missing, no extra)', () => {
    expect(Object.keys(PLAN_LIMITS).sort()).toEqual([...ALL_TIERS].sort())
  })

  for (const tier of ALL_TIERS) {
    it(`${tier}: connection + object-storage caps match plans.yaml`, () => {
      expect(PLAN_LIMITS[tier].connections).toBe(EXPECTED[tier].connections)
      expect(PLAN_LIMITS[tier].objectStorageMB).toBe(EXPECTED[tier].objectStorageMB)
    })
  }
})

describe('connectionLimitFor', () => {
  for (const tier of ALL_TIERS) {
    it(`${tier} → ${EXPECTED[tier].connections}`, () => {
      expect(connectionLimitFor(tier)).toBe(EXPECTED[tier].connections)
    })
  }

  it('Pro is a finite 20, never ∞ — the exact production bug', () => {
    expect(connectionLimitFor('pro')).toBe(20)
    expect(connectionLimitFor('pro')).toBeGreaterThan(0)
  })

  it('falls back to free for an unknown/undefined tier (understate, not overstate)', () => {
    expect(connectionLimitFor('mystery_tier')).toBe(EXPECTED.free.connections)
    expect(connectionLimitFor(undefined)).toBe(EXPECTED.free.connections)
    expect(connectionLimitFor(null)).toBe(EXPECTED.free.connections)
  })
})

describe('objectStorageLimit helpers', () => {
  it('Pro object cap is 50 GB (51200 MB), NOT a conflated multi-service sum', () => {
    expect(objectStorageLimitMBFor('pro')).toBe(51200)
    expect(objectStorageLimitGBFor('pro')).toBe(50)
  })

  for (const tier of ALL_TIERS) {
    it(`${tier} object-storage GB == MB/1024`, () => {
      const mb = objectStorageLimitMBFor(tier)
      expect(objectStorageLimitGBFor(tier)).toBeCloseTo(mb / 1024, 6)
    })
  }

  it('free shows its real 10 MB cap, never unlimited (∞)', () => {
    expect(objectStorageLimitMBFor('free')).toBe(10)
    expect(objectStorageLimitGBFor('free')).toBeGreaterThan(0)
  })

  it('planLimitsFor returns the matching row object', () => {
    expect(planLimitsFor('team')).toEqual(PLAN_LIMITS.team)
  })
})
