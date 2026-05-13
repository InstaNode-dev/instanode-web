// AdminCustomersPage — founder console at /app/admin/customers. Lists
// every team in the platform with tier, MRR, storage, and last-active.
// Clicking a row opens the CustomerDetailDrawer (slide-in panel) so
// the operator never loses the list context. Two write actions live
// inside the drawer: change tier (with type-to-confirm safety) and
// issue a promo code.
//
// Route gating is two-layered:
//   1. The sidebar link is conditionally rendered in AppShell from
//      ctx.me?.is_platform_admin.
//   2. This page also reads is_platform_admin from useDashboardCtx and
//      renders a NotFound surface for non-admin users — the route
//      effectively 404s without leaking that the page exists.
//
// Loading order:
//   - On mount, fire listAdminCustomers(); show a quiet skeleton
//   - Filter pills + search debounce into a refetch
//   - Sort headers cycle asc / desc / unset (default sort_by=mrr desc)

import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import * as api from '../api'
import type { AdminCustomerSummary, Tier } from '../api/types'
import { TierPill } from '../components/Common'
import { CustomerDetailDrawer, formatBytes } from '../components/CustomerDetailDrawer'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

type SortKey =
  | 'mrr'
  | 'storage'
  | 'deployments'
  | 'last_active'
  | 'created_at'
  | 'email'
  | 'tier'

type SortDir = 'asc' | 'desc'

const FILTER_PILLS: Array<{ key: 'all' | Tier; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'anonymous', label: 'Anonymous' },
  { key: 'free', label: 'Free' },
  { key: 'hobby', label: 'Hobby' },
  { key: 'pro', label: 'Pro' },
  { key: 'team', label: 'Team' },
]

