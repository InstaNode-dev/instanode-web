import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { TierPill } from '../components/Common'
import { UpgradeButton } from '../components/UpgradeButton'
import { PricingGrid } from '../components/PricingGrid'
import { ChangePlanModal } from '../components/ChangePlanModal'
import type { TierKey } from '../components/TierCard'
import * as api from '../api'
import type { BillingDetails, BillingUsage, ChangePlanTier, Invoice, PlanFrequency, Tier } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'
import { formatInvoiceAmount, formatInvoiceDate } from '../lib/currency'
import { isEmailVerifiedError, VerifyEmailBanner } from '../components/VerifyEmailBanner'

// Tiers eligible for the in-dashboard Change-plan modal. Anonymous + free
// users have no active subscription to swap, so the /api/v1/billing/change-
// plan endpoint returns 400 no_subscription for them — they upgrade through
// the regular createCheckout grid below instead. Showing the button for
// those tiers would be a dead click.
// FIX-K (2026-05-16): hobby_plus added — subscribers can now use in-place Change-plan modal.
const TIERS_WITH_SUBSCRIPTION = new Set<string>(['hobby', 'hobby_plus', 'pro', 'team', 'growth'])

// Next-tier-up suggestion the Change-plan modal opens onto. Mirrors the
// LIMITS.nextTier values further down but typed as ChangePlanTier — the
// PricingGrid tier set ('free' included) is narrower than the change-plan
// tier set, so we keep them separate to avoid coercion.
const NEXT_CHANGE_PLAN_TIER: Record<string, ChangePlanTier> = {
  hobby: 'pro',
  // FIX-K (2026-05-16): hobby_plus was missing.
  hobby_plus: 'pro',
  pro: 'team',
  growth: 'team',
  // team has no next tier — the button won't render for team users
  // anyway (modal handles the empty-upgrades case as a fallback).
}

// 2026-05-13 billing redesign: frequency now defaults to **annual**.
//
// Why default annual:
//   Research (Athenic, InfluenceFlow 2026) shows defaulting to annual lifts
//   annual adoption +19–35% and "2 months free" framing drove a +342%
//   annual-signups lift in one cited test. Existing monthly subscribers
//   keep monthly mid-cycle (they're already enrolled — the toggle only
//   affects new checkout sessions).
//
// Persistence is preserved: a user who explicitly switches back to monthly
// will see monthly on subsequent loads. The default flip only matters on
// first-time render with no stored preference.
const FREQ_STORAGE_KEY = 'instant.billing.plan_frequency'

function readStoredFrequency(): PlanFrequency {
  try {
    if (typeof window === 'undefined') return 'yearly'
    const v = window.localStorage.getItem(FREQ_STORAGE_KEY)
    if (v === 'monthly') return 'monthly'
    if (v === 'yearly') return 'yearly'
    // No stored value → default Annual (the new default per the redesign).
    return 'yearly'
  } catch {
    return 'yearly'
  }
}

function writeStoredFrequency(f: PlanFrequency): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(FREQ_STORAGE_KEY, f)
  } catch {
    // Safari private mode / quota errors are non-fatal — the toggle
    // still works for the lifetime of the page, just doesn't persist.
  }
}

// Per-service limits used by the Usage panel. `Infinity` means "no
// dashboard-side cap shown" (team-tier headroom). Postgres / Redis /
// MongoDB values are in MB to match how UsageRow renders them;
// deployments / webhooks / seats are integer counts. Source of truth
// is api/plans.yaml — keep in sync if those numbers change.
type PlanLimits = {
  postgres_mb: number
  redis_mb: number
  mongodb_mb: number
  deployments: number
  webhooks: number
  team_seats: number
}

