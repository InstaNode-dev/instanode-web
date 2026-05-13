// CustomerDetailDrawer — right-side slide-in panel for the founder's
// admin console. Row clicks on AdminCustomersPage open this drawer
// instead of navigating away, so the operator keeps the list context
// (filters, sort, scroll position) while drilling into a customer.
//
// Tabs:
//   • Overview  — email, name, tier, signup date, MRR, last login,
//                 Razorpay subscription status
//   • Resources — every resource owned by the team (type/env/storage/
//                 expiry)
//   • Activity  — last 20 audit_log entries (kind + summary + timestamp)
//   • Promos    — issued promo codes + "Issue new" CTA
//
// Two actions live in the header:
//   • "Promote / demote tier" — opens TierChangeModal
//   • "Issue promo"           — opens IssuePromoModal
//
// Both refetch detail on success so the drawer reflects new tier /
// audit / promo rows without a page reload.

import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import type {
  AdminCustomerDetailResponse,
  AdminCustomerSummary,
} from '../api/types'
import { EnvPill, RelTime, TierPill } from './Common'
import { IssuePromoModal } from './IssuePromoModal'
import { TierChangeModal } from './TierChangeModal'

type Tab = 'overview' | 'resources' | 'activity' | 'promos'

interface Props {
  summary: AdminCustomerSummary
  onClose: () => void
}

function formatINR(amount?: number | null): string {
  if (amount == null || !Number.isFinite(amount) || amount === 0) return '—'
  // Track A returns amounts in paise. Render in INR with locale grouping.
  const rupees = amount / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees)
}

export function formatBytes(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b) || b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = b
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const digits = v >= 100 || i === 0 ? 0 : 1
  return `${v.toFixed(digits)} ${units[i]}`
}

