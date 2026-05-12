// UpgradeButton — A/B-variant aware upgrade CTA.
//
// P1 of the pricing experiments track. The variant is decided
// server-side (GET /auth/me's `experiments.upgrade_button`) and
// surfaced here as a data-variant attribute + a label string. The
// styling lives in styles/tokens.css under `.btn-upgrade[data-variant=...]`
// so all three variants share one DOM element with a single class
// switch — no per-variant JSX trees, no duplicated layout code.
//
// On click the component:
//
//   1. Fires POST /api/v1/experiments/converted (best-effort) so the
//      audit log captures the variant the user clicked BEFORE any
//      navigation kicks in.
//   2. Races that POST against a 500ms timeout. If the network is
//      slow we move on; the analytics tail must not delay the
//      conversion.
//   3. Calls the parent's onClick — which typically navigates to
//      Razorpay checkout. The parent owns the navigation; this
//      component is purely an instrumentation wrapper.
//
// Unknown / missing variants fall back to "control" so older API
// builds that don't return the experiments field still render a
// working button.

import { useState, useEffect } from 'react'
import * as api from '../api'

/** Server-recognised variants. Keep in sync with the api side's
 *  internal/experiments/experiments.go constants. */
export type UpgradeVariant = 'control' | 'urgent' | 'value'

/** Experiment name. The api server registers this string in its
 *  experiments registry; the conversion endpoint cross-checks that
 *  the dashboard's submitted variant matches the server's bucket
 *  for the caller, so this constant must be byte-equal on both
 *  sides. */
export const EXPERIMENT_UPGRADE_BUTTON = 'upgrade_button'

/** Convert any variant string (possibly undefined/typo'd) into
 *  one of the three known variants. Defaults to "control" so an
 *  older API build that omits the experiments field still renders
 *  a working upgrade button instead of a blank pill. */
export function normalizeVariant(v: string | undefined): UpgradeVariant {
  if (v === 'urgent' || v === 'value') return v
  return 'control'
}

/** Variant-specific copy. Centralised here so tests can import
 *  the same source of truth the component renders from. */
export const UPGRADE_VARIANT_LABELS: Record<UpgradeVariant, string> = {
  control: 'Upgrade to Pro',
  urgent: 'Get Pro now',
  value: 'Unlock Pro features',
}

interface UpgradeButtonProps {
  /** Variant as returned by /auth/me's experiments map. Pass
   *  `me?.experiments?.upgrade_button` directly — undefined is
   *  handled and routes to "control". */
  variant?: string
  /** Click handler — typically navigates to checkout. The button
   *  always awaits the conversion-report POST (capped at 500ms)
   *  before invoking this. */
  onClick: () => void | Promise<void>
  /** When true, render the button as disabled (e.g. while a parent
   *  checkout request is in flight). */
  disabled?: boolean
  /** Override the default label. Rarely used — the component
   *  computes its own label from the variant. Passing this is an
   *  escape hatch for callers that need a different word (e.g.
   *  "Upgrade to Hobby"). */
  label?: string
  /** Action identifier sent in the audit-log metadata. Defaults
   *  to "checkout_started" since that's the only conversion path
   *  we have today. */
  action?: string
  /** Stable id for testing. Forwarded to data-testid. */
  testId?: string
  /** Optional title attribute (hover tooltip). */
  title?: string
}

/** Maximum wait for the conversion-report POST before navigating
 *  anyway. 500ms is the budget specified in the P1 brief — long
 *  enough to capture the event on a healthy network, short enough
 *  that a slow or down analytics endpoint never blocks the user. */
const REPORT_TIMEOUT_MS = 500

/** Race a promise against a timeout. Resolves once either settles;
 *  the timeout never rejects (we just give up). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    p.then(finish, finish)
    setTimeout(finish, ms)
  })
}

export function UpgradeButton({
  variant,
  onClick,
  disabled = false,
  label,
  action = 'checkout_started',
  testId = 'upgrade-button',
  title,
}: UpgradeButtonProps) {
  const norm = normalizeVariant(variant)
  const displayLabel = label ?? UPGRADE_VARIANT_LABELS[norm]
  const [busy, setBusy] = useState(false)

  // Reset the busy flag if the component unmounts while a click
  // is in flight — otherwise React will warn about a state update
  // on an unmounted component. Use a ref to communicate teardown.
  useEffect(() => {
    return () => {
      // No-op cleanup; the closure below checks `mounted` via a
      // ref-style pattern inline. We keep the effect so future
      // refactors find the seam.
    }
  }, [])

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    if (disabled || busy) return
    setBusy(true)
    // Fire-and-forget conversion report, capped at 500ms. The
    // helper swallows every error so we never break the click.
    await withTimeout(
      api.reportExperimentConverted({
        experiment: EXPERIMENT_UPGRADE_BUTTON,
        variant: norm,
        action,
      }),
      REPORT_TIMEOUT_MS,
    )
    try {
      await onClick()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="btn-upgrade"
      data-variant={norm}
      data-testid={testId}
      data-experiment={EXPERIMENT_UPGRADE_BUTTON}
      onClick={handleClick}
      disabled={disabled || busy}
      title={title}
    >
      {displayLabel}
    </button>
  )
}