// LIMITS — only the per-tier numeric caps the Usage panel needs. The grid
// renders the marketing copy from PricingGrid's own internal table, so we
// no longer need a duplicate `features` list here.
//
// W11 (2026-05-13): added hobby_plus mid-tier ($19/mo). Same postgres /
// redis as hobby; bumped mongodb to 1 GB, deployments to 2, webhooks to
// 5000. Numbers mirror api/plans.yaml hobby_plus block.
const LIMITS: Record<string, { label: string; limits: PlanLimits; nextTier?: TierKey }> = {
  anonymous: {
    label: 'Anonymous',
    nextTier: 'hobby',
    limits: { postgres_mb: 10, redis_mb: 5, mongodb_mb: 5, deployments: 0, webhooks: 100, team_seats: 1 },
  },
  free: {
    label: 'Free',
    nextTier: 'hobby',
    limits: { postgres_mb: 10, redis_mb: 5, mongodb_mb: 5, deployments: 0, webhooks: 100, team_seats: 1 },
  },
  hobby: {
    label: 'Hobby',
    nextTier: 'hobby_plus',
    limits: { postgres_mb: 1024, redis_mb: 50, mongodb_mb: 100, deployments: 1, webhooks: 1000, team_seats: 1 },
  },
  hobby_plus: {
    label: 'Hobby Plus',
    nextTier: 'pro',
    limits: { postgres_mb: 1024, redis_mb: 50, mongodb_mb: 1024, deployments: 2, webhooks: 5000, team_seats: 1 },
  },
  pro: {
    label: 'Pro',
    nextTier: 'team',
    // FIX-K (2026-05-16): 2026-05-15 storage bump. Was: postgres_mb: 5120, redis_mb: 256, mongodb_mb: 2048.
    limits: { postgres_mb: 10240, redis_mb: 512, mongodb_mb: 5120, deployments: 10, webhooks: 10000, team_seats: 5 },
  },
  // D5 (2026-05-18): growth row was missing — a growth-tier team fell
  // through to `LIMITS.hobby`, painting red over-quota bars on a plan they
  // were well within. Numbers mirror api/plans.yaml growth: postgres 20480
  // MB, redis 1024 MB, mongodb / webhooks unlimited (-1 in plans.yaml →
  // Infinity here), 5 deployments, 10 team_members.
  growth: {
    label: 'Growth',
    nextTier: 'team',
    limits: {
      postgres_mb: 20480, redis_mb: 1024, mongodb_mb: Infinity,
      deployments: 5, webhooks: Infinity, team_seats: 10,
    },
  },
  team: {
    label: 'Team',
    limits: {
      postgres_mb: Infinity, redis_mb: Infinity, mongodb_mb: Infinity,
      deployments: Infinity, webhooks: Infinity, team_seats: Infinity,
    },
  },
}

// Normalise the user's tier into one of the five grid tiers. Anonymous +
// any unknown value collapses to 'free' for the grid (so an anonymous
// user viewing /app/billing sees Free highlighted as "Your plan").
function gridTierFromTier(tier: string): TierKey {
  if (tier === 'hobby' || tier === 'hobby_plus' || tier === 'pro' || tier === 'team' || tier === 'free') {
    return tier
  }
  // FIX-K (2026-05-16): growth maps to pro (nearest grid tier).
  if (tier === 'growth') return 'pro'
  // anonymous + unknown → free
  return 'free'
}

