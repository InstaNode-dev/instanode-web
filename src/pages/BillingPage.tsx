import { useEffect, useState } from 'react'
import { ROBanner, ContractBanner, TierPill } from '../components/Common'
import * as api from '../api'
import type { BillingDetails, BillingUsage, Invoice, Promotion } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

// Typed per-service limits used by the Usage panel. `Infinity` means "no
// dashboard-side cap shown" (team-tier headroom). Postgres / Redis / MongoDB
// values are in MB to match how UsageRow renders them; deployments / webhooks
// / seats are integer counts. Source of truth is api/plans.yaml — keep in
// sync if those numbers change.
type PlanLimits = {
  postgres_mb: number
  redis_mb: number
  mongodb_mb: number
  deployments: number
  webhooks: number
  team_seats: number
}

const PLANS: Record<string, {
  label: string
  price: string
  features: Array<{ text: string; comingSoon?: boolean }>
  nextTier?: string
  highlight?: boolean
  limits: PlanLimits
}> = {
  anonymous: {
    label: 'Anonymous',
    price: '$0',
    features: [
      { text: '10 MB Postgres · 2 conn · 24h TTL' },
      { text: '5 MB Redis · 24h TTL' },
      { text: '5 MB MongoDB · 24h TTL' },
      { text: '100 stored webhooks' },
      { text: '0 deployments' },
      { text: 'no vault — claim resources first' },
      { text: 'agent-only access · no dashboard account' },
    ],
    nextTier: 'hobby',
    limits: {
      postgres_mb: 10,
      redis_mb: 5,
      mongodb_mb: 5,
      deployments: 0,
      webhooks: 100,
      team_seats: 1,
    },
  },
  // `free` shares anonymous's limits exactly — the only differences are
  // (a) the user has claimed (team_id is set, dashboard is reachable) and
  // (b) the user-facing label, which reads as "you have an account, you
  // just haven't paid yet". Same 24h TTL — pay from day one.
  free: {
    label: 'Free',
    price: '$0',
    features: [
      { text: '10 MB Postgres · 2 conn · 24h TTL' },
      { text: '5 MB Redis · 24h TTL' },
      { text: '5 MB MongoDB · 24h TTL' },
      { text: '100 stored webhooks' },
      { text: '0 deployments' },
      { text: 'no vault — upgrade to Hobby to unlock' },
      { text: 'dashboard access · upgrade to keep resources past 24h' },
    ],
    nextTier: 'hobby',
    limits: {
      postgres_mb: 10,
      redis_mb: 5,
      mongodb_mb: 5,
      deployments: 0,
      webhooks: 100,
      team_seats: 1,
    },
  },
  hobby: {
    label: 'Hobby',
    price: '$9 / mo',
    features: [
      { text: '1 GB Postgres · 8 conn' },
      { text: '50 MB Redis' },
      { text: '100 MB MongoDB · 5 conn' },
      { text: '1 small deployment' },
      { text: '20 vault entries · production env' },
      { text: '*.deployment.instanode.dev domain' },
      { text: '1000 stored webhooks' },
    ],
    nextTier: 'pro',
    limits: {
      postgres_mb: 1024,
      redis_mb: 50,
      mongodb_mb: 100,
      deployments: 1,
      webhooks: 1000,
      team_seats: 1,
    },
  },
  pro: {
    label: 'Pro',
    price: '$49 / mo',
    features: [
      { text: '5 GB Postgres · 20 conn' },
      { text: '256 MB Redis' },
      { text: '2 GB MongoDB · 20 conn' },
      { text: '10 medium deployments' },
      { text: '200 vault entries · multi-env (dev/staging/prod + custom)' },
      { text: 'custom domain' },
      { text: '10k stored webhooks' },
    ],
    nextTier: 'team',
    highlight: true,
    limits: {
      postgres_mb: 5120,
      redis_mb: 256,
      mongodb_mb: 2048,
      deployments: 10,
      webhooks: 10000,
      team_seats: 5,
    },
  },
  team: {
    label: 'Team',
    price: '$199 / mo',
    // Team tier is under active development — every feature shown here is
    // marked comingSoon until the multi-seat / RBAC / SSO surface ships and
    // we publish real per-resource numbers. Don't promise "unlimited X" for
    // capacity we haven't delivered.
    features: [
      { text: 'Everything in Pro, with larger per-resource limits', comingSoon: true },
      { text: 'Multi-seat workspace · RBAC + audit log', comingSoon: true },
      { text: 'SSO / SAML · 99.9% SLA + priority support', comingSoon: true },
      { text: 'Dedicated node pools', comingSoon: true },
      { text: 'Audit log export (CSV/JSONL)', comingSoon: true },
    ],
    // Team-tier capacity is "unlimited" relative to dashboard math — represent
    // as Infinity so usage stays at 0% even for very large totals. UsageRow's
    // formatter renders Infinity as "∞".
    limits: {
      postgres_mb: Infinity,
      redis_mb: Infinity,
      mongodb_mb: Infinity,
      deployments: Infinity,
      webhooks: Infinity,
      team_seats: Infinity,
    },
  },
}

