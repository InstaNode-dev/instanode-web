// AuditPanel.tsx — renders the Audit tab on ResourceDetailPage.
//
// Replaces the prior `status="gap"` placeholder + early-access CTA.
// Calls fetchResourceAudit(resourceId, 24) on mount: under the hood
// that hits the team-level GET /api/v1/audit?since=<24h-ago>&limit=200
// and filters client-side for rows whose metadata.resource_id matches
// the resource we're looking at. The team-level endpoint already
// enforces ownership (rows scoped to team_id OR a resource the team
// owns), so the client-side cut is precision, not a security boundary.
//
// Honesty contract:
//   - No fake rows. An empty response renders an empty state.
//   - A 402 from the API (anonymous/free tier) renders the upgrade
//     prompt inline rather than an error banner. Hobby/Pro/Team can
//     see audit history; Hobby is capped at 30 days but for the
//     Audit tab default of 24h that floor is never the binding cap.
//   - Other failures render an error banner with the message; we
//     don't synthesise from resource timestamps the way the overview
//     activity feed does. The audit tab is "what really happened",
//     not "what we can show".

import { useEffect, useState } from 'react'
import * as api from '../api'
import type { ResourceAuditEvent } from '../api'
import { Card } from './Common'

const SINCE_HOURS = 24

interface AuditPanelProps {
  /** The resource UUID. Used to filter audit rows whose
   *  metadata.resource_id matches. The dashboard's `Resource` shape
   *  uses `id` for the row's UUID; the `token` field is a different
   *  surface and must NOT be passed here. */
  resourceId: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; status?: number }
  | { kind: 'ready'; rows: ResourceAuditEvent[]; lookbackDays: number; tier: string }

export function AuditPanel({ resourceId }: AuditPanelProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function fetchOnce() {
      try {
        const r = await api.fetchResourceAudit(resourceId, SINCE_HOURS)
        if (cancelled) return
        setState({
          kind: 'ready',
          rows: r.items,
          lookbackDays: r.lookback_days,
          tier: r.tier,
        })
      } catch (e) {
        if (cancelled) return
        const err = e as { status?: number; message?: string }
        setState({
          kind: 'error',
          status: err.status,
          message: err.message ?? 'Failed to load audit log',
        })
      }
    }

    void fetchOnce()
    return () => {
      cancelled = true
    }
  }, [resourceId])

  if (state.kind === 'loading') {
    return (
      <Card title={`Audit · last ${SINCE_HOURS}h`}>
        <div data-testid="audit-loading" className="skel" style={{ width: '100%', height: 220 }} />
      </Card>
    )
  }

  if (state.kind === 'error') {
    // 402 = anonymous/free tier hitting the audit gate. Render an
    // upgrade prompt rather than a red error banner.
    if (state.status === 402) {
      return (
        <Card
          title={`Audit · last ${SINCE_HOURS}h`}
          right={<span style={{ color: 'var(--rose)' }}>upgrade required</span>}
        >
          <div
            data-testid="audit-upgrade-required"
            style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}
          >
            Audit history is a Hobby+ feature.{' '}
            <a
              href="https://instanode.dev/pricing"
              style={{ color: 'var(--rose)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              Upgrade to unlock →
            </a>
          </div>
        </Card>
      )
    }
    return (
      <Card title={`Audit · last ${SINCE_HOURS}h`}>
        <div
          role="alert"
          data-testid="audit-error"
          style={{
            padding: 16,
            color: 'var(--rose)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
          }}
        >
          {state.message}
        </div>
      </Card>
    )
  }

  if (state.rows.length === 0) {
    return (
      <Card
        title={`Audit · last ${SINCE_HOURS}h`}
        right={
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            tier: {state.tier || 'unknown'}
          </span>
        }
      >
        <div
          data-testid="audit-empty"
          style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}
        >
          No audit events for this resource in the last {SINCE_HOURS}h. Provisioning,
          rotation, pause/resume, and deletion events will appear here as they happen.
        </div>
      </Card>
    )
  }

  return (
    <Card
      title={`Audit · last ${SINCE_HOURS}h`}
      right={
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          {state.rows.length} event{state.rows.length === 1 ? '' : 's'}
          {' · tier '}
          {state.tier || 'unknown'}
        </span>
      }
    >
      <div data-testid="audit-table" className="table" role="table">
        <div
          className="table-row"
          role="row"
          style={{
            gridTemplateColumns: '1.1fr 1.1fr 1fr 2fr',
            fontSize: 10.5,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          <span role="columnheader">timestamp</span>
          <span role="columnheader">actor</span>
          <span role="columnheader">kind</span>
          <span role="columnheader">meta</span>
        </div>
        {state.rows.map((ev) => (
          <div
            key={ev.id}
            role="row"
            data-testid={`audit-row-${ev.id}`}
            className="table-row"
            style={{
              gridTemplateColumns: '1.1fr 1.1fr 1fr 2fr',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span role="cell" title={ev.created_at}>
              {new Date(ev.created_at).toLocaleString()}
            </span>
            <span role="cell" style={{ color: 'var(--text-dim)' }}>
              {ev.actor_email_masked ?? 'system'}
            </span>
            <span role="cell">{ev.kind}</span>
            <span
              role="cell"
              style={{
                color: 'var(--text-faint)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={ev.metadata ? JSON.stringify(ev.metadata) : ''}
            >
              {ev.metadata ? JSON.stringify(ev.metadata) : '—'}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
