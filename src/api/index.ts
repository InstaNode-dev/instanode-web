// Real API surface — talks to api.instanode.dev (via Vite proxy in dev,
// same-origin in prod).
//
// §10.21 complete (2026-05-12): every FIXTURE_* fallback that previously
// masked backend outages is gone. Surfaces with no live endpoint return
// honest empty/null results; surfaces with a partial backend (billing 503,
// invoices 503) now propagate errors so the consuming page renders a
// real error banner instead of lying with mock data.

import type {
  Resource, DashboardStack, DashboardDeployment, DeploymentStatus,
  DashboardTeam, BillingDetails, Invoice,
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
//   { ok, user_id, team_id, email, tier, trial_ends_at, experiments }
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
    /** A/B-test bucket per registered experiment, e.g.
     *  `{ upgrade_button: "urgent" }`. Older API builds omit this
     *  field entirely — callers must treat undefined as "no
     *  experiment, render control variant". */
    experiments?: Record<string, string>
  }
  // No try/catch — errors propagate. The previous fixture fallback masked
  // backend outages by serving the `aanya@acme.dev` mock identity, which
  // led to chrome lying ("acme-corp", "aanya@acme.dev") instead of
  // surfacing the failure. (§10.21.1.) Callers handle errors:
  //   - 401 → AuthGate redirects to /login
  //   - other → useDashboardCtx records meErr; chrome shows a fallback
  //     `workspace` placeholder and the page can render a banner.
  const me = await call<AgentMe>('/auth/me')
  // Derive a stable team slug from the email's local part — the only
  // human-readable identity we have until a real team table exposes a slug.
  const localPart = me.email?.split('@')[0] ?? ''
  const slug = localPart.toLowerCase().replace(/[^a-z0-9-]/g, '-') || me.team_id.slice(0, 8)
  return {
    user: {
      id: me.user_id,
      email: me.email,
      team_id: me.team_id,
      tier: me.tier as any,
      created_at: '',
    },
    team: {
      id: me.team_id,
      name: localPart || 'workspace',
      slug,
      owner_id: me.user_id,
      member_count: 1,
      tier: me.tier as any,
      created_at: '',
    },
    experiments: me.experiments,
  }
}

