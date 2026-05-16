// FailureAutopsyPanel — Phase 0 Failure Autopsy
//
// Rendered ABOVE the tab bar on DeployDetailPage when a deployment has
// failed. Two states:
//
//   1. `failure` present — full autopsy panel with humanised reason heading,
//      hint (plain-language probable cause + remedy), supporting detail
//      (exit_code + event), and a collapsible last_lines log block.
//
//   2. `failure` absent but `status === 'failed'` — neutral "diagnostics
//      pending" banner. Never crashes, never renders a blank screen.
//
// The panel is intentionally impossible to miss: it sits above the tab
// strip (so the Overview tab scroll doesn't bury it), uses the design
// system's error colour (--rose) for the border + heading, and the
// heading is always the first readable line after the deployment name.

import { useState } from 'react'
import type { DeploymentFailure, DeploymentFailureReason } from '../api/types'
import { RelTime } from './Common'

// ─── Humanised reason labels ──────────────────────────────────────────────
//
// Each DeploymentFailureReason maps to a plain-English heading that a
// non-expert user can act on. The short technical tag is included in
// parentheses so engineers can match it to k8s events without digging.
//
// These are the ONLY strings shown as the panel heading — never the raw
// reason key. If the backend ships a new reason that isn't listed here,
// we fall back to the raw string so we never show a blank heading.

export const FAILURE_REASON_LABELS: Record<DeploymentFailureReason, string> = {
  OOMKilled:        'Out of memory (OOMKilled)',
  Evicted:          'Pod evicted by the cluster (Evicted)',
  ImagePullBackOff: 'Container image could not be pulled (ImagePullBackOff)',
  CrashLoopBackOff: 'Container is crash-looping (CrashLoopBackOff)',
  BuildFailed:      'Build failed before the container started (BuildFailed)',
  DeadlineExceeded: 'Deployment timed out (DeadlineExceeded)',
  Error:            'Container exited with an error (Error)',
  Unknown:          'Unknown failure — diagnostics captured below',
}

// ─── Component ────────────────────────────────────────────────────────────

interface Props {
  /** The deployment's current status — used to decide whether to show
   *  the panel at all (only when status is 'failed'). */
  status: string
  /** Structured autopsy payload from the API — may be absent even on a
   *  failed deploy if diagnostics have not yet been captured. */
  failure?: DeploymentFailure
}

export function FailureAutopsyPanel({ status, failure }: Props) {
  // Only render for failed deploys.
  if (status !== 'failed') return null

  // "Diagnostics pending" state — failed but no autopsy captured yet.
  if (!failure) {
    return (
      <div
        data-testid="failure-autopsy-pending"
        role="status"
        style={{
          background: 'rgba(255,122,138,0.06)',
          border: '1px solid rgba(255,122,138,0.20)',
          borderRadius: 8,
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span
          aria-hidden="true"
          style={{ fontSize: 18, lineHeight: 1, color: 'var(--rose, #ff7a8a)', flexShrink: 0 }}
        >
          ⚠
        </span>
        <div>
          <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--text)', marginBottom: 2 }}>
            Deployment failed — diagnostics pending
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            The failure was detected but the diagnostic capture is still in
            flight. Refresh in a moment to see the full autopsy.
          </div>
        </div>
      </div>
    )
  }

  return <FullAutopsyPanel failure={failure} />
}

// ─── Full autopsy panel (when failure payload is present) ─────────────────

function FullAutopsyPanel({ failure }: { failure: DeploymentFailure }) {
  const [logsExpanded, setLogsExpanded] = useState(false)

  const humanisedReason =
    FAILURE_REASON_LABELS[failure.reason as DeploymentFailureReason] ??
    failure.reason

  return (
    <div
      data-testid="failure-autopsy-panel"
      role="alert"
      aria-label="Why this deployment failed"
      style={{
        background: 'rgba(255,122,138,0.07)',
        border: '1px solid rgba(255,122,138,0.28)',
        borderRadius: 10,
        padding: '18px 20px',
        marginBottom: 20,
      }}
    >
      {/* ── Header row ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <span
          aria-hidden="true"
          style={{
            fontSize: 22,
            lineHeight: 1,
            color: 'var(--rose, #ff7a8a)',
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          ✕
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            data-testid="failure-autopsy-heading"
            style={{
              fontWeight: 600,
              fontSize: 16,
              color: 'var(--rose, #ff7a8a)',
              marginBottom: 2,
              letterSpacing: '-0.01em',
            }}
          >
            {humanisedReason}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              fontFamily: 'var(--font-mono)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span data-testid="failure-autopsy-occurred-at">
              {failure.occurred_at ? (
                <>failed <RelTime at={failure.occurred_at} /></>
              ) : (
                'failure time unknown'
              )}
            </span>
            {failure.exit_code != null && (
              <>
                <span style={{ opacity: 0.4 }}>·</span>
                <span data-testid="failure-autopsy-exit-code">
                  exit code {failure.exit_code}
                </span>
              </>
            )}
          </div>
        </div>
        {/* "Why it failed" label — makes the section scannable */}
        <span
          style={{
            fontSize: 10,
            color: 'var(--rose, #ff7a8a)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            opacity: 0.8,
            flexShrink: 0,
            paddingTop: 3,
          }}
        >
          Why it failed
        </span>
      </div>

      {/* ── Hint (primary plain-language explanation) ── */}
      <div
        data-testid="failure-autopsy-hint"
        style={{
          background: 'rgba(255,122,138,0.06)',
          border: '1px solid rgba(255,122,138,0.14)',
          borderRadius: 7,
          padding: '12px 14px',
          fontSize: 13.5,
          color: 'var(--text)',
          lineHeight: 1.65,
          marginBottom: failure.event ? 12 : 0,
        }}
      >
        {failure.hint}
      </div>

      {/* ── Supporting detail: event ── */}
      {failure.event && (
        <div style={{ marginBottom: failure.last_lines.length > 0 ? 12 : 0 }}>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--text-faint)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 6,
            }}
          >
            k8s event
          </div>
          <div
            data-testid="failure-autopsy-event"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-dim)',
              background: 'var(--elevated, #131319)',
              border: '1px solid var(--border, #1f1f28)',
              borderRadius: 6,
              padding: '10px 12px',
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {failure.event}
          </div>
        </div>
      )}

      {/* ── Last lines log block (collapsed by default) ── */}
      {failure.last_lines.length > 0 && (
        <div>
          <button
            data-testid="failure-autopsy-log-toggle"
            onClick={() => setLogsExpanded((x) => !x)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: logsExpanded ? 8 : 0,
            }}
            aria-expanded={logsExpanded}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                transform: logsExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s',
                lineHeight: 1,
              }}
            >
              ▶
            </span>
            {logsExpanded
              ? `hide last ${failure.last_lines.length} lines`
              : `show last ${failure.last_lines.length} lines`}
          </button>

          {logsExpanded && (
            <div
              data-testid="failure-autopsy-log-block"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: 'var(--text-dim)',
                background: 'var(--ink, #08080a)',
                border: '1px solid var(--border, #1f1f28)',
                borderRadius: 6,
                padding: '10px 12px',
                overflowY: 'auto',
                maxHeight: 320,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {failure.last_lines.map((line, i) => (
                <div key={i} data-testid={`failure-log-line-${i}`}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
