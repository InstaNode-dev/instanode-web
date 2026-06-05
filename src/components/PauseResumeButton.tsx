// PauseResumeButton — toggle a resource between active and paused (Pro+).
//
// Pause is a real write that hits POST /api/v1/resources/:id/pause on the
// agent API; resume hits .../resume. Unlike cancel/downgrade (support-only
// per the project memory rule), pause is a Pro feature that preserves data
// and just stops the resource from counting against the quota — so it's
// appropriate to expose self-serve in the UI.
//
// Component contract:
//   - Renders a "Pause" button when resource.status === 'active'
//   - Renders a "Resume" button when resource.status === 'paused'
//   - Renders nothing for terminal statuses (expired / tombstoned / deleted)
//   - On click, opens a confirmation modal explaining the side-effects
//   - On confirm, calls the api; on 402, swaps the button for an inline
//     UpgradeButton CTA that links to /app/billing
//   - On 5xx / network failure, shows an inline error string under the
//     button (no toast library available in this codebase)
//
// The button is the only entry point for the modal — extracting the modal
// into a separate top-level component would force the parent (ResourceDetailPage
// + ResourcesPage list row) to track open/close state, and the only thing the
// modal needs from the parent is the resource itself. Keeping it inline keeps
// both call sites identical.

import { useState, useRef, useEffect, type MouseEvent } from 'react'
import * as api from '../api'
import type { Resource } from '../api'
import { UpgradeButton } from './UpgradeButton'

export interface PauseResumeButtonProps {
  /** The current resource — the button reads `status` to decide its label
   *  and reads `id` for the api call. */
  resource: Resource
  /** Called after a successful pause/resume with the updated resource so
   *  the parent can replace its local state without a refetch. */
  onUpdated: (r: Resource) => void
  /** Optional override for the trigger button's size. The list-row uses
   *  the compact variant; the detail-page card uses the default. */
  size?: 'default' | 'sm'
}

// Surfaces where the modal places focus on open — we trap focus on the
// confirm button so keyboard users can hit Enter immediately. Implemented
// with a ref + effect to avoid pulling in @reach/dialog or similar.
//
// Note: this is a lightweight inline modal, NOT a full a11y-compliant
// dialog. Production would use <dialog> or a library; for now we match the
// pattern used elsewhere in the dashboard (PromptCard etc. — none use a
// proper dialog primitive).

