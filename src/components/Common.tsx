/* Reusable atoms & molecules used across pages.
   Kept in one file to keep imports flat — split later if it grows. */

import type { ReactNode } from 'react'
import type { ResourceType, StackStatus, Tier, Env, Role } from '../api/types'

// ------------- branding -------------
// The mark uses the canonical instanode.dev favicon (cube + braces). Loaded
// from /public so it's part of the app bundle, not an external request.
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <img
      src="/apple-touch-icon.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
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

export function StatusPill({ status }: { status: StackStatus | 'healthy' }) {
  const display = status === 'running' ? 'healthy' : status
  const cls =
    display === 'healthy'  ? 'status-pill healthy' :
    display === 'building' ? 'status-pill building' :
    display === 'failed'   ? 'status-pill failed' :
                             'status-pill stopped'
  return <span className={cls}>{display}</span>
}

export function TierPill({ tier }: { tier: Tier }) {
  return <span className="res-tier">{tier}</span>
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
  showAsk = true
}: {
  variant?: 'read' | 'write'
  children: ReactNode
  showAsk?: boolean
}) {
  const badge = variant === 'write' ? 'human · only' : 'read-only'
  return (
    <div className={`ro-banner ${variant === 'write' ? 'write' : ''}`}>
      <span className="badge">{badge}</span>
      <div className="body">{children}</div>
      {showAsk && variant === 'read' && (
        <a className="ask">✦ ⌘K · ask agent</a>
      )}
    </div>
  )
}

// ------------- prompt pattern -------------
export function PromptPill({
  label,
  shortcut = '⌘K'
}: {
  label: string
  shortcut?: string
}) {
  return (
    <a className="prompt-pill" role="button">
      <span className="label">{label}</span>
      <span style={{ opacity: 0.6 }}>{shortcut}</span>
    </a>
  )
}

export function PromptCard({
  title,
  prompt,
  method,
  endpoint,
  hint,
  danger = false
}: {
  title: string
  prompt: ReactNode
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  endpoint: string
  hint?: string
  danger?: boolean
}) {
  const verbCls =
    method === 'GET' ? 'get' :
    method === 'DELETE' ? 'del' :
    method === 'PATCH' ? 'patch' :
    method === 'PUT' ? 'put' : ''
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
        <button className="cp">copy prompt</button>
        <button className="cp">copy curl</button>
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
export function UsageBar({
  used,
  limit,
  format = (a, b) => `${a} / ${b}`
}: {
  used: number
  limit: number
  format?: (used: string, limit: string) => string
}) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
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
      <span className="num">{format(fmt(used), fmt(limit))}</span>
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
