import { useEffect, useState } from 'react'
import { APIError, cancelDeploymentDeletion, cancelStackDeletion } from '../api'

// PendingDeletionBanner — Wave FIX-I. Renders the in-flight deletion
// state on a resource detail page.
//
// Surfaces:
//   - the masked email the confirmation went to,
//   - the time remaining on the link,
//   - a Cancel button that fires DELETE /confirm-deletion.
//
// Drive it from the parent page by passing the pending row's
// (id, kind, sentTo, expiresAt) tuple. The parent decides when to
// fetch this — typically alongside the resource detail itself.
//
// The component is intentionally dumb about how the pending state is
// detected: it just renders + handles the cancel click. The detection
// (a separate /api/v1/.../pending-deletion lookup, or inferring from
// a 202 envelope returned by an in-page DELETE click) is a follow-up
// — the wire surface for that lookup isn't shipped in FIX-I.

export type PendingDeletionState = {
  /** Resource id passed back to the cancel endpoint. */
  id: string
  /** Discriminator picks the right cancel route. */
  kind: 'deploy' | 'stack'
  /** Masked email (e.g. "a***@example.com") returned by the API at
   *  request time. Empty string falls back to a generic line. */
  sentTo: string
  /** ISO timestamp from the API's confirmation_expires_at field. */
  expiresAt: string
  /** Optional — called after a successful cancel so the parent page
   *  can refetch the resource state without polling. */
  onCancelled?: () => void
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'expired'
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

export function PendingDeletionBanner({
  id,
  kind,
  sentTo,
  expiresAt,
  onCancelled,
}: PendingDeletionState) {
  const [remaining, setRemaining] = useState<string>(formatRemaining(expiresAt))
  const [cancelling, setCancelling] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string>('')

  useEffect(() => {
    const t = setInterval(() => setRemaining(formatRemaining(expiresAt)), 1000)
    return () => clearInterval(t)
  }, [expiresAt])

  async function handleCancel() {
    setCancelling(true)
    setErrorMsg('')
    try {
      if (kind === 'stack') {
        await cancelStackDeletion(id)
      } else {
        await cancelDeploymentDeletion(id)
      }
      onCancelled?.()
    } catch (err) {
      const msg = err instanceof APIError ? err.message : 'Cancel failed'
      setErrorMsg(msg)
    } finally {
      setCancelling(false)
    }
  }

  const recipientLine = sentTo
    ? `Sent to ${sentTo}. `
    : 'Sent to the team owner. '

  return (
    <div
      data-testid="pending-deletion-banner"
      style={{
        background: '#fff8e6',
        border: '1px solid #ddb74e',
        padding: '12px 16px',
        borderRadius: 6,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>
          Deletion pending confirmation
        </p>
        <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>
          {recipientLine}
          <span data-testid="pending-deletion-countdown">Expires in {remaining}</span>.
        </p>
        {errorMsg && (
          <p style={{ margin: '6px 0 0', color: '#c0392b', fontSize: 13 }}>
            {errorMsg}
          </p>
        )}
      </div>
      <button
        onClick={handleCancel}
        disabled={cancelling}
        data-testid="pending-deletion-cancel"
        style={{
          background: '#fff',
          color: '#111',
          border: '1px solid #ccc',
          padding: '8px 14px',
          borderRadius: 6,
          fontSize: 13,
          cursor: cancelling ? 'wait' : 'pointer',
          fontWeight: 500,
        }}
      >
        {cancelling ? 'Cancelling…' : 'Cancel deletion'}
      </button>
    </div>
  )
}
