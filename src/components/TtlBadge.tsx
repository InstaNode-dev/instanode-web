// TtlBadge.tsx — Wave FIX-J. Renders the lifecycle state of a deployment as
// a tight inline badge, plus an inline "Keep" button when within the final
// 12h of TTL. Lives next to StatusPill / EnvPill in the DeploymentsPage and
// DeployDetailPage rows.
//
// Three visual states:
//   - permanent  → grey "Permanent" badge, no button.
//   - >12h left  → muted "expires in Nh" badge, optional inline link.
//   - <12h left  → red "expires in Nh" badge with a Make Permanent button
//                  (banner-style on the detail page).
//
// The dashboard is otherwise read-only — mutations are agent-driven via
// PromptCards. The Make Permanent button is the one Pre-FIX-J exception:
// every product-meeting reading of the policy said "the user must be one
// click away from keeping their deploy", not "the user must paste a curl
// command at 2am". Net new UX surface = a 32-char button.

import { useState } from 'react'
import type { DashboardDeployment } from '../api/types'
import { makeDeploymentPermanent } from '../api'

interface TtlBadgeProps {
  deployment: DashboardDeployment
  /** When true, render the larger detail-page banner shape (button on the
   *  right of the badge). When false, render the table-row inline pill. */
  variant?: 'inline' | 'banner'
  /** Optional callback fired after a successful make-permanent so the
   *  parent can replace its local deployment state without a refetch. */
  onPermanent?: (updated: DashboardDeployment) => void
}

export function TtlBadge({ deployment, variant = 'inline', onPermanent }: TtlBadgeProps) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Permanent path — single grey badge, no button.
  if (deployment.ttl_policy === 'permanent' || !deployment.expires_at) {
    return (
      <span
        data-testid="ttl-permanent"
        title="This deployment will never auto-expire."
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-dim)',
          background: 'var(--bg-2, #f4f4f4)',
          padding: '2px 8px',
          borderRadius: 4,
          fontFamily: 'var(--font-mono)',
        }}
      >
        Permanent
      </span>
    )
  }

  // Auto-expiring path — compute hours remaining (ceiling, min 1).
  const hoursRemaining = Math.max(1, Math.ceil(
    (new Date(deployment.expires_at).getTime() - Date.now()) / 3_600_000,
  ))
  const isExpiringSoon = hoursRemaining <= 12

  const handleKeep = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await makeDeploymentPermanent(deployment.id)
      onPermanent?.(r.deployment)
    } catch (e: any) {
      setErr(e?.message || 'Failed to keep deployment — try again.')
    } finally {
      setBusy(false)
    }
  }

  const badge = (
    <span
      data-testid="ttl-auto-expire"
      title={`Auto-expires at ${deployment.expires_at}. Six reminder emails fire over the final 12h.`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        color: isExpiringSoon ? 'var(--red, #d00)' : 'var(--text-dim)',
        background: isExpiringSoon ? 'var(--red-bg, #fff0f0)' : 'var(--bg-2, #f4f4f4)',
        padding: '2px 8px',
        borderRadius: 4,
        fontFamily: 'var(--font-mono)',
      }}
    >
      Expires in {hoursRemaining}h
    </span>
  )

  // Inline (table row) variant — badge only, no button. The detail page
  // is where the Make Permanent button lives.
  if (variant === 'inline') {
    return badge
  }

  // Banner (detail page) — badge + Make Permanent button + error inline.
  return (
    <div
      data-testid="ttl-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: isExpiringSoon ? 'var(--red-bg, #fff0f0)' : 'var(--bg-2, #f4f4f4)',
        borderRadius: 6,
        marginBottom: 16,
        fontSize: 13,
      }}
    >
      {badge}
      <span style={{ color: 'var(--text)', flex: 1 }}>
        {isExpiringSoon
          ? `This deployment is auto-expiring in ${hoursRemaining}h. Click Keep to make it permanent.`
          : `This deployment will auto-expire in ${hoursRemaining}h unless you keep it.`}
      </span>
      <button
        data-testid="make-permanent-button"
        onClick={handleKeep}
        disabled={busy}
        style={{
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 500,
          background: 'var(--text, #111)',
          color: 'white',
          border: 0,
          borderRadius: 4,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Keeping…' : 'Keep this deployment'}
      </button>
      {err && (
        <span style={{ color: 'var(--red, #d00)', fontSize: 11 }}>{err}</span>
      )}
    </div>
  )
}
