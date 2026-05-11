// Real API surface — talks to api.instanode.dev (via Vite proxy in dev,
// same-origin in prod). Endpoints that do NOT exist on the live backend
// (vault list, activity feed, team metadata, members CRUD) fall back to
// fixtures so the dashboard remains usable end-to-end while engineering
// catches up. Each fallback is annotated `[FIXTURE]` in the comment.

import { fake } from './client'
import {
  FIXTURE_STACKS,
  FIXTURE_TEAM,
  FIXTURE_USER,
  FIXTURE_MEMBERS,
  FIXTURE_INVITATIONS,
  FIXTURE_BILLING,
  FIXTURE_INVOICES,
  FIXTURE_VAULT,
  FIXTURE_ACTIVITY,
  FIXTURE_BUILD_LOGS
} from './fixtures'
import type {
  Resource, DashboardStack, DashboardTeam, BillingDetails, Invoice,
  TeamMember, TeamInvitation, AuthMeResponse, VaultEntry, ActivityItem
} from './types'

export * from './types'

// ─── API base URL resolution ─────────────────────────────────────────────
// Resolves the origin used for every fetch in this module.
//   - Dev (Vite dev server): '' so the Vite proxy in vite.config.ts handles
//     /api, /auth, /claim, ... — keeps requests same-origin and avoids
//     CORS preflights during local development.
//   - Prod (GitHub Pages at https://instanode.dev): full origin
//     'https://api.instanode.dev' so the browser issues cross-origin
//     requests directly to the API on DOKS.
//   - Tests can pin the origin via window.__INSTANODE_API_URL__.
//   - CI builds can override via VITE_API_URL at build time (this beats
//     both of the above).
export function getAPIBaseURL(): string {
  // Override for tests / debugging
  if (typeof window !== 'undefined') {
    const o = (window as any).__INSTANODE_API_URL__ as string | undefined
    if (o) return o
  }
  // Build-time env (set in CI)
  const env = (import.meta as any).env?.VITE_API_URL
  if (env !== undefined && env !== null) return env
  // Default differs by mode:
  //   - dev: '' so Vite's proxy handles it (no CORS preflight needed)
  //   - prod: full URL — cross-origin direct
  if ((import.meta as any).env?.DEV) return ''
  return 'https://api.instanode.dev'
}

// ─── Auth + token storage ────────────────────────────────────────────────

const TOKEN_KEY = 'instanode.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// ─── Low-level fetch ─────────────────────────────────────────────────────

class APIError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Paths where a 401 should NOT trigger the auto-redirect to /login. The
// LoginPage uses fetchMe() to verify a freshly-pasted PAT and wants to
// surface the 401 inline; the ClaimPage handles its own auth flow.
const AUTH_REDIRECT_SKIP_PREFIXES = ['/login', '/claim']
const RETURN_TO_KEY = 'instanode.return_to'

/**
 * Central fetch wrapper. On a 401 response from the API the helper:
 *   1. clears the stored token,
 *   2. saves the current pathname+search under `instanode.return_to` so the
 *      user can be sent back after re-login,
 *   3. redirects to `/login` via `window.location.replace` (so the back
 *      button doesn't loop), and
 *   4. still throws the `APIError` so callers see a rejected promise.
 *
 * The redirect is suppressed when the current path already starts with
 * `/login` or `/claim` — those pages render the 401 inline. The function
 * is also a no-op outside a browser environment (SSR / unit tests).
 */
async function call<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {})
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  const tok = getToken()
  if (tok) headers.set('Authorization', `Bearer ${tok}`)

  // Resolve to an absolute URL so cross-origin builds (GitHub Pages → DOKS)
  // hit the API directly. When base is '' (dev — Vite proxy) we still need
  // an absolute origin for the URL constructor; fall back to the current
  // window origin (or a localhost stub for non-browser tests).
  const base = getAPIBaseURL()
  const url = new URL(
    path,
    base || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'),
  )
  // Bearer auth is in the Authorization header — no cookies in flight, so
  // we deliberately do NOT set credentials: 'include' (avoids unnecessary
  // CORS preflights and keeps the API allowlist simple).
  const res = await fetch(url.toString(), { ...init, headers })
  const ct = res.headers.get('content-type') ?? ''
  const body: any = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text()
  if (!res.ok) {
    if (res.status === 401) {
      let onAuthPage = false
      try {
        const p = location.pathname
        onAuthPage = AUTH_REDIRECT_SKIP_PREFIXES.some((prefix) => p.startsWith(prefix))
      } catch {
        /* non-browser env (jsdom-less tests) — treat as not on auth page */
      }
      if (!onAuthPage) {
        clearToken()
        try {
          localStorage.setItem(RETURN_TO_KEY, location.pathname + location.search)
        } catch {
          /* localStorage / location unavailable — best-effort only */
        }
        if (typeof window !== 'undefined') {
          window.location.replace('/login')
        }
      }
    }
    const code = (body && body.error) || `http_${res.status}`
    const msg = (body && (body.message || body.error_description)) || res.statusText
    throw new APIError(res.status, code, msg)
  }
  return body as T
}

