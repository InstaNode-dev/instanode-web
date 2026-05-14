import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  APIError,
  confirmDeploymentDeletion,
  confirmStackDeletion,
} from '../api'

// ConfirmDeletionPage — Wave FIX-I. Renders the human-facing step in the
// two-step email-confirmed deletion flow:
//
//   1. The user receives an email with a link.
//   2. The link goes to GET /auth/email/confirm-deletion?t=<token> on
//      the API, which 302s here with the token on the query string.
//   3. This page asks the user "Are you sure?" and on click POSTs to
//      /api/v1/{deployments|stacks}/:id/confirm-deletion?token=<token>.
//
// The page deliberately does NOT auto-submit on load — an email
// pre-fetcher (corp mail scanners, link previews) would otherwise
// trigger destruction. The user must press the Confirm button.
//
// Query params:
//   - t        — plaintext confirmation token (required)
//   - kind     — 'deploy' (default) | 'stack'
//   - id       — resource id (optional; we derive it from the API call
//                if missing because the API echoes it in the response,
//                but the URL ideally carries it so the page can render
//                the resource name pre-confirm)
//   - label    — human-readable resource name (optional, for display)

type Stage = 'pre-confirm' | 'confirming' | 'success' | 'failure'

export function ConfirmDeletionPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('t') ?? ''
  const kindRaw = params.get('kind')
  const kind: 'deploy' | 'stack' = kindRaw === 'stack' ? 'stack' : 'deploy'
  const id = params.get('id') ?? ''
  const label = params.get('label') ?? ''

  const [stage, setStage] = useState<Stage>('pre-confirm')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [agentAction, setAgentAction] = useState<string>('')

  // Render an early failure if the URL is malformed — no token, no
  // confirmable action. We don't redirect the user away because the
  // empty state is the diagnostic: "you opened an old link / the link
  // got truncated".
  useEffect(() => {
    if (!token) {
      setStage('failure')
      setErrorMsg('This link is missing a confirmation token. Open the email again and try the original link.')
    }
  }, [token])

  async function handleConfirm() {
    setStage('confirming')
    try {
      // Two reasons we still need the id even though the token alone is
      // sufficient for the API: (1) the path carries it, so without it
      // the URL is malformed; (2) the API double-checks the token
      // belongs to the calling team, but the per-route id gate is what
      // catches "valid token, wrong resource" in tests and audits.
      if (!id) {
        throw new APIError(400, 'missing_id', 'This link is missing the resource id. Open the email again and try the original link.')
      }
      const resp =
        kind === 'stack'
          ? await confirmStackDeletion(id, token)
          : await confirmDeploymentDeletion(id, token)
      setAgentAction(resp.agent_action ?? '')
      setStage('success')
    } catch (err) {
      const code = err instanceof APIError ? err.code : 'unknown'
      const message = err instanceof APIError ? err.message : 'Something went wrong'
      // Surface the specific code so the user sees the right remedy.
      if (code === 'deletion_token_invalid') {
        setErrorMsg('This confirmation link has expired or has already been used. Go back to the dashboard and request a fresh deletion if you still want to remove the resource.')
      } else {
        setErrorMsg(message)
      }
      setStage('failure')
    }
  }

  // Success → bounce to the relevant list page after a beat so the
  // user sees the confirmation banner before navigating.
  useEffect(() => {
    if (stage !== 'success') return
    const target = kind === 'stack' ? '/app' : '/app/deployments'
    const timer = setTimeout(() => navigate(target, { replace: true }), 1500)
    return () => clearTimeout(timer)
  }, [stage, kind, navigate])

  const resourceTypeLabel = kind === 'stack' ? 'stack' : 'deployment'
  const resourceDisplay = label || (id ? `${resourceTypeLabel} ${id}` : `this ${resourceTypeLabel}`)

  return (
    <div
      style={{
        maxWidth: 560,
        margin: '64px auto',
        padding: '32px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#111',
      }}
      data-testid="confirm-deletion-page"
    >
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Confirm deletion</h1>

      {stage === 'pre-confirm' && (
        <>
          <p style={{ marginBottom: 12 }}>
            You're about to permanently delete:
          </p>
          <p
            style={{
              background: '#f5f5f5',
              padding: '12px 16px',
              borderRadius: 6,
              fontFamily: 'monospace',
              marginBottom: 16,
            }}
            data-testid="confirm-resource-label"
          >
            <strong>{resourceDisplay}</strong>
          </p>
          <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
            This action cannot be undone. The slot on your plan will be freed.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={handleConfirm}
              data-testid="confirm-button"
              style={{
                background: '#c0392b',
                color: '#fff',
                border: 'none',
                padding: '12px 20px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Confirm deletion
            </button>
            <Link
              to={kind === 'stack' ? '/app' : '/app/deployments'}
              style={{
                background: '#fff',
                color: '#111',
                border: '1px solid #ccc',
                padding: '12px 20px',
                borderRadius: 6,
                fontSize: 14,
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Cancel
            </Link>
          </div>
        </>
      )}

      {stage === 'confirming' && (
        <p data-testid="confirming-state">Confirming deletion…</p>
      )}

      {stage === 'success' && (
        <div data-testid="confirm-success">
          <p
            style={{
              background: '#e8f6e8',
              border: '1px solid #6bbd6b',
              padding: '12px 16px',
              borderRadius: 6,
              marginBottom: 16,
            }}
          >
            <strong>Deletion confirmed.</strong> The resource is fully torn down and the slot on your plan is now free. Redirecting to your dashboard…
          </p>
          {agentAction && (
            <p style={{ color: '#666', fontSize: 13 }}>{agentAction}</p>
          )}
        </div>
      )}

      {stage === 'failure' && (
        <div data-testid="confirm-failure">
          <p
            style={{
              background: '#fdecea',
              border: '1px solid #e07569',
              padding: '12px 16px',
              borderRadius: 6,
              marginBottom: 16,
            }}
          >
            <strong>Confirmation failed.</strong> {errorMsg}
          </p>
          <Link
            to={kind === 'stack' ? '/app' : '/app/deployments'}
            style={{
              color: '#0066cc',
              textDecoration: 'underline',
            }}
          >
            Back to dashboard
          </Link>
        </div>
      )}
    </div>
  )
}