export function PauseResumeButton({
  resource,
  onUpdated,
  size = 'default',
}: PauseResumeButtonProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tierBlocked, setTierBlocked] = useState(false)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  // Focus the confirm button when the modal opens so Enter immediately
  // commits the action. setTimeout 0 lets React paint first.
  useEffect(() => {
    if (open && confirmRef.current) {
      const t = setTimeout(() => confirmRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open])

  // Terminal statuses don't get pause/resume affordances — the resource is
  // already gone (expired) or being destroyed (tombstoned/deleted). The
  // parent page (ResourceDetailPage) can show a different status banner.
  if (
    resource.status === 'expired' ||
    resource.status === 'tombstoned' ||
    resource.status === 'deleted'
  ) {
    return null
  }

  const isPaused = resource.status === 'paused'
  const action: 'pause' | 'resume' = isPaused ? 'resume' : 'pause'
  const verb = isPaused ? 'Resume' : 'Pause'
  const btnClass =
    size === 'sm'
      ? `btn btn-sm ${isPaused ? 'btn-primary' : 'btn-secondary'}`
      : `btn ${isPaused ? 'btn-primary' : 'btn-secondary'}`

  function openModal(e: MouseEvent<HTMLButtonElement>) {
    // Prevent the surrounding row <Link> from navigating when the button
    // is rendered inside ResourcesPage's clickable row.
    e.preventDefault()
    e.stopPropagation()
    setOpen(true)
    setErr(null)
    setTierBlocked(false)
  }

  function closeModal() {
    if (busy) return
    setOpen(false)
  }

  async function confirm(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      // Address the resource by its public TOKEN, not the internal UUID `id`.
      // The agent API resolves /api/v1/resources/:id/{pause,resume} against the
      // TOKEN column (the same as getResource / rotate / delete), so passing the
      // UUID `id` here 404'd ("Resource not found") for EVERY resource — token
      // and id differ on real resources — silently breaking pause/resume through
      // the dashboard. Surfaced 2026-06-06 by the live-ui pause/resume journey
      // (the only real-backend exercise of this path). Use resource.token, with
      // a defensive fall-back to id for any legacy row missing a token.
      const ref = resource.token || resource.id
      const r = isPaused ? await api.resumeResource(ref) : await api.pauseResource(ref)
      onUpdated(r.resource)
      setOpen(false)
    } catch (e: any) {
      // 402 → tier wall. Swap the confirm row out for an UpgradeButton.
      // The modal stays open so the user can read the upgrade copy in
      // context (and can dismiss it).
      if (e?.status === 402) {
        setTierBlocked(true)
      } else {
        // 5xx / network — surface inline. Don't close the modal so the
        // user can retry without losing context.
        const msg = (e && (e.message || e.code)) || 'request failed'
        setErr(`Couldn't ${action} this resource: ${msg}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={btnClass}
        onClick={openModal}
        data-testid="pause-resume-button"
        data-action={action}
        title={isPaused
          ? 'Resume — counts against quota and reachable again'
          : 'Pause — stops counting against quota; data is preserved'}
      >
        {verb}
      </button>

      {open && (
        <div
          data-testid="pause-resume-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-resume-modal-title"
          onClick={closeModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 20,
              maxWidth: 460,
              width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
            }}
          >
            <h3
              id="pause-resume-modal-title"
              style={{ fontSize: 16, fontWeight: 500, margin: '0 0 8px' }}
            >
              {isPaused
                ? `Resume ${resource.name ?? resource.resource_type}?`
                : `Pause ${resource.name ?? resource.resource_type}?`}
            </h3>
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-dim)',
                lineHeight: 1.55,
                margin: '0 0 16px',
              }}
            >
              {isPaused ? (
                <>
                  Resuming makes this resource reachable again and starts
                  counting it against your plan quota. Your data is exactly
                  where you left it.
                </>
              ) : (
                <>
                  Pausing stops this resource from counting against your
                  quota. <strong>Your data is preserved</strong>, but the
                  resource becomes unreachable until you resume it.
                </>
              )}
            </p>

            {tierBlocked ? (
              <div
                data-testid="pause-resume-upgrade"
                style={{
                  background: 'rgba(108,206,255,0.06)',
                  border: '1px solid rgba(108,206,255,0.18)',
                  borderRadius: 6,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--text)',
                    marginBottom: 10,
                    lineHeight: 1.5,
                  }}
                >
                  Pause &amp; resume is a Pro feature — your current plan
                  doesn&apos;t include it. Upgrading keeps every existing
                  resource and unlocks pause/resume immediately.
                </div>
                <UpgradeButton
                  onClick={() => {
                    // The UpgradeButton itself doesn't navigate — provide
                    // the destination here so checkout opens in the same
                    // tab. window.location is fine; React Router would
                    // also work but this surface is a one-off and avoids
                    // pulling useNavigate into the component.
                    window.location.assign('/app/billing?plan=pro&frequency=yearly')
                  }}
                  action="pause_resume_upgrade_clicked"
                  testId="pause-resume-upgrade-cta"
                />
              </div>
            ) : (
              <>
                {err && (
                  <div
                    role="alert"
                    data-testid="pause-resume-error"
                    style={{
                      color: 'var(--rose)',
                      fontSize: 12.5,
                      fontFamily: 'var(--font-mono)',
                      marginBottom: 12,
                    }}
                  >
                    {err}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={closeModal}
                    disabled={busy}
                    data-testid="pause-resume-cancel"
                  >
                    Cancel
                  </button>
                  <button
                    ref={confirmRef}
                    type="button"
                    className={`btn btn-sm ${isPaused ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={confirm}
                    disabled={busy}
                    data-testid="pause-resume-confirm"
                  >
                    {busy ? (isPaused ? 'Resuming…' : 'Pausing…') : verb}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