// ─── Auth / me ───────────────────────────────────────────────────────────
// GET /auth/me on the agent API returns:
//   { ok, user_id, team_id, email, tier, trial_ends_at }
// The dashboard expected { user, team } — we adapt here so the rest of
// the dashboard still consumes the richer fixture shape.
export async function fetchMe(): Promise<AuthMeResponse> {
  type AgentMe = {
    ok: boolean
    user_id: string
    team_id: string
    email: string
    tier: string
    trial_ends_at: string | null
  }
  try {
    const me = await call<AgentMe>('/auth/me')
    return {
      user: {
        ...FIXTURE_USER,
        id: me.user_id,
        email: me.email,
        team_id: me.team_id,
        tier: me.tier as any,
      },
      team: {
        ...FIXTURE_TEAM,
        id: me.team_id,
        // Derive a stable, non-fixture display name from the email's local
        // part (the email is the only human-readable identity we have until
        // a real team table exposes a slug).
        slug: (me.email?.split('@')[0]?.toLowerCase().replace(/[^a-z0-9-]/g, '-')) || me.team_id.slice(0, 8),
        name: (me.email?.split('@')[0]) || 'workspace',
        tier: me.tier as any,
      },
    }
  } catch (e: any) {
    // 401 → bubble up so AuthGate can redirect.
    if (e?.status === 401) throw e
    // Other errors fall back to fixture so the demo keeps working.
    return fake({ user: FIXTURE_USER, team: FIXTURE_TEAM })
  }
}

export async function logout(): Promise<{ ok: true }> {
  clearToken()
  return { ok: true }
}

// ─── Team (some surfaces missing on backend, fallback) ───────────────────
// [FIXTURE] no GET /api/v1/team yet — fetchMe() returns enough team info.
export async function fetchTeam(): Promise<{ ok: true; team: DashboardTeam }> {
  try {
    const me = await fetchMe()
    return { ok: true, team: me.team }
  } catch {
    return fake({ ok: true as const, team: FIXTURE_TEAM })
  }
}

export async function updateTeam(patch: { name?: string; display_name?: string }): Promise<{ ok: true; team: DashboardTeam }> {
  // [FIXTURE] no PATCH /api/v1/team yet.
  return fake({ ok: true as const, team: { ...FIXTURE_TEAM, ...patch } })
}

export async function listMembers(): Promise<{ ok: true; members: TeamMember[]; member_limit: number }> {
  // LIVE — `GET /api/v1/team/members` shipped in v1.0.0.
  // Falls back to a single-owner row derived from /auth/me when the call fails.
  try {
    type Resp = { ok: boolean; members: any[]; member_limit: number }
    const r = await call<Resp>('/api/v1/team/members')
    const members: TeamMember[] = (r.members ?? []).map((m) => ({
      ...FIXTURE_MEMBERS[0],
      user_id: m.user_id,
      email: m.email,
      role: m.role,
      joined_at: m.joined_at,
    } as TeamMember))
    return { ok: true, members, member_limit: r.member_limit ?? -1 }
  } catch (e: any) {
    if (e?.status === 401) throw e
    try {
      const me = await fetchMe()
      return {
        ok: true,
        members: [{ ...FIXTURE_MEMBERS[0], user_id: me.user.id, email: me.user.email } as TeamMember],
        member_limit: 999,
      }
    } catch {
      return fake({ ok: true as const, members: FIXTURE_MEMBERS, member_limit: 999 })
    }
  }
}

export async function listInvitations(): Promise<{ ok: true; invitations: TeamInvitation[] }> {
  // The agent API has /api/v1/teams/:id/invitations — different shape and
  // requires team_id in path. Mapping the live response to dashboard's
  // TeamInvitation shape is a follow-up; using fixtures for now.
  return fake({ ok: true as const, invitations: FIXTURE_INVITATIONS })
}

export async function inviteMember(_body: { email: string; role: string }): Promise<{ ok: true }> {
  // [FIXTURE] no /api/v1/team/members/invite — agent-driven in this model.
  return fake({ ok: true as const })
}

