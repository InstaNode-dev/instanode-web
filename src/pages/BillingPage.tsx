import { useEffect, useMemo, useState } from 'react'
import { ROBanner, ContractBanner, TierPill } from '../components/Common'
import * as api from '../api'
import type { BillingDetails, Invoice, Resource } from '../api'
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
  const [resources, setResources] = useState<Resource[]>([])
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  useEffect(() => {
    // Three independent reads — billing, invoices, and resources (for the
    // Usage panel). A failure on one shouldn't blank the whole page, so each
    // is guarded individually and fed into its own state slot.
    Promise.all([
      api.fetchBilling(),
      api.listInvoices(),
      api.listResources().catch(() => ({ items: [] as Resource[] })),
    ]).then(([b, i, r]) => {
      setBilling(b.billing)
      setInvoices(i.invoices)
      setResources((r as { items?: Resource[] }).items ?? [])
    })
  }, [])

  // Aggregate live resource usage per type so the Usage panel reflects the
  // user's actual footprint instead of the old hand-rolled fixture numbers.
  // Storage figures sum `storage_bytes` from postgres/redis/mongodb resources;
  // deployments / webhooks are simple counts.
  const usage = useMemo(() => {
    const sumBytes = (t: string) =>
      resources
        .filter((r) => r.resource_type === t)
        .reduce((s, r) => s + (r.storage_bytes ?? 0), 0)
    return {
      postgres_mb: sumBytes('postgres') / (1024 * 1024),
      redis_mb: sumBytes('redis') / (1024 * 1024),
      mongodb_mb: sumBytes('mongodb') / (1024 * 1024),
      deployments: resources.filter((r) => r.resource_type === 'deploy').length,
      webhooks: resources.filter((r) => r.resource_type === 'webhook').length,
      // We don't have a team-members list endpoint on the dashboard yet, so
      // seats stays at 1 here. Sidebar `counts.team` shares the same gap —
      // tracked in §10.7.
      team_seats: 1,
    }
  }, [resources])

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
