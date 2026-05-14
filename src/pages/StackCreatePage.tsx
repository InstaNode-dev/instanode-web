/* StackCreatePage — /app/stacks/new (W9).
 *
 * Human-driven "Create stack" wizard. The agent API endpoint is
 * multipart-only (POST /stacks/new with a .tar.gz Dockerfile bundle),
 * which makes it inaccessible from curl-shy customers. This page lets a
 * human upload a tarball, set name / port / env / env vars, and watch the
 * build complete — all without leaving the dashboard.
 *
 * Why this exists (vs. agent-driven flow):
 *   POST /stacks/new is a real exception to the dashboard's read-only
 *   contract. Tarball uploads aren't agent-friendly (agents would have to
 *   produce a tar locally), and the platform's "frictionless for agents"
 *   pitch relies on a human path here for the cases an agent can't tar
 *   up source itself. Mutations elsewhere stay agent-driven via PromptCard.
 *
 * Stages:
 *   1. 'form'    — the user fills in fields + picks a file. Submit → POST.
 *   2. 'building' — 202 received; polling GET /api/v1/stacks/:slug every
 *                   3s up to 5 minutes for status flip.
 *   3. 'live'    — status=running. Show URL + copy button. Optionally
 *                   redirect to the stack detail.
 *   4. 'failed'  — build failed; show error + retry CTA.
 *   5. 'error'   — submit failed (4xx/5xx); inline error banner on form.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../api'
import type { CreateStackResponse, Tier } from '../api'
import { EnvPill, StatusPill, copyToClipboard } from '../components/Common'
import { UpgradePromptCard } from '../components/UpgradePromptCard'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

// 50 MB tarball cap — matches the platform CLAUDE.md limit + api edge
// rejection. Validating client-side gives the user an inline error before
// the upload starts (avoids waiting 30 s for the api to 413).
export const MAX_TARBALL_BYTES = 50 * 1024 * 1024

// Polling cadence: 3 s strikes a balance between "feels alive" and "doesn't
// hammer the api during a 30-90 s build". Hard cap at 5 min — past that the
// build almost certainly failed silently and the user should retry. We
// surface a "still building, your build might be stuck" hint past 90 s so
// the user knows we're aware.
export const POLL_INTERVAL_MS = 3_000
export const POLL_MAX_MS = 5 * 60 * 1000
export const POLL_SLOW_HINT_MS = 90_000

// Tiers that can create more than zero stacks. Anonymous gets none.
const STACK_CREATE_TIERS: ReadonlySet<Tier> = new Set([
  'hobby', 'pro', 'team', 'growth',
])

// Allowed env-var key shape: A–Z, 0–9, underscore. Must start with letter
// or underscore. Matches POSIX conventions + the api validator.
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/

type Stage = 'form' | 'building' | 'live' | 'failed' | 'error'

interface EnvVarRow {
  /** Stable id for the React key — we never reorder, but adding/removing
   *  rows shouldn't reuse indices (would re-target inputs). */
  id: number
  key: string
  value: string
}

let _envVarRowId = 0
function nextEnvVarRowId() {
  _envVarRowId += 1
  return _envVarRowId
}

function newEnvVarRow(): EnvVarRow {
  return { id: nextEnvVarRowId(), key: '', value: '' }
}

