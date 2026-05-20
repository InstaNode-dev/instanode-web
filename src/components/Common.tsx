/* Reusable atoms & molecules used across pages.
   Kept in one file to keep imports flat — split later if it grows. */

import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Resource, ResourceType, StackStatus, Tier, Env, Role } from '../api/types'

// ------------- display-name helpers -------------
// Resource `name` is becoming a required field on the API, but legacy rows
// (provisioned before the field existed) can still carry an empty/null
// `name`. A backend backfill populates most of them — these helpers render
// defensively so a missing name never shows a blank primary label.
//
// The contract: the human-readable `name` is ALWAYS the primary label; the
// hash/token/UUID is secondary muted text. When `name` is absent we show
// `(unnamed <type>)` so the row is still identifiable at a glance.

/** Primary display label for a resource/deployment/stack.
 *  Returns the name when present, else `(unnamed)` or `(unnamed <type>)`. */
export function displayName(
  name: string | null | undefined,
  type?: string | null,
): string {
  const trimmed = (name ?? '').trim()
  if (trimmed) return trimmed
  return type ? `(unnamed ${type})` : '(unnamed)'
}

/** True when a resource has no usable name — used to style the fallback
 *  label as muted/italic so it reads as a placeholder, not a real name. */
export function isUnnamed(name: string | null | undefined): boolean {
  return !(name ?? '').trim()
}

// ------------- branding -------------
// The mark uses the canonical instanode.dev favicon (cube + braces). Loaded
// from /public so it's part of the app bundle, not an external request.
//
// Wave 3 perf polish: `decoding="async"` lets the browser decode the PNG
// off the main thread so the brand mark doesn't compete with the rest of
// the nav for paint budget. width/height are explicit so the layout
// reserves space and CLS stays 0.
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <img
      src="/apple-touch-icon.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      className="brand-mark"
    />
  )
}

export function Brand() {
  return (
    <span className="brand">
      <BrandMark />
      <span className="brand-name">
        instanode<span className="dot">.</span>dev
      </span>
    </span>
  )
}

// ------------- pills -------------
export function EnvPill({ env }: { env: Env }) {
  const cls =
    env === 'production'  ? 'env-pill prod'  :
    env === 'staging'     ? 'env-pill staging' :
    env === 'development' ? 'env-pill dev'  : 'env-pill'
  const label =
    env === 'production' ? 'prod' :
    env === 'development' ? 'dev' : env
  return <span className={cls}>{label}</span>
}

// StatusPill renders both stack statuses (building / running / failed /
// stopped) and the deployment-level 'deploying' phase emitted by
// /api/v1/deployments. 'deploying' renders identically to 'building'
// because the visual semantics — "work in flight, not yet live" — are
// the same; treating them as separate pill styles would over-fragment
// the chrome. 'healthy' is kept as an alias of 'running' so the
// deployment status field can land here without an extra adapter.
export function StatusPill({
  status,
}: {
  status: StackStatus | 'healthy' | 'deploying' | 'expired'
}) {
  const display =
    status === 'running'   ? 'healthy' :
    status === 'deploying' ? 'building' :
                              status
  const cls =
    display === 'healthy'  ? 'status-pill healthy' :
    display === 'building' ? 'status-pill building' :
    display === 'failed'   ? 'status-pill failed' :
    display === 'expired'  ? 'status-pill stopped' :
                             'status-pill stopped'
  return <span className={cls}>{display}</span>
}

// TIER_LABELS maps internal tier keys to user-facing names. The two
// equal-limit tiers ("anonymous" vs "free") render with different labels so
// the dashboard can show "Free" to claimed-but-unpaid users while keeping
// "Anonymous" for pre-claim agent flows.
const TIER_LABELS: Record<Tier, string> = {
  anonymous: 'anonymous',
  free: 'free',
  hobby: 'hobby',
  hobby_plus: 'hobby+',
  pro: 'pro',
  team: 'team',
  growth: 'growth',
}

export function TierPill({ tier }: { tier: Tier }) {
  // Same color family as anonymous (both are zero-cost pre-paid tiers) but a
  // distinct modifier class lets us nudge the visual without divergence.
  return <span className={`res-tier tier-${tier}`}>{TIER_LABELS[tier] ?? tier}</span>
}

export function RolePill({ role }: { role: Role }) {
  return <span className={`role-pill ${role === 'owner' || role === 'admin' ? role : ''}`}>{role}</span>
}