// ─── A/B-experiment conversion ───────────────────────────────────────────
// reportExperimentConverted — fires POST /api/v1/experiments/converted to
// record that the user took the conversion action on a server-bucketed
// experiment (e.g. clicked the Upgrade button). Best-effort:
//   - swallows every error (network down, 400 from a stale variant, etc.)
//   - never blocks navigation; callers race it against a short timeout
//     and proceed regardless.
//
// The matching server-side endpoint writes an audit_log row with
// kind="experiment.conversion" and metadata={experiment, variant,
// action_taken}. See api/internal/handlers/experiments.go.
export async function reportExperimentConverted(input: {
  experiment: string
  variant: string
  action: string
}): Promise<void> {
  try {
    await call<{ ok: boolean }>('/api/v1/experiments/converted', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  } catch {
    /* analytics tail must not wag the conversion dog */
  }
}

export async function logout(): Promise<{ ok: true }> {
  clearToken()
  return { ok: true }
}

// ─── Team — honest empty/error states (no fixtures, §10.21.1) ────────────
export async function fetchTeam(): Promise<{ ok: true; team: DashboardTeam }> {
  // GET /api/v1/team isn't implemented yet — derive from /auth/me.
  const me = await fetchMe()
  return { ok: true, team: me.team }
}

export async function updateTeam(_patch: { name?: string; display_name?: string }): Promise<{ ok: true; team: DashboardTeam }> {
  // PATCH /api/v1/team isn't implemented. Return current team unchanged
  // and let the caller surface "this isn't editable yet" to the user.
  const me = await fetchMe()
  return { ok: true, team: me.team }
}

export async function listMembers(): Promise<{ ok: true; members: TeamMember[]; member_limit: number }> {
  // LIVE — `GET /api/v1/team/members`. On failure (other than 401),
  // fall back to a single-owner row derived from /auth/me — that's
  // honest minimum data the user is guaranteed to own.
  type Resp = { ok: boolean; members: any[]; member_limit: number }
  try {
    const r = await call<Resp>('/api/v1/team/members')
    const members: TeamMember[] = (r.members ?? []).map((m) => ({
      user_id: m.user_id,
      email: m.email,
      role: m.role,
      joined_at: m.joined_at,
      created_at: m.joined_at,
      display_name: m.display_name ?? m.email,
      id: m.user_id,
    }) as unknown as TeamMember)
    return { ok: true, members, member_limit: r.member_limit ?? -1 }
  } catch (e: any) {
    if (e?.status === 401) throw e
    // Honest fallback: a single owner row built from /auth/me. Not a fixture.
    const me = await fetchMe()
    return {
      ok: true,
      members: [{
        id: me.user.id,
        user_id: me.user.id,
        email: me.user.email,
        role: 'owner',
        joined_at: me.user.created_at,
        created_at: me.user.created_at,
        display_name: me.user.email,
      } as unknown as TeamMember],
      member_limit: -1,
    }
  }
}

export async function listInvitations(): Promise<{ ok: true; invitations: TeamInvitation[] }> {
  // GET /api/v1/teams/:id/invitations exists on the agent API but the
  // dashboard adapter isn't wired yet. Return empty until then — better
  // than fabricating pending invites that don't exist.
  return { ok: true, invitations: [] }
}

export async function inviteMember(_body: { email: string; role: string }): Promise<{ ok: true }> {
  // The team-invite flow is agent-driven in this product (see TeamPage
  // PromptCard). The dashboard never POSTs invitations directly. Return
  // ok so any legacy callers don't break; the actual invite is sent by
  // the agent running the user's prompt.
  return { ok: true }
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

export async function listResources(env?: string): Promise<{ ok: true; items: Resource[]; total: number }> {
  // ?env= filters server-side. Omit for all envs (the legacy behavior).
  const path = env ? `/api/v1/resources?env=${encodeURIComponent(env)}` : '/api/v1/resources'
  const r = await call<ResourceListResp>(path)
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

// ─── Stacks / deployments ───
// GET /api/v1/stacks returns one row per stack including the real env
// (production / staging / dev / ...) and parent_stack_id linkage. We adapt
// the shape into DashboardStack and leave still-missing fields (url,
// last_deploy_at, build_duration_s) undefined — the UI handles missing
// fields gracefully. Until POST /deploy/new ships in Phase 1, expect this
// to return an empty list for most teams.
type StacksListResp = {
  ok: boolean
  items?: Array<{
    stack_id?: string
    name?: string
    status?: string
    tier?: string
    namespace?: string
    env?: string
    parent_stack_id?: string
    created_at?: string
  }>
  total?: number
}

export async function listStacks(): Promise<{ ok: true; items: DashboardStack[]; total: number }> {
  try {
    const r = await call<StacksListResp>('/api/v1/stacks')
    const items: DashboardStack[] = (r.items ?? []).map((s) => ({
      id: s.stack_id ?? '',
      slug: s.stack_id ?? '',
      name: s.name ?? '',
      status: (s.status as DashboardStack['status']) ?? 'building',
      url: null,
      created_at: s.created_at ?? '',
      team_id: '',
      // env defaults to 'production' for legacy stacks pre-dating migration
      // 015. The API never returns null for env (the column has NOT NULL
      // DEFAULT 'production'), so the ?? branch is only exercised when the
      // backend predates env-aware deployments entirely.
      env: (s.env as DashboardStack['env']) ?? 'production',
      tier: (s.tier as DashboardStack['tier']) ?? 'free',
    }))
    return { ok: true, items, total: r.total ?? items.length }
  } catch {
    // Auth missing, endpoint unavailable, or other transient — show honest
    // empty state rather than fixture data.
    return { ok: true, items: [], total: 0 }
  }
}

// ─── Deployments (LIVE — POST /deploy/new single-container apps) ────────
//
// `listDeployments()` hits GET /api/v1/deployments on the agent API and
// returns the typed dashboard shape. The server response keys collide
// with DashboardStack vocabulary in one place: it returns `env` for the
// env-vars map and `environment` for the scope name. We swap them here
// so the rest of the dashboard can treat env (scope) and env_vars (map)
// the same way it does for stacks.
//
// Status mapping: the server emits 'healthy' for a live deploy, which the
// dashboard's shared StatusPill renders as 'running' (matching stacks).
// We normalise here so consumer code doesn't need to special-case it.
type DeploymentRespItem = {
  id?: string
  token?: string
  app_id?: string
  url?: string
  port?: number
  tier?: string
  status?: string
  // Server returns env as a map of env_vars (legacy alias). New callers
  // should also accept env_vars for forward compat with the spec.
  env?: Record<string, string> | string
  env_vars?: Record<string, string>
  // Env scope (production / staging / dev / ...).
  environment?: string
  created_at?: string
  updated_at?: string
  last_deploy_at?: string
  build_duration_s?: number
  resource_id?: string
  name?: string
}

type DeploymentsListResp = {
  ok: boolean
  items?: DeploymentRespItem[]
  total?: number
}

type DeploymentGetResp = {
  ok: boolean
  item?: DeploymentRespItem
}

function normaliseDeploymentStatus(s: string | undefined): DeploymentStatus {
  switch (s) {
    case 'healthy':
      return 'running' // dashboard's StatusPill speaks 'running'
    case 'building':
    case 'deploying':
    case 'failed':
    case 'stopped':
    case 'running':
      return s
    default:
      return 'building'
  }
}

function adaptDeployment(d: DeploymentRespItem): DashboardDeployment {
  // The server's `env` field is the env_vars map (legacy alias); the env
  // scope name lives under `environment`. New callers may also send a
  // dedicated `env_vars` field — accept either.
  const envVarsRaw =
    d.env_vars ??
    (typeof d.env === 'object' && d.env !== null ? d.env : undefined)
  const envScope = d.environment ?? (typeof d.env === 'string' ? d.env : undefined)
  const id = d.id ?? d.app_id ?? d.token ?? ''
  const appID = d.app_id ?? d.token ?? id
  return {
    id,
    app_id: appID,
    // The server doesn't ship a separate display name yet — fall back to
    // the app_id so the UI has something stable to render. Once the API
    // exposes a real name, this falls through automatically.
    name: d.name ?? appID,
    url: d.url ?? null,
    status: normaliseDeploymentStatus(d.status),
    env: (envScope ?? 'production') as DashboardDeployment['env'],
    port: d.port ?? 0,
    tier: (d.tier ?? 'free') as DashboardDeployment['tier'],
    env_vars: envVarsRaw ?? {},
    created_at: d.created_at ?? '',
    last_deploy_at: d.last_deploy_at ?? d.updated_at,
    build_duration_s: d.build_duration_s,
    resource_id: d.resource_id,
  }
}

export async function listDeployments(env?: string): Promise<{ ok: true; items: DashboardDeployment[]; total: number }> {
  // No try/catch fallback to empty — errors propagate so DeploymentsPage
  // can render a real error state instead of silently lying. The list
  // endpoint requires auth; 401 still triggers the AuthGate redirect.
  // ?env= filters server-side; omitting returns all envs (legacy behavior).
  const path = env ? `/api/v1/deployments?env=${encodeURIComponent(env)}` : '/api/v1/deployments'
  const r = await call<DeploymentsListResp>(path)
  const items = (r.items ?? []).map(adaptDeployment)
  return { ok: true, items, total: r.total ?? items.length }
}

/**
 * Fetch a single deployment by ID. Returns `null` when the API returns
 * 404 so the caller (DeployDetailPage) can fall back to the stack lookup
 * without a noisy console error. Other errors still propagate.
 */
export async function getDeployment(
  id: string,
): Promise<{ ok: true; deployment: DashboardDeployment | null }> {
  try {
    const r = await call<DeploymentGetResp>(`/api/v1/deployments/${encodeURIComponent(id)}`)
    if (!r.item) return { ok: true, deployment: null }
    return { ok: true, deployment: adaptDeployment(r.item) }
  } catch (e: any) {
    if (e?.status === 404) return { ok: true, deployment: null }
    throw e
  }
}

// ─── Stack family — env-sibling grid ─────────────────────────────────────
// GET /api/v1/stacks/:slug/family returns root + every direct child as a
// flat list (root first) so the dashboard can render "production · staging
// · dev" cards side-by-side without doing N round-trips. Pro+ only — the
// agent API returns 402 with agent_action for hobby/free teams; we surface
// that with a tagged failure so the UI shows the existing PromoteUpsell
// instead of trying to render an empty grid.

export type StackFamilyMember = {
  slug: string
  name: string
  env: string
  status: DashboardStack['status']
  tier: DashboardStack['tier']
  url: string
  is_root: boolean
  parent_stack_id: string
  last_deploy_at: string
  created_at: string
}

type StackFamilyResp = {
  ok: boolean
  slug?: string
  family?: Array<{
    slug?: string
    name?: string
    env?: string
    status?: string
    tier?: string
    url?: string
    is_root?: boolean
    parent_stack_id?: string
    last_deploy_at?: string
    created_at?: string
  }>
  total?: number
}

/**
 * Fetch the env-sibling family for a stack. Returns:
 *   { ok: true, family, slug }     — Pro+ team, family fetched
 *   { ok: false, reason: 'upgrade_required' } — hobby/free, 402 from API
 *   { ok: false, reason: 'not_found' }        — slug missing or another team's
 *   { ok: false, reason: 'unknown' }          — transient failure
 *
 * The discriminated-union return shape lets the calling UI choose between
 * rendering the env grid, the PromoteUpsell card, or an error state without
 * leaking APIError into the page component.
 */
export async function fetchStackFamily(
  slug: string,
): Promise<
  | { ok: true; slug: string; family: StackFamilyMember[]; total: number }
  | { ok: false; reason: 'upgrade_required' | 'not_found' | 'unknown' }
> {
  try {
    const r = await call<StackFamilyResp>(`/api/v1/stacks/${encodeURIComponent(slug)}/family`)
    const family: StackFamilyMember[] = (r.family ?? []).map((m) => ({
      slug: m.slug ?? '',
      name: m.name ?? '',
      env: m.env ?? 'production',
      status: (m.status as DashboardStack['status']) ?? 'building',
      tier: (m.tier as DashboardStack['tier']) ?? 'free',
      url: m.url ?? '',
      is_root: m.is_root ?? false,
      parent_stack_id: m.parent_stack_id ?? '',
      last_deploy_at: m.last_deploy_at ?? '',
      created_at: m.created_at ?? '',
    }))
    return { ok: true, slug: r.slug ?? slug, family, total: r.total ?? family.length }
  } catch (err) {
    // APIError exposes status; treat 402 as the explicit upgrade signal and
    // 404 as not-yet-promoted (the slug exists but the team can't see it),
    // and lump everything else into 'unknown' so the UI keeps showing the
    // single-env fallback. Inspect status defensively because non-APIError
    // throwables (network failures, jsdom) reach here too.
    const status = (err as { status?: number })?.status
    if (status === 402) return { ok: false as const, reason: 'upgrade_required' }
    if (status === 404) return { ok: false as const, reason: 'not_found' }
    return { ok: false as const, reason: 'unknown' }
  }
}

// §10.21: no live GET /api/v1/stacks/:slug yet. Derive the detail from
// listStacks() so the dashboard stops fabricating stack metadata. Returns
// `stack: null` honestly when the slug isn't found instead of silently
// substituting the first FIXTURE_STACKS entry, which previously made the
// dashboard render a fake "flashcards" stack for every unknown slug.
export async function getStack(slug: string): Promise<{ ok: true; stack: DashboardStack | null }> {
  try {
    const r = await listStacks()
    const stack = r.items.find((x) => x.slug === slug) ?? null
    return { ok: true as const, stack }
  } catch {
    return { ok: true as const, stack: null }
  }
}

// §10.21: no live GET /api/v1/stacks/:slug/build-logs yet. Return an
// honest empty buffer instead of canned build logs that don't match the
// user's actual deploy. Real-time logs stream via streamSSE on
// DeployDetailPage.
export async function getStackLogs(slug: string) {
  return { ok: true as const, slug, lines: [] as Array<{ ts: string; phase: string; level: string; message: string }> }
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
// fetchBilling   — LIVE. Calls GET /api/v1/billing on the agent API and
//                  returns the aggregated billing state. Errors (including
//                  503 = Razorpay unconfigured) propagate so the page
//                  renders a real error banner instead of mock data.
//
// listInvoices   — LIVE. Calls GET /api/v1/billing/invoices. Errors
//                  propagate (no fixture fallback).
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
  // §10.21: every error propagates. The previous 503 fallback returned
  // FIXTURE_BILLING (fake "active subscription, ****4242 visa, renews in
  // 9 days") whenever Razorpay was unconfigured, which lied to users in
  // local dev and any partial-outage state. BillingPage now catches the
  // APIError and renders a real error banner.
  const r = await call<BillingStateResp>('/api/v1/billing')
  return { ok: true as const, plan: r.tier, billing: mapBillingState(r) }
}

type InvoicesResp = { ok: boolean; invoices?: Invoice[] }

export async function listInvoices(): Promise<{ ok: true; invoices: Invoice[] }> {
  // §10.21: errors propagate. The previous 503 fallback returned three
  // mock "paid" invoices that didn't correspond to any real payment;
  // BillingPage now surfaces the failure honestly.
  const r = await call<InvoicesResp>('/api/v1/billing/invoices')
  return { ok: true, invoices: r.invoices ?? [] }
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
  // §10.21: 401 still rethrows (AuthGate redirects to /login). Other
  // errors return an honest empty list — the page renders an empty state
  // rather than fabricating Stripe / OpenAI / Anthropic keys the user
  // has never stored.
  try {
    const r = await call<VaultListResp>(`/api/v1/vault/${encodeURIComponent(env)}`)
    const entries: VaultEntry[] = (r.keys ?? []).map((key) => ({
      key,
      env,
      // Backend doesn't expose rotated_at / last_read_at on the list; the UI
      // shows them only when the api actually returns a value. Leaving
      // rotated_at null here so VaultPage hides the "rotated …" chip
      // instead of fabricating "just now" for every row.
      rotated_at: null,
      last_read_at: null,
      reads_24h: 0,
      deploys: 0,
    }) as unknown as VaultEntry)
    return { ok: true, entries }
  } catch (e: any) {
    if (e?.status === 401) throw e
    return { ok: true as const, entries: [] }
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
  // §10.21: 401 still rethrows. On any other failure we still try the
  // resource-synthesis fallback (honest data, just synthesised from the
  // live resource list). If that also fails we return an empty list
  // instead of FIXTURE_ACTIVITY — the page renders "no activity yet"
  // rather than fabricating "marcus rotated STRIPE_SECRET_KEY" rows
  // that never happened.
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
    // Fall back to synthesising from resources so the dashboard still
    // renders something honest (real resources, real timestamps).
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
      return { ok: true as const, items: [] }
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

// ─── §10.20 cached aggregates (LIVE) ────────────────────────────────────
//
// Two server-side cached endpoints replace what the dashboard previously
// computed client-side:
//
//   fetchBillingUsage() → GET /api/v1/billing/usage   (Redis-cached 30s)
//   fetchTeamSummary()  → GET /api/v1/team/summary    (Redis-cached 5m)
//
// Both responses carry `as_of` (ISO timestamp) + `freshness_seconds` so the
// UI can render an "as of Ns ago" footnote that makes the eventual-
// consistency tradeoff visible to the user (per §13).
//
// These are pure GETs — safe to call on render. The agent API sets
// Cache-Control: private, max-age=N so the browser also caches the
// response within the same window (no double-fetch on remount).

/** Per-metric shape inside `usage` — bytes/limit_bytes for storage services,
 *  count/limit for everything else. -1 means unlimited. */
export type UsageMetric = {
  bytes?: number
  limit_bytes?: number
  count?: number
  limit?: number
}

export type BillingUsage = {
  ok: true
  freshness_seconds: number
  /** ISO-8601 UTC timestamp of when the server computed this snapshot. */
  as_of: string
  usage: {
    postgres: UsageMetric
    redis: UsageMetric
    mongodb: UsageMetric
    deployments: UsageMetric
    webhooks: UsageMetric
    vault: UsageMetric
    members: UsageMetric
  }
}

export async function fetchBillingUsage(): Promise<BillingUsage> {
  return call<BillingUsage>('/api/v1/billing/usage')
}

export type TeamSummaryCounts = {
  resources: {
    total: number
    postgres: number
    redis: number
    mongodb: number
    webhook: number
    queue: number
    storage: number
    other: number
  }
  deployments: number
  members: number
  vault_keys: number
}

export type TeamSummary = {
  ok: true
  freshness_seconds: number
  /** ISO-8601 UTC timestamp of when the server computed this snapshot. */
  as_of: string
  tier: string
  counts: TeamSummaryCounts
}

export async function fetchTeamSummary(): Promise<TeamSummary> {
  return call<TeamSummary>('/api/v1/team/summary')
}