function formatINRCompact(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '—'
  const rupees = amount / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

// Client-side sort. We could let the server do it, but the result set is
// small (Track A clamps to 200) and a client comparator gives us instant
// header-click feedback without burning a round-trip.
function sortRows(
  rows: AdminCustomerSummary[],
  key: SortKey,
  dir: SortDir,
): AdminCustomerSummary[] {
  const m = dir === 'asc' ? 1 : -1
  const copy = [...rows]
  copy.sort((a, b) => {
    switch (key) {
      case 'mrr':
        return (a.mrr_monthly - b.mrr_monthly) * m
      case 'storage':
        return (a.storage_bytes - b.storage_bytes) * m
      case 'deployments':
        return (a.deployments_active - b.deployments_active) * m
      case 'last_active': {
        const av = a.last_active ? new Date(a.last_active).getTime() : 0
        const bv = b.last_active ? new Date(b.last_active).getTime() : 0
        return (av - bv) * m
      }
      case 'created_at': {
        const av = a.created_at ? new Date(a.created_at).getTime() : 0
        const bv = b.created_at ? new Date(b.created_at).getTime() : 0
        return (av - bv) * m
      }
      case 'email':
        return a.primary_email.localeCompare(b.primary_email) * m
      case 'tier':
        return a.tier.localeCompare(b.tier) * m
      default:
        return 0
    }
  })
  return copy
}

export function AdminCustomersPage() {
  const ctx = useDashboardCtx()
  const [rows, setRows] = useState<AdminCustomerSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | Tier>('all')
  const [sortKey, setSortKey] = useState<SortKey>('mrr')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [openTeamID, setOpenTeamID] = useState<string | null>(null)

  // Gate the entire page on the admin flag. We render Navigate(*) which
  // matches the dashboard's catch-all and redirects to "/" — i.e., the
  // route 404-equivalents instead of 403-ing. Non-admin users never
  // learn the URL exists.
  const me = ctx.me
  const meLoading = ctx.meLoading
  const isAdmin = me?.is_platform_admin === true

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    setLoading(true)
    setError(null)
    api
      .listAdminCustomers({
        q: search,
        tier: tierFilter,
      })
      .then((r) => {
        if (!alive) return
        setRows(r.customers)
        setTotal(r.total)
      })
      .catch((e) => {
        if (!alive) return
        setError(e?.message ?? 'Could not load customers')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // search / tier trigger refetches; sort is purely client-side because
    // the result set is small (Track A clamps to 200). If the result set
    // grows, switch this to a server-side sort.
  }, [isAdmin, search, tierFilter])

  const sortedRows = useMemo(
    () => sortRows(rows, sortKey, sortDir),
    [rows, sortKey, sortDir],
  )

  function handleHeaderClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Default to descending for numeric columns (MRR/storage/deployments)
      // because the operator usually wants the biggest customer first.
      setSortDir(
        key === 'email' || key === 'tier' || key === 'created_at' ? 'asc' : 'desc',
      )
    }
  }

  // While me is loading, render nothing — the AppShell already shows a
  // chrome-level loading state and rendering Navigate too early would
  // bounce the user away before we know whether they're an admin.
  if (meLoading) {
    return (
      <p className="dim" data-testid="admin-customers-loading">
        Loading…
      </p>
    )
  }

  if (!isAdmin) {
    return <Navigate to="/" replace data-testid="admin-customers-redirect" />
  }

  const openRow = openTeamID ? rows.find((r) => r.team_id === openTeamID) ?? null : null

  return (
    <div data-testid="admin-customers-page">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>Customers</h2>
        <span className="dim" data-testid="admin-customers-count">
          {total} total
        </span>
        <span style={{ flex: 1 }} />
        <div
          role="tablist"
          aria-label="Filter by tier"
          style={{ display: 'flex', gap: 6 }}
        >
          {FILTER_PILLS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={tierFilter === p.key}
              data-testid={`admin-filter-${p.key}`}
              onClick={() => setTierFilter(p.key)}
              className={`btn ${tierFilter === p.key ? 'primary' : ''}`}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                background:
                  tierFilter === p.key ? 'var(--accent-soft, #eef)' : 'transparent',
                border: '1px solid var(--border, #ddd)',
                borderRadius: 16,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email…"
          data-testid="admin-customers-search"
          style={{
            padding: '6px 10px',
            fontSize: 13,
            minWidth: 200,
          }}
        />
      </header>

      {error && (
        <p
          role="alert"
          data-testid="admin-customers-error"
          style={{
            padding: 10,
            background: 'rgba(220,38,38,0.08)',
            color: 'var(--red, #b91c1c)',
            fontSize: 13,
            borderRadius: 4,
          }}
        >
          {error}
        </p>
      )}

      {loading && !error && (
        <p className="dim" data-testid="admin-customers-loading">
          Loading customers…
        </p>
      )}

      {!loading && !error && sortedRows.length === 0 && (
        <p
          className="dim"
          data-testid="admin-customers-empty"
          style={{ fontSize: 14, padding: '32px 0' }}
        >
          No customers match that filter
        </p>
      )}

      {!loading && !error && sortedRows.length > 0 && (
        <table
          className="data-table"
          data-testid="admin-customers-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border, #eee)' }}>
              <SortHeader
                k="email"
                label="Email"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={handleHeaderClick}
              />
              <SortHeader
                k="tier"
                label="Tier"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={handleHeaderClick}
              />
              <SortHeader
                k="mrr"
                label="MRR"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={handleHeaderClick}
                align="right"
              />
              <SortHeader
                k="storage"
                label="Storage"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={handleHeaderClick}
                align="right"
              />
              <SortHeader
                k="deployments"
                label="Deploys"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={handleHeaderClick}
                align="right"
              />
              <SortHeader
                k="last_active"
                label="Last active"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={handleHeaderClick}
              />
              <SortHeader
                k="created_at"
                label="Signed up"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={handleHeaderClick}
              />
              <th style={{ padding: '8px 6px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={row.team_id}
                data-testid={`admin-customer-row-${row.team_id}`}
                onClick={() => setOpenTeamID(row.team_id)}
                style={{
                  borderTop: '1px solid var(--border, #eee)',
                  cursor: 'pointer',
                }}
              >
                <td style={{ padding: '8px 6px' }}>{row.primary_email}</td>
                <td style={{ padding: '8px 6px' }}>
                  <TierPill tier={row.tier} />
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                  {formatINRCompact(row.mrr_monthly)}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                  {formatBytes(row.storage_bytes)}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                  {row.deployments_active}
                </td>
                <td style={{ padding: '8px 6px' }}>{formatDate(row.last_active)}</td>
                <td style={{ padding: '8px 6px' }}>{formatDate(row.created_at)}</td>
                <td
                  style={{ padding: '8px 6px' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setOpenTeamID(row.team_id)}
                    data-testid={`admin-customer-open-${row.team_id}`}
                    className="btn"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openRow && (
        <CustomerDetailDrawer
          summary={openRow}
          onClose={() => setOpenTeamID(null)}
        />
      )}
    </div>
  )
}

function SortHeader({
  k,
  label,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  k: SortKey
  label: string
  sortKey: SortKey
  sortDir: SortDir
  onClick: (k: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sortKey === k
  const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th
      onClick={() => onClick(k)}
      data-testid={`admin-sort-${k}`}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{
        padding: '8px 6px',
        cursor: 'pointer',
        userSelect: 'none',
        textAlign: align ?? 'left',
        fontWeight: 600,
      }}
    >
      {label}
      <span style={{ fontWeight: 400 }}>{arrow}</span>
    </th>
  )
}