export function CustomerDetailDrawer({ summary, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [detail, setDetail] = useState<AdminCustomerDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPromo, setShowPromo] = useState(false)
  const [showTier, setShowTier] = useState(false)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.getAdminCustomer(summary.team_id)
      setDetail(r)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load customer detail')
    } finally {
      setLoading(false)
    }
  }, [summary.team_id])

  useEffect(() => {
    void refetch()
  }, [refetch])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Current tier — prefer the freshly-fetched detail, fall back to the
  // summary so the modal opens with the correct seed even mid-load.
  const currentTier = detail?.team?.tier ?? summary.tier

  return (
    <>
      <div
        data-testid="customer-drawer-overlay"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 900,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Customer ${summary.primary_email}`}
        data-testid="customer-drawer"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(560px, 100vw)',
          background: 'var(--bg, #fff)',
          boxShadow: '-12px 0 32px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 950,
        }}
      >
        <header
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border, #eee)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              data-testid="drawer-email"
            >
              {summary.primary_email}
            </h3>
            <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
              <TierPill tier={currentTier} />
              <span className="dim" style={{ fontSize: 12 }}>
                team {summary.team_id.slice(0, 8)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            data-testid="drawer-close"
            className="btn"
            style={{ flexShrink: 0 }}
          >
            ✕
          </button>
        </header>

        <div
          style={{
            padding: '10px 20px',
            display: 'flex',
            gap: 8,
            borderBottom: '1px solid var(--border, #eee)',
          }}
        >
          <button
            type="button"
            onClick={() => setShowTier(true)}
            data-testid="drawer-change-tier"
            className="btn"
          >
            Promote / demote tier
          </button>
          <button
            type="button"
            onClick={() => setShowPromo(true)}
            data-testid="drawer-issue-promo"
            className="btn"
          >
            Issue promo
          </button>
        </div>

        <nav
          role="tablist"
          aria-label="Customer detail tabs"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border, #eee)',
          }}
        >
          {(['overview', 'resources', 'activity', 'promos'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-testid={`drawer-tab-${t}`}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '10px 12px',
                background: tab === t ? 'var(--accent-soft, #eef)' : 'transparent',
                border: 0,
                borderBottom:
                  tab === t ? '2px solid var(--accent, #44f)' : '2px solid transparent',
                fontSize: 12,
                textTransform: 'capitalize',
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </nav>

        <div
          style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}
          data-testid="drawer-body"
        >
          {loading && (
            <p data-testid="drawer-loading" className="dim" style={{ fontSize: 13 }}>
              Loading…
            </p>
          )}
          {error && !loading && (
            <p
              role="alert"
              data-testid="drawer-error"
              style={{
                padding: 8,
                background: 'rgba(220,38,38,0.08)',
                color: 'var(--red, #b91c1c)',
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              {error}
            </p>
          )}

          {!loading && !error && detail && tab === 'overview' && (
            <OverviewTab summary={summary} detail={detail} />
          )}
          {!loading && !error && detail && tab === 'resources' && (
            <ResourcesTab detail={detail} />
          )}
          {!loading && !error && detail && tab === 'activity' && (
            <ActivityTab detail={detail} />
          )}
          {!loading && !error && detail && tab === 'promos' && (
            <PromosTab
              detail={detail}
              onOpenIssuePromo={() => setShowPromo(true)}
            />
          )}
        </div>
      </aside>

      {showPromo && (
        <IssuePromoModal
          teamID={summary.team_id}
          primaryEmail={summary.primary_email}
          onClose={() => setShowPromo(false)}
          onIssued={() => {
            // Audit + promo lists pick up the new entry on refetch.
            void refetch()
          }}
        />
      )}
      {showTier && (
        <TierChangeModal
          teamID={summary.team_id}
          primaryEmail={summary.primary_email}
          currentTier={currentTier}
          onClose={() => setShowTier(false)}
          onChanged={() => {
            void refetch()
          }}
        />
      )}
    </>
  )
}

function OverviewTab({
  summary,
  detail,
}: {
  summary: AdminCustomerSummary
  detail: AdminCustomerDetailResponse
}) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Email', summary.primary_email],
    ['Name', detail.team?.display_name ?? detail.team?.name ?? summary.name ?? '—'],
    ['Tier', <TierPill key="tier" tier={detail.team?.tier ?? summary.tier} />],
    [
      'Signed up',
      detail.team?.created_at ? (
        <RelTime at={detail.team.created_at} />
      ) : summary.created_at ? (
        <RelTime at={summary.created_at} />
      ) : (
        '—'
      ),
    ],
    [
      'MRR (monthly)',
      formatINR(summary.mrr_monthly) +
        (summary.mrr_yearly > 0 ? ` · yearly ${formatINR(summary.mrr_yearly)}` : ''),
    ],
    ['Last active', summary.last_active ? <RelTime at={summary.last_active} /> : '—'],
    [
      'Razorpay subscription',
      detail.subscription?.status
        ? `${detail.subscription.status}${
            detail.subscription.razorpay_subscription_id
              ? ` · ${detail.subscription.razorpay_subscription_id}`
              : ''
          }`
        : 'none',
    ],
    [
      'Next renewal',
      detail.subscription?.next_renewal_at ? (
        <RelTime at={detail.subscription.next_renewal_at} />
      ) : (
        '—'
      ),
    ],
    ['Active deployments', String(summary.deployments_active ?? 0)],
    ['Storage used', formatBytes(summary.storage_bytes)],
    ['Team members', String(detail.users?.length ?? 0)],
  ]

  return (
    <dl
      data-testid="drawer-overview"
      style={{
        display: 'grid',
        gridTemplateColumns: '40% 60%',
        gap: '6px 12px',
        margin: 0,
        fontSize: 13,
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt className="dim" style={{ fontWeight: 500 }}>
            {k}
          </dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ResourcesTab({ detail }: { detail: AdminCustomerDetailResponse }) {
  if (!detail.resources || detail.resources.length === 0) {
    return (
      <p data-testid="drawer-resources-empty" className="dim" style={{ fontSize: 13 }}>
        No resources.
      </p>
    )
  }
  return (
    <table
      data-testid="drawer-resources"
      className="data-table"
      style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
    >
      <thead>
        <tr style={{ textAlign: 'left' }}>
          <th style={{ padding: '6px 4px' }}>Type</th>
          <th style={{ padding: '6px 4px' }}>Name</th>
          <th style={{ padding: '6px 4px' }}>Env</th>
          <th style={{ padding: '6px 4px' }}>Storage</th>
          <th style={{ padding: '6px 4px' }}>Expires</th>
        </tr>
      </thead>
      <tbody>
        {detail.resources.map((r) => (
          <tr
            key={r.id}
            data-testid={`drawer-resource-${r.id}`}
            style={{ borderTop: '1px solid var(--border, #eee)' }}
          >
            <td style={{ padding: '6px 4px' }}>{r.resource_type}</td>
            <td style={{ padding: '6px 4px' }}>{r.name ?? r.token.slice(0, 12)}</td>
            <td style={{ padding: '6px 4px' }}>
              <EnvPill env={r.env} />
            </td>
            <td style={{ padding: '6px 4px' }}>{formatBytes(r.storage_bytes)}</td>
            <td style={{ padding: '6px 4px' }}>
              {r.expires_at ? <RelTime at={r.expires_at} /> : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ActivityTab({ detail }: { detail: AdminCustomerDetailResponse }) {
  const items = (detail.audit_log ?? []).slice(0, 20)
  if (items.length === 0) {
    return (
      <p data-testid="drawer-activity-empty" className="dim" style={{ fontSize: 13 }}>
        No activity yet.
      </p>
    )
  }
  return (
    <ul
      data-testid="drawer-activity"
      style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}
    >
      {items.map((e) => (
        <li
          key={e.id}
          data-testid={`drawer-activity-row-${e.id}`}
          style={{
            padding: '8px 0',
            borderTop: '1px solid var(--border, #eee)',
            display: 'flex',
            gap: 8,
          }}
        >
          <span
            className="dim"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              flexShrink: 0,
              minWidth: 80,
            }}
          >
            {e.kind}
          </span>
          <span style={{ flex: 1 }}>{e.summary}</span>
          <span className="dim" style={{ fontSize: 11, flexShrink: 0 }}>
            <RelTime at={e.at} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function PromosTab({
  detail,
  onOpenIssuePromo,
}: {
  detail: AdminCustomerDetailResponse
  onOpenIssuePromo: () => void
}) {
  const promos = detail.promos ?? []
  return (
    <div data-testid="drawer-promos">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 13 }}>Issued promo codes</h4>
        <button
          type="button"
          onClick={onOpenIssuePromo}
          className="btn"
          data-testid="drawer-promos-issue-new"
        >
          Issue new
        </button>
      </div>
      {promos.length === 0 ? (
        <p data-testid="drawer-promos-empty" className="dim" style={{ fontSize: 13 }}>
          No promo codes issued yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
          {promos.map((p) => (
            <li
              key={p.id}
              data-testid={`drawer-promo-row-${p.id}`}
              style={{
                padding: '8px 0',
                borderTop: '1px solid var(--border, #eee)',
                display: 'flex',
                gap: 8,
              }}
            >
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--accent-soft, #eef)',
                  padding: '2px 6px',
                  borderRadius: 3,
                }}
              >
                {p.code}
              </code>
              <span className="dim" style={{ flex: 1 }}>
                {p.kind === 'first_month_free'
                  ? 'first month free'
                  : p.kind === 'percent_off'
                  ? `${p.value}% off`
                  : `$${p.value} off`}
                {p.applies_to > 0 ? ` · first ${p.applies_to} mo` : ' · ongoing'}
              </span>
              <span className="dim" style={{ fontSize: 11, flexShrink: 0 }}>
                {p.expires_at ? <RelTime at={p.expires_at} /> : 'no expiry'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