export function StackCreatePage() {
  const navigate = useNavigate()
  const ctx = useDashboardCtx()
  const tier = (ctx.me?.user.tier ?? 'anonymous') as Tier
  const canCreate = STACK_CREATE_TIERS.has(tier)

  // Form state
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [port, setPort] = useState<number>(8080)
  // Default env: development (per 2026-05-13 platform memory rule).
  const [env, setEnv] = useState<string>('development')
  const [envVars, setEnvVars] = useState<EnvVarRow[]>([newEnvVarRow()])
  const [submitting, setSubmitting] = useState(false)
  const [stage, setStage] = useState<Stage>('form')
  const [stack, setStack] = useState<CreateStackResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [tierWall, setTierWall] = useState(false)

  // ─── Validation helpers ──────────────────────────────────────────────
  const fileError = (() => {
    if (!file) return null
    if (file.size > MAX_TARBALL_BYTES) {
      return `Tarball is ${formatBytes(file.size)} — limit is ${formatBytes(MAX_TARBALL_BYTES)}.`
    }
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.tar.gz') && !lower.endsWith('.tgz')) {
      return 'File must be a .tar.gz or .tgz archive.'
    }
    return null
  })()

  const nameError = (() => {
    if (!name) return null
    if (name.length > 32) return 'Name must be 32 characters or fewer.'
    if (!/^[a-z0-9-]+$/.test(name)) return 'Lowercase letters, digits, and hyphens only.'
    return null
  })()

  const portError = (() => {
    if (port < 1024 || port > 65535) return 'Port must be between 1024 and 65535.'
    if (!Number.isInteger(port)) return 'Port must be an integer.'
    return null
  })()

  const envVarErrors = envVars.map((row) => {
    // Empty row is fine (it's a placeholder for "add another"). Once the
    // user types anything, we enforce the key/value rules so submit can't
    // ship a malformed pair.
    if (!row.key && !row.value) return null
    if (!row.key) return 'Key is required.'
    if (!ENV_KEY_RE.test(row.key)) return 'Keys: A-Z, 0-9, _ only (must start with letter or _).'
    return null
  })

  const formValid =
    canCreate &&
    file !== null &&
    fileError === null &&
    nameError === null &&
    portError === null &&
    envVarErrors.every((e) => e === null)

  // ─── Submit ───────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !formValid) return
    setSubmitting(true)
    setErrorMsg(null)
    setTierWall(false)
    try {
      // Collapse env-var rows into the {KEY: "VAL"} shape the api expects.
      // Empty rows (placeholder for "add another") are dropped silently.
      const envVarsMap: Record<string, string> = {}
      for (const row of envVars) {
        if (row.key) envVarsMap[row.key] = row.value
      }
      const r = await api.createStack(file, {
        name: name || undefined,
        port,
        env,
        env_vars: Object.keys(envVarsMap).length > 0 ? envVarsMap : undefined,
      })
      setStack(r.stack)
      // If the api came back with status='running' synchronously (cached
      // build, rare), skip straight to live. Otherwise enter polling.
      if (r.stack.status === 'running') {
        setStage('live')
      } else if (r.stack.status === 'failed') {
        setStage('failed')
      } else {
        setStage('building')
      }
    } catch (err: any) {
      if (err?.status === 402) {
        setTierWall(true)
        setStage('error')
      } else if (err?.status === 413) {
        setErrorMsg('Tarball too large. Limit is 50 MB.')
        setStage('error')
      } else {
        setErrorMsg(err?.message || 'Submit failed — try again.')
        setStage('error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Polling loop ─────────────────────────────────────────────────────
  // Runs only in 'building' stage. Polls every POLL_INTERVAL_MS up to
  // POLL_MAX_MS; flips to 'live' on running, 'failed' on failed, and
  // 'error' (with hint) if we time out.
  const pollStartedAt = useRef<number | null>(null)
  const [pollElapsed, setPollElapsed] = useState(0)
  useEffect(() => {
    if (stage !== 'building' || !stack?.slug) return
    pollStartedAt.current = Date.now()
    let cancelled = false
    let timeoutId: number | undefined

    async function tick() {
      if (cancelled) return
      try {
        const r = await api.fetchStackStatus(stack!.slug)
        if (cancelled) return
        if (r.stack) {
          if (r.stack.status === 'running') {
            setStack((prev) => prev ? { ...prev, status: 'running', url: r.stack!.url } : prev)
            setStage('live')
            return
          }
          if (r.stack.status === 'failed') {
            setStack((prev) => prev ? { ...prev, status: 'failed' } : prev)
            setStage('failed')
            return
          }
        }
      } catch {
        // transient — let the timeout decide. We don't want a one-off 5xx
        // to bounce the user out of the build screen.
      }
      const elapsed = Date.now() - (pollStartedAt.current ?? Date.now())
      setPollElapsed(elapsed)
      if (elapsed >= POLL_MAX_MS) {
        setErrorMsg(
          'Build is taking longer than 5 minutes — check the stack detail page for logs.',
        )
        setStage('error')
        return
      }
      timeoutId = window.setTimeout(tick, POLL_INTERVAL_MS)
    }

    timeoutId = window.setTimeout(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, stack?.slug])

  // ─── Renders by stage ─────────────────────────────────────────────────
  if (!canCreate) {
    // Tier wall: anonymous / free can't create any stacks. Show the
    // existing UpgradePromptCard (private_deploy copy is the closest
    // existing feature key; we render the upgrade copy generically).
    return (
      <div data-testid="stack-create-tier-wall" style={{ maxWidth: 720, margin: '24px auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 12px' }}>Create stack</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 16 }}>
          Stack deploys are a paid feature. Upgrade to hobby or higher to ship apps
          from the dashboard.
        </p>
        <UpgradePromptCard feature="private_deploy" />
      </div>
    )
  }

  if (stage === 'live' && stack) {
    return <LivePanel stack={stack} onViewStack={() => navigate(`/app/deployments`)} />
  }

  if (stage === 'failed' && stack) {
    return (
      <FailedPanel
        slug={stack.slug}
        onRetry={() => {
          setStage('form')
          setStack(null)
          setErrorMsg(null)
        }}
      />
    )
  }

  if (stage === 'building' && stack) {
    return <BuildingPanel stack={stack} elapsedMs={pollElapsed} />
  }

  // 'form' or 'error'
  return (
    <form
      onSubmit={onSubmit}
      data-testid="stack-create-form"
      style={{ maxWidth: 720, margin: '24px auto' }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 4px' }}>Create stack</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 24px' }}>
        Upload a .tar.gz containing a <code>Dockerfile</code> + source. We'll build it
        and ship it under <code>*.deployment.instanode.dev</code>.
      </p>

      {tierWall && (
        <div
          data-testid="stack-create-tier-banner"
          style={{
            border: '1px solid var(--amber, #d4a017)',
            background: 'rgba(212,160,23,0.06)',
            padding: 12,
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <strong>Stack limit reached.</strong> Your current plan ({tier}) doesn't allow
          another stack. Upgrade to Pro to ship up to 10 stacks.
        </div>
      )}
      {errorMsg && !tierWall && (
        <div
          data-testid="stack-create-error"
          style={{
            border: '1px solid var(--red, #d44017)',
            background: 'rgba(212,64,23,0.06)',
            padding: 12,
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Tarball */}
      <FormField
        label="Tarball"
        hint="gzipped tar with Dockerfile + source · max 50 MB"
        error={fileError}
      >
        <input
          type="file"
          accept=".tar.gz,.tgz,application/gzip"
          data-testid="stack-create-file"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
          }}
        />
        {file && (
          <div
            data-testid="stack-create-file-info"
            style={{ marginTop: 6, fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            {file.name} · {formatBytes(file.size)}
          </div>
        )}
      </FormField>

      {/* Name */}
      <FormField
        label="Stack name"
        hint="auto-generated if blank · lowercase + hyphens, max 32"
        error={nameError}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          maxLength={32}
          placeholder="auto-generated if blank"
          data-testid="stack-create-name"
          style={{ width: '100%' }}
        />
      </FormField>

      {/* Port */}
      <FormField
        label="Port"
        hint="the container's HTTP listener port"
        error={portError}
      >
        <input
          type="number"
          value={port}
          onChange={(e) => {
            const v = Number(e.target.value)
            setPort(Number.isFinite(v) ? v : 0)
          }}
          min={1024}
          max={65535}
          data-testid="stack-create-port"
          style={{ width: 120 }}
        />
      </FormField>

      {/* Env */}
      <FormField label="Environment" hint="defaults to development">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            data-testid="stack-create-env"
          >
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
          </select>
          <EnvPill env={env} />
        </div>
      </FormField>

      {/* Env vars */}
      <FormField
        label="Env vars"
        hint="key=value pairs passed to the container"
      >
        <div data-testid="stack-create-envvars">
          {envVars.map((row, idx) => (
            <div
              key={row.id}
              data-testid={`stack-create-envvar-row-${idx}`}
              style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}
            >
              <div style={{ flex: '1 1 200px' }}>
                <input
                  type="text"
                  placeholder="KEY"
                  value={row.key}
                  data-testid={`stack-create-envvar-key-${idx}`}
                  onChange={(e) => {
                    const next = [...envVars]
                    // Auto-uppercase to match POSIX convention; keep the
                    // original behavior of letting the user paste and see
                    // their pasted value normalized.
                    next[idx] = { ...next[idx], key: e.target.value.toUpperCase() }
                    setEnvVars(next)
                  }}
                  style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                />
                {envVarErrors[idx] && (
                  <div
                    data-testid={`stack-create-envvar-error-${idx}`}
                    style={{ fontSize: 11, color: 'var(--red, #d44017)', marginTop: 2 }}
                  >
                    {envVarErrors[idx]}
                  </div>
                )}
              </div>
              <div style={{ flex: '1 1 280px' }}>
                <input
                  type="text"
                  placeholder="value"
                  value={row.value}
                  data-testid={`stack-create-envvar-value-${idx}`}
                  onChange={(e) => {
                    const next = [...envVars]
                    next[idx] = { ...next[idx], value: e.target.value }
                    setEnvVars(next)
                  }}
                  style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <button
                type="button"
                data-testid={`stack-create-envvar-remove-${idx}`}
                onClick={() => {
                  const next = envVars.filter((_, i) => i !== idx)
                  // Keep at least one row so "add" still has somewhere to
                  // point. Removing the last row resets it to empty.
                  setEnvVars(next.length === 0 ? [newEnvVarRow()] : next)
                }}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  background: 'transparent',
                  border: '1px solid var(--border, #333)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                }}
              >
                remove
              </button>
            </div>
          ))}
          <button
            type="button"
            data-testid="stack-create-envvar-add"
            onClick={() => setEnvVars([...envVars, newEnvVarRow()])}
            style={{
              marginTop: 4,
              padding: '6px 10px',
              fontSize: 12,
              background: 'transparent',
              border: '1px dashed var(--border, #333)',
              borderRadius: 4,
              cursor: 'pointer',
              color: 'var(--text-dim)',
            }}
          >
            + Add env var
          </button>
        </div>
      </FormField>

      <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={!formValid || submitting}
          data-testid="stack-create-submit"
          style={{
            padding: '10px 20px',
            fontSize: 13,
            fontWeight: 500,
            background: formValid && !submitting ? 'var(--blue, #4488ff)' : 'var(--border, #333)',
            color: 'white',
            border: 0,
            borderRadius: 6,
            cursor: formValid && !submitting ? 'pointer' : 'not-allowed',
          }}
        >
          {submitting ? 'Uploading…' : 'Deploy'}
        </button>
        <button
          type="button"
          data-testid="stack-create-cancel"
          onClick={() => navigate('/app/deployments')}
          style={{
            padding: '10px 20px',
            fontSize: 13,
            background: 'transparent',
            color: 'var(--text-dim)',
            border: '1px solid var(--border, #333)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────

function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
        {label}
        {hint && (
          <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 8 }}>
            {hint}
          </span>
        )}
      </label>
      {children}
      {error && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--red, #d44017)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function BuildingPanel({
  stack,
  elapsedMs,
}: {
  stack: CreateStackResponse
  elapsedMs: number
}) {
  const slow = elapsedMs >= POLL_SLOW_HINT_MS
  return (
    <div data-testid="stack-create-building" style={{ maxWidth: 720, margin: '24px auto' }}>
      <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 4px' }}>Building your stack…</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 16px' }}>
        We're building <code>{stack.slug}</code>. This usually takes 30-90 seconds.
      </p>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StatusPill status="building" />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{stack.slug}</span>
        </div>
        {slow && (
          <div
            data-testid="stack-create-slow-hint"
            style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)' }}
          >
            Still building — large dependencies (e.g. Node + a big install) can push
            past 90 seconds. We'll keep polling for up to 5 minutes.
          </div>
        )}
      </div>
    </div>
  )
}

function LivePanel({
  stack,
  onViewStack,
}: {
  stack: CreateStackResponse
  onViewStack: () => void
}) {
  const url = stack.url ?? `https://${stack.slug}.deployment.instanode.dev`
  const [copied, setCopied] = useState(false)
  return (
    <div data-testid="stack-create-live" style={{ maxWidth: 720, margin: '24px auto' }}>
      <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 4px' }}>Live</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 16px' }}>
        Your stack <code>{stack.slug}</code> is live.
      </p>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <StatusPill status="running" />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            data-testid="stack-create-live-url"
            style={{ color: 'var(--blue, #4488ff)', fontFamily: 'var(--font-mono)', fontSize: 13 }}
          >
            {url}
          </a>
          <button
            type="button"
            data-testid="stack-create-copy-url"
            onClick={async () => {
              const ok = await copyToClipboard(url)
              if (ok) {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              }
            }}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              background: 'transparent',
              border: '1px solid var(--border, #333)',
              borderRadius: 4,
              cursor: 'pointer',
              color: 'var(--text-dim)',
            }}
          >
            {copied ? 'copied ✓' : 'copy'}
          </button>
        </div>
        <button
          type="button"
          data-testid="stack-create-view-deployments"
          onClick={onViewStack}
          style={{
            padding: '8px 16px',
            fontSize: 12,
            background: 'transparent',
            border: '1px solid var(--border, #333)',
            borderRadius: 4,
            cursor: 'pointer',
            color: 'var(--text)',
          }}
        >
          View deployments →
        </button>
      </div>
    </div>
  )
}

function FailedPanel({
  slug,
  onRetry,
}: {
  slug: string
  onRetry: () => void
}) {
  return (
    <div data-testid="stack-create-failed" style={{ maxWidth: 720, margin: '24px auto' }}>
      <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 4px' }}>Build failed</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 16px' }}>
        Build for <code>{slug}</code> failed. Check the build logs on the stack
        detail page, then try again.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          data-testid="stack-create-retry"
          onClick={onRetry}
          style={{
            padding: '8px 16px',
            fontSize: 12,
            background: 'var(--blue, #4488ff)',
            color: 'white',
            border: 0,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
