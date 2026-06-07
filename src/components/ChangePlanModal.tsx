// ChangePlanModal — in-dashboard tier-upgrade dialog for an *existing*
// subscriber. Calls POST /api/v1/billing/change-plan (api.changePlan)
// which swaps the Razorpay subscription's plan in place rather than
// creating a fresh one via the checkout flow. The fresh-checkout path
// (createCheckout → razorpay short_url → return to dashboard) is what
// the PricingGrid still uses for anonymous / free-tier signups; this
// modal exists for the upgrade-from-tier-to-tier case where the user
// already has an active subscription on their team.
//
// Policy guardrail (project_no_self_serve_cancel_downgrade.md):
//   downgrade is NOT self-serve. The modal must ONLY offer tiers
//   strictly above the current one. The "Contact support" mailto
//   is the only exit path for downgrades — surfaced inline as a
//   footer link, never as a selectable radio option.
//
// Two server response shapes the caller may see:
//   - short_url present  → window.location.href = short_url
//                          (Razorpay-hosted checkout for a tier bump
//                          that triggers re-auth on the saved card).
//   - immediate: true    → server confirmed the plan swapped in-place;
//                          we refetch billing context and render a
//                          success message before the modal closes.
//
// Surfaces test-ids: change-plan-modal / change-plan-confirm /
// change-plan-cancel / change-plan-error / change-plan-success — kept
// stable so the BillingPage Playwright tests can drive this flow.

import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { TIER_RANK } from '../api'
import type { ChangePlanTier, PlanFrequency, Tier } from '../api'

// Ranks for "is this an upgrade?" math come from the single canonical
// TIER_RANK table in src/api/index.ts (kept aligned with the backend's
// common/plans/rank.go). `hobby_plus` sits between hobby and pro at $19/mo,
// and growth ($99) sits strictly ABOVE pro ($49) — see the table's comment.
// Importing the shared table keeps this modal from re-diverging into the
// old inverted growth/pro ordering.

// Human-readable label for the modal title + selector. Derived once so
// translations / brand renames live in one place.
const TIER_LABEL: Record<ChangePlanTier, string> = {
  hobby: 'Hobby',
  hobby_plus: 'Hobby Plus',
  pro: 'Pro',
  team: 'Team',
  growth: 'Growth',
}

// Tiers we expose in the in-dashboard upgrade selector.
//
// FIX-R9 / FIX-190 (W11): include hobby_plus (now real in api/plans.yaml as
// the $19/mo step between Hobby and Pro), drop growth — there is no real
// growth row available through self-serve upgrade yet. Customers who need
// growth-tier dedicated infra go through support / sales, not this modal.
//
// TEAM-GATE (2026-06-04 CEO directive): `team` is REMOVED from the selectable
// set — Team ($199 "unlimited") is not rolled out and must not be offered as
// a self-serve in-app upgrade until its unlimited-resource delivery is proven
// built. A Pro/Growth user whose only path up is Team now falls through to the
// modal's "no upgrades — contact support" empty state, which is the honest,
// sales-assisted exit. Do NOT re-add 'team' here. Ref:
// docs/sessions/2026-06-04/TEAM-PLAN-GATE-AND-BUILD.md.
const SELECTABLE_TIERS: ChangePlanTier[] = ['hobby', 'hobby_plus', 'pro']

export interface ChangePlanModalProps {
  /** The team's current tier — read from useDashboardCtx().me.team.tier on
   *  the caller side. Used to:
   *    1. compute which target tiers are "strictly above" (selectable)
   *    2. render the "from X" line in the title
   *    3. guard against same-tier confirmations on the server's behalf */
  currentTier: Tier
  /** Pre-selected target — typically the next-tier-up the caller already
   *  computed (e.g. hobby → pro). User can change it inside the modal. */
  defaultTargetTier?: ChangePlanTier
  /** Frequency the caller is currently displaying (matches the BillingPage
   *  Annual/Monthly toggle). User can override before confirming. */
  defaultFrequency?: PlanFrequency
  /** Called when the modal should close — backdrop click, Esc, cancel, or
   *  after a successful immediate change. */
  onClose: () => void
  /** Fired only on a successful `immediate: true` response so the parent
   *  can refetch /api/v1/billing without a full reload. Not invoked on
   *  the short_url redirect path (the page is navigating away). */
  onChanged?: () => void
}