export function ScopePill({ scope }: { scope: 'read' | 'write' | 'agent' }) {
  if (scope === 'write')
    return <span className="scope-pill write" title="this page is human-only — agents cannot pay with cards">write · clickable</span>
  if (scope === 'agent')
    return <span className="scope-pill agent" title="this page tells you what to ask your agent">✦ agent surface</span>
  return <span className="scope-pill read" title="this page is read-only · changes go through your agent">read · mirror</span>
}

// ------------- icons -------------
export function ResourceIcon({ type, size = 22 }: { type: ResourceType; size?: number }) {
  const map: Record<ResourceType, string> = {
    postgres: 'ico-pg',
    redis: 'ico-rd',
    mongodb: 'ico-mg',
    queue: 'ico-qu',
    storage: 'ico-st',
    webhook: 'ico-wh',
    deploy: 'ico-dp'
  }
  return (
    <span
      className={`${map[type]} res-name-ico`}
      style={{ width: size, height: size, borderRadius: size <= 16 ? 3 : 5, flexShrink: 0, display: 'inline-block' }}
      aria-hidden="true"
    />
  )
}

// ------------- contract banners -------------
type BannerKind = 'locked' | 'blocked' | 'warning'
export function ContractBanner({
  kind,
  badge,
  children
}: {
  kind: BannerKind
  badge: string
  children: ReactNode
}) {
  return (
    <div className={`contract-banner ${kind}`}>
      <span className="badge">{badge}</span>
      <div className="body">{children}</div>
    </div>
  )
}

export function ROBanner({
  variant = 'read',
  children,
}: {
  variant?: 'read' | 'write'
  children: ReactNode
  /** Deprecated — removed when the decorative ⌘K "ask agent" link was retired.
   * Accepted as an ignored prop for transitional callsites. */
  showAsk?: boolean
}) {
  const badge = variant === 'write' ? 'human · only' : 'read-only'
  return (
    <div className={`ro-banner ${variant === 'write' ? 'write' : ''}`}>
      <span className="badge">{badge}</span>
      <div className="body">{children}</div>
    </div>
  )
}

// ------------- clipboard helper -------------
//
// Single source of truth for "copy text to clipboard" across the dashboard.
// Tries the async Clipboard API first (modern Safari/Chrome/Firefox on
// https origins), then falls back to the legacy `document.execCommand`
// path so HTTP origins, older Safari, and locked-down sandboxes still
// work. Returns `false` only when both paths fail — callers should
// surface a small failure indicator (v1: console.warn at the call site,
// full toast library is a separate workstream).
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to execCommand path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// ------------- prompt pattern -------------
export function PromptCard({
  title,
  prompt,
  promptText,
  method,
  endpoint,
  hint,
  danger = false,
  baseURL = 'https://api.instanode.dev'
}: {
  title: string
  prompt: ReactNode
  promptText?: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  endpoint: string
  hint?: string
  danger?: boolean
  baseURL?: string
}) {
  const verbCls =
    method === 'GET' ? 'get' :
    method === 'DELETE' ? 'del' :
    method === 'PATCH' ? 'patch' :
    method === 'PUT' ? 'put' : ''
  const [copied, setCopied] = useState<null | 'prompt' | 'curl'>(null)
  const curlText =
    `curl -X ${method} ${baseURL}${endpoint} \\\n` +
    `  -H "Authorization: Bearer $INSTANODE_TOKEN"` +
    (method === 'GET' || method === 'DELETE' ? '' : ` \\\n  -H "Content-Type: application/json"`)
  // Fallback when a caller hasn't supplied a richer promptText yet: still gives the
  // agent enough to act. Pages should provide promptText with full context for best UX.
  const fallbackPrompt = `${title}\n\nCall: ${method} ${baseURL}${endpoint}\nAuth: use my INSTANODE_TOKEN env var as Bearer.`
  async function copy(kind: 'prompt' | 'curl') {
    const text = kind === 'prompt' ? (promptText ?? fallbackPrompt) : curlText
    const ok = await copyToClipboard(text)
    if (!ok) {
      console.warn('[PromptCard] copy failed — clipboard unavailable')
      return
    }
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 1500)
  }
  return (
    <div
      className="prompt-card"
      style={
        danger
          ? {
              borderColor: 'rgba(255,122,138,0.25)',
              background: 'linear-gradient(180deg, rgba(255,122,138,0.04), transparent)'
            }
          : undefined
      }
    >
      <div className="head">
        <strong>{title}</strong>
        {hint && <span className="right">{hint}</span>}
      </div>
      <div className="prompt">{prompt}</div>
      <div className="api">
        <span className={`verb ${verbCls}`}>{method}</span>
        <span>{endpoint}</span>
      </div>
      <div className="actions">
        <button className="cp" onClick={() => copy('prompt')} data-testid="copy-prompt">
          {copied === 'prompt' ? 'copied ✓' : 'copy prompt'}
        </button>
        <button className="cp" onClick={() => copy('curl')} data-testid="copy-curl">
          {copied === 'curl' ? 'copied ✓' : 'copy curl'}
        </button>
      </div>
    </div>
  )
}

