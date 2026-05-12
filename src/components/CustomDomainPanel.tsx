// CustomDomainPanel — Pro+ tier feature.
// Lets a stack owner bind a custom hostname (e.g. app.acme.com) to a deployed
// stack. The lifecycle is:
//   pending_verification  user adds TXT record, clicks Verify
//   verified              TXT confirmed, cert issuance starts
//   ingress_ready         k8s ingress wired
//   cert_ready / live     TLS cert issued — practical "done" state
//   failed                last check failed (last_check_err surfaces why)
//
// The panel lives inside DeployDetailPage and is gated at the page level on
// tier (hobby/anonymous see an upsell card instead of this component).

import { useEffect, useState } from 'react'
import * as api from '../api'
import type { CustomDomain, CustomDomainRecord, CustomDomainStatus } from '../api'
import { copyToClipboard } from './Common'
import { UpgradePromptCard } from './UpgradePromptCard'

// Endpoint hint shown beneath the section header. The exact path is
// /api/v1/stacks/:slug/domains — keeping it as a constant so the heading
// and the docs string don't drift apart.
const DOMAINS_ENDPOINT_HINT = 'POST /api/v1/stacks/:slug/domains'

type Props = { stackSlug: string }

export function CustomDomainPanel({ stackSlug }: Props) {
  const [items, setItems] = useState<CustomDomain[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [hostname, setHostname] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createErr, setCreateErr] = useState<{ kind: 'upgrade_required' | 'other'; message: string } | null>(null)

  async function refresh() {
    setLoading(true)
    setErr(null)
    try {
      const list = await api.listCustomDomains(stackSlug)
      setItems(list)
    } catch (e: any) {
      setErr(e?.message ?? 'failed to load domains')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackSlug])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    const h = hostname.trim().toLowerCase()
    if (!h) return
    setSubmitting(true)
    setCreateErr(null)
    try {
      const created = await api.createCustomDomain(stackSlug, h)
      setItems((prev) => (prev ? [created, ...prev] : [created]))
      setHostname('')
      setShowAdd(false)
    } catch (e: any) {
      if (e?.status === 402 || e?.code === 'upgrade_required') {
        setCreateErr({ kind: 'upgrade_required', message: 'Custom domains are a Pro feature.' })
      } else if (e?.code === 'hostname_taken') {
        setCreateErr({ kind: 'other', message: 'That hostname is already bound to another stack.' })
      } else if (e?.code === 'invalid_hostname') {
        setCreateErr({ kind: 'other', message: 'That hostname is not valid. Use a fully qualified domain like app.acme.com.' })
      } else {
        setCreateErr({ kind: 'other', message: e?.message ?? 'failed to add domain' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function onVerify(d: CustomDomain) {
    try {
      const updated = await api.verifyCustomDomain(stackSlug, d.id)
      setItems((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)))
    } catch (e: any) {
      setItems((prev) =>
        (prev ?? []).map((x) =>
          x.id === d.id ? { ...x, last_check_err: e?.message ?? 'verify failed' } : x,
        ),
      )
    }
  }

  async function onDelete(d: CustomDomain) {
    if (!window.confirm(`Remove ${d.hostname}? This cannot be undone.`)) return
    try {
      await api.deleteCustomDomain(stackSlug, d.id)
      setItems((prev) => (prev ?? []).filter((x) => x.id !== d.id))
    } catch (e: any) {
      setErr(e?.message ?? 'failed to delete domain')
    }
  }

  return (
    <section className="card" style={{ padding: 0, marginTop: 24 }}>
      <header style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}>Custom domains</h3>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {DOMAINS_ENDPOINT_HINT}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {!showAdd && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowAdd(true); setCreateErr(null) }}>
              + add domain
            </button>
          )}
        </span>
      </header>

      {showAdd && (
        <form onSubmit={onCreate} style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}>
          <div className="form-row" style={{ marginBottom: 8 }}>
            <label htmlFor="cd-hostname">hostname</label>
            <input
              id="cd-hostname"
              type="text"
              autoFocus
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="app.acme.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              disabled={submitting}
            />
            <span className="help">Fully qualified hostname. We'll guide you through DNS records once it's added.</span>
          </div>
          {createErr && createErr.kind === 'upgrade_required' && (
            <div style={{ marginBottom: 8 }} data-testid="custom-domain-upgrade-banner">
              <UpgradePromptCard feature="custom_domain" dense />
            </div>
          )}
          {createErr && createErr.kind === 'other' && (
            <div style={{
              fontSize: 12.5, color: 'var(--rose)', marginBottom: 8,
              padding: '8px 10px', borderLeft: '2px solid var(--rose)', background: 'rgba(255,122,138,0.04)',
            }}>
              {createErr.message}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting || !hostname.trim()}>
              {submitting ? 'adding…' : 'add domain'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowAdd(false); setHostname(''); setCreateErr(null) }} disabled={submitting}>
              cancel
            </button>
          </div>
        </form>
      )}

      <div>
        {loading && (
          <div style={{ padding: '20px 18px', color: 'var(--text-faint)', fontSize: 12.5 }}>
            loading custom domains…
          </div>
        )}
        {!loading && err && (
          <div style={{ padding: '20px 18px', color: 'var(--rose)', fontSize: 12.5 }}>
            {err}
          </div>
        )}
        {!loading && !err && items && items.length === 0 && (
          <div style={{ padding: '24px 18px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            No custom domains yet. By default this stack is reachable at its
            {' '}<code style={{ color: 'var(--text)' }}>*.deployment.instanode.dev</code> address.
          </div>
        )}
        {!loading && !err && items && items.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((d) => (
              <DomainRow key={d.id} d={d} onVerify={() => onVerify(d)} onDelete={() => onDelete(d)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ─── Domain row ───────────────────────────────────────────────────────────

function DomainRow({
  d,
  onVerify,
  onDelete,
}: {
  d: CustomDomain
  onVerify: () => void | Promise<void>
  onDelete: () => void | Promise<void>
}) {
  const [verifying, setVerifying] = useState(false)
  const showCname = d.verified || d.status === 'verified' || d.status === 'ingress_ready'
    || d.status === 'cert_ready' || d.status === 'live'

  async function handleVerify() {
    setVerifying(true)
    try {
      await onVerify()
    } finally {
      setVerifying(false)
    }
  }

  return (
    <li style={{
      borderBottom: '1px solid var(--border)',
      padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)' }}>
          {d.hostname}
        </strong>
        <DomainStatusPill status={d.status} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {d.status !== 'live' && d.status !== 'cert_ready' && (
            <button className="btn btn-secondary btn-sm" onClick={handleVerify} disabled={verifying}>
              {verifying ? 'checking…' : 'verify'}
            </button>
          )}
          <button className="btn btn-danger btn-sm" onClick={onDelete}>delete</button>
        </div>
      </div>

      {d.last_check_err && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          fontSize: 12, color: 'var(--amber)',
          borderLeft: '2px solid var(--amber)',
          background: 'rgba(255,192,105,0.04)',
          fontFamily: 'var(--font-mono)',
        }}>
          last check: {d.last_check_err}
        </div>
      )}

      {/* DNS instructions. Show TXT until verified; switch to CNAME afterwards. */}
      {!d.verified && d.verification?.txt && (
        <DnsInstructions
          intro="Add this TXT record at your DNS provider, then click Verify."
          record={d.verification.txt}
        />
      )}
      {showCname && d.verification?.cname && (
        <DnsInstructions
          intro="Point your domain at instanode by adding this CNAME record."
          record={d.verification.cname}
        />
      )}
    </li>
  )
}

// ─── Status pill ──────────────────────────────────────────────────────────
// pending_verification → amber "Awaiting TXT"
// verified             → mint  "TXT verified — issuing cert"
// ingress_ready        → mint  "Ingress live — issuing cert"
// cert_ready / live    → mint  "Live" (with checkmark)
// failed               → rose  "Failed"

function DomainStatusPill({ status }: { status: CustomDomainStatus }) {
  let label: string
  let color: string
  let bg: string
  let border: string
  switch (status) {
    case 'pending_verification':
      label = 'Awaiting TXT'
      color = 'var(--amber)'
      bg = 'rgba(255,192,105,0.08)'
      border = 'rgba(255,192,105,0.25)'
      break
    case 'verified':
      label = 'TXT verified — issuing cert'
      color = 'var(--accent)'
      bg = 'rgba(0,228,142,0.08)'
      border = 'rgba(0,228,142,0.25)'
      break
    case 'ingress_ready':
      label = 'Ingress live — issuing cert'
      color = 'var(--accent)'
      bg = 'rgba(0,228,142,0.08)'
      border = 'rgba(0,228,142,0.25)'
      break
    case 'cert_ready':
    case 'live':
      label = '✓ Live'
      color = 'var(--accent)'
      bg = 'rgba(0,228,142,0.08)'
      border = 'rgba(0,228,142,0.25)'
      break
    case 'failed':
      label = 'Failed'
      color = 'var(--rose)'
      bg = 'rgba(255,122,138,0.08)'
      border = 'rgba(255,122,138,0.25)'
      break
    default:
      label = String(status)
      color = 'var(--text-faint)'
      bg = 'transparent'
      border = 'var(--border)'
  }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      letterSpacing: '0.02em',
      color,
      background: bg,
      border: `1px solid ${border}`,
    }}>
      {label}
    </span>
  )
}

// ─── DNS instruction block (TXT or CNAME) ─────────────────────────────────

function DnsInstructions({ intro, record }: { intro: string; record: CustomDomainRecord }) {
  return (
    <div style={{
      marginTop: 12,
      padding: '12px 14px',
      border: '1px solid var(--border)',
      borderRadius: 6,
      background: 'var(--ink)',
    }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 10 }}>
        {intro}
      </div>
      <DnsRow label="Type"  value={record.record_type} mono />
      <DnsRow label="Name"  value={record.record_name} mono copyable />
      <DnsRow label="Value" value={record.record_value} mono copyable />
    </div>
  )
}

function DnsRow({
  label, value, mono, copyable,
}: {
  label: string
  value: string
  mono?: boolean
  copyable?: boolean
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    const ok = await copyToClipboard(value)
    if (!ok) {
      console.warn('[CustomDomainPanel] copy failed — clipboard unavailable')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '60px 1fr auto',
      gap: 10,
      alignItems: 'center',
      padding: '4px 0',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        color: 'var(--text-faint)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
      <code style={{
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        fontSize: 12,
        color: 'var(--text)',
        wordBreak: 'break-all',
      }}>
        {value}
      </code>
      {copyable ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={copy}
          aria-label={`copy ${label.toLowerCase()}`}
          style={{ minWidth: 56 }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}