// ─── Resources (LIVE) ───────────────────────────────────────────────────
type ResourceListResp = { ok: boolean; items: any[]; total: number }
type ResourceGetResp = { ok: boolean; item: any }

function adaptResource(r: any): Resource {
  return {
    id: r.id,
    token: r.token,
    resource_type: r.resource_type,
    tier: r.tier,
    status: r.status,
    name: r.name ?? null,
    env: r.env ?? 'production',
    storage_bytes: r.storage_bytes ?? 0,
    storage_limit_bytes: r.storage_limit_bytes ?? 0,
    storage_exceeded: r.storage_exceeded ?? false,
    connections_in_use: r.connections_in_use,
    connections_limit: r.connections_limit,
    cloud_vendor: r.cloud_vendor,
    country_code: r.country_code,
    expires_at: r.expires_at ?? null,
    created_at: r.created_at,
    connection_url: r.connection_url,
  }
}

export async function listResources(): Promise<{ ok: true; items: Resource[]; total: number }> {
  const r = await call<ResourceListResp>('/api/v1/resources')
  const items = (r.items ?? []).map(adaptResource)
  return { ok: true, items, total: r.total ?? items.length }
}

export async function getResource(id: string): Promise<{ ok: true; resource: Resource }> {
  const r = await call<ResourceGetResp>(`/api/v1/resources/${id}`)
  // The agent API splits credentials into a separate endpoint.
  let connection_url: string | undefined
  try {
    const c = await call<{ connection_url: string }>(`/api/v1/resources/${id}/credentials`)
    connection_url = c.connection_url
  } catch {
    /* credentials may be hidden for some resource types */
  }
  return { ok: true, resource: adaptResource({ ...r.item, connection_url }) }
}

export async function deleteResource(id: string): Promise<void> {
  await call(`/api/v1/resources/${id}`, { method: 'DELETE' })
}

export async function rotateResource(id: string): Promise<{ ok: true; connection_url: string; resource: Resource }> {
  const r = await call<{ ok: boolean; connection_url: string }>(
    `/api/v1/resources/${id}/rotate-credentials`,
    { method: 'POST' },
  )
  const detail = await call<ResourceGetResp>(`/api/v1/resources/${id}`)
  return {
    ok: true,
    connection_url: r.connection_url,
    resource: adaptResource({ ...detail.item, connection_url: r.connection_url }),
  }
}

// ─── Stacks / deployments (partial: deployments live, stacks fixture) ───
export async function listStacks(): Promise<{ ok: true; items: DashboardStack[]; total: number }> {
  // The agent API has /api/v1/stacks but the dashboard's DashboardStack
  // shape is denser than what the API returns. Falling back to fixtures
  // until the shapes align.
  return fake({ ok: true as const, items: FIXTURE_STACKS, total: FIXTURE_STACKS.length })
}

export async function getStack(slug: string): Promise<{ ok: true; stack: DashboardStack }> {
  const s = FIXTURE_STACKS.find((x) => x.slug === slug) ?? FIXTURE_STACKS[0]
  return fake({ ok: true as const, stack: s })
}

export async function getStackLogs(slug: string) {
  return fake({ ok: true as const, slug, lines: FIXTURE_BUILD_LOGS })
}

// ─── Custom domains (LIVE) ──────────────────────────────────────────────
// Pro+ tier feature: bind a customer-owned hostname to a stack. Lifecycle:
//   pending_verification → verified → ingress_ready → cert_ready → live
// (the reconciler worker isn't deployed yet, so `live` may not appear right
// away — treat `cert_ready` as "done" until then).
export type CustomDomainStatus =
  | 'pending_verification'
  | 'verified'
  | 'ingress_ready'
  | 'cert_ready'
  | 'live'
  | 'failed'

export type CustomDomainRecord = {
  record_type: string
  record_name: string
  record_value: string
}

export type CustomDomain = {
  id: string
  hostname: string
  status: CustomDomainStatus
  verified: boolean
  certificate_ready: boolean
  verification?: {
    txt?: CustomDomainRecord
    cname?: CustomDomainRecord
  }
  last_check_err?: string | null
}

export async function listCustomDomains(stackSlug: string): Promise<CustomDomain[]> {
  const r = await call<{ ok: boolean; items: CustomDomain[]; total: number }>(
    `/api/v1/stacks/${encodeURIComponent(stackSlug)}/domains`,
  )
  return r.items ?? []
}

export async function createCustomDomain(stackSlug: string, hostname: string): Promise<CustomDomain> {
  const r = await call<{ domain: CustomDomain }>(
    `/api/v1/stacks/${encodeURIComponent(stackSlug)}/domains`,
    { method: 'POST', body: JSON.stringify({ hostname }) },
  )
  return r.domain
}