// ------------- sparkline -------------
export function Sparkline({
  points,
  color = 'rgba(0,228,142,0.4)'
}: {
  points: number[]
  color?: string
}) {
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const w = 100
  const h = 22
  const step = w / Math.max(points.length - 1, 1)
  const path = points
    .map((v, i) => {
      const x = i * step
      const y = h - ((v - min) / range) * h
      return `${i === 0 ? '' : ''}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth={1.2} points={path} />
    </svg>
  )
}

// ------------- usage bar -------------
// The agent API emits `limit = -1` for unlimited (team-tier) quotas. A bare
// `-1` would render a literal "-1" in the label and a NaN/negative ratio for
// the bar fill, so `limit < 0` is treated as "unlimited": the fill stays
// neutral (no usage ratio is meaningful against an unbounded limit) and the
// label shows the used value against an ∞ symbol.
export function UsageBar({
  used,
  limit,
  format = (a, b) => `${a} / ${b}`
}: {
  used: number
  limit: number
  format?: (used: string, limit: string) => string
}) {
  const unlimited = limit < 0
  const ratio = !unlimited && limit > 0 ? Math.min(used / limit, 1) : 0
  const cls = ratio > 0.95 ? 'fill danger' : ratio > 0.8 ? 'fill warn' : 'fill'
  const fmt = (n: number) => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)} MB`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
    return `${n}`
  }
  return (
    <div className="usage">
      <span className="bar">
        <span className={cls} style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="num">{format(fmt(used), unlimited ? '∞' : fmt(limit))}</span>
    </div>
  )
}

// ------------- relative time -------------
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const sec = Math.round(diff / 1000)
  if (sec < 60) return sec <= 5 ? 'just now' : `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  return `${mo}mo ago`
}

export function RelTime({ at }: { at: string | null | undefined }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
      {relTime(at)}
    </span>
  )
}

// ------------- skeleton -------------
export function Skeleton({ width = '100%', height = 14 }: { width?: number | string; height?: number | string }) {
  return <span className="skel" style={{ width, height }} />
}

// ------------- contract line (single-row API doc) -------------
export function ContractLine({
  method,
  path,
  status = 'live'
}: {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  status?: 'live' | 'gap' | 'partial' | string
}) {
  const m =
    method === 'GET' ? 'get' :
    method === 'DELETE' ? 'del' :
    method === 'PATCH' ? 'patch' :
    method === 'PUT' ? 'put' : 'post'
  const cls = status === 'live' ? 'meta ok' : status === 'gap' ? 'meta gap' : 'meta'
  return (
    <div className="contract-line">
      <span className={`m ${m}`}>{method}</span>
      <span className="path">{path}</span>
      <span className={cls}>{status}</span>
    </div>
  )
}

// ------------- expiry (claimed-but-unpaid 24h TTL) -------------
//
// Until the Razorpay subscription.charged webhook fires, every claimed
// resource has an `expires_at` set to ~24h from claim. The dashboard
// surfaces this in three places (row badge, top banner, detail card) so
// the user can't close the tab and lose everything they just provisioned.
//
// All countdown math is render-time. Pages can opt into a 60s tick by
// using useExpiryTick() at the layout root — no sub-second timers.

/** Window in which the top-of-dashboard warning banner shows. */
export const EXPIRY_BANNER_THRESHOLD_MS = 6 * 60 * 60 * 1000 // 6 hours
/** Window in which the badge pulses to draw the eye. */
export const EXPIRY_URGENT_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

/**
 * Format the time between `now` and `expiresAt` as a short human string.
 * Returns 'expired' when the timestamp is in the past, otherwise one of
 * '37m', '2h 14m', '14h 3m', '1d 3h' (single-unit days only above 24h).
 */
export function formatTimeUntil(expiresAt: string | null | undefined, now: number = Date.now()): string {
  if (!expiresAt) return ''
  const t = new Date(expiresAt).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = t - now
  if (diff <= 0) return 'expired'
  const totalMin = Math.floor(diff / 60_000)
  if (totalMin < 1) {
    // <60s — show seconds for the last minute so it feels alive.
    const sec = Math.max(1, Math.floor(diff / 1000))
    return `${sec}s`
  }
  if (totalMin < 60) return `${totalMin}m`
  const totalHr = Math.floor(totalMin / 60)
  const minPart = totalMin % 60
  if (totalHr < 24) {
    return minPart === 0 ? `${totalHr}h` : `${totalHr}h ${minPart}m`
  }
  const days = Math.floor(totalHr / 24)
  const hrPart = totalHr % 24
  return hrPart === 0 ? `${days}d` : `${days}d ${hrPart}h`
}

/** Classifies an expiry timestamp for styling decisions. */
export type ExpiryLevel = 'none' | 'safe' | 'soon' | 'urgent' | 'expired'

export function expiryLevel(expiresAt: string | null | undefined, now: number = Date.now()): ExpiryLevel {
  if (!expiresAt) return 'none'
  const t = new Date(expiresAt).getTime()
  if (!Number.isFinite(t)) return 'none'
  const diff = t - now
  if (diff <= 0) return 'expired'
  if (diff <= EXPIRY_URGENT_THRESHOLD_MS) return 'urgent'
  if (diff <= EXPIRY_BANNER_THRESHOLD_MS) return 'soon'
  return 'safe'
}

/**
 * Light render-time hook: re-renders the consumer every 60 seconds so
 * countdown text stays fresh without manual interaction. One interval
 * per mount — placed at the layout level it covers every page.
 */
export function useExpiryTick(intervalMs: number = 60_000): number {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return tick
}

/**
 * Resource-row countdown badge. Rose-tinted; pulses when <1h to expiry.
 * Renders nothing when `expires_at` is null (permanent resource).
 */
export function ExpiryBadge({ expiresAt, now }: { expiresAt: string | null | undefined; now?: number }) {
  const t = now ?? Date.now()
  const level = expiryLevel(expiresAt, t)
  if (level === 'none') return null
  const text = level === 'expired' ? 'expired' : `expires in ${formatTimeUntil(expiresAt, t)}`
  const cls = `expiry-badge ${level === 'urgent' || level === 'expired' ? 'urgent' : ''}`
  return (
    <span
      className={cls}
      data-testid="expiry-badge"
      data-level={level}
      title="Claimed resources expire 24h after creation unless a subscription is active. Pay to keep them."
    >
      <span className="warn-ico" aria-hidden="true">⚠</span>
      <span>{text}</span>
    </span>
  )
}

/**
 * Top-of-dashboard banner. Shows when ANY resource is <6h from expiry.
 * Renders nothing when no resource qualifies (no FOUC for paid users).
 */
export function ExpiryWarningBanner({ resources, now }: { resources: Resource[]; now?: number }) {
  const t = now ?? Date.now()
  const atRisk = resources.filter((r) => {
    const lvl = expiryLevel(r.expires_at, t)
    return lvl === 'soon' || lvl === 'urgent' || lvl === 'expired'
  })
  if (atRisk.length === 0) return null
  const n = atRisk.length
  // Pick the soonest-to-expire to surface a concrete time in the banner.
  const soonest = atRisk.reduce<Resource | null>((acc, r) => {
    if (!r.expires_at) return acc
    if (!acc || !acc.expires_at) return r
    return new Date(r.expires_at).getTime() < new Date(acc.expires_at).getTime() ? r : acc
  }, null)
  const soonestText = soonest?.expires_at ? formatTimeUntil(soonest.expires_at, t) : ''
  return (
    <div
      className="contract-banner expiry"
      role="alert"
      data-testid="expiry-warning-banner"
      data-count={n}
    >
      <span className="badge">expires soon</span>
      <div className="body">
        <strong>
          {n === 1 ? '1 resource' : `${n} resources`} expire{n === 1 ? 's' : ''} in less than 6 hours
        </strong>
        {soonestText && soonestText !== 'expired' ? (
          <> · soonest in <strong>{soonestText}</strong></>
        ) : null}
        . Claimed resources are on a 24h TTL until you start a subscription —{' '}
        <Link to="/app/billing" className="pay-now-link">Pay now to keep them →</Link>
      </div>
    </div>
  )
}

// ------------- card wrapper -------------
export function Card({
  title,
  right,
  children,
  className,
  style
}: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={`card ${className ?? ''}`} style={style}>
      {(title || right) && (
        <div className="card-h">
          {title}
          {right && <span className="right">{right}</span>}
        </div>
      )}
      {children}
    </div>
  )
}