// Split a price string like "$49 / mo" into ("$", "49 / mo") to keep the
// existing CSS structure (small dollar sign + big number + frequency).
function splitPrice(price: string): { symbol: string; rest: string } {
  const m = price.match(/^(\$|₹|€|£)?\s*(.*)$/)
  if (!m) return { symbol: '$', rest: price }
  return { symbol: m[1] ?? '', rest: m[2] ?? '' }
}

export function BillingPage() {
  const { me } = useDashboardCtx()
  const tier = me?.team?.tier ?? 'hobby'
  const plan = PLANS[tier] ?? PLANS.hobby

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

  // ── Discount code state (P3) ───────────────────────────────────────────
  // The input lives behind a "Have a discount code?" toggle so the upgrade
  // CTA isn't crowded for the 95% of users who don't have a code. Once a
  // code validates green it persists into the checkout call via
  // applied.code; users can clear it to type a different one.
  const [promoOpen, setPromoOpen] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const [promoErr, setPromoErr] = useState<string | null>(null)
  const [promoValidating, setPromoValidating] = useState(false)
  const [appliedPromo, setAppliedPromo] = useState<Promotion | null>(null)

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
  }, [])

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

  const { symbol, rest } = splitPrice(plan.price)

  async function handleChangePlan() {
    if (!plan.nextTier) return
    setCheckoutErr(null)
    setCheckoutLoading(true)
    try {
      // Pass promotion_code only when a code has actually been validated
      // green — never the raw input string. If no code is applied, the
      // createCheckout call is invoked with a single arg (matches the
      // pre-P3 signature so existing tests' strict-arg matchers still
      // pass). Otherwise the second-arg opts carry the promo code.
      const r = appliedPromo
        ? await api.createCheckout(plan.nextTier!, { promotion_code: appliedPromo.code })
        : await api.createCheckout(plan.nextTier!)
      if (r.short_url) {
        window.location.href = r.short_url
        return
      }
      setCheckoutErr('checkout returned no url')
    } catch (e: any) {
      setCheckoutErr(e?.message ?? 'checkout failed')
    } finally {
      setCheckoutLoading(false)
    }
  }

  async function handleApplyPromo() {
    if (!plan.nextTier) return
    const code = promoCode.trim()
    if (!code) {
      setPromoErr('Enter a code.')
      return
    }
    setPromoErr(null)
    setPromoValidating(true)
    try {
      const r = await api.validatePromotion(code, plan.nextTier)
      setAppliedPromo(r.promotion)
    } catch (e: any) {
      // Network errors (no status, no message): show the friendly fallback.
      // API errors carrying a server message (404/409/410): surface it.
      if (e?.status === undefined && (e?.name === 'TypeError' || /network|fetch/i.test(e?.message ?? ''))) {
        setPromoErr("couldn't reach the server, try again")
      } else {
        setPromoErr(e?.message ?? 'Code not valid.')
      }
      setAppliedPromo(null)
    } finally {
      setPromoValidating(false)
    }
  }

  function handleClearPromo() {
    setAppliedPromo(null)
    setPromoCode('')
    setPromoErr(null)
    // Collapse back to the discreet toggle — auto-reopening the input
    // would steal focus and surprise the user. They can click "Have a
    // discount code?" again if they want to try a different one.
    setPromoOpen(false)
  }

  return (
    <>
      <ROBanner variant="write" showAsk={false}>
        <strong>Upgrades and card updates stay clickable on this page</strong> — the
        agent doesn't have payment credentials, so the human has to drive the
        Razorpay flow. <strong>To cancel or downgrade, contact support</strong> —
        we don't expose a self-serve path on purpose.
      </ROBanner>


      <div className="plan-card">
        <div className="plan-summary">
          <div className="lbl">current plan</div>
          <h2 style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-0.03em', marginBottom: 4 }}>{plan.label}</h2>
          <div className="price">
            <span style={{ fontSize: 18, color: 'var(--text-dim)' }}>{symbol}</span>
            <span className="num">{rest.replace(/\s*\/\s*mo.*$/, '')}</span>
            <span className="freq">{rest.includes('/') ? `/ ${rest.split('/')[1]?.trim()} · billed monthly` : '· billed monthly'}</span>
          </div>
          <ul className="desc" style={{ listStyle: 'none', padding: 0, margin: '8px 0 12px' }}>
            {plan.features.map((f, i) => (
              <li key={i} style={{ opacity: f.comingSoon ? 0.6 : 1 }}>
                {f.text}
                {f.comingSoon && (
                  <span style={{
                    marginLeft: 6, padding: '1px 6px', fontSize: 10,
                    fontFamily: 'var(--font-mono)', color: 'var(--violet)',
                    border: '1px solid rgba(183,148,246,0.3)', borderRadius: 4,
                    textTransform: 'uppercase', letterSpacing: 0.06,
                  }}>soon</span>
                )}
              </li>
            ))}
          </ul>
          {/* ── Discount code (P3) ───────────────────────────────────────
              Sits below the price + feature list, above the upgrade CTA.
              Only rendered when an upgrade target exists (no point applying
              a discount on team-tier — there's nothing left to upgrade to).
              Collapsed by default; one-line link expands a small input. */}
          {plan.nextTier && (
            <PromoCodePanel
              open={promoOpen}
              code={promoCode}
              validating={promoValidating}
              err={promoErr}
              applied={appliedPromo}
              onOpen={() => setPromoOpen(true)}
              onChangeCode={setPromoCode}
              onApply={handleApplyPromo}
              onClear={handleClearPromo}
            />
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleChangePlan}
              disabled={!plan.nextTier || checkoutLoading}
              title={plan.nextTier ? `Upgrade to ${PLANS[plan.nextTier]?.label ?? plan.nextTier}` : 'You are on the highest plan'}
            >
              {plan.nextTier ? `Upgrade to ${PLANS[plan.nextTier]?.label ?? plan.nextTier}` : 'Change plan'}
            </button>
            <a
              className="btn btn-ghost btn-sm"
              href="mailto:support@instanode.dev?subject=Cancel%20subscription"
              data-testid="contact-support-cancel"
            >
              Cancel? Contact support
            </a>
          </div>
          {checkoutErr && (
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--danger, #c33)', fontFamily: 'var(--font-mono)' }}>
              {checkoutErr}
            </div>
          )}
          <div style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
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
              {/* No self-serve "update payment method" endpoint exists. Route
                  the click through support, matching the cancel pattern. */}
              <a
                className="btn btn-sm btn-ghost"
                style={{ marginLeft: 'auto' }}
                href="mailto:support@instanode.dev?subject=Update%20payment%20method"
                data-testid="contact-support-update-payment"
              >
                Update
              </a>
            </div>
          </div>
        </div>

        <div className="plan-usage">
          <h4>Usage · this period</h4>
          <UsageRow
            k="postgres"
            used={formatMB(usage.postgres_mb)}
            limit={formatLimitMB(plan.limits.postgres_mb)}
            pct={pctOf(usage.postgres_mb, plan.limits.postgres_mb)}
            warn={isWarn(usage.postgres_mb, plan.limits.postgres_mb)}
          />
          <UsageRow
            k="redis"
            used={formatMB(usage.redis_mb)}
            limit={formatLimitMB(plan.limits.redis_mb)}
            pct={pctOf(usage.redis_mb, plan.limits.redis_mb)}
            warn={isWarn(usage.redis_mb, plan.limits.redis_mb)}
          />
          <UsageRow
            k="mongo"
            used={formatMB(usage.mongodb_mb)}
            limit={formatLimitMB(plan.limits.mongodb_mb)}
            pct={pctOf(usage.mongodb_mb, plan.limits.mongodb_mb)}
            warn={isWarn(usage.mongodb_mb, plan.limits.mongodb_mb)}
          />
          <UsageRow
            k="deployments"
            used={String(usage.deployments)}
            limit={formatLimitCount(plan.limits.deployments)}
            pct={pctOf(usage.deployments, plan.limits.deployments)}
            warn={isWarn(usage.deployments, plan.limits.deployments)}
          />
          <UsageRow
            k="webhooks"
            used={String(usage.webhooks)}
            limit={formatLimitCount(plan.limits.webhooks)}
            pct={pctOf(usage.webhooks, plan.limits.webhooks)}
            warn={isWarn(usage.webhooks, plan.limits.webhooks)}
          />
          <UsageRow
            k="team seats"
            used={String(usage.team_seats)}
            limit={formatLimitCount(plan.limits.team_seats)}
            pct={pctOf(usage.team_seats, plan.limits.team_seats)}
            warn={isWarn(usage.team_seats, plan.limits.team_seats)}
          />
          {/* §10.20: visible eventual-consistency footnote. The Usage panel
              is server-cached for 30s — render the freshness so users can
              tell whether they're looking at a fresh read or a cached one
              (and don't expect provision/delete to update instantly).
              Hidden until the first fetch completes so we don't render
              "as of —". */}
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
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div className="section-h">
          <h2>Invoices</h2>
          <span className="sub">via razorpay</span>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div className="invoice-row head">
            <span>id</span>
            <span>period</span>
            <span>plan</span>
            <span>status</span>
            <span>amount</span>
          </div>
          {invoices.map((i) => (
            <div key={i.id} className="invoice-row">
              <span className="id">{i.id}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-dim)' }}>
                {new Date(i.period_start).toLocaleDateString()} → {new Date(i.period_end).toLocaleDateString()}
              </span>
              <TierPill tier={i.plan} />
              {/* Show the real invoice status (paid/pending/failed), not a
                  hardcoded "running" pill. StatusPill doesn't style these
                  three, so render a plain mono span. (§10.8.) */}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                {i.status}
              </span>
              <span className="amt">
                ${(i.amount_cents / 100).toFixed(2)}
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

// ─── PromoCodePanel (P3) ───────────────────────────────────────────────
// Collapsed state: a small "Have a discount code?" link button.
// Open + unapplied state: input + Apply button + (optional) error msg.
// Open + applied state: green checkmark + applied description + Remove.
//
// Keeping this as a sub-component keeps BillingPage scannable — the
// upgrade flow is the headline; this is a side rail. State lives in the
// parent so the applied code can be passed into createCheckout.
function PromoCodePanel({
  open,
  code,
  validating,
  err,
  applied,
  onOpen,
  onChangeCode,
  onApply,
  onClear,
}: {
  open: boolean
  code: string
  validating: boolean
  err: string | null
  applied: Promotion | null
  onOpen: () => void
  onChangeCode: (s: string) => void
  onApply: () => void
  onClear: () => void
}) {
  // Applied state — small green chip with the discount description and a
  // Remove action. Sits where the input was so the layout doesn't jump.
  if (applied) {
    return (
      <div
        data-testid="promo-applied"
        style={{
          marginBottom: 12,
          padding: '8px 12px',
          background: 'rgba(46, 160, 67, 0.08)',
          border: '1px solid rgba(46, 160, 67, 0.3)',
          borderLeft: '3px solid var(--green, #2ea043)',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12.5,
        }}
      >
        <span aria-hidden="true" style={{ color: 'var(--green, #2ea043)', fontSize: 14, lineHeight: 1 }}>✓</span>
        <span data-testid="promo-applied-text">
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)' }}>{applied.code}</code>
          {' '}applied: {formatDiscount(applied)}
        </span>
        <button
          type="button"
          data-testid="promo-clear"
          onClick={onClear}
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 'auto', fontSize: 11 }}
        >
          Remove
        </button>
      </div>
    )
  }

  // Collapsed state — single discreet link. Click expands the input.
  if (!open) {
    return (
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          data-testid="promo-toggle"
          onClick={onOpen}
          className="btn btn-ghost btn-sm"
          style={{
            padding: '2px 0',
            fontSize: 12,
            color: 'var(--text-dim)',
            background: 'transparent',
            border: 'none',
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
            textUnderlineOffset: 3,
            cursor: 'pointer',
          }}
        >
          Have a discount code?
        </button>
      </div>
    )
  }

  // Open + unapplied state — input + Apply.
  return (
    <div data-testid="promo-input-row" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          data-testid="promo-input"
          aria-label="Discount code"
          placeholder="DISCOUNT CODE"
          value={code}
          onChange={(e) => onChangeCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!validating) onApply()
            }
          }}
          autoFocus
          disabled={validating}
          style={{
            flex: '1 1 auto',
            maxWidth: 220,
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        />
        <button
          type="button"
          data-testid="promo-apply"
          onClick={onApply}
          disabled={validating || !code.trim()}
          className="btn btn-secondary btn-sm"
          style={{ fontSize: 12 }}
        >
          {validating ? 'Checking…' : 'Apply'}
        </button>
      </div>
      {err && (
        <div
          data-testid="promo-error"
          role="alert"
          style={{
            marginTop: 6,
            fontSize: 11.5,
            color: 'var(--danger, #c33)',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span aria-hidden="true">✗</span>
          <span>{err}</span>
        </div>
      )}
    </div>
  )
}

// formatDiscount — turns a Promotion.discount object into a human-friendly
// chip. Falls back to a generic "discount applied" for unknown kinds so the
// UI is forward-compatible if the api ships a new discount shape.
function formatDiscount(p: Promotion): string {
  const d = p.discount
  if (d.kind === 'percent_off') {
    const span = d.applies_to && d.unit
      ? ` first ${d.applies_to} ${d.unit}`
      : d.applies_to === 1
        ? ' first month'
        : ''
    return `${d.value}% off${span}`
  }
  if (d.kind === 'amount_off') {
    return `$${(d.value / 100).toFixed(2)} off`
  }
  if (d.kind === 'free_period') {
    const unit = d.unit ?? 'months'
    return `${d.value} ${unit} free`
  }
  return 'discount applied'
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
