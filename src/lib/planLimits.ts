// planLimits — the dashboard's single, registry-shaped mirror of the per-tier
// numeric caps the Overview tiles bind to.
//
// WHY THIS FILE EXISTS (rule 18 — registry-iterating, not hand-typed-at-call-site):
// Before this, the Overview "connection limit" and "storage" tiles derived
// their numbers from per-RESOURCE fields (`connections_limit` / `storage_limit_bytes`)
// summed across the user's live resources. That produced two confirmed bugs on
// real dashboards:
//
//   1. CONNECTION LIMIT showed "∞ unlimited" for a Pro user. The summing logic
//      flipped the whole tile to ∞ the moment ANY resource carried
//      connections_limit < 0 — and queue/redis/storage/webhook resources are
//      legitimately -1 (connection caps don't apply to them). So a Pro user
//      (real cap: 20 Postgres connections) with a single Redis saw ∞.
//
//   2. STORAGE denominator showed a conflated SUM of every per-service cap
//      (e.g. 50 GB object + 10 GB pg + 5 GB mongo + 10 GB vector + queue …
//      ≈ 81.3 GiB) presented under one "STORAGE" label. Pro's object-storage
//      cap is 50 GB; the tile must reflect object storage specifically, not a
//      sum across unlike services.
//
// The honest fix is to bind each tile to the TIER's published cap, not to a
// derived per-resource sum. The source of truth is api/plans.yaml. The
// `PLAN_LIMITS` table below mirrors it; the matching test
// (planLimits.test.ts) iterates EVERY tier in the `Tier` union so a future
// tier (or a renamed one) can't silently fall through to a wrong number.
//
// Connection semantics: only the connection-BEARING services (postgres,
// mongodb, vector) have a finite per-tier connection cap. redis / queue /
// storage / webhook do not take SQL-style connections — their per-resource
// connections_limit is -1 by design and must NOT be read as "the tier is
// unlimited". The connection tile therefore shows the connection-bearing cap
// (postgres == mongodb == vector on every tier today) and is only "∞" when
// that cap is itself -1 in plans.yaml (no tier is, post strict-80% redesign).

import type { Tier } from '../api'

const MB_PER_GB = 1024

export interface PlanLimits {
  /** Per-connection-bearing-service connection cap (postgres/mongodb/vector).
   *  -1 means unlimited. plans.yaml: postgres_connections / mongodb_connections /
   *  vector_connections — equal on every tier today. */
  connections: number
  /** Object-storage cap in MB. plans.yaml: storage_storage_mb. -1 = unlimited
   *  (no tier today). This is the OBJECT-STORE cap only — never a sum across
   *  postgres / mongodb / vector / queue. */
  objectStorageMB: number
}

// PLAN_LIMITS — mirror of api/plans.yaml. Keep in lock-step with that file
// (rule 22: a tier/limit change touches plans.yaml AND this mirror). Every
// member of the `Tier` union MUST have a row — planLimits.test.ts fails if one
// is missing, so a new tier can't ship a tile bound to the fallback.
//
// connections column source (plans.yaml, verified 2026-06-11 @ origin/master):
//   anonymous/free  postgres_connections=2   storage_storage_mb=10
//   hobby           postgres_connections=8   storage_storage_mb=512
//   hobby_plus      postgres_connections=8   storage_storage_mb=5120
//   pro             postgres_connections=20  storage_storage_mb=51200  (50 GB)
//   growth          postgres_connections=20  storage_storage_mb=153600 (150 GB)
//   team            postgres_connections=100 storage_storage_mb=307200 (300 GB)
export const PLAN_LIMITS: Record<Tier, PlanLimits> = {
  anonymous:  { connections: 2,   objectStorageMB: 10 },
  free:       { connections: 2,   objectStorageMB: 10 },
  hobby:      { connections: 8,   objectStorageMB: 512 },
  hobby_plus: { connections: 8,   objectStorageMB: 5120 },
  pro:        { connections: 20,  objectStorageMB: 51200 },
  growth:     { connections: 20,  objectStorageMB: 153600 },
  team:       { connections: 100, objectStorageMB: 307200 },
}

// Fallback used only when the live tier string is somehow outside the union
// (defensive — TS guarantees the union, but the wire could in theory send a
// future tier the build doesn't know yet). Free is the safest assumption: it
// understates rather than overstates the user's ceiling.
const FALLBACK: PlanLimits = PLAN_LIMITS.free

export function planLimitsFor(tier: Tier | string | undefined | null): PlanLimits {
  if (tier && tier in PLAN_LIMITS) return PLAN_LIMITS[tier as Tier]
  return FALLBACK
}

/** The connection-bearing connection cap for a tier. -1 → unlimited. */
export function connectionLimitFor(tier: Tier | string | undefined | null): number {
  return planLimitsFor(tier).connections
}

/** The object-storage cap for a tier, in MB. -1 → unlimited. */
export function objectStorageLimitMBFor(tier: Tier | string | undefined | null): number {
  return planLimitsFor(tier).objectStorageMB
}

/** Object-storage cap as a GB number (decimal-GB to match how plans.yaml /
 *  the pricing page talk about "50 GB"). -1 stays -1 (unlimited). */
export function objectStorageLimitGBFor(tier: Tier | string | undefined | null): number {
  const mb = objectStorageLimitMBFor(tier)
  return mb < 0 ? -1 : mb / MB_PER_GB
}