export function BillingPage() {
  const { me } = useDashboardCtx()
  const tier = me?.team?.tier ?? 'hobby'
  const limitDef = LIMITS[tier] ?? LIMITS.hobby
  const currentGridTier = gridTierFromTier(tier)

  const [billing, setBilling] = useState<BillingDetails | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  // §10.20: Usage panel reads from /api/v1/billing/usage (server-side
  // cached 30s with singleflight) — not from /resources. The browser
  // no longer pulls every resource row to compute six aggregates.
  const [billingUsage, setBillingUsage] = useState<BillingUsage | null>(null)
  // §10.21: fetchBilling no longer falls back to fixture data on 503,
  // so we surface its error explicitly via this banner state.
  const [billingErr, setBillingErr] = useState<string | null>(null)
  const [billingLoading, setBillingLoading] = useState(true)
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  // B6-P0 008 (BUGBASH 2026-05-20): when the api 403s for email_not_verified,
  // we surface the VerifyEmailBanner inline next to the upgrade grid instead
  // of just dropping the failure into the generic checkout error toast.
  const [verifyEmailGate, setVerifyEmailGate] = useState(false)

  // Frequency state — default Annual. Read once on mount.
  const [frequency, setFrequencyState] = useState<PlanFrequency>(() => readStoredFrequency())
  const setFrequency = (f: PlanFrequency) => {
    setFrequencyState(f)
    writeStoredFrequency(f)
  }

  // Change-plan modal state — open/closed plus a small refresh nonce that
  // bumps after a successful immediate change so the page refetches /billing.
  // Stored as a number rather than a boolean so unrelated effect deps stay
  // stable (incrementing on every change rather than toggling avoids the
  // "two consecutive changes don't retrigger" footgun).
  const [changePlanOpen, setChangePlanOpen] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Compute whether to surface the Change-plan button. Hidden for anon/free
  // users (no active subscription) and for the highest tier we self-serve
  // upgrades to (team — there's nowhere further to go).
  const hasUpgradeTarget = !!NEXT_CHANGE_PLAN_TIER[tier]
  const showChangePlanButton = TIERS_WITH_SUBSCRIPTION.has(tier) && hasUpgradeTarget

  useEffect(() => {
    // Independent reads — each guarded individually so a failure on one
    // doesn't blank the whole page. Billing error → banner. Invoices
    // error → empty section. Usage error → zero rows on the Usage panel.
    let alive = true
    api.fetchBilling()
      .then((b) => { if (alive) setBilling(b.billing) })
      .catch((e: any) => {
        if (!alive) return
        setBillingErr(e?.message ?? 'billing is currently unavailable')
      })
      .finally(() => { if (alive) setBillingLoading(false) })
    api.listInvoices()
      .then((i) => { if (alive) setInvoices(i.invoices) })
      .catch(() => { /* surfaced in the banner via billingErr; invoices section will read 0 */ })
    api.fetchBillingUsage()
      .then((u) => { if (alive) setBillingUsage(u) })
      .catch(() => { /* usage panel reads 0 — non-fatal */ })
    return () => { alive = false }
  }, [refreshNonce])

  // §10.20: Derive Usage panel inputs from the server-side cached payload.
  // The server returns storage in bytes (with `limit_bytes`) — convert to
  // MB here for the UsageRow renderer (which is MB-shaped). Zeroes while
  // the response is in flight so the layout doesn't jump on arrival; a
  // non-fatal fetch failure leaves the panel at zeroes rather than
  // blocking the rest of the page.
  const u = billingUsage?.usage
  const bytesToMB = (n?: number) => (n && n > 0 ? n / (1024 * 1024) : 0)
  const usage = {
    postgres_mb: bytesToMB(u?.postgres?.bytes),
    redis_mb: bytesToMB(u?.redis?.bytes),
    mongodb_mb: bytesToMB(u?.mongodb?.bytes),
    deployments: u?.deployments?.count ?? 0,
    webhooks: u?.webhooks?.count ?? 0,
    // Members count now comes from the same server-side aggregate —
    // previously the dashboard had no live source (§10.7 gap). Clamp to 1
    // when the API returns 0 so the seats row stays honest (the owner row
    // always exists; the team_members table just hasn't populated yet).
    team_seats: u?.members?.count && u.members.count > 0 ? u.members.count : 1,
  }

  if (billingLoading && !billing) return <div className="skel" style={{ width: '100%', height: 320 }} />

  // §10.21: fetchBilling no longer returns FIXTURE_BILLING on 503. If the
  // backend is unreachable we surface a real error banner rather than
  // rendering the page with stale/fake data.
  if (!billing) {
    return (
      <div
        role="alert"
        data-testid="billing-error"
        style={{
          padding: '16px 18px',
          border: '1px solid var(--rose)',
          borderLeft: '3px solid var(--rose)',
          borderRadius: 6,
          background: 'var(--surface)',
          color: 'var(--text)',
          fontSize: 13.5,
        }}
      >
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--rose)', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 6 }}>
          billing unavailable
        </div>
        <div>
          We couldn't load your billing details right now. {billingErr ? <code style={{ color: 'var(--text-dim)' }}>{billingErr}</code> : null}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
          Try again in a moment, or contact <a href="mailto:support@instanode.dev" style={{ color: 'var(--accent)' }}>support@instanode.dev</a> if it persists.
        </div>
      </div>
    )
  }

  // Map a clicked tier-key from the PricingGrid into the createCheckout
  // call. The grid always targets an explicit tier, so we no longer rely
  // on a "next tier" computed from the user's plan — the user can pick
  // (e.g. Hobby user upgrading directly to Team).
  //
  // Edge cases:
  //   - target === 'free': no checkout (Free is the no-cost tier; the
  //     user would have to contact support to downgrade — we don't offer
  //     a self-serve path).
  //   - target === 'team': team is comingSoon; route the click to
  //     support@ for a sales conversation rather than checkout. This
  //     keeps the UX honest until the team-tier surface ships.
  //   - target === currentGridTier: defensive no-op (the grid already
  //     renders "Your plan" instead of a CTA, but the prop API exposes
  //     the handler regardless — guard so a synthetic test click doesn't
  //     fire a wasted checkout).
  async function handleSelectTier(target: TierKey) {
    if (target === currentGridTier) return
    if (target === 'free') return
    if (target === 'team') {
      // Surfaces as a normal mailto navigation. We don't route through
      // Razorpay because team tier isn't on Razorpay yet. The grid
      // renders "Contact sales" as the button text so users aren't
      // surprised when this happens.
      window.location.href = 'mailto:sales@instanode.dev?subject=Team%20plan%20enquiry'
      return
    }
    setCheckoutErr(null)
    setVerifyEmailGate(false)
    setCheckoutLoading(true)
    try {
      // Promo codes are intentionally NOT plumbed through the dashboard
      // anymore. Razorpay's hosted checkout has its own "Have a code?"
      // affordance, which avoids the Baymard "coupon hunting" pattern:
      // empty fields trigger users to abandon the upgrade and Google
      // for codes. We send the user straight to Razorpay's checkout;
      // code redemption happens there if they have one.
      const r = await api.createCheckout(target, frequency)
      if (r.short_url) {
        window.location.href = r.short_url
        return
      }
      setCheckoutErr('checkout returned no url')
    } catch (e: any) {
      if (isEmailVerifiedError(e)) {
        // B6-P0 008: don't render the generic toast — show the recoverable
        // "Verify your email" banner with a resend-magic-link button.
        setVerifyEmailGate(true)
      } else {
        setCheckoutErr(e?.message ?? 'checkout failed')
      }
    } finally {
      setCheckoutLoading(false)
    }
  }

  // The Pro card's CTA composes with the P1 A/B UpgradeButton when the
  // user is *not* already on Pro — keeps the experiment variants alive
  // through the redesign. When the user *is* on Pro, the grid renders the
  // "Your plan" pill (the slot is unused). When the user is on Team, Pro
  // is just another non-current tier — we still render an UpgradeButton-
  // shaped element so the variant copy is consistent.
  const proCtaSlot = currentGridTier === 'pro' ? null : (
    <UpgradeButton
      variant={me?.experiments?.upgrade_button}
      onClick={() => handleSelectTier('pro')}
      disabled={checkoutLoading}
      title="Upgrade to Pro"
      testId="upgrade-button"
      // Price-anchored override: research (Kissmetrics + PhoebeLown)
      // shows verb + outcome + price beats generic "Upgrade".
      label={
        frequency === 'yearly'
          ? 'Get Pro — $40.83/mo'
          : 'Get Pro — $49/mo'
      }
    />
  )

  return (
    <>
      {/* Pricing grid: 4 tiers side-by-side with Pro highlighted. Replaces
          the single-plan upgrade card. The grid owns its own frequency
          toggle (Annual default) and renders "Your plan" on the current
          tier; every other tier shows a tier-aware CTA whose copy embeds
          the anchored price (e.g. "Get Pro — $40.83/mo"). */}
      <section
        data-testid="billing-upgrade-section"
        style={{
          marginTop: 14,
          padding: '14px 14px 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            choose a plan
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
              marginTop: 4,
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.02em', margin: 0 }}>
              You're on {limitDef.label} today.
            </h2>
            {/* "Change plan" — opens the in-dashboard tier-swap modal that
                calls /api/v1/billing/change-plan. Hidden for anonymous /
                free / team because those have no in-place upgrade path
                (anon+free have no subscription; team is the ceiling). */}
            {showChangePlanButton && (
              <button
                type="button"
                className="btn btn-sm"
                data-testid="open-change-plan-modal"
                onClick={() => setChangePlanOpen(true)}
              >
                Change plan
              </button>
            )}
          </div>
        </div>
        <PricingGrid
          currentTier={currentGridTier}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          onSelectTier={(t) => { void handleSelectTier(t) }}
          ctaDisabled={checkoutLoading}
          proCtaSlot={proCtaSlot ?? undefined}
        />
        {checkoutErr && (
          <div
            data-testid="checkout-error"
            style={{
              marginTop: 10,
              fontSize: 12,
              color: 'var(--danger, #c33)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {checkoutErr}
          </div>
        )}
        {verifyEmailGate && (
          <VerifyEmailBanner email={me?.user?.email} />
        )}
        <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            className="btn btn-ghost btn-sm"
            href="mailto:support@instanode.dev?subject=Cancel%20subscription"
            data-testid="contact-support-cancel"
          >
            Cancel? Contact support
          </a>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-faint)',
              letterSpacing: '0.03em',
            }}
          >
            Promo codes apply at checkout (Razorpay).
          </span>
        </div>
      </section>

      {/* Payment + auto-renew detail. Pulled out of the old plan card so
          the upgrade grid can stand on its own. */}
      <section style={{ marginTop: 18 }}>
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              payment method
            </span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>
              {billing.payment_network?.toUpperCase()} · {billing.payment_last4}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* The agent API never returns payment_exp_* — render only the
                auto-renew date, which we do have. (§10.8 — kill the leak.) */}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
              auto-renews{' '}
              {billing.current_period_end && new Date(billing.current_period_end).toLocaleDateString()}
            </span>
            {/* Self-serve "update payment method" is wired: api/billing.go
                exposes POST /api/v1/billing/update-payment which returns a
                Razorpay short_url. Falls back to support mailto on error
                (rate limit, billing not configured, network) so customers
                still have an escalation path. */}
            <UpdatePaymentButton />
          </div>
        </div>
      </section>

      {/* Usage panel — driven by the server-side cached aggregate. Mirrors
          the pre-redesign layout so existing tests still hit the same .skel
          + .usage-row + as-of footnote contract. */}
      <section className="plan-usage" style={{ marginTop: 28 }}>
        <h4>Usage · this period</h4>
        <UsageRow
          k="postgres"
          used={formatMB(usage.postgres_mb)}
          limit={formatLimitMB(limitDef.limits.postgres_mb)}
          pct={pctOf(usage.postgres_mb, limitDef.limits.postgres_mb)}
          warn={isWarn(usage.postgres_mb, limitDef.limits.postgres_mb)}
        />
        <UsageRow
          k="redis"
          used={formatMB(usage.redis_mb)}
          limit={formatLimitMB(limitDef.limits.redis_mb)}
          pct={pctOf(usage.redis_mb, limitDef.limits.redis_mb)}
          warn={isWarn(usage.redis_mb, limitDef.limits.redis_mb)}
        />
        <UsageRow
          k="mongo"
          used={formatMB(usage.mongodb_mb)}
          limit={formatLimitMB(limitDef.limits.mongodb_mb)}
          pct={pctOf(usage.mongodb_mb, limitDef.limits.mongodb_mb)}
          warn={isWarn(usage.mongodb_mb, limitDef.limits.mongodb_mb)}
        />
        <UsageRow
          k="deployments"
          used={String(usage.deployments)}
          limit={formatLimitCount(limitDef.limits.deployments)}
          pct={pctOf(usage.deployments, limitDef.limits.deployments)}
          warn={isWarn(usage.deployments, limitDef.limits.deployments)}
        />
        <UsageRow
          k="webhooks"
          used={String(usage.webhooks)}
          limit={formatLimitCount(limitDef.limits.webhooks)}
          pct={pctOf(usage.webhooks, limitDef.limits.webhooks)}
          warn={isWarn(usage.webhooks, limitDef.limits.webhooks)}
        />
        <UsageRow
          k="team seats"
          used={String(usage.team_seats)}
          limit={formatLimitCount(limitDef.limits.team_seats)}
          pct={pctOf(usage.team_seats, limitDef.limits.team_seats)}
          warn={isWarn(usage.team_seats, limitDef.limits.team_seats)}
        />
        {/* §10.20: visible eventual-consistency footnote. The Usage panel
            is server-cached for 30s — render the freshness so users can
            tell whether they're looking at a fresh read or a cached one
            (and don't expect provision/delete to update instantly). */}
        {billingUsage?.as_of && (
          <div
            data-testid="billing-usage-as-of"
            style={{
              marginTop: 10,
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: 'var(--text-faint)',
              letterSpacing: '0.04em',
            }}
          >
            as of {formatAsOf(billingUsage.as_of)} · cached {billingUsage.freshness_seconds}s
          </div>
        )}
      </section>

      {changePlanOpen && (
        <ChangePlanModal
          currentTier={tier as Tier}
          defaultTargetTier={NEXT_CHANGE_PLAN_TIER[tier]}
          defaultFrequency={frequency}
          onClose={() => setChangePlanOpen(false)}
          onChanged={() => {
            // Bump the nonce so the useEffect refetches billing + invoices
            // + usage. The modal closes itself shortly after firing this
            // (it holds open briefly to show the success indicator).
            setRefreshNonce((n) => n + 1)
          }}
        />
      )}

      <div style={{ marginTop: 28 }}>
        <div className="section-h">
          <h2>Invoices</h2>
          <span className="sub">via razorpay</span>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div className="invoice-row head">
            <span>id</span>
            {/* "date" not "period": the Razorpay invoices endpoint emits a
                single charge timestamp, not a billing window. */}
            <span>date</span>
            <span>plan</span>
            <span>status</span>
            <span>amount</span>
          </div>
          {invoices.map((i) => (
            <div key={i.id} className="invoice-row">
              <span className="id">{i.id}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-dim)' }}>
                {/* BugBash T15-P1-4 (2026-05-20): unguarded `new Date(...)`
                    rendered the literal `Invalid Date` for any null/malformed
                    `issued_at`. Use the defensive `formatInvoiceDate` helper
                    so an em-dash shows up instead of a string that looks
                    like a bug. Prefer the billing window when both ends are
                    present and valid; otherwise fall back to the single
                    charge date. */}
                {(() => {
                  const startStr = formatInvoiceDate(i.period_start)
                  const endStr = formatInvoiceDate(i.period_end)
                  if (i.period_start && i.period_end && startStr !== '—' && endStr !== '—') {
                    return `${startStr} → ${endStr}`
                  }
                  return formatInvoiceDate(i.issued_at)
                })()}
              </span>
              {/* The invoices endpoint doesn't carry a plan tier — render the
                  pill only when one is actually present, never fabricate. */}
              {i.plan ? <TierPill tier={i.plan} /> : <span className="dim">—</span>}
              {/* Show the real invoice status (paid/pending/failed), not a
                  hardcoded "running" pill. StatusPill doesn't style these
                  three, so render a plain mono span. (§10.8.) */}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                {i.status}
              </span>
              <span className="amt">
                {/* BugBash T15-P1-4 (2026-05-20): unguarded
                    `(i.amount_cents/100).toFixed(2)` rendered `$NaN` for any
                    null/undefined/non-numeric amount. A money UI saying `$NaN`
                    destroys trust on contact. `formatInvoiceAmount` falls
                    back to em-dash. */}
                {formatInvoiceAmount(i.amount_cents)}
                {/* Only render the pdf link when the API actually has one.
                    A live `href="#"` is a dead-end click. (§10.8.) */}
                {i.pdf_url && (
                  <a href={i.pdf_url} className="dl" target="_blank" rel="noopener noreferrer">↓ pdf</a>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function UsageRow({ k, used, limit, pct, warn = false }: { k: string; used: string; limit: string; pct: number; warn?: boolean }) {
  return (
    <div className="usage-row">
      <span className="k">{k}</span>
      <div className="usage">
        <span className="bar">
          <span className={`fill ${warn ? 'warn' : ''}`} style={{ width: `${pct}%` }} />
        </span>
      </div>
      <span className="num">
        {used} <span className="lim">/ {limit}</span>
      </span>
    </div>
  )
}

// ─── Usage formatters ─────────────────────────────────────────────────────
// MB values render as a single decimal under 100 MB, no-decimal above, and
// switch to GB once the figure clears 1024 MB. Keeps the column narrow.
function formatMB(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '0'
  if (mb >= 1024) return (mb / 1024).toFixed(2).replace(/\.?0+$/, '') + ' GB'
  if (mb >= 100) return Math.round(mb).toString()
  return mb.toFixed(1).replace(/\.0$/, '')
}

function formatLimitMB(mb: number): string {
  if (!Number.isFinite(mb)) return '∞'
  if (mb >= 1024) return (mb / 1024).toFixed(0) + ' GB'
  return mb.toString()
}

function formatLimitCount(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  return n.toString()
}

function pctOf(used: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

function isWarn(used: number, limit: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false
  return used / limit >= 0.8
}

// UpdatePaymentButton — invokes POST /api/v1/billing/update-payment, which
// returns a Razorpay-managed short_url the customer can hit to swap their
// saved card. On any error the button silently falls back to a mailto
// link so the customer is never stuck. data-testid mirrors the previous
// support-route id so existing Playwright assertions on click-target still
// pass — the underlying href just resolves to a real Razorpay session now.
function UpdatePaymentButton() {
  const [pending, setPending] = useState(false)
  const [errored, setErrored] = useState(false)

  async function onClick(e: ReactMouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setErrored(false)
    try {
      const r = await api.updatePaymentMethod()
      if (r.short_url) {
        window.location.href = r.short_url
        return
      }
      setErrored(true)
    } catch {
      setErrored(true)
    } finally {
      setPending(false)
    }
  }

  if (errored) {
    return (
      <a
        className="btn btn-sm btn-ghost"
        style={{ marginLeft: 'auto' }}
        href="mailto:support@instanode.dev?subject=Update%20payment%20method"
        data-testid="contact-support-update-payment"
      >
        Contact support
      </a>
    )
  }
  return (
    <a
      className="btn btn-sm btn-ghost"
      style={{ marginLeft: 'auto', pointerEvents: pending ? 'none' : 'auto', opacity: pending ? 0.6 : 1 }}
      href="#"
      onClick={onClick}
      data-testid="contact-support-update-payment"
    >
      {pending ? 'Opening…' : 'Update'}
    </a>
  )
}

// formatAsOf — renders a server-side ISO timestamp as a human-friendly
// "Ns ago" string for the cached-usage footnote. Under a minute is in
// seconds; older snapshots switch to minutes / hours. Clock skew (negative
// age) clamps to "just now" so we never render a future timestamp.
export function formatAsOf(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'unknown'
  const ageMs = Date.now() - t
  if (ageMs < 1000) return 'just now'
  const secs = Math.floor(ageMs / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}