export async function verifyCustomDomain(stackSlug: string, id: string): Promise<CustomDomain> {
  const r = await call<{ domain: CustomDomain }>(
    `/api/v1/stacks/${encodeURIComponent(stackSlug)}/domains/${encodeURIComponent(id)}/verify`,
    { method: 'POST' },
  )
  return r.domain
}

export async function deleteCustomDomain(stackSlug: string, id: string): Promise<void> {
  await call(
    `/api/v1/stacks/${encodeURIComponent(stackSlug)}/domains/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

// ─── Billing (LIVE: every endpoint hits the agent API) ──────────────────
//
// fetchBilling   — LIVE. Calls GET /api/v1/billing on the agent API,
//                  which returns the aggregated billing state (tier,
//                  subscription_status, next_renewal_at, amount_inr,
//                  payment_method, razorpay_*_id). Falls back to a
//                  whoami-derived shape when the endpoint isn't
//                  available (503 = Razorpay unconfigured, e.g. local
//                  dev) so the UI stays usable.
//
// listInvoices   — LIVE. Calls GET /api/v1/billing/invoices on the agent
//                  API; falls back to FIXTURE_INVOICES on 503.
//
// createCheckout — LIVE. Calls POST /api/v1/billing/checkout, creates a
//                  real Razorpay subscription, and returns the hosted
//                  payment short_url. The caller (BillingPage) redirects
//                  the user to short_url to complete payment. Errors
//                  propagate as APIError so the page's checkoutErr state
//                  can surface them inline.
//
// cancelSubscription — LIVE. POST /api/v1/billing/cancel.

type BillingStateResp = {
  ok: boolean
  tier: string
  subscription_status?: 'none' | 'active' | 'cancelled' | 'trial'
  next_renewal_at?: string | null
  amount_inr?: number | null
  payment_method?: {
    type: 'card' | 'upi' | 'netbanking' | 'wallet'
    brand?: string
    last4?: string
    vpa?: string
  } | null
  billing_email?: string
  razorpay_subscription_id?: string | null
  razorpay_customer_id?: string | null
}

/* Map the agent API's BillingStateResp into the dashboard's BillingDetails
 * type. The dashboard's shape was designed against a richer Stripe-style
 * payload; the agent API returns the bare minimum for now. Anything the
 * agent API doesn't expose stays undefined so the UI renders "—". */
function mapBillingState(r: BillingStateResp): BillingDetails {
  return {
    status: r.subscription_status ?? 'none',
    current_period_end: r.next_renewal_at ?? null,
    razorpay_configured: r.subscription_status !== 'none',
    subscription_status: r.subscription_status,
    payment_last4: r.payment_method?.last4,
    payment_network: r.payment_method?.brand,
    cancel_at_period_end: false,
  }
}

export async function fetchBilling(): Promise<{ ok: true; plan: string; billing: BillingDetails }> {
  try {
    const r = await call<BillingStateResp>('/api/v1/billing')
    return { ok: true as const, plan: r.tier, billing: mapBillingState(r) }
  } catch (e: any) {
    // 503 = Razorpay unconfigured in this env (e.g. local dev without
    // RAZORPAY_KEY_ID). Fall back to the whoami-derived shape +
    // FIXTURE_BILLING so the page still renders. Any other error
    // propagates so the caller sees a real failure.
    if (e?.status === 503) {
      try {
        const me = await fetchMe()
        return { ok: true as const, plan: me.user.tier, billing: FIXTURE_BILLING }
      } catch {
        return { ok: true as const, plan: 'hobby', billing: FIXTURE_BILLING }
      }
    }
    throw e
  }
}

type InvoicesResp = { ok: boolean; invoices?: Invoice[] }

export async function listInvoices(): Promise<{ ok: true; invoices: Invoice[] }> {
  try {
    const r = await call<InvoicesResp>('/api/v1/billing/invoices')
    return { ok: true, invoices: r.invoices ?? [] }
  } catch (e: any) {
    // 503 = billing_not_configured (no Razorpay keys in this env). Fall
    // back to the fixture list so the page renders something usable in
    // local dev. Any other error propagates so the UI shows a real
    // failure state.
    if (e?.status === 503) return { ok: true, invoices: FIXTURE_INVOICES }
    throw e
  }
}

export async function createCheckout(
  plan: string,
): Promise<{ ok: true; short_url: string; subscription_id?: string }> {
  const r = await call<{ ok: boolean; short_url: string; subscription_id?: string }>(
    '/api/v1/billing/checkout',
    { method: 'POST', body: JSON.stringify({ plan }) },
  )
  return { ok: true, short_url: r.short_url, subscription_id: r.subscription_id }
}

export async function cancelSubscription(): Promise<{ ok: true }> {
  await call<{ ok: boolean }>('/api/v1/billing/cancel', { method: 'POST' })
  return { ok: true }
}

// ─── Vault (LIVE — listing keys works, value reveal lives on detail) ────
type VaultListResp = { ok: boolean; keys: string[] }

export async function listVault(env: string): Promise<{ ok: true; entries: VaultEntry[] }> {
  try {
    const r = await call<VaultListResp>(`/api/v1/vault/${encodeURIComponent(env)}`)
    const entries: VaultEntry[] = (r.keys ?? []).map((key) => ({
      key,
      env,
      // Backend doesn't expose rotated_at / last_read_at on the list; UI
      // shows them when present. Filling with synthesised values.
      rotated_at: new Date().toISOString(),
      last_read_at: null,
      reads_24h: 0,
      deploys: 0,
    }) as unknown as VaultEntry)
    return { ok: true, entries }
  } catch (e: any) {
    if (e?.status === 401) throw e
    return fake({ ok: true as const, entries: FIXTURE_VAULT.filter((v) => v.env === env) })
  }
}

// Reveal a single secret. Adds an audit row on the server.
export async function revealVaultSecret(env: string, key: string): Promise<{ value: string; version: number }> {
  return call(`/api/v1/vault/${encodeURIComponent(env)}/${encodeURIComponent(key)}`)
}

export async function putVaultSecret(env: string, key: string, value: string): Promise<{ version: number }> {
  return call(`/api/v1/vault/${encodeURIComponent(env)}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })
}

