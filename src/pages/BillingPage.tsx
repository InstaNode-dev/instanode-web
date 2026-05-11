import { useEffect, useState } from 'react'
import { ROBanner, ContractBanner, TierPill, StatusPill, RelTime } from '../components/Common'
import * as api from '../api'
import type { BillingDetails, Invoice } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

const PLANS: Record<string, {
  label: string
  price: string
  features: Array<{ text: string; comingSoon?: boolean }>
  nextTier?: string
  highlight?: boolean
}> = {
  anonymous: {
    label: 'Anonymous (free)',
    price: '$0',
    features: [
      { text: '10 MB Postgres · 2 conn · 24h TTL' },
      { text: '5 MB Redis · 24h TTL' },
      { text: '5 MB MongoDB · 24h TTL' },
      { text: '100 stored webhooks' },
      { text: '0 deployments' },
      { text: 'no vault — claim resources first' },
      { text: 'agent-only access' },
    ],
    nextTier: 'hobby',
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
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  useEffect(() => {
    Promise.all([api.fetchBilling(), api.listInvoices()]).then(([b, i]) => {
      setBilling(b.billing)
      setInvoices(i.invoices)
    })
  }, [])

  if (!billing) return <div className="skel" style={{ width: '100%', height: 320 }} />

  const { symbol, rest } = splitPrice(plan.price)

  async function handleChangePlan() {
    if (!plan.nextTier) return
    setCheckoutErr(null)
    setCheckoutLoading(true)
    try {
      const r = await api.createCheckout(plan.nextTier!)
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

  async function handleCancel() {
    if (!window.confirm('Cancel your subscription? You will keep access until the end of the current period.')) return
    setCheckoutErr(null)
    try {
      await api.cancelSubscription()
      // Razorpay processes the cancellation asynchronously and emits a
      // subscription.cancelled webhook that downgrades the team. The new
      // tier won't appear until the next page reload picks up the
      // updated whoami, so re-read the billing card and tell the user
      // that the downgrade is in flight.
      const b = await api.fetchBilling()
      setBilling(b.billing)
      window.alert('Cancellation requested. Your tier downgrades when Razorpay finalises (usually within seconds). Refresh the page in a moment.')
    } catch (e: any) {
      setCheckoutErr(e?.message ?? 'cancel failed')
    }
  }

  return (
    <>
      <ROBanner variant="write" showAsk={false}>
        <strong>This is the only page where you click to act.</strong> Cards belong to humans, not agents. Plan changes, cancellations, and card updates all stay clickable — and the agent never has the credentials to call <code>POST /billing/checkout</code> on your behalf.
      </ROBanner>

      <ContractBanner kind="locked" badge="locked">
        <strong>6 endpoints live.</strong> <code>GET /billing</code> · <code>POST /checkout</code> · <code>/cancel</code> · <code>GET /invoices</code> · <code>POST /update-payment</code> · <code>POST /change-plan</code>.
      </ContractBanner>

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
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleChangePlan}
              disabled={!plan.nextTier || checkoutLoading}
              title={plan.nextTier ? `Upgrade to ${PLANS[plan.nextTier]?.label ?? plan.nextTier}` : 'You are on the highest plan'}
            >
              {plan.nextTier ? `Upgrade to ${PLANS[plan.nextTier]?.label ?? plan.nextTier}` : 'Change plan'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleCancel}>Cancel subscription</button>
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
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                expires {billing.payment_exp_month}/{billing.payment_exp_year} · auto-renews{' '}
                {billing.current_period_end && new Date(billing.current_period_end).toLocaleDateString()}
              </span>
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }}>Update</button>
            </div>
          </div>
        </div>

        <div className="plan-usage">
          <h4>Usage · this period</h4>
          <UsageRow k="postgres"     used="47"   limit="500" pct={9} />
          <UsageRow k="redis"        used="163"  limit="256" pct={64} warn />
          <UsageRow k="mongo"        used="1.64" limit="2 GB" pct={82} warn />
          <UsageRow k="deployments"  used="3"    limit="5"   pct={60} />
          <UsageRow k="webhooks"     used="1.4k" limit="10k" pct={14} />
          <UsageRow k="team seats"   used="5"    limit="5"   pct={100} />
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
              <StatusPill status="running" />
              <span className="amt">
                ${(i.amount_cents / 100).toFixed(2)} <a href="#" className="dl">↓ pdf</a>
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
