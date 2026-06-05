// Real API surface — talks to api.instanode.dev (via Vite proxy in dev,
// same-origin in prod).
//
// §10.21 complete (2026-05-12): every FIXTURE_* fallback that previously
// masked backend outages is gone. Surfaces with no live endpoint return
// honest empty/null results; surfaces with a partial backend (billing 503,
// invoices 503) now propagate errors so the consuming page renders a
// real error banner instead of lying with mock data.

import type {
  Tier,
  Resource, ResourceType, DashboardStack, StackStatus,
  DashboardDeployment, DeploymentStatus, DeploymentFailure,
  DashboardTeam, BillingDetails, Invoice,
  TeamMember, TeamInvitation, AuthMeResponse, VaultEntry, ActivityItem,
  AdminCustomerListResponse, AdminCustomerDetailResponse,
  AdminIssuePromoInput, AdminIssuePromoResponse,
  AdminSetTierInput, AdminSetTierResponse,
  // Wire types DERIVED from the OpenAPI snapshot (generated.ts via gen:api-types).
  // Consuming these here is what makes an api field rename fail `tsc` — see the
  // contract-drift gate header in types.ts (Wave 1).
  WireAuthMe, WireResourceItem, WireResourceListResponse,
  WireBillingState, WireDeployItem,
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

// D08 (P1): logout hook registry.
//
// The `logout()` function lives in this module (api/index.ts). The bootstrap
// state that needs resetting lives in hooks/useDashboardCtx.ts. A direct
// import would create a circular dependency (hooks → api is fine; api → hooks
// is not). Instead, useDashboardCtx.ts calls registerLogoutHook(resetBootstrap)
// once at module load, and logout() invokes every registered callback before
// returning. This is the same decoupled pattern used for the 401 clearToken
// behaviour in the `call` helper.
const _logoutHooks: Array<() => void> = []

/** Register a callback to run synchronously during logout (after server
 *  invalidation, before clearToken). Idempotent — registering the same
 *  function reference twice is a no-op. */
export function registerLogoutHook(fn: () => void): void {
  if (!_logoutHooks.includes(fn)) _logoutHooks.push(fn)
}

// ─── Low-level fetch ─────────────────────────────────────────────────────

// P2-W2-16: the tier-wall envelope. A 402 (and some 403 admin walls) carry
// an `agent_action` — a copy-pasteable agent prompt task #33 sharpened — and
// an `upgrade_url`. A 429 carries a `Retry-After` header (seconds). The old
// APIError dropped all three, so every wall rendered generic "Payment
// Required" copy and rate-limited callers had no backoff hint. APIError now
// preserves them; callers (ChangePlanModal, QuotaWallBanner, the 429 retry
// path) read them off the thrown error.
export class APIError extends Error {
  status: number
  code: string
  /** Agent prompt string from a 402/403 tier-wall envelope, if present. */
  agentAction?: string
  /** Upgrade/pricing URL from a 402/403 tier-wall envelope, if present. */
  upgradeUrl?: string
  /** Seconds to wait before retrying — from a 429 `Retry-After` header. */
  retryAfter?: number
  constructor(
    status: number,
    code: string,
    message: string,
    extra?: { agentAction?: string; upgradeUrl?: string; retryAfter?: number },
  ) {
    super(message)
    this.status = status
    this.code = code
    this.agentAction = extra?.agentAction
    this.upgradeUrl = extra?.upgradeUrl
    this.retryAfter = extra?.retryAfter
  }
}

// parseErrorEnvelope — pulls the wall extras (agent_action, upgrade_url) out
// of a parsed JSON error body and the Retry-After out of the response
// headers. Shared by call() and the three multipart helpers that build
// their own APIError. `Retry-After` may be a delay in seconds or an HTTP
// date; we only honor the numeric-seconds form (the API emits seconds).
function parseErrorEnvelope(
  res: Response,
  body: any,
): { agentAction?: string; upgradeUrl?: string; retryAfter?: number } {
  const agentAction =
    body && typeof body.agent_action === 'string' ? body.agent_action : undefined
  const upgradeUrl =
    body && typeof body.upgrade_url === 'string' ? body.upgrade_url : undefined
  let retryAfter: number | undefined
  const ra = res.headers.get('Retry-After')
  if (ra) {
    const secs = Number(ra)
    if (Number.isFinite(secs) && secs >= 0) retryAfter = secs
  }
  return { agentAction, upgradeUrl, retryAfter }
}

// Paths where a 401 SHOULD auto-redirect to /login. Only the gated `/app/*`
// subtree warrants kicking the user out — every other route (marketing `/`,
// `/pricing`, `/docs`, `/blog`, `/use-cases`, `/status`, `/incidents`,
// `/login`, `/claim`, …) must render even when the api rejects a stray
// call. The previous SKIP-list approach was inverted: any public page that
// happened to fire a 401-producing api call (stale NR ping, deferred
// fetch, a re-mounted hook from cached navigation) would bounce the
// visitor to /login. That was the root cause of "homepage automatically
// redirects to /login" — fixed by gating the redirect to the path we
// actually want to protect.
const AUTH_REDIRECT_REQUIRED_PREFIXES = ['/app']
const RETURN_TO_KEY = 'instanode.return_to'

/**
 * Central fetch wrapper. On a 401 response from the API the helper:
 *   1. clears the stored token,
 *   2. saves the current pathname+search under `instanode.return_to` so the
 *      user can be sent back after re-login,
 *   3. redirects to `/login` via `window.location.replace` ONLY if the
 *      caller is already inside the gated `/app/*` subtree,
 *   4. still throws the `APIError` so callers see a rejected promise.
 *
 * The redirect is intentionally limited to `/app/*`. On any public page
 * (marketing, pricing, docs, login, claim) we clear the token and surface
 * the error to the caller without navigation — the page stays renderable
 * for an anonymous visitor. The function is also a no-op outside a
 * browser environment (SSR / unit tests).
 */
// handle401 — the shared 401 reaction: clear the stale token, and (only
// when the user is already inside the gated `/app/*` subtree) stash the
// return-to path and redirect to /login. Extracted from call() so the
// multipart helpers (createDeploy / createStack) — which build their own
// fetch and bypass call() — give an expired token the same treatment
// instead of leaving the user in a dead retry loop (P1-W3-20).
export function handle401(status: number): void {
  if (status !== 401) return
  let inGatedAppArea = false
  try {
    const p = location.pathname
    inGatedAppArea = AUTH_REDIRECT_REQUIRED_PREFIXES.some(
      (prefix) => p === prefix || p.startsWith(prefix + '/'),
    )
  } catch {
    /* non-browser env (jsdom-less tests) — treat as not in /app */
  }
  // Always clear the stale token so subsequent calls don't re-attach it.
  // Only navigate when we're already inside the gated area.
  clearToken()
  if (inGatedAppArea) {
    try {
      localStorage.setItem(RETURN_TO_KEY, location.pathname + location.search)
    } catch {
      /* localStorage / location unavailable — best-effort only */
    }
    if (typeof window !== 'undefined') {
      // B8-E2 (2026-05-20): pass session_expired=1 so /login can render a
      // visible banner explaining why the user landed here. The earlier
      // behaviour silently redirected with no UX hint, so the user
      // saw a generic login page and assumed their click vanished. Combined
      // with the return-to localStorage stash, this gives a complete
      // "session expired — please sign in to continue" story.
      window.location.replace('/login?session_expired=1')
    }
  }
}

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
    handle401(res.status)
    const code = (body && body.error) || `http_${res.status}`
    const msg = (body && (body.message || body.error_description)) || res.statusText
    throw new APIError(res.status, code, msg, parseErrorEnvelope(res, body))
  }
  return body as T
}

