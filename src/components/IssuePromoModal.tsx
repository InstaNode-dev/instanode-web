// IssuePromoModal — founder-tool dialog for issuing a one-off promo code
// to a specific customer (Track A admin console). The modal calls
// `api.issueAdminCustomerPromo` and surfaces the generated code with a
// copy button so the operator can paste it directly into a support reply
// (Discord / email / call). Successful issuance also writes an audit
// row server-side, which the parent drawer's Activity tab picks up on
// its next refresh.
//
// Field shape mirrors AdminIssuePromoInput:
//   - kind:           percent_off | first_month_free | amount_off
//   - value:          integer (15 → 15% off; 49 → $49 off; ignored when
//                     kind = first_month_free)
//   - applies_to:     integer (1 = first month, 3 = first 3 months,
//                     0 = ongoing — backend enforces ≥0)
//   - valid_for_days: integer (default 30; backend clamps to ≤ 180)
//
// The modal is keyboard-friendly (Escape closes, autofocus on kind) and
// blocks submit until a numeric value is present for kinds that need one.

import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import type { AdminIssuePromoInput } from '../api/types'
import { copyToClipboard } from './Common'

export const PROMO_KINDS: Array<AdminIssuePromoInput['kind']> = [
  'percent_off',
  'first_month_free',
  'amount_off',
]

export const PROMO_KIND_LABELS: Record<AdminIssuePromoInput['kind'], string> = {
  percent_off: 'percent off',
  first_month_free: 'first month free',
  amount_off: 'amount off (USD)',
}

interface Props {
  teamID: string
  primaryEmail: string
  onClose: () => void
  onIssued?: () => void
}

interface IssuedState {
  code: string
  expiresAt: string | null
}

export function IssuePromoModal({ teamID, primaryEmail, onClose, onIssued }: Props) {
  const [kind, setKind] = useState<AdminIssuePromoInput['kind']>('percent_off')
  const [value, setValue] = useState<string>('15')
  const [appliesTo, setAppliesTo] = useState<string>('3')
  const [validForDays, setValidForDays] = useState<string>('30')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<IssuedState | null>(null)
  const [copied, setCopied] = useState(false)
  const firstFieldRef = useRef<HTMLSelectElement | null>(null)

  // Close on Escape — only swallow Escape when the modal owns it.
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

  const needsValue = kind !== 'first_month_free'
  const numericValue = Number(value)
  const numericApplies = Number(appliesTo)
  const numericDays = Number(validForDays)
  const canSubmit =
    !submitting &&
    issued === null &&
    Number.isFinite(numericApplies) &&
    numericApplies >= 0 &&
    Number.isFinite(numericDays) &&
    numericDays > 0 &&
    (!needsValue || (Number.isFinite(numericValue) && numericValue > 0))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const r = await api.issueAdminCustomerPromo(teamID, {
        kind,
        value: needsValue ? Math.floor(numericValue) : 0,
        applies_to: Math.floor(numericApplies),
        valid_for_days: Math.floor(numericDays),
      })
      setIssued({ code: r.code, expiresAt: r.expires_at })
      onIssued?.()
    } catch (e: any) {
      setError(e?.message ?? 'Could not issue promo')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    if (!issued) return
    const ok = await copyToClipboard(issued.code)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Issue promo code"
      data-testid="issue-promo-modal"
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
        {issued === null ? (
          <form onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>Issue promo to {primaryEmail}</h3>
            <p className="dim" style={{ fontSize: 13, marginTop: 0 }}>
              Generates a one-time code. The redemption + audit row appears
              in this customer's Activity tab.
            </p>

            <label
              style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 500 }}
            >
              Kind
              <select
                ref={firstFieldRef}
                data-testid="promo-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as AdminIssuePromoInput['kind'])}
                style={{ width: '100%', marginTop: 4, padding: '6px 8px' }}
              >
                {PROMO_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PROMO_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>

            {needsValue && (
              <label
                style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 500 }}
              >
                Value{' '}
                <span className="dim" style={{ fontWeight: 400 }}>
                  ({kind === 'percent_off' ? '% — e.g., 15 for 15% off' : 'USD — e.g., 49 for $49 off'})
                </span>
                <input
                  data-testid="promo-value"
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: '6px 8px' }}
                />
              </label>
            )}

            <label
              style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 500 }}
            >
              Applies to{' '}
              <span className="dim" style={{ fontWeight: 400 }}>
                (1 = first month, 3 = first 3 months, 0 = ongoing)
              </span>
              <input
                data-testid="promo-applies-to"
                inputMode="numeric"
                value={appliesTo}
                onChange={(e) => setAppliesTo(e.target.value)}
                style={{ width: '100%', marginTop: 4, padding: '6px 8px' }}
              />
            </label>

            <label
              style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 500 }}
            >
              Valid for (days)
              <input
                data-testid="promo-valid-days"
                inputMode="numeric"
                value={validForDays}
                onChange={(e) => setValidForDays(e.target.value)}
                style={{ width: '100%', marginTop: 4, padding: '6px 8px' }}
              />
            </label>

            {error && (
              <p
                data-testid="promo-error"
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
                data-testid="promo-cancel"
                className="btn"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                data-testid="promo-submit"
                className="btn primary"
              >
                {submitting ? 'Issuing…' : 'Issue code'}
              </button>
            </div>
          </form>
        ) : (
          <div data-testid="promo-issued">
            <h3 style={{ marginTop: 0 }}>Promo issued</h3>
            <p className="dim" style={{ fontSize: 13, marginTop: 0 }}>
              Share this code with {primaryEmail}. It expires
              {issued.expiresAt
                ? ` on ${new Date(issued.expiresAt).toLocaleDateString()}.`
                : ' as configured.'}
            </p>
            <div
              data-testid="promo-issued-code"
              style={{
                marginTop: 14,
                padding: '10px 12px',
                background: 'var(--accent-soft, #eef)',
                border: '1px solid var(--accent-glow, #aaf)',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 16,
                letterSpacing: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>{issued.code}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="btn"
                data-testid="promo-copy"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 18,
              }}
            >
              <button
                type="button"
                onClick={onClose}
                className="btn primary"
                data-testid="promo-done"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