export function ChangePlanModal({
  currentTier,
  defaultTargetTier,
  defaultFrequency = 'monthly',
  onClose,
  onChanged,
}: ChangePlanModalProps) {
  // Compute the upgrade-only target list once per (currentTier) change.
  // Filtering on render keeps the policy guardrail honest even if the
  // caller passes a defaultTargetTier that would have been a downgrade
  // (we drop it back to the lowest available upgrade in that case).
  const currentRank = TIER_RANK[currentTier] ?? 0
  const upgradeTargets = SELECTABLE_TIERS.filter((t) => (TIER_RANK[t] ?? -1) > currentRank)

  const initialTarget: ChangePlanTier =
    defaultTargetTier && upgradeTargets.includes(defaultTargetTier)
      ? defaultTargetTier
      : (upgradeTargets[0] ?? 'pro')

  const [targetTier, setTargetTier] = useState<ChangePlanTier>(initialTarget)
  const [frequency, setFrequency] = useState<PlanFrequency>(defaultFrequency)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 5xx → render a Contact-support fallback in the error block. Track this
  // separately from the message so the support link only appears when the
  // failure was actually upstream (vs. a 4xx the user can fix themselves).
  const [showSupportFallback, setShowSupportFallback] = useState(false)
  const [success, setSuccess] = useState(false)
  const firstFocusRef = useRef<HTMLInputElement | null>(null)

  // Esc closes — matches TierChangeModal + the rest of the dashboard's
  // modal-overlay convention. Suspended while a request is in flight so a
  // mis-keyed Escape mid-Razorpay-call doesn't strand a half-submitted
  // change-plan call (the dashboard never sees the response).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  // Focus the first selectable radio on mount so keyboard users can
  // proceed without clicking. Wrapped in a tick because the radio
  // refs aren't installed until the first paint.
  useEffect(() => {
    firstFocusRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || upgradeTargets.length === 0) return
    setSubmitting(true)
    setError(null)
    setShowSupportFallback(false)
    try {
      // BugBash T9-P1-1 (2026-05-20): the Annual radio used to silently
      // bill the user monthly because `POST /api/v1/billing/change-plan`
      // ignores `plan_frequency` and `Portal.ChangePlan` only resolves
      // monthly plan IDs. The handler comment (api/index.ts:1917-1919) is
      // explicit: "yearly changes still route through createCheckout per
      // the inline comment on razorpayPlanIDs()." So for the yearly branch
      // we now route through the same checkout flow CheckoutPage uses —
      // the user gets a real annual Razorpay subscription, no silent
      // contract lie. Razorpay handles the swap-from-monthly-to-annual
      // proration on the hosted page. Monthly→monthly stays on the
      // in-place change-plan endpoint (the immediate-swap path).
      if (frequency === 'yearly') {
        const r = await api.createCheckout(targetTier, 'yearly')
        if (r.short_url) {
          window.location.href = r.short_url
          return
        }
        setError('Unexpected response from billing. Please try again.')
        return
      }
      const r = await api.changePlan(targetTier, frequency)
      if (r.short_url) {
        // Razorpay-hosted portal handoff. The page navigates away — no
        // need to clear submitting state, we'll be gone.
        window.location.href = r.short_url
        return
      }
      if (r.immediate) {
        setSuccess(true)
        onChanged?.()
        // Hold the modal open briefly so the user actually sees the
        // confirmation. 1500ms is enough to register without feeling
        // sticky; the BillingPage will already be refetching in the
        // background via onChanged.
        setTimeout(() => onClose(), 1500)
        return
      }
      // Defensive: the api returned ok but neither short_url nor
      // immediate — treat as an unexpected response so the user has
      // an escalation path instead of a silent failure.
      setError('Unexpected response from billing. Please try again.')
    } catch (e: any) {
      const status: number | undefined = e?.status
      const message: string = e?.message ?? 'Could not change plan'
      setError(message)
      if (status && status >= 500) setShowSupportFallback(true)
    } finally {
      setSubmitting(false)
    }
  }

  const noUpgrades = upgradeTargets.length === 0
  const tierLabel = TIER_LABEL[targetTier]

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Change plan"
      data-testid="change-plan-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 480,
          padding: 24,
          background: 'var(--surface, #fff)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <form onSubmit={handleSubmit}>
          <h3 style={{ marginTop: 0 }} data-testid="change-plan-title">
            Change to {tierLabel}
          </h3>
          <p
            className="dim"
            style={{ fontSize: 13, marginTop: 0 }}
            data-testid="change-plan-current-tier"
          >
            You're currently on <strong>{TIER_LABEL[currentTier as ChangePlanTier] ?? currentTier}</strong>.
            Upgrading swaps your Razorpay subscription in place — no double-billing.
          </p>

          {noUpgrades ? (
            <div
              data-testid="change-plan-no-upgrades"
              style={{
                marginTop: 14,
                padding: 12,
                background: 'rgba(234,179,8,0.10)',
                border: '1px solid rgba(234,179,8,0.30)',
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              You're already on the highest plan available through self-serve.
              To explore a custom plan,{' '}
              <a
                href="mailto:contact@instanode.dev?subject=Plan%20change"
                style={{ color: 'var(--accent)' }}
              >
                contact support
              </a>
              .
            </div>
          ) : (
            <fieldset
              style={{ border: 0, padding: 0, margin: '14px 0 0' }}
              data-testid="change-plan-targets"
            >
              <legend
                style={{ fontSize: 12, fontWeight: 500, paddingBottom: 6 }}
              >
                Choose a plan
              </legend>
              {upgradeTargets.map((t, idx) => (
                <label
                  key={t}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 0',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    ref={idx === 0 ? firstFocusRef : undefined}
                    type="radio"
                    name="change-plan-target"
                    value={t}
                    checked={targetTier === t}
                    onChange={() => setTargetTier(t)}
                    data-testid={`change-plan-target-${t}`}
                  />
                  <span>{TIER_LABEL[t]}</span>
                </label>
              ))}
            </fieldset>
          )}

          {!noUpgrades && (
            <fieldset
              style={{ border: 0, padding: 0, margin: '14px 0 0' }}
              data-testid="change-plan-frequency"
            >
              <legend
                style={{ fontSize: 12, fontWeight: 500, paddingBottom: 6 }}
              >
                Billing frequency
              </legend>
              <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="change-plan-frequency"
                    value="monthly"
                    checked={frequency === 'monthly'}
                    onChange={() => setFrequency('monthly')}
                    data-testid="change-plan-frequency-monthly"
                  />
                  Monthly
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="change-plan-frequency"
                    value="yearly"
                    checked={frequency === 'yearly'}
                    onChange={() => setFrequency('yearly')}
                    data-testid="change-plan-frequency-yearly"
                  />
                  Annual <span className="dim" style={{ fontSize: 11 }}>(2 months free)</span>
                </label>
              </div>
            </fieldset>
          )}

          {error && (
            <div
              data-testid="change-plan-error"
              role="alert"
              style={{
                marginTop: 14,
                padding: 10,
                background: 'rgba(220,38,38,0.08)',
                color: 'var(--rose, #b91c1c)',
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              {error}
              {showSupportFallback && (
                <div style={{ marginTop: 6 }}>
                  Still stuck?{' '}
                  <a
                    href="mailto:contact@instanode.dev?subject=Change%20plan%20failed"
                    data-testid="change-plan-support-fallback"
                    style={{ color: 'var(--accent)' }}
                  >
                    Contact support
                  </a>
                  .
                </div>
              )}
            </div>
          )}

          {success && (
            <div
              data-testid="change-plan-success"
              role="status"
              style={{
                marginTop: 14,
                padding: 10,
                background: 'rgba(16,185,129,0.10)',
                color: 'var(--green, #047857)',
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              Plan changed ✓
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 18,
              gap: 8,
            }}
          >
            {/* Downgrade exit-path — surfaces the support mailto so users
                who clicked "Change plan" hoping to downgrade aren't dead-
                ended. Policy memory: downgrade is support-only. */}
            <a
              href="mailto:contact@instanode.dev?subject=Downgrade%20plan"
              data-testid="change-plan-downgrade-support"
              style={{ fontSize: 11, color: 'var(--text-faint)' }}
            >
              Need to downgrade? Contact support
            </a>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                data-testid="change-plan-cancel"
                className="btn"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || noUpgrades || success}
                data-testid="change-plan-confirm"
                className="btn primary"
              >
                {submitting ? 'Changing…' : `Confirm change to ${tierLabel}`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