// ─── Auth / me ───────────────────────────────────────────────────────────
// GET /auth/me on the agent API returns:
//   { ok, user_id, team_id, email, tier, experiments }
// The dashboard expected { user, team } — we adapt here so the rest of
// the dashboard still consumes the richer fixture shape.
//
// Historical note: this response used to include a `trial_ends_at` field;
// removed on 2026-05-14 per policy memory project_no_trial_pay_day_one.md.
// The platform has no trial period — hobby/pro/team are paid from day one.
export async function fetchMe(): Promise<AuthMeResponse> {
  // AgentMe is the WIRE shape of GET /auth/me — DERIVED from the OpenAPI
  // snapshot (WireAuthMe = components['schemas']['AuthMeResponse']). It used to
  // be hand-typed here; deriving it means an api rename/removal of any /auth/me
  // field (e.g. dropping `tier`, the login-break class) fails `tsc` right here
  // at the read sites below. The wire schema marks every field optional (no
  // `required` array on the response), so the reads below use nullish guards —
  // the server sends user_id/team_id/email/tier on every real response, but a
  // partial/older build that omits one must degrade, not throw.
  type AgentMe = WireAuthMe
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
  // `?? ''` guards: WireAuthMe marks team_id/user_id/email/tier optional (the
  // wire schema has no `required` array), so the derived type is `string |
  // undefined`. Real responses always carry them; an omission degrades to an
  // empty identity rather than throwing on `.slice` / failing the non-optional
  // User/DashboardTeam field types. Runtime is unchanged for well-formed payloads.
  const teamId = me.team_id ?? ''
  const userId = me.user_id ?? ''
  const email = me.email ?? ''
  const tier = (me.tier ?? '') as Tier
  const slug = localPart.toLowerCase().replace(/[^a-z0-9-]/g, '-') || teamId.slice(0, 8)
  // Stash the admin path prefix in a module-local var so the admin URL
  // builders below can mint `/api/v1/${prefix}/customers/...` requests
  // without forcing every caller to plumb it through manually. The prefix
  // is a secret — see setAdminPathPrefix() — never log, never echo to UI.
  setAdminPathPrefix(me.admin_path_prefix ?? '')
  return {
    user: {
      id: userId,
      email,
      team_id: teamId,
      tier,
      created_at: '',
    },
    team: {
      id: teamId,
      name: localPart || 'workspace',
      slug,
      owner_id: userId,
      member_count: 1,
      tier,
      created_at: '',
    },
    experiments: me.experiments,
    is_platform_admin: me.is_platform_admin === true,
    admin_path_prefix: me.admin_path_prefix,
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

// ─── Status — public, real backend (W11) ──────────────────────────────────
// GET /api/v1/status returns the worker-aggregated uptime feed. Replaces
// the previous client-side probe loop on /status (which had the fatal
// "instanode edge down → probe also down" failure mode caught by P3).
//
// Public — no auth. Errors fall through to an empty payload so the page
// renders a skeleton instead of a crash.

export interface StatusComponent {
  slug: string
  name: string
  category: string
  description?: string
  current_status: 'operational' | 'degraded' | 'down'
  uptime_7d_pct: number
  uptime_30d_pct: number
  /** 96 booleans, one per 15-minute slot, oldest → newest. */
  last_24h_samples: boolean[]
}

export interface StatusIncident {
  id: string
  title: string
  severity: string
  status: string
  started_at: string
  resolved_at?: string
  summary?: string
  url?: string
}

export interface StatusPayload {
  ok: boolean
  freshness_seconds: number
  as_of: string
  components: StatusComponent[]
  current_incidents: StatusIncident[]
}

/**
 * fetchStatus — public GET /api/v1/status. Best-effort: on any failure
 * returns an honest empty payload (ok=false, components=[]) so the page
 * can render a degraded-but-functional skeleton instead of a 500 or a
 * console error. The page logic distinguishes ok=false from
 * components=[] (the latter is also a valid "fresh install, no probes
 * yet" state).
 */
export async function fetchStatus(): Promise<StatusPayload> {
  const base = getAPIBaseURL()
  const origin =
    base || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  let url: string
  try {
    url = new URL('/api/v1/status', origin).toString()
  } catch {
    return emptyStatus()
  }
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) return emptyStatus()
    const body = (await res.json().catch(() => null)) as StatusPayload | null
    if (!body || !Array.isArray(body.components)) return emptyStatus()
    // Defensive: server should always send current_incidents, but coerce
    // missing/null to [] so the consumer can safely .map().
    if (!Array.isArray(body.current_incidents)) {
      body.current_incidents = []
    }
    return body
  } catch {
    return emptyStatus()
  }
}

function emptyStatus(): StatusPayload {
  return {
    ok: false,
    freshness_seconds: 60,
    as_of: new Date().toISOString(),
    components: [],
    current_incidents: [],
  }
}

export async function logout(): Promise<{ ok: true }> {
  // A03 (P1): server-side session invalidation — POST /auth/logout stores
  // the JWT's jti in Redis so subsequent requests with the same bearer token
  // are rejected by RequireAuth. We fire this BEFORE clearToken so the
  // Authorization header is still present. On server error (network / Redis
  // down) we proceed with client-side cleanup — the caller still considers
  // the logout successful, and the token will auto-expire at most 24h later.
  try {
    await call<{ ok: boolean }>('/auth/logout', { method: 'POST' })
  } catch {
    // Fail-soft on server error — always clear the local token.
  }
  // D08 (P1): reset module-level state (bootstrapped flag + cached identity)
  // so the next same-tab login performs a fresh /auth/me fetch. Registered by
  // useDashboardCtx.ts at module load via registerLogoutHook(resetBootstrap).
  for (const fn of _logoutHooks) fn()
  clearToken()
  // Drop the admin URL prefix on logout. A stale prefix in module-local
  // state would survive across a re-login by a different user (admin →
  // non-admin same tab), and the non-admin's first /auth/me would race
  // with their first admin-page render. Belt-and-braces: also clears it
  // in tests that mock fetchMe but exercise logout afterwards.
  setAdminPathPrefix('')
  return { ok: true }
}

// ─── Team — honest empty/error states (no fixtures, §10.21.1) ────────────
export async function fetchTeam(): Promise<{ ok: true; team: DashboardTeam }> {
  // GET /api/v1/team isn't implemented yet — derive from /auth/me.
  const me = await fetchMe()
  return { ok: true, team: me.team }
}

export async function updateTeam(patch: { name?: string; display_name?: string }): Promise<{ ok: true; team: DashboardTeam }> {
  // B8-P1 F1 (BUGBASH 2026-05-20): PATCH /api/v1/team is live (api/openapi.json
  // confirms: required `name`, 1-200 chars, whitespace trimmed). The previous
  // implementation was a no-op stub that silently returned the cached team
  // unchanged — every rename "succeeded" from the UI's POV but never reached
  // the server. We now PATCH with the new name (prefer `name`, fall back to
  // `display_name` for callers that still pass that key) and rebuild the
  // DashboardTeam from the server response so the UI reflects the persisted
  // value, not the optimistic input. On error we surface to the caller so the
  // form can show a real banner.
  const name = (patch.name ?? patch.display_name ?? '').trim()
  if (!name) {
    // Don't waste a round-trip on an empty patch — the api would 400.
    const me = await fetchMe()
    return { ok: true, team: me.team }
  }
  type PatchResp = { ok: boolean; team: { id: string; name: string; plan_tier: string; has_active_subscription: boolean; created_at: string } }
  const r = await call<PatchResp>('/api/v1/team', {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
  // The PATCH response is the slim TeamSelf shape (no slug / owner_id /
  // member_count). Merge with /auth/me-derived team so consumers that read
  // those fields keep working.
  const me = await fetchMe()
  const team: DashboardTeam = {
    ...me.team,
    name: r.team?.name ?? name,
    tier: (r.team?.plan_tier as any) ?? me.team.tier,
    created_at: r.team?.created_at ?? me.team.created_at,
  }
  return { ok: true, team }
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
  // B8-P1 F2 (BUGBASH 2026-05-20): GET /api/v1/team/invitations is live
  // (owner-only, see openapi.json — 200/401/403). The previous stub returned
  // [] so TeamPage's "Pending · 0" was a lie when the team had real invites.
  // We now call the live endpoint and adapt. On 401 (not logged in) and 403
  // (caller isn't owner) we fail open to []: the team page renders the
  // empty-invite section either way, and a banner would be noise for the
  // common case of non-owners viewing the page.
  type InviteRow = {
    id: string
    email: string
    role: string
    status?: string
    invited_by_user_id?: string
    invited_by?: string
    invited_by_name?: string
    created_at: string
    expires_at: string
  }
  type Resp = { ok: boolean; invitations: InviteRow[] }
  try {
    const r = await call<Resp>('/api/v1/team/invitations')
    const invitations: TeamInvitation[] = (r.invitations ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role as TeamInvitation['role'],
      status: (i.status as TeamInvitation['status']) ?? 'pending',
      invited_by: i.invited_by ?? i.invited_by_user_id ?? '',
      invited_by_name: i.invited_by_name,
      created_at: i.created_at,
      expires_at: i.expires_at,
    }))
    return { ok: true, invitations }
  } catch (e: any) {
    if (e?.status === 401 || e?.status === 403) {
      // Not owner / not logged in — render zero pending invites rather
      // than blowing up the team page.
      return { ok: true, invitations: [] }
    }
    throw e
  }
}

export async function inviteMember(body: { email: string; role: string }): Promise<{ ok: true; invitation?: TeamInvitation }> {
  // B8-P1 F3 (BUGBASH 2026-05-20): POST /api/v1/team/members/invite is live
  // (owner/admin only, see openapi.json — 201/400/401/403/409/429). The
  // previous stub returned `{ ok: true }` without contacting the server, so
  // the agent-driven flow that the prompt-card describes ran on top of a
  // broken direct-call path: any code calling inviteMember thought the
  // invite was sent when nothing happened.
  //
  // We now POST and surface the created invitation (or a structured error)
  // to the caller. The role enum on the server is {admin, developer, viewer,
  // member}; we pass through whatever the caller sent and let the api do the
  // validation (returns 400 for an unknown value).
  type CreateResp = {
    ok: boolean
    invitation?: {
      id: string
      email: string
      role: string
      status?: string
      invited_by_user_id?: string
      invited_by?: string
      invited_by_name?: string
      created_at: string
      expires_at: string
    }
  }
  const r = await call<CreateResp>('/api/v1/team/members/invite', {
    method: 'POST',
    body: JSON.stringify({ email: body.email, role: body.role }),
  })
  if (!r.invitation) {
    return { ok: true }
  }
  const i = r.invitation
  const invitation: TeamInvitation = {
    id: i.id,
    email: i.email,
    role: i.role as TeamInvitation['role'],
    status: (i.status as TeamInvitation['status']) ?? 'pending',
    invited_by: i.invited_by ?? i.invited_by_user_id ?? '',
    invited_by_name: i.invited_by_name,
    created_at: i.created_at,
    expires_at: i.expires_at,
  }
  return { ok: true, invitation }
}

