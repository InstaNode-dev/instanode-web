// TierChangeModal — founder-tool dialog for promoting / demoting a
// customer's tier from the admin console (Track A). Two safety rails
// because tier changes are destructive on the way down (resources lose
// pro-tier headroom) and expensive on the way up (we just gave away $49):
//
//   1. The operator must pick a target tier *different* from the
//      current one — the submit stays disabled until then.
//   2. The operator must type the literal word "PROMOTE" (up-tier) or
//      "DEMOTE" (down-tier) into a confirmation field. The required
//      word is recomputed from the chosen tier; the input must match
//      exactly (case-sensitive) before submit unlocks.
//
// On success the modal closes and the parent drawer refetches detail so
// the new tier + audit row land in one render.

import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import type { AdminSetTierInput, Tier } from '../api/types'

export const ADMIN_TIER_CHOICES: Tier[] = [
  'anonymous',
  'free',
  'hobby',
  'pro',
  'team',
  'growth',
]

// Ranked low → high so we can compute "is this a promotion or demotion?"
// and pick the correct confirmation word.
const TIER_RANK: Record<Tier, number> = {
  anonymous: 0,
  free: 1,
  hobby: 2,
  growth: 3,
  pro: 4,
  team: 5,
}

export function confirmationWord(currentTier: Tier, nextTier: Tier): 'PROMOTE' | 'DEMOTE' {
  return TIER_RANK[nextTier] >= TIER_RANK[currentTier] ? 'PROMOTE' : 'DEMOTE'
}

interface Props {
  teamID: string
  primaryEmail: string
  currentTier: Tier
  onClose: () => void
  /** Called after a successful tier change; the drawer uses this to
   *  refresh detail so the new tier + audit entry land together. */
  onChanged?: () => void
}

export function TierChangeModal({
  teamID,
  primaryEmail,
  currentTier,
  onClose,
  onChanged,
}: Props) {
  const [nextTier, setNextTier] = useState<Tier>(currentTier)
  const [reason, setReason] = useState('')
  const [confirmInput, setConfirmInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstFieldRef = useRef<HTMLSelectElement | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  const isDifferent = nextTier !== currentTier
  const verb = isDifferent ? confirmationWord(currentTier, nextTier) : 'PROMOTE'
  const canSubmit =
    !submitting &&
    isDifferent &&
    reason.trim().length > 0 &&
    confirmInput === verb

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const body: AdminSetTierInput = { tier: nextTier, reason: reason.trim() }
      await api.setAdminCustomerTier(teamID, body)
      onChanged?.()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Could not change tier')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Change customer tier"
      data-testid="tier-change-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
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
          background: 'var(--bg, #fff)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <form onSubmit={handleSubmit}>
          <h3 style={{ marginTop: 0 }}>Change tier for {primaryEmail}</h3>
          <p className="dim" style={{ fontSize: 13, marginTop: 0 }}>
            Current tier: <strong>{currentTier}</strong>. Tier changes
            elevate (or strand) every active resource owned by this team.
          </p>

          <label
            style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 500 }}
          >
            New tier
            <select
              ref={firstFieldRef}
              data-testid="tier-select"
              value={nextTier}
              onChange={(e) => setNextTier(e.target.value as Tier)}
              style={{ width: '100%', marginTop: 4, padding: '6px 8px' }}
            >
              {ADMIN_TIER_CHOICES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label
            style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 500 }}
          >
            Reason{' '}
            <span className="dim" style={{ fontWeight: 400 }}>
              (audit log)
            </span>
            <textarea
              data-testid="tier-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              style={{ width: '100%', marginTop: 4, padding: '6px 8px' }}
              placeholder="e.g., founder demo, support escalation, refund"
            />
          </label>

          {isDifferent && (
            <div
              style={{
                marginTop: 14,
                padding: 10,
                background: 'rgba(234,179,8,0.10)',
                border: '1px solid rgba(234,179,8,0.30)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              This will change <strong>{primaryEmail}</strong>'s tier from{' '}
              <strong>{currentTier}</strong> to <strong>{nextTier}</strong> and
              elevate all their active resources. Type{' '}
              <code data-testid="tier-confirm-word">{verb}</code> to confirm.
              <input
                data-testid="tier-confirm-input"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: '6px 8px',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
          )}

          {error && (
            <p
              data-testid="tier-error"
              role="alert"
              style={{
                marginTop: 12,
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

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 18,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              data-testid="tier-cancel"
              className="btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="tier-submit"
              className="btn primary"
            >
              {submitting ? 'Saving…' : `Confirm ${verb.toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