export async function deleteVaultSecret(env: string, key: string): Promise<void> {
  await call(`/api/v1/vault/${encodeURIComponent(env)}/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

// ─── Activity feed — LIVE via /api/v1/audit ─────────────────────────────
// Backed by the audit_log table (migration 012). Each row from a real event:
// provision / claim / rotate / delete / vault.put / etc.
// Falls back to synthesising from resource timestamps if the audit call fails.
export async function fetchActivity(): Promise<{ ok: true; items: ActivityItem[] }> {
  try {
    type AuditResp = {
      ok: boolean
      items: Array<{
        id: string
        actor: string
        kind: string
        resource_type: string
        resource_id: string | null
        summary: string
        metadata: Record<string, any> | null
        at: string
      }>
    }
    const r = await call<AuditResp>('/api/v1/audit?limit=20')
    const items: ActivityItem[] = (r.items ?? []).map((e) => ({
      id: e.id,
      at: e.at,
      level: 'info' as const,
      text: e.summary,
      actor: e.actor,
      kind: e.kind,
    } as unknown as ActivityItem))
    return { ok: true, items }
  } catch (e: any) {
    if (e?.status === 401) throw e
    // Fall back to synthesising from resources so the dashboard still renders.
    try {
      const r = await listResources()
      const items: ActivityItem[] = r.items.slice(0, 8).map((res) => ({
        id: `act_${res.id}`,
        at: res.created_at,
        level: 'info' as const,
        text: `<strong>${res.cloud_vendor ?? 'agent'}</strong> provisioned <strong>${res.resource_type}</strong> <code>${(res.name ?? res.token).slice(0, 16)}</code>`,
        actor: res.cloud_vendor ?? 'agent',
        kind: 'provision',
      } as unknown as ActivityItem))
      return { ok: true, items }
    } catch {
      return fake({ ok: true as const, items: FIXTURE_ACTIVITY })
    }
  }
}

// ─── PATs (LIVE) ────────────────────────────────────────────────────────
export type APIKey = {
  id: string
  name: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  revoked: boolean
}
export type APIKeyCreated = APIKey & { key: string; note: string }

export async function listAPIKeys(): Promise<{ ok: true; items: APIKey[] }> {
  return call('/api/v1/auth/api-keys')
}

export async function createAPIKey(body: { name: string; scopes?: string[] }): Promise<APIKeyCreated> {
  return call('/api/v1/auth/api-keys', { method: 'POST', body: JSON.stringify(body) })
}

export async function revokeAPIKey(id: string): Promise<void> {
  await call(`/api/v1/auth/api-keys/${id}`, { method: 'DELETE' })
}

// ─── Claim (LIVE) ───────────────────────────────────────────────────────
export type ClaimResp = {
  ok: boolean
  team_id: string
  user_id: string
  session_token: string
  message?: string
}

export async function claim(body: { jwt: string; email: string }): Promise<ClaimResp> {
  return call('/claim', { method: 'POST', body: JSON.stringify(body) })
}