// ─── Resources (LIVE) ───────────────────────────────────────────────────
// Resource wire envelopes — DERIVED from the OpenAPI snapshot. The list
// envelope is the generated ResourceListResponse; the detail `item` is a
// WireResourceItem. adaptResource() (below) reads these, so an api rename of
// e.g. storage_bytes → storageBytes fails `tsc` at the adapter read site.
// connection_url is NOT on the wire ResourceItem (it comes from the separate
// /credentials endpoint and is spliced in), so the detail item is widened to
// allow it.
type ResourceListResp = WireResourceListResponse
type ResourceGetResp = { ok?: boolean; item?: WireResourceItem & { connection_url?: string } }

// CREDENTIALED_RESOURCE_TYPES — the resource types whose
// GET /api/v1/resources/:id/credentials endpoint returns a usable
// `connection_url`. BugBash P3-02: getResource() fired the credentials
// fetch unconditionally, so webhook / storage / queue resources (which
// do not expose a connection_url on that endpoint) returned a 400 on
// every detail-page open — spurious 400s in the API logs and NR
// telemetry. Gating the fetch to these three types removes the noise
// without changing behaviour for db/redis/mongo (the catch below still
// guards genuine permission-hidden cases).
export const CREDENTIALED_RESOURCE_TYPES: ReadonlySet<ResourceType> = new Set<ResourceType>([
  'postgres',
  // 'vector' is wire-distinct from 'postgres' but uses the same Postgres
  // credentials shape — `/api/v1/resources/:id/credentials` returns a
  // working postgres:// URL. Without this entry, opening a vector
  // resource's detail page never fetches the connection_url and the
  // "Connection string" panel renders empty.
  'vector',
  'redis',
  'mongodb',
])

