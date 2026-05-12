// QuotaWallBanner — Track U1.
//
// Yellow banner above page content that appears when the caller's team
// is approaching the 80% mark on any tier-limit axis (storage,
// connections, or provisions). Backed by GET /api/v1/usage/wall, which
// returns the most recent near_quota_wall audit row written by the
// worker's QuotaWallNudgeWorker.
//
// Dismissibility — localStorage:
//   key = `instanode.quotaWallDismiss.<team_id>`
//   value = JSON({ percent: number, at: string })
//
// The banner is dismissible, but the dismiss anchors to the percent at
// dismiss time. If usage climbs another 5pp after dismiss, the banner
// reappears — the user explicitly said "I see it" at X%, not "ignore
// forever". Keyed by team_id so two teams sharing a browser don't
// share dismisses.
//
// Polling cadence: 5 minutes. The worker writes at most once per 24h
// per team, so this is gentle enough to not generate noise but quick
// enough that a dismissed banner can re-emerge inside one session.

import { useEffect, useState } from 'react'
import * as api from '../api'
import type { QuotaWallResponse } from '../api'

// QUOTA_WALL_POLL_MS — how often the banner refetches /usage/wall after
// mount. 5 minutes balances "user sees the banner reappear inside one
// session if usage climbs" with "we don't hammer the API for a check
// that updates at most once per 24h on the worker side".
const QUOTA_WALL_POLL_MS = 5 * 60 * 1000

// QUOTA_WALL_REAPPEAR_DELTA_PCT — minimum percent-used increase over the
// dismissed value before the banner reappears. 5pp matches the brief —
// "dismissible, but reappears if usage increases another 5pp".
const QUOTA_WALL_REAPPEAR_DELTA_PCT = 5

// QUOTA_WALL_DISMISS_KEY_PREFIX — localStorage key prefix. The full key
// is `${prefix}<team_id>` so per-team dismiss state is isolated even
// when two teams share a browser profile.
const QUOTA_WALL_DISMISS_KEY_PREFIX = 'instanode.quotaWallDismiss.'

// BILLING_PATH — where the Upgrade CTA points. Matches the in-app
// billing surface mounted in App.tsx; the page from there has the
// real Razorpay checkout flow.
const BILLING_PATH = '/app/billing'

type Props = {
  /** Team id the dismiss key is scoped to. When unset (loading) the
   *  banner stays hidden — we don't want to render against a global
   *  dismiss key and leak one team's nudge into another's view. */
  teamId?: string
  /** Optional injected wall payload for tests / Storybook. When
   *  undefined the component fetches /api/v1/usage/wall itself. */
  initialWall?: QuotaWallResponse | null
  /** Disable the network poll. Tests pass true to keep the component
   *  stable across renders. */
  disablePolling?: boolean
}

type DismissState = {
  percent: number
  at: string
}

function readDismiss(teamId: string): DismissState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(QUOTA_WALL_DISMISS_KEY_PREFIX + teamId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DismissState
    if (typeof parsed?.percent === 'number' && typeof parsed?.at === 'string') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function writeDismiss(teamId: string, state: DismissState): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(QUOTA_WALL_DISMISS_KEY_PREFIX + teamId, JSON.stringify(state))
  } catch {
    /* localStorage unavailable — banner just won't be dismissable this session */
  }
}

// shouldRender — pure decision: should the banner render given the
// latest API response and the current localStorage dismiss state?
// Exposed at module scope so the component test can exercise it
// without mounting a tree.
export function shouldRender(wall: QuotaWallResponse | null, dismiss: DismissState | null): boolean {
  if (!wall || !wall.near_wall) return false
  if (!dismiss) return true
  const pct = wall.percent_used ?? 0
  // Reappear once usage climbs ≥ N pp above the dismissed point.
  return pct - dismiss.percent >= QUOTA_WALL_REAPPEAR_DELTA_PCT
}

// formatAxisCopy — turns the raw axis/service/percent into the human
// banner text. Kept tiny on purpose: copy variations live here, not
// scattered through the JSX.
function formatAxisCopy(wall: QuotaWallResponse): string {
  const tier = wall.tier ?? 'your'
  const pct = wall.percent_used ?? 0
  switch (wall.axis) {
    case 'storage': {
      const svc = wall.service ?? 'storage'
      return `You're at ${pct}% of your ${tier} ${svc} storage limit.`
    }
    case 'connections':
      return `You're at ${pct}% of your ${tier} tier connection limit.`
    case 'provisions':
      return `You're at ${pct}% of your ${tier} tier provision limit.`
    default:
      return `You're at ${pct}% of your ${tier} tier limit.`
  }
}

export function QuotaWallBanner({ teamId, initialWall, disablePolling }: Props) {
  const [wall, setWall] = useState<QuotaWallResponse | null>(initialWall ?? null)
  const [dismiss, setDismiss] = useState<DismissState | null>(() =>
    teamId ? readDismiss(teamId) : null,
  )

  // Resync dismiss state if the team changes (rare, but happens on
  // multi-team accounts that switch teams without a full reload).
  useEffect(() => {
    if (!teamId) {
      setDismiss(null)
      return
    }
    setDismiss(readDismiss(teamId))
  }, [teamId])

  useEffect(() => {
    if (disablePolling) return
    let alive = true
    async function tick() {
      try {
        const r = await api.fetchQuotaWall()
        if (!alive) return
        setWall(r)
      } catch {
        // Quiet on failure — banner stays hidden rather than showing a
        // stale state. The dashboard already surfaces auth/API outages
        // elsewhere.
        if (alive) setWall(null)
      }
    }
    // Skip the initial fetch when the parent already passed `initialWall`
    // (tests, prerender). Otherwise fetch on mount + poll on interval.
    if (initialWall === undefined) {
      tick()
    }
    const id = window.setInterval(tick, QUOTA_WALL_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [disablePolling, initialWall])

  if (!shouldRender(wall, dismiss)) return null
  // Non-null guaranteed by shouldRender — fall through is type-narrowed.
  const w = wall!

  function onDismiss() {
    if (!teamId) return
    const next: DismissState = {
      percent: w.percent_used ?? 0,
      at: new Date().toISOString(),
    }
    writeDismiss(teamId, next)
    setDismiss(next)
  }

  return (
    <div
      className="quota-wall-banner"
      role="alert"
      data-testid="quota-wall-banner"
      style={{
        background: 'linear-gradient(90deg, rgba(255,192,105,0.18), rgba(255,192,105,0.10))',
        border: '1px solid rgba(255,192,105,0.35)',
        borderRadius: 8,
        padding: '12px 16px',
        margin: '0 0 16px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        color: 'var(--text-primary, #111)',
        fontSize: 14,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
        ⚠
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{formatAxisCopy(w)}</strong>{' '}
        <span style={{ opacity: 0.85 }}>
          Upgrade for more headroom — keeps your agents shipping without quota errors.
        </span>
      </div>
      <a
        href={BILLING_PATH}
        className="quota-wall-cta"
        data-testid="quota-wall-upgrade"
        style={{
          background: 'rgba(255,192,105,0.85)',
          color: '#1a1304',
          padding: '6px 12px',
          borderRadius: 6,
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Upgrade
      </a>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss quota wall banner"
        data-testid="quota-wall-dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          opacity: 0.6,
          cursor: 'pointer',
          padding: '0 4px',
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