// adaptResource maps the wire ResourceItem (derived from the OpenAPI snapshot)
// into the UI's Resource shape. `r` is typed as WireResourceItem plus the two
// fields the wire schema does NOT carry but the UI splices/derives:
//   - connection_url: from the separate /credentials endpoint (getResource).
//   - connections_in_use: not on ResourceItem in the spec today (the schema has
//     connections_limit but not connections_in_use). Kept readable via the
//     intersection so the UI's optional field stays populated if/when the api
//     adds it; until then it's always undefined. (Latent gap, noted in report.)
// Because `r` is the derived wire type, an api rename of any field consumed
// below fails `tsc` HERE — that's the gate biting.
function adaptResource(
  r: WireResourceItem & { connection_url?: string; connections_in_use?: number },
): Resource {
  return {
    id: r.id ?? '',
    // `token` is uuid-typed on the wire; the UI treats it as the opaque
    // resource token string.
    token: r.token ?? '',
    resource_type: (r.resource_type ?? 'postgres') as ResourceType,
    tier: (r.tier ?? '') as Resource['tier'],
    status: (r.status ?? '') as Resource['status'],
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
    created_at: r.created_at ?? '',
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
  // The agent API splits credentials into a separate endpoint, but only
  // db/redis/mongo expose a connection_url there — webhook/storage/queue
  // 400 on it (BugBash P3-02). Gate the fetch on resource_type so we
  // don't generate a spurious 400 on every detail-page open.
  let connection_url: string | undefined
  // r.item?.resource_type is now `ResourceType | undefined` (derived wire type);
  // the Set is typed over ResourceType. An undefined type simply isn't a member,
  // so the guard short-circuits — same runtime behavior, type-clean.
  const resType = r.item?.resource_type
  if (resType && CREDENTIALED_RESOURCE_TYPES.has(resType)) {
    try {
      const c = await call<{ connection_url: string }>(`/api/v1/resources/${id}/credentials`)
      connection_url = c.connection_url
    } catch {
      /* credentials may still be hidden (permissions, paused, etc.) */
    }
  }
  return { ok: true, resource: adaptResource({ ...r.item, connection_url }) }
}

export async function deleteResource(id: string): Promise<void> {
  await call(`/api/v1/resources/${id}`, { method: 'DELETE' })
}

// ─── Pause / resume (Pro+ feature) ──────────────────────────────────────
//
// Pause stops the resource counting against quota while preserving every
// byte of data. Resume flips it back to 'active' so it counts again and is
// reachable. Both are idempotent on the server: pausing an already-paused
// resource returns the current row unchanged; same for resume.
//
// Tier gate: the agent API returns 402 with `agent_action` on
// anonymous/free/hobby. The callers (PauseResumeButton) trap that status
// and render the upgrade CTA inline instead of throwing. Other errors
// (5xx, network) propagate so the UI can surface a real banner.
//
// Status semantics:
//   POST /api/v1/resources/:id/pause   → { ok, resource: <resource with status='paused'> }
//   POST /api/v1/resources/:id/resume  → { ok, resource: <resource with status='active'> }
//
// Note: the envelope key is "resource" (not "item") — the Go handler returns
// `fiber.Map{"resource": resourceToMap(resource)}`. Reading r.item returns
// undefined, adaptResource(undefined) throws TypeError, and the UI shows an
// error even though the server-side pause/resume succeeded (D02-02 fix).
export async function pauseResource(id: string): Promise<{ ok: true; resource: Resource }> {
  const r = await call<{ ok: boolean; resource: any }>(`/api/v1/resources/${id}/pause`, { method: 'POST' })
  return { ok: true, resource: adaptResource(r.resource) }
}

export async function resumeResource(id: string): Promise<{ ok: true; resource: Resource }> {
  const r = await call<{ ok: boolean; resource: any }>(`/api/v1/resources/${id}/resume`, { method: 'POST' })
  return { ok: true, resource: adaptResource(r.resource) }
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

// ─── Resource metrics ───
//
// GET /api/v1/resources/:id/metrics — per-resource time-series metrics
// (p50/p95/p99 latency, active connections, storage_bytes, error_rate_pct)
// over a tier-capped window. The dashboard polls this every 60s on the
// Metrics tab; per CLAUDE.md feedback ("aggregations need caching +
// consistency reasoning") the freshness model here is poll-on-demand, not
// long-cached — these tiles are observability surfaces where seeing the
// latest sample matters more than minimising server load.
//
// The response's `data_source` field is "stub" until the W5-A prober's
// per-probe row writer lands. The dashboard renders a yellow "metrics will
// populate" banner only when data_source === "stub" so the layout doesn't
// shift when real data arrives.

export type MetricsDataSource = 'stub' | 'newrelic' | 'resource_metrics'

export interface ResourceMetricsResponse {
  ok: true
  resource_id: string
  resource_type: string
  window_seconds: number
  samples_count: number
  sample_interval_seconds: number
  metrics: {
    latency_p50_ms: number[]
    latency_p95_ms: number[]
    latency_p99_ms: number[]
    connections_active: number[]
    storage_bytes: number[]
    error_rate_pct: number[]
  }
  data_source: MetricsDataSource
}

export async function getResourceMetrics(
  id: string,
  windowParam: string = '1h',
): Promise<ResourceMetricsResponse> {
  const r = await call<ResourceMetricsResponse>(
    `/api/v1/resources/${id}/metrics?window=${encodeURIComponent(windowParam)}`,
  )
  return r
}

// ─── Resource audit ─────────────────────────────────────────────────────
//
// W7-C/W11: the team-level audit log (GET /api/v1/audit) returns rows
// scoped to either `team_id = caller_team` OR `metadata.resource_id`
// pointing at a resource the caller owns. There is no per-resource
// endpoint yet — instead we fetch the team window and filter client-side
// for rows whose metadata.resource_id matches the resource we're looking
// at. The endpoint enforces a tier-derived hard lookback floor (Hobby
// 30d, Pro 90d, Team unlimited; anonymous/free 402s), so this surface
// renders an "upgrade required" state on 402 rather than throwing.
//
// Wire shape (from auditEventToMap):
//   { id, kind, created_at, metadata, actor_user_id, actor_email_masked }
//
// `metadata` is unmarshalled JSON or null. We surface metadata.resource_id
// and metadata.summary when present; everything else lands in the raw
// metadata JSON column on the table for transparency.
export interface ResourceAuditEvent {
  id: string
  kind: string
  created_at: string
  actor_user_id: string | null
  actor_email_masked: string | null
  metadata: Record<string, unknown> | null
}

export interface ResourceAuditResponse {
  ok: true
  items: ResourceAuditEvent[]
  total_returned: number
  next_cursor: string | null
  lookback_days: number
  tier: string
}

/**
 * Fetch audit rows scoped to a single resource over the last `sinceHours`
 * hours. Implementation: call GET /api/v1/audit?since=<iso>&limit=200 and
 * filter client-side for rows whose metadata.resource_id matches. The
 * team-level endpoint already enforces ownership (rows are returned only
 * if `team_id = caller_team` OR the metadata.resource_id points at a
 * resource the caller owns), so the client-side filter is a precision
 * cut, not a security boundary.
 *
 * On 402 (anonymous/free tier) the call propagates so the caller can
 * render an upgrade prompt instead of an error banner.
 */
export async function fetchResourceAudit(
  resourceId: string,
  sinceHours: number = 24,
  limit: number = 200,
): Promise<ResourceAuditResponse> {
  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString()
  const path = `/api/v1/audit?since=${encodeURIComponent(sinceIso)}&limit=${limit}`
  const r = await call<ResourceAuditResponse>(path)
  const items = (r.items ?? []).filter((ev) => {
    if (!ev.metadata || typeof ev.metadata !== 'object') return false
    const ridRaw = (ev.metadata as Record<string, unknown>).resource_id
    if (typeof ridRaw !== 'string') return false
    return ridRaw === resourceId
  })
  return {
    ok: true,
    items,
    total_returned: items.length,
    next_cursor: r.next_cursor ?? null,
    lookback_days: r.lookback_days ?? 0,
    tier: r.tier ?? '',
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
// Deployment wire row — the DOCUMENTED fields are DERIVED from the OpenAPI
// snapshot (WireDeployItem = components['schemas']['DeployItem']). adaptDeployment
// (below) reads them, so an api rename of app_id/status/environment/ttl_policy/
// failure.* fails `tsc` at the adapter site.
//
// WireDeployItem types `env` as a string map (the masked env_vars). The
// adapter, however, historically tolerated `env` being EITHER a map or a
// string, and reads two UI-side conveniences the wire schema does NOT carry:
//   - env_vars      — the adapter's preferred name for the env map.
//   - last_deploy_at — UI alias; adapter falls back to updated_at.
//   - build_duration_s — reserved; not on the wire yet.
// Those three are intersected on as optional. The `env` widening keeps the
// adapter's defensive both-shapes handling. Everything else comes from the spec.
type DeploymentRespItem = Omit<WireDeployItem, 'env'> & {
  env?: Record<string, string> | string
  env_vars?: Record<string, string>
  last_deploy_at?: string
  build_duration_s?: number
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
    case 'expired':
      return 'expired' // C02: TTL-expired — render badge not spinner
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
    // Surface the server's display name verbatim, or `null` when absent.
    // The UI (DeploymentsPage / DeployDetailPage) renders `(unnamed deploy)`
    // for a null name and keeps app_id as muted secondary text — we no
    // longer promote the hash into the primary `name` slot.
    name: d.name?.trim() ? d.name : null,
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
    // Private-deploy fields (Track B). Older API builds omit them; we
    // surface false / [] so the UI never silently inherits "private"
    // state from a stale payload.
    private: d.private ?? false,
    allowed_ips: d.allowed_ips ?? [],
    // Wave FIX-J TTL fields. The server returns them on every deploy
    // payload; older builds omit them and the dashboard renders as
    // ttl_policy='auto_24h' (the documented default) so the UI never
    // shows a stale "no TTL" state.
    ttl_policy: d.ttl_policy as DashboardDeployment['ttl_policy'],
    expires_at: d.expires_at,
    reminders_sent: typeof d.reminders_sent === 'number' ? d.reminders_sent : undefined,
    make_permanent_url: d.make_permanent_url,
    extend_ttl_url: d.extend_ttl_url,
    // Phase 0 Failure Autopsy. Validate that the raw server payload has
    // the minimum required fields (reason + hint) before surfacing it.
    // Absent, malformed, or incomplete payloads are dropped so the UI
    // renders the "diagnostics pending" fallback instead of crashing.
    failure: adaptFailure(d.failure),
  }
}

function adaptFailure(
  // LATENT DRIFT (surfaced by the codegen gate): the UI's DeploymentFailure has
  // `exit_code`, but the wire DeployItem.failure schema does NOT carry it (only
  // GET /deployments/:id/events does — see CLAUDE.md rule 27). So `exit_code` is
  // intersected as optional here; at runtime it was always undefined on this
  // path → coerced to null below, identical to before. Tracked in the report as
  // a spec/UI gap to reconcile (add exit_code to DeployItem, or drop it from the
  // detail panel and read it only from the events surface).
  raw: (WireDeployItem['failure'] & { exit_code?: number | null }) | undefined,
): DeploymentFailure | undefined {
  if (!raw) return undefined
  // Both `reason` and `hint` are required for the panel to render
  // meaningfully. Drop the payload if either is missing — the page
  // renders the "diagnostics pending" state in that case.
  if (!raw.reason || !raw.hint) return undefined
  return {
    reason: raw.reason as DeploymentFailure['reason'],
    exit_code: raw.exit_code ?? null,
    event: raw.event ?? '',
    last_lines: Array.isArray(raw.last_lines) ? raw.last_lines : [],
    hint: raw.hint,
    occurred_at: raw.occurred_at ?? '',
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

// ─── createDeploy — POST /deploy/new (Track B private-deploy fields) ─────
//
// The dashboard doesn't usually drive deploys itself (the read-only model
// favours agent-driven mutations via PromptCard), but the createDeploy
// helper exists so:
//   1. The "Configure private access" panel on DeploymentsPage can build a
//      precise agent prompt that mirrors the request shape the helper
//      would send (single source of truth for the field names).
//   2. Future agentic flows in the dashboard (e.g. one-click redeploy with
//      a privacy patch) can call this without re-implementing the contract.
//
// Body shape — accepted by the Track A backend:
//   - tarball is uploaded multipart; the dashboard doesn't have file-upload
//     UI yet, so this helper takes the metadata and trusts the caller to
//     attach a tarball via FormData if needed (omit for prompts-only flow).
//   - env_vars is sent as `env` (server's legacy alias) for symmetry with
//     the response adapter above.
//   - `private` (bool) + `allowed_ips` (string[]) are the Track B fields
//     this Track B PR introduces. Backend returns 402 with agent_action on
//     hobby/free/anonymous, 400 with `validation_error` on empty
//     allowed_ips when private=true, or invalid IPs/CIDRs.
//
// Errors propagate (APIError with status + code); the caller decides
// whether to surface them inline or fall back to the prompt-only path.
export interface CreateDeployInput {
  name?: string
  port?: number
  env?: string           // Env scope name (production / staging / dev).
  env_vars?: Record<string, string>
  resource_id?: string
  /** Track B: gate the deploy by an IP allow-list. Requires Pro+. */
  private?: boolean
  /** Track B: IPv4 addresses or CIDR blocks (max 32) permitted when
   *  `private` is true. Backend returns 400 on empty list when private=true
   *  or on invalid IP/CIDR strings. */
  allowed_ips?: string[]
}

export async function createDeploy(
  input: CreateDeployInput,
  tarball?: File,
): Promise<{ ok: true; deployment: DashboardDeployment }> {
  // POST /deploy/new is multipart-only — c.MultipartForm() returns 400 on JSON.
  // Build FormData; do NOT set Content-Type (browser generates the boundary).
  const fd = new FormData()
  if (tarball) fd.append('tarball', tarball)
  if (input.name) fd.append('name', input.name)
  if (input.port !== undefined) fd.append('port', String(input.port))
  if (input.env) fd.append('env', input.env)
  if (input.env_vars && Object.keys(input.env_vars).length > 0) {
    fd.append('env_vars', JSON.stringify(input.env_vars))
  }
  if (input.resource_id) fd.append('resource_id', input.resource_id)
  if (input.private !== undefined) fd.append('private', String(input.private))
  if (input.allowed_ips !== undefined) fd.append('allowed_ips', JSON.stringify(input.allowed_ips))

  const headers = new Headers()
  const tok = getToken()
  if (tok) headers.set('Authorization', `Bearer ${tok}`)

  const base = getAPIBaseURL()
  const deployURL = new URL(
    '/deploy/new',
    base || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'),
  )
  const res = await fetch(deployURL.toString(), { method: 'POST', headers, body: fd })
  const ct = res.headers.get('content-type') ?? ''
  const respBody: any = ct.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text()

  if (!res.ok) {
    const code = (respBody && respBody.error) || `http_${res.status}`
    const msg =
      (respBody && (respBody.message || respBody.error_description)) || res.statusText
    // P1-W3-20: this multipart path bypasses call() (and its central 401
    // redirect). Re-run the 401 token-clear here so an expired token on a
    // deploy doesn't leave the user in a dead retry loop.
    if (res.status === 401) handle401(res.status)
    throw new APIError(res.status, code, msg, parseErrorEnvelope(res, respBody))
  }

  if (!respBody?.item) {
    throw new APIError(500, 'invalid_response', 'POST /deploy/new returned no item')
  }
  return { ok: true, deployment: adaptDeployment(respBody.item) }
}

// ─── updateDeploymentAccess — PATCH /api/v1/deployments/:id (Track A) ────
//
// Pro+ feature: toggle a deployment's privacy state and edit its
// allowed_ips after creation. The PATCH endpoint is Track A's
// responsibility — until it ships, this helper still issues the request
// and surfaces a 404 to the caller so the DeployDetailPage can render a
// read-only "edits pending backend" hint instead of pretending the change
// landed.
//
// Errors:
//   - 402 with agent_action — tier gate (hobby / free / anonymous)
//   - 400 with validation_error — empty allowed_ips when private=true,
//     invalid IPs/CIDRs, > 32 entries
//   - 404 — endpoint not yet shipped (Track A pending)
//   - 5xx — server error; bubble up so the page shows a real banner
export async function updateDeploymentAccess(
  id: string,
  privateFlag: boolean,
  allowedIps: string[],
): Promise<{ ok: true; deployment: DashboardDeployment }> {
  const r = await call<DeploymentGetResp>(
    `/api/v1/deployments/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ private: privateFlag, allowed_ips: allowedIps }),
    },
  )
  if (!r.item) {
    throw new APIError(500, 'invalid_response', 'PATCH /deployments/:id returned no item')
  }
  return { ok: true, deployment: adaptDeployment(r.item) }
}

// ─── Deletion confirmation (Wave FIX-I) ──────────────────────────────────
//
// Two-step email-confirmed deletion. The api returns 202 with
// deletion_status='pending_confirmation' on the first DELETE for any
// paid-tier deploy or stack; this module wraps the follow-up endpoints.
//
// All three helpers share the same envelope shape — surfaced via the
// DeletionConfirmResponse type so the page can render a consistent
// success/failure banner.

export type DeletionPendingResponse = {
  ok: true
  id: string
  deletion_status: 'pending_confirmation'
  confirmation_sent_to: string
  confirmation_expires_at: string
  agent_action: string
  cancellation_note: string
}

export type DeletionResolvedResponse = {
  ok: true
  id: string
  resource_type: 'deploy' | 'stack'
  deletion_status: 'confirmed' | 'cancelled'
  freed_at?: string
  agent_action: string
  note: string
}

/** Issue the initial DELETE — may return either an immediate 200 (free
 *  / anonymous / header-bypass) or a 202 with the pending envelope.
 *  The caller branches on `deletion_status`. */
export async function deleteDeployment(
  id: string,
  opts?: { skipEmailConfirmation?: boolean },
): Promise<DeletionPendingResponse | { ok: true; message: string }> {
  const headers: Record<string, string> = {}
  if (opts?.skipEmailConfirmation) {
    headers['X-Skip-Email-Confirmation'] = 'yes'
  }
  return call(`/api/v1/deployments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  })
}

/** Step 2 — confirm the pending deletion with the plaintext token
 *  carried in the email link. Returns 200 on the winning CAS; 410 on
 *  expired/already-used (surfaces as APIError with code
 *  'deletion_token_invalid'). */
export async function confirmDeploymentDeletion(
  id: string,
  token: string,
): Promise<DeletionResolvedResponse> {
  return call(
    `/api/v1/deployments/${encodeURIComponent(id)}/confirm-deletion?token=${encodeURIComponent(token)}`,
    { method: 'POST' },
  )
}

/** Step 2 (alternate) — cancel a pending deletion. The resource stays
 *  active and the slot stays consumed. Idempotent: a cancel on an
 *  already-resolved row returns 410. */
export async function cancelDeploymentDeletion(
  id: string,
): Promise<DeletionResolvedResponse> {
  return call(
    `/api/v1/deployments/${encodeURIComponent(id)}/confirm-deletion`,
    { method: 'DELETE' },
  )
}

// Stack-side counterparts. Same contract, different path prefix.

export async function deleteStack(
  slug: string,
  opts?: { skipEmailConfirmation?: boolean },
): Promise<DeletionPendingResponse | { ok: true; message: string }> {
  const headers: Record<string, string> = {}
  if (opts?.skipEmailConfirmation) {
    headers['X-Skip-Email-Confirmation'] = 'yes'
  }
  return call(`/stacks/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers,
  })
}

export async function confirmStackDeletion(
  slug: string,
  token: string,
): Promise<DeletionResolvedResponse> {
  return call(
    `/api/v1/stacks/${encodeURIComponent(slug)}/confirm-deletion?token=${encodeURIComponent(token)}`,
    { method: 'POST' },
  )
}

export async function cancelStackDeletion(
  slug: string,
): Promise<DeletionResolvedResponse> {
  return call(
    `/api/v1/stacks/${encodeURIComponent(slug)}/confirm-deletion`,
    { method: 'DELETE' },
  )
}

// ─── Deploy TTL keepers — Wave FIX-J ─────────────────────────────────────
//
// Two POST endpoints back the "Keep this deployment" + "Extend TTL"
// buttons on DeploymentsPage / DeployDetailPage. The server returns the
// updated deployment row so we adapt it through the same adaptDeployment
// path the list/get endpoints use — guarantees the response shape stays
// identical across all four code paths.

export async function makeDeploymentPermanent(
  id: string,
): Promise<{ ok: true; deployment: DashboardDeployment }> {
  const r = await call<DeploymentGetResp>(
    `/api/v1/deployments/${encodeURIComponent(id)}/make-permanent`,
    { method: 'POST', body: '{}' },
  )
  if (!r.item) {
    throw new APIError(500, 'invalid_response', 'POST /deployments/:id/make-permanent returned no item')
  }
  return { ok: true, deployment: adaptDeployment(r.item) }
}

export async function setDeploymentTTL(
  id: string,
  hours: number,
): Promise<{ ok: true; deployment: DashboardDeployment }> {
  const r = await call<DeploymentGetResp>(
    `/api/v1/deployments/${encodeURIComponent(id)}/ttl`,
    {
      method: 'POST',
      body: JSON.stringify({ hours }),
    },
  )
  if (!r.item) {
    throw new APIError(500, 'invalid_response', 'POST /deployments/:id/ttl returned no item')
  }
  return { ok: true, deployment: adaptDeployment(r.item) }
}

// ─── Team settings — Wave FIX-J ──────────────────────────────────────────
//
// GET / PATCH /api/v1/team/settings. PATCH is owner/admin only on the
// server; the dashboard hides the toggle for non-admin sessions, but the
// server is the source of truth.

export interface TeamSettings {
  team_id: string
  default_deployment_ttl_policy: 'auto_24h' | 'permanent'
  default_deployment_ttl_hours: number
}

type TeamSettingsResp = {
  ok: boolean
  settings?: TeamSettings
}

export async function getTeamSettings(): Promise<{ ok: true; settings: TeamSettings }> {
  const r = await call<TeamSettingsResp>('/api/v1/team/settings')
  if (!r.settings) {
    throw new APIError(500, 'invalid_response', 'GET /team/settings returned no settings')
  }
  return { ok: true, settings: r.settings }
}

export async function updateTeamSettings(
  patch: Partial<Pick<TeamSettings, 'default_deployment_ttl_policy'>>,
): Promise<{ ok: true; settings: TeamSettings }> {
  const r = await call<TeamSettingsResp>('/api/v1/team/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!r.settings) {
    throw new APIError(500, 'invalid_response', 'PATCH /team/settings returned no settings')
  }
  return { ok: true, settings: r.settings }
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

// ─── createStack — POST /stacks/new (multipart tarball upload) ───────────
//
// W9: the StackCreatePage at /app/stacks/new lets a human upload a
// .tar.gz (Dockerfile + source) and ship it without touching curl. The
// agent API endpoint is multipart-only — fields ride alongside the
// `tarball` file part.
//
// Tarball size limit: 50 MB (per platform CLAUDE.md). Validated on the
// caller side too so the user sees an inline error before the upload
// starts; the api enforces the same limit at the edge.
//
// Response shape (synchronous: 202 Accepted on success):
//   { ok: true, slug, status: "building", url?, name?, env? }
// The dashboard polls GET /api/v1/stacks/:slug afterwards (via
// fetchStackStatus) until status flips to running / healthy / failed.
//
// Tier-wall: anonymous gets 0 stacks, hobby gets 1, pro+ gets more. The
// api returns 402 with agent_action; the caller surfaces an upgrade prompt.
export interface CreateStackInput {
  /** Optional human-readable name (max 32, lowercase + hyphens). Empty →
   *  server auto-generates a slug like `tender-sky-9421`. */
  name?: string
  /** Container HTTP port. Default 8080. */
  port?: number
  /** Env scope (production / staging / development). Default 'development'
   *  per the 2026-05-13 platform memory (default env flipped). */
  env?: string
  /** Map of env vars handed to the container. Keys must be uppercase +
   *  underscore + alphanumeric — validated by the form. */
  env_vars?: Record<string, string>
}

export interface CreateStackResponse {
  /** Stack slug — used in /api/v1/stacks/:slug polling and the final URL. */
  slug: string
  /** Current build status. 'building' on synchronous 202; the caller polls
   *  until this flips to 'running' / 'failed'. */
  status: StackStatus
  /** Final live URL once status is 'running'. May be null while building. */
  url: string | null
  /** Echoed name (server-generated if input.name was empty). */
  name?: string
  /** Echoed env scope. */
  env?: string
}

/**
 * Upload a tarball + metadata to POST /stacks/new. The body is multipart;
 * env_vars (a JS object) is serialized to JSON for the matching form field.
 *
 * Authentication: pulls the bearer token from localStorage (same as call()).
 * 401 propagates so AuthGate redirects — we don't replicate the redirect
 * logic here because the route is auth-gated already and the caller's page
 * mount has already passed the gate.
 *
 * Errors:
 *   - 400 with { error: 'invalid_tarball', message }: surface inline
 *   - 402 with { error: 'tier_limit', message, agent_action }: tier wall
 *   - 413: tarball too large (the api enforces ≤ 50 MB)
 *   - any other 4xx/5xx: propagate as APIError so the page renders a banner
 */
// Default container port baked into a generated single-service manifest
// when the caller omits one.
const defaultStackServicePort = 8080
// The single service name in a dashboard-generated stack manifest. The
// tarball MUST be uploaded under a form field of this same name — the api
// matches each service in the manifest to its `<service>` multipart file.
const singleServiceName = 'app'

// buildSingleServiceManifest renders the minimal instant.yaml a one-service
// stack needs. POST /stacks/new REQUIRES a `manifest` field — without it the
// server 400s. port and env vars are embedded here, NOT sent as sibling
// multipart fields.
export function buildSingleServiceManifest(opts: CreateStackInput = {}): string {
  const port = opts.port ?? defaultStackServicePort
  let m = `services:\n  ${singleServiceName}:\n    port: ${port}\n`
  if (opts.env_vars && Object.keys(opts.env_vars).length > 0) {
    m += `    env:\n`
    for (const [k, v] of Object.entries(opts.env_vars)) {
      // single-quote the value; escape embedded quotes per YAML rules.
      m += `      ${k}: '${String(v).replace(/'/g, "''")}'\n`
    }
  }
  return m
}

export async function createStack(
  file: File,
  opts: CreateStackInput = {},
): Promise<{ ok: true; stack: CreateStackResponse }> {
  const fd = new FormData()
  // manifest is REQUIRED; tarball is keyed by the service name ("app").
  fd.append('manifest', buildSingleServiceManifest(opts))
  fd.append(singleServiceName, file)
  if (opts.name) fd.append('name', opts.name)

  const headers = new Headers()
  const tok = getToken()
  if (tok) headers.set('Authorization', `Bearer ${tok}`)
  // CRITICAL: do NOT set Content-Type for FormData — the browser must
  // generate its own boundary. Setting it here would break the upload at
  // the multipart parser.

  const base = getAPIBaseURL()
  const url = new URL(
    '/stacks/new',
    base || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'),
  )
  const res = await fetch(url.toString(), { method: 'POST', headers, body: fd })
  const ct = res.headers.get('content-type') ?? ''
  const body: any = ct.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text()

  if (!res.ok) {
    const code = (body && body.error) || `http_${res.status}`
    const msg = (body && (body.message || body.error_description)) || res.statusText
    // P1-W3-20: mirror call()'s 401 handling — this multipart path bypasses
    // the central interceptor.
    if (res.status === 401) handle401(res.status)
    throw new APIError(res.status, code, msg, parseErrorEnvelope(res, body))
  }

  // Synchronous 202 / 200 — the server hands back the slug + initial state.
  // Fields tolerated as optional because the api may add/drop them across
  // versions; the page polls /api/v1/stacks/:slug for the canonical state.
  // P2 (W3 T5): `/stacks/new` may return the slug under `slug`, `stack_id`,
  // or `stack_slug` across api versions — accept all three so the polling
  // loop in StackCreatePage always has a key (an empty slug silently never
  // resolved).
  const stack: CreateStackResponse = {
    slug: body?.slug ?? body?.stack_id ?? body?.stack_slug ?? '',
    status: (body?.status as StackStatus) ?? 'building',
    url: body?.url ?? null,
    name: body?.name,
    env: body?.env ?? body?.environment,
  }
  return { ok: true as const, stack }
}

/**
 * Poll a single stack's current state via GET /api/v1/stacks/:slug (D09/C06 fix).
 *
 * The server response is flat — stack fields are at the top level, NOT under
 * a nested 'stack' or 'item' key. Shape: { ok, stack_id, status, tier, name,
 * services, expires_at? } where stack_id is the slug string.
 *
 * Returns null on 404 (deleted or not owned). Other errors propagate.
 */
export async function fetchStackStatus(
  slug: string,
): Promise<{ ok: true; stack: DashboardStack | null }> {
  try {
    type StackGetResp = {
      ok: boolean
      // stack_id is the slug (not the internal UUID).
      stack_id?: string
      status?: string
      tier?: string
      name?: string
      services?: Array<{ name?: string; url?: string; status?: string }>
      expires_at?: string
    }
    const r = await call<StackGetResp>(`/api/v1/stacks/${encodeURIComponent(slug)}`)
    if (!r.stack_id) return { ok: true as const, stack: null }
    // Derive URL from the first service that has one (stack row has no top-level url).
    const derivedURL = r.services?.find((svc) => !!svc.url)?.url ?? null
    const stack: DashboardStack = {
      id: r.stack_id,
      slug: r.stack_id,
      name: r.name ?? '',
      status: (r.status as DashboardStack['status']) ?? 'building',
      url: derivedURL,
      created_at: '',
      team_id: '',
      env: 'production', // GET /stacks/:slug does not return env scope
      tier: (r.tier as DashboardStack['tier']) ?? 'free',
    }
    return { ok: true as const, stack }
  } catch (e: any) {
    if (e?.status === 404) return { ok: true as const, stack: null }
    throw e
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

// Billing wire shape — DERIVED from the OpenAPI snapshot (WireBillingState =
// components['schemas']['BillingStateResponse']) so an api rename of e.g.
// `tier` or `subscription_status` fails `tsc` at mapBillingState/fetchBilling.
//
// `razorpay_configured` is intersected in: it is NOT in the snapshot schema
// today (the api returns it on /api/v1/billing but it isn't documented in
// openapi.go — a latent spec gap, noted in the report). Keeping it as a local
// intersection preserves the fail-closed default logic in mapBillingState while
// still deriving every documented field from the spec. When openapi.go adds the
// field, drop the intersection so it too is gated.
type BillingStateResp = WireBillingState & {
  razorpay_configured?: boolean
}

/* Map the agent API's BillingStateResp into the dashboard's BillingDetails
 * type. The dashboard's shape was designed against a richer Stripe-style
 * payload; the agent API returns the bare minimum for now. Anything the
 * agent API doesn't expose stays undefined so the UI renders "—". */
function mapBillingState(r: BillingStateResp): BillingDetails {
  return {
    status: r.subscription_status ?? 'none',
    current_period_end: r.next_renewal_at ?? null,
    // P2-19: `razorpay_configured` previously inferred itself from
    // `subscription_status !== 'none'`. That conflates "the team already
    // has a subscription" with "checkout is available" — a freshly-claimed
    // paid team (subscription_status='none') would see checkout suppressed
    // even though Razorpay is configured. Prefer the explicit wire field.
    //
    // BUG-P088 (P1, 2026-05-29): the previous default `?? true` was
    // optimistic — an older API build that omits the flag (or a partial
    // outage where the field is dropped) would render the upgrade button
    // as if Razorpay were live. Per CLAUDE.md memory
    // `project_razorpay_recurring_not_enabled.md`, Razorpay recurring is
    // NOT enabled on the prod account, so clicking that button surfaces a
    // raw 502 from Razorpay's create-subscription call. Default FAIL-CLOSED
    // (false) — when the server doesn't say, hide the button. Honest copy
    // ("contact support to upgrade") beats a button that 502s.
    razorpay_configured: r.razorpay_configured ?? false,
    subscription_status: r.subscription_status,
    // `?? undefined`: the derived BillingPaymentMethod types last4/brand as
    // `string | null`, but BillingDetails wants `string | undefined`. Coerce
    // null → undefined so a "no card on file" payload renders "—" as before.
    payment_last4: r.payment_method?.last4 ?? undefined,
    payment_network: r.payment_method?.brand ?? undefined,
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

// Wire shape of one invoice row from GET /api/v1/billing/invoices. Mirrors
// api/internal/handlers/billing.go::ListInvoicesAPI exactly: a Razorpay
// invoice has a single `amount` (in the currency's smallest unit — paise
// for INR) and a single `date`, with no billing period or plan tier.
type InvoiceWire = {
  id: string
  amount: number
  currency: string
  status: string
  date: string
  pdf_url?: string
}
type InvoicesResp = { ok: boolean; invoices?: InvoiceWire[] }

// VALID_INVOICE_STATUSES — the three states the dashboard's Invoice type
// models. Razorpay can also emit 'issued' / 'expired' / 'cancelled'; any
// status outside this set collapses to 'pending' so the UI renders a
// neutral pill instead of an unstyled raw string.
const VALID_INVOICE_STATUSES: ReadonlySet<string> = new Set(['paid', 'pending', 'failed'])

// mapInvoice — converts the agent API's wire shape into the dashboard's
// normalized Invoice type. The previous `r.invoices ?? []` blind cast let
// the wire's {amount,date} reach a UI expecting {amount_cents,period_*},
// rendering "Invalid Date" / "$NaN" on every row. `amount` is already in
// the smallest currency unit (paise/cents) — it maps to `amount_cents`
// directly, NO ×100. `period_start` / `period_end` / `plan` are not on
// the wire and stay undefined; the BillingPage renders around them.
function mapInvoice(w: InvoiceWire): Invoice {
  return {
    id: w.id,
    issued_at: w.date,
    amount_cents: w.amount,
    currency: w.currency,
    status: VALID_INVOICE_STATUSES.has(w.status)
      ? (w.status as Invoice['status'])
      : 'pending',
    pdf_url: w.pdf_url,
  }
}

export async function listInvoices(): Promise<{ ok: true; invoices: Invoice[] }> {
  // §10.21: errors propagate. The previous 503 fallback returned three
  // mock "paid" invoices that didn't correspond to any real payment;
  // BillingPage now surfaces the failure honestly.
  const r = await call<InvoicesResp>('/api/v1/billing/invoices')
  return { ok: true, invoices: (r.invoices ?? []).map(mapInvoice) }
}

// PlanFrequency selects between the monthly and yearly Razorpay plan_id at
// checkout. The agent API rejects anything other than 'monthly' | 'yearly'
// with 400 invalid_frequency, and returns 503 billing_not_configured when
// the yearly plan_id env var isn't set on the server (operator action
// pending). Defaulting to 'monthly' on omission keeps the upgrade path
// behaving as it did before the toggle shipped.
export type PlanFrequency = 'monthly' | 'yearly'

export async function createCheckout(
  plan: string,
  planFrequency: PlanFrequency = 'monthly',
  opts?: { promotion_code?: string },
): Promise<{ ok: true; short_url: string; subscription_id?: string }> {
  const body: Record<string, unknown> = { plan, plan_frequency: planFrequency }
  // Only include the promotion_code field when the caller actually passed
  // one — sending an empty string would cause the api to treat it as an
  // invalid promo and reject the checkout. Trimming guards against UI
  // whitespace leaks (the dashboard already trims, this is belt+braces).
  const code = opts?.promotion_code?.trim()
  if (code) body.promotion_code = code
  const r = await call<{ ok: boolean; short_url: string; subscription_id?: string }>(
    '/api/v1/billing/checkout',
    { method: 'POST', body: JSON.stringify(body) },
  )
  return { ok: true, short_url: r.short_url, subscription_id: r.subscription_id }
}

// ─── Promotion validation (P3 — mocked until api ships endpoint) ────────
//
// Contract proposed for `POST /api/v1/billing/promotion/validate`:
//   request:  { code: string, plan: string }
//   response: { ok: true, code, discount: { kind: "percent_off" | "amount_off"
//                                          | "free_period",
//                                          value: number,
//                                          applies_to?: number,
//                                          unit?: "months" | "days" },
//              valid_until: string /* ISO */ }
//   errors:   404 { error: "promotion_not_found", message: "Code not found." }
//             410 { error: "promotion_expired",   message: "This code has expired." }
//             409 { error: "promotion_not_applicable",
//                   message: "Code can't be applied to this plan." }
//
// api/internal/plans/promotion_test.go already has the engine
// (`plans.validatePromotion(code, plan) (Promotion, error)`) — the missing
// piece is the HTTP handler. Until that ships, this function transparently
// falls back to a small in-memory table of three seed codes so the upgrade
// flow is testable end-to-end. The mock activates on 404 (endpoint not
// registered) OR on a network error to /api/v1/billing/promotion/validate.
export type Promotion = {
  code: string
  discount: {
    kind: 'percent_off' | 'amount_off' | 'free_period'
    value: number
    applies_to?: number
    unit?: 'months' | 'days'
  }
  valid_until: string
}

const PROMOTION_SEEDS: Record<string, Promotion['discount']> = {
  TWITTER15: { kind: 'percent_off', value: 15, applies_to: 3, unit: 'months' },
  LAUNCH50:  { kind: 'percent_off', value: 50, applies_to: 1, unit: 'months' },
  COMEBACK10: { kind: 'percent_off', value: 10, applies_to: 1, unit: 'months' },
}

export async function validatePromotion(
  code: string,
  plan: string,
): Promise<{ ok: true; promotion: Promotion }> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) {
    throw new APIError(400, 'promotion_invalid', 'Enter a code.')
  }
  try {
    const r = await call<{
      ok: boolean
      code: string
      discount: Promotion['discount']
      valid_until: string
    }>('/api/v1/billing/promotion/validate', {
      method: 'POST',
      body: JSON.stringify({ code: normalized, plan }),
    })
    return {
      ok: true,
      promotion: { code: r.code, discount: r.discount, valid_until: r.valid_until },
    }
  } catch (e: any) {
    // 404 = endpoint not yet shipped on api → fall back to local seeds so
    // the upgrade flow is demo-able. Any other status (400/410/409/etc.)
    // is a real validation error and propagates so the UI can show it.
    const status = e?.status
    if (status === 404 || status === undefined || status === 0) {
      const seed = PROMOTION_SEEDS[normalized]
      if (!seed) {
        throw new APIError(404, 'promotion_not_found', 'Code not found.')
      }
      return {
        ok: true,
        promotion: {
          code: normalized,
          discount: seed,
          // Mocked seeds are valid through 2026-09-01 — matches the spec
          // example in the P3 brief. Replace with server response once the
          // endpoint ships.
          valid_until: '2026-09-01T00:00:00Z',
        },
      }
    }
    throw e
  }
}

export async function cancelSubscription(): Promise<{ ok: true }> {
  await call<{ ok: boolean }>('/api/v1/billing/cancel', { method: 'POST' })
  return { ok: true }
}

// updatePaymentMethod — LIVE. POST /api/v1/billing/update-payment returns a
// Razorpay short_url the customer can hit to swap their saved card without
// going through support. Previously the BillingPage "Update" button was a
// mailto:support@ link because the comment in BillingPage.tsx claimed "no
// self-serve update-payment endpoint exists" — but the api shipped this
// handler (billing.go:1082 UpdatePaymentMethodAPI) so the dashboard should
// just call it.
export async function updatePaymentMethod(): Promise<{ ok: true; short_url: string }> {
  const r = await call<{ ok: boolean; short_url: string }>(
    '/api/v1/billing/update-payment',
    { method: 'POST' },
  )
  return { ok: true, short_url: r.short_url }
}

// ChangePlanTier — the subset of Tier values the agent API's change-plan
// handler currently accepts. The server hard-codes this list in
// api/internal/handlers/billing.go:razorpayPlanIDs() — it's intentionally
// narrower than the full `Tier` union because anonymous / free / growth /
// (and 'team' until it launches) can't be reached through a self-serve
// subscription swap. Kept here as a local type so api/index.ts has no
// dependency on src/components/TierCard.tsx (which restricts TierKey to
// the grid's four columns for an unrelated UI reason).
export type ChangePlanTier = 'hobby' | 'hobby_plus' | 'pro' | 'team' | 'growth'

// TIER_RANK — the single canonical totally-ordered rank of plan tiers for
// the dashboard. Higher rank = more capacity. Anchored to api/plans.yaml
// pricing (hobby $9 < hobby_plus $19 < pro $49 < growth $99 < team $199)
// and kept byte-for-byte aligned with the backend's common/plans/rank.go.
//
// IMPORTANT: pro sits strictly BELOW growth. An earlier inverted copy
// (growth:4, pro:5) lived independently in ChangePlanModal and
// TierChangeModal — the admin console then showed "DEMOTE" for a
// pro→growth upgrade. Both modals now import this one table so they can't
// re-diverge. If the tier ladder changes, edit here AND rank.go together.
export const TIER_RANK: Record<string, number> = {
  anonymous: 0,
  free: 1,
  hobby: 2,
  hobby_plus: 3,
  pro: 4,
  growth: 5,
  team: 6,
}

// changePlan — LIVE. POST /api/v1/billing/change-plan upgrades an *existing*
// Razorpay subscription to a different plan tier in-place, rather than
// creating a fresh subscription via the checkout flow. Used by the
// in-dashboard Change-plan modal so an existing subscriber upgrading
// Hobby → Pro keeps their subscription (no double-billing during the
// transition, no orphaned monthly cancellations).
//
// Request body shape the agent handler actually accepts today
// (api/internal/handlers/billing.go: changePlanBody / ChangePlanAPI):
//   { target_plan: "hobby" | "pro" | "team" }
// The handler ignores `plan_frequency` for now (monthly-only plan swap;
// yearly changes still route through createCheckout per the inline comment
// on razorpayPlanIDs()). We forward `plan_frequency` regardless so the
// field is wired the day the api accepts it — Go's strict-decoded body
// parser ignores unknown fields, so this is safe today and forward-
// compatible tomorrow. If the contract turns out to be stricter than
// that, this is the surface to fix.
//
// Server returns: { ok, new_plan, effective_date, short_url? }
//   - When Razorpay can swap the plan immediately without a fresh checkout,
//     `short_url` is empty and we treat that as `immediate: true` so the
//     dashboard can refetch billing inline. When Razorpay requires a
//     human checkout (e.g. tier-bump that triggers a new auth), `short_url`
//     points at Razorpay's hosted portal and the caller redirects.
export async function changePlan(
  targetTier: ChangePlanTier,
  frequency: PlanFrequency,
): Promise<{ ok: true; short_url?: string; immediate?: boolean }> {
  const r = await call<{
    ok: boolean
    short_url?: string
    new_plan?: string
    effective_date?: string
  }>('/api/v1/billing/change-plan', {
    method: 'POST',
    body: JSON.stringify({ target_plan: targetTier, plan_frequency: frequency }),
  })
  const short = r.short_url && r.short_url.length > 0 ? r.short_url : undefined
  return { ok: true, short_url: short, immediate: !short }
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
    //
    // W12 XSS hardening (2026-05-14): this synth previously embedded
    // <strong>/<code> tags AND interpolated res.name directly — which,
    // because OverviewPage rendered the text via dangerouslySetInnerHTML,
    // meant any resource whose name slipped past server-side sanitizeName
    // would execute as HTML. We now emit plain text; the consumer
    // (OverviewPage) also renders as a text node. Defence in depth.
    try {
      const r = await listResources()
      const items: ActivityItem[] = r.items.slice(0, 8).map((res) => ({
        id: `act_${res.id}`,
        at: res.created_at,
        level: 'info' as const,
        text: `${res.cloud_vendor ?? 'agent'} provisioned ${res.resource_type} ${(res.name ?? res.token).slice(0, 16)}`,
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

// ─── Usage wall (Track U1) ──────────────────────────────────────────────
// GET /api/v1/usage/wall — most recent near_quota_wall row for the
// caller's team within the last 24h. Drives the QuotaWallBanner upgrade
// nudge. When near_wall=false the response carries only `{ok, near_wall}`;
// when true the metadata fields (tier/axis/service/current/limit/
// percent_used/at) are flattened in alongside ok/near_wall.
export type QuotaWallResponse = {
  ok: true
  near_wall: boolean
  tier?: string
  axis?: 'storage' | 'connections' | 'provisions'
  service?: string
  current?: number
  limit?: number
  percent_used?: number
  at?: string
}

export async function fetchQuotaWall(): Promise<QuotaWallResponse> {
  return call<QuotaWallResponse>('/api/v1/usage/wall')
}

// ─── Admin Customers (Track A — founder console) ────────────────────────
//
// Four endpoints back the /app/admin/customers page. They register on the
// API under an UNGUESSABLE PATH PREFIX (env var ADMIN_PATH_PREFIX), not
// the legacy /api/v1/admin/customers path. The prefix is delivered to
// admin clients in the /auth/me response (`admin_path_prefix` field) and
// stashed module-locally by fetchMe().
//
//   listAdminCustomers       — GET  /api/v1/<prefix>/customers
//   getAdminCustomer         — GET  /api/v1/<prefix>/customers/:team_id
//   setAdminCustomerTier     — POST /api/v1/<prefix>/customers/:team_id/tier
//   issueAdminCustomerPromo  — POST /api/v1/<prefix>/customers/:team_id/promo
//
// Track A returns 403 with `agent_action` for non-admin callers; the
// dashboard's route guard turns the page into a 404 for those users so
// the route's existence isn't leaked. Other errors propagate so the
// page renders a real banner instead of silently failing.
//
// SECURITY: the prefix is a credential with the same blast radius as a
// session token. NEVER log it. NEVER echo it into rendered UI text. NEVER
// hand it to a third-party analytics tool. The module-local var is the
// canonical store; treat reads through getAdminPathPrefix() as "I am
// about to build an admin URL right now."

/** Module-local cache of the admin URL prefix. Populated by fetchMe()
 *  from the /auth/me response (`admin_path_prefix`) and reset to '' by
 *  logout(). The two reader entry-points are:
 *
 *  - getAdminPathPrefix() — used by tests + the route gate to check
 *    "is the admin surface available to this session?"
 *  - buildAdminURL(...)    — used by every admin API function to mint
 *    a request URL; throws if the prefix is empty.
 *
 *  Stored at module scope so the four admin builders below stay free of
 *  per-call arguments. Bundle-scoped, not module-scoped-per-bundle: the
 *  Vite build leaves one instance of this module per build, so all four
 *  builders + the route guard see the same cache. */
let _adminPathPrefix = ''

/** setAdminPathPrefix is called by fetchMe() with the value from the
 *  /auth/me response. Idempotent; safe to call on every fetchMe(). */
export function setAdminPathPrefix(prefix: string): void {
  _adminPathPrefix = prefix
}

/** getAdminPathPrefix returns the currently stashed admin URL prefix, or
 *  the empty string if /auth/me has not yet loaded or returned no value.
 *  Components use this to decide "should I render the admin route?" — an
 *  empty result means "no", regardless of why (no prefix configured on
 *  the server, the caller isn't on ADMIN_EMAILS, fetchMe hasn't run yet,
 *  or the session was just logged out). */
export function getAdminPathPrefix(): string {
  return _adminPathPrefix
}

/** buildAdminURL is the only place that turns the stashed prefix into an
 *  HTTP path. Throws with a clear, copy-and-paste-able error message when
 *  the prefix is empty — admin functions should never be called from UI
 *  that hasn't already gated on getAdminPathPrefix(), so an empty here
 *  is a programmer error, not a user-visible state.
 *
 *  Note: we deliberately omit the prefix from the error message to avoid
 *  the case where the empty-state error gets logged with a non-empty
 *  prefix value next to it. */
function buildAdminURL(suffix: string): string {
  if (_adminPathPrefix === '') {
    throw new APIError(
      403,
      'admin_endpoints_unavailable',
      'admin endpoints unavailable: not authorized or session not loaded',
    )
  }
  return `/api/v1/${_adminPathPrefix}${suffix}`
}

/** Filter / sort options accepted by GET /api/v1/admin/customers. The
 *  query string is built up only for the fields the caller actually sets
 *  so older API builds that don't yet honour a flag don't get tripped on
 *  an empty string. */
export interface ListAdminCustomersInput {
  /** Free-text search (email, name, team_id substring). */
  q?: string
  /** Filter pill — undefined or 'all' returns every tier. */
  tier?: 'all' | 'anonymous' | 'free' | 'hobby' | 'hobby_plus' | 'pro' | 'team' | 'growth'
  /** Track A sort keys: mrr | last_active | created_at | storage | deployments. */
  sort_by?: string
  /** Page size — Track A clamps to 200; default 50. */
  limit?: number
  offset?: number
}

export async function listAdminCustomers(
  input: ListAdminCustomersInput = {},
): Promise<AdminCustomerListResponse> {
  const params = new URLSearchParams()
  if (input.q && input.q.trim()) params.set('q', input.q.trim())
  if (input.tier && input.tier !== 'all') params.set('tier', input.tier)
  if (input.sort_by) params.set('sort_by', input.sort_by)
  if (input.limit !== undefined) params.set('limit', String(input.limit))
  if (input.offset !== undefined) params.set('offset', String(input.offset))
  const qs = params.toString()
  const base = buildAdminURL('/customers')
  const path = qs ? `${base}?${qs}` : base
  const r = await call<{
    ok: boolean
    customers?: AdminCustomerListResponse['customers']
    total?: number
  }>(path)
  return { ok: true, customers: r.customers ?? [], total: r.total ?? 0 }
}

export async function getAdminCustomer(
  teamID: string,
): Promise<AdminCustomerDetailResponse> {
  const r = await call<{
    ok: boolean
    team?: AdminCustomerDetailResponse['team']
    users?: AdminCustomerDetailResponse['users']
    resources?: AdminCustomerDetailResponse['resources']
    audit_log?: AdminCustomerDetailResponse['audit_log']
    deploys?: AdminCustomerDetailResponse['deploys']
    subscription?: AdminCustomerDetailResponse['subscription']
    promos?: AdminCustomerDetailResponse['promos']
  }>(buildAdminURL(`/customers/${encodeURIComponent(teamID)}`))
  return {
    ok: true,
    team: r.team ?? ({ id: teamID } as AdminCustomerDetailResponse['team']),
    users: r.users ?? [],
    resources: r.resources ?? [],
    audit_log: r.audit_log ?? [],
    deploys: r.deploys ?? [],
    subscription: r.subscription ?? null,
    promos: r.promos ?? [],
  }
}

export async function setAdminCustomerTier(
  teamID: string,
  input: AdminSetTierInput,
): Promise<AdminSetTierResponse> {
  const r = await call<{ ok: boolean; team: DashboardTeam }>(
    buildAdminURL(`/customers/${encodeURIComponent(teamID)}/tier`),
    { method: 'POST', body: JSON.stringify(input) },
  )
  return { ok: true, team: r.team }
}

export async function issueAdminCustomerPromo(
  teamID: string,
  input: AdminIssuePromoInput,
): Promise<AdminIssuePromoResponse> {
  const r = await call<{ ok: boolean; code: string; expires_at: string | null }>(
    buildAdminURL(`/customers/${encodeURIComponent(teamID)}/promo`),
    { method: 'POST', body: JSON.stringify(input) },
  )
  return { ok: true, code: r.code, expires_at: r.expires_at ?? null }
}
