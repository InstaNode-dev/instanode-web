// ------------------------------------------------------------------
// Types — mirror the agent API JSON shapes the dashboard consumes.
// Source of truth: /InstaNode/api/internal/handlers/*
// ------------------------------------------------------------------

export type Tier = 'anonymous' | 'free' | 'hobby' | 'hobby_plus' | 'pro' | 'team' | 'growth'
export type Role = 'owner' | 'admin' | 'developer' | 'viewer'
export type Env = 'production' | 'staging' | 'development' | string

export type ResourceType =
  | 'postgres'
  | 'redis'
  | 'mongodb'
  | 'queue'
  | 'storage'
  | 'webhook'
  | 'deploy'

export type ResourceStatus = 'active' | 'paused' | 'expired' | 'tombstoned' | 'deleted' | 'reaped'

export interface Resource {
  id: string
  token: string
  resource_type: ResourceType
  tier: Tier
  status: ResourceStatus
  name: string | null
  env: Env
  storage_bytes: number
  storage_limit_bytes: number
  storage_exceeded: boolean
  connections_in_use?: number
  connections_limit?: number
  cloud_vendor?: string
  country_code?: string
  expires_at: string | null
  created_at: string
  /** Only present on GET /:id and POST /:id/rotate — never on list */
  connection_url?: string
}

export type StackStatus = 'building' | 'running' | 'failed' | 'stopped'

export interface DashboardStack {
  id: string
  slug: string
  name: string
  status: StackStatus
  url: string | null
  created_at: string
  team_id: string
  logs_service?: string
  /** Last build duration in seconds */
  build_duration_s?: number
  /** Last deploy timestamp */
  last_deploy_at?: string
  env: Env
  tier: Tier
}

// ─── Deployment (POST /deploy/new — single-container app) ───────────────
//
// The agent API exposes two deploy surfaces that the dashboard renders
// through the same pages:
//   1. multi-service stacks → POST /stacks/new, GET /api/v1/stacks
//   2. single-container deployments → POST /deploy/new, GET /api/v1/deployments
//
// `DashboardDeployment` is the typed shape of (2) after adaptation. The
// server response includes `env` as a map of env_vars (legacy alias) and
// `environment` as the env scope name; we surface them as `env_vars` and
// `env` here so the type matches the DashboardStack vocabulary.
export type DeploymentStatus =
  | 'building'
  | 'deploying'
  | 'healthy'
  | 'failed'
  | 'stopped'
  // Mapped onto StackStatus for shared UI: 'healthy' → 'running'.
  | 'running'

export interface DashboardDeployment {
  /** UUID of the deployment row (used in /deploy/:id paths). */
  id: string
  /** Public app token; doubles as the URL slug under deployment.instanode.dev. */
  app_id: string
  /** Human-readable name. Server doesn't expose one yet — falls back to app_id. */
  name: string
  /** Application URL — e.g. https://<app_id>.deployment.instanode.dev. */
  url: string | null
  status: DeploymentStatus
  /** Env scope: production / staging / dev / ... — defaults to 'production'. */
  env: Env
  /** Listening port inside the container. */
  port: number
  tier: Tier
  /** User-supplied env vars (excluding vault refs are still strings). */
  env_vars: Record<string, string>
  created_at: string
  /** Updated_at from the row — used as the "last deploy" timestamp until the
   *  API exposes a dedicated field. */
  last_deploy_at?: string
  /** Not exposed by the API yet; reserved for forward compatibility. */
  build_duration_s?: number
  /** Optional resource binding (UUID of the primary resource). */
  resource_id?: string
  /** When true the deploy is gated by an IP allow-list; agents/browsers
   *  outside `allowed_ips` get a 403 from the edge. Defaults to false on
   *  older API builds (public deploy). Pro+ feature — anonymous / free
   *  / hobby get 402 from POST /deploy/new when this is set. */
  private?: boolean
  /** IPv4 addresses or CIDR blocks (max 32) permitted to reach the
   *  deployment when `private=true`. Empty / undefined when public. */
  allowed_ips?: string[]
}

export interface DashboardTeam {
  id: string
  name: string
  slug: string
  owner_id: string
  member_count: number
  tier: Tier
  created_at: string
  /** Locked by /api/v1/team — display name optional */
  display_name?: string
  /** Default env preference (NEEDS LOCK — not in proto yet) */
  default_env?: Env
}

export interface User {
  id: string
  email: string
  tier: Tier
  team_id: string
  created_at: string
  github_handle?: string
  display_name?: string
  role?: Role
}

export interface TeamMember {
  id: string
  email: string
  role: Role
  created_at: string
  display_name?: string
  /** Avatar gradient seed — frontend-derived */
  _avatar_color?: string
}

export interface TeamInvitation {
  id: string
  email: string
  role: Role
  status: 'pending' | 'revoked' | 'accepted'
  invited_by: string
  invited_by_name?: string
  created_at: string
  expires_at: string
}

export interface BillingDetails {
  status: string
  current_period_end: string | null
  razorpay_configured: boolean
  subscription_status?: string
  payment_last4?: string
  payment_exp_month?: number
  payment_exp_year?: number
  payment_network?: string
  cancel_at_period_end?: boolean
}

export interface Invoice {
  id: string
  period_start: string
  period_end: string
  plan: Tier
  amount_cents: number
  currency: string
  status: 'paid' | 'pending' | 'failed'
  pdf_url?: string
}

// ---------- Vault (BLOCKED — proposed shape, not yet implemented) ----------
export interface VaultEntry {
  key: string
  env: Env
  team_id: string
  created_at: string
  /** Backend doesn't expose rotated_at on the list endpoint yet — undefined until it does. */
  rotated_at?: string | null
  last_read_at?: string
  read_count: number
  deploys_using: number
  // value: NEVER returned, only on /reveal endpoint
}

// ---------- Audit (BLOCKED — proposed shape) ----------
export interface AuditEvent {
  id: string
  at: string
  actor: string
  actor_name?: string
  target?: string
  target_name?: string
  action: string
  details?: Record<string, unknown>
  ip?: string
}

// ---------- Activity feed (overview) ----------
export interface ActivityItem {
  id: string
  at: string
  level: 'ok' | 'warn' | 'err' | 'info'
  text: string
}

// ---------- Generic envelope ----------
export type OkResponse<T = {}> = { ok: true } & T
export interface ErrResponse {
  ok: false
  error: string
  message?: string
  upgrade_url?: string
}

// ---------- Stat overview (computed client-side from list) ----------
export interface OverviewStats {
  active_resources: number
  storage_used_bytes: number
  storage_limit_bytes: number
  connections_in_use: number
  connections_limit: number
  deployments_active: number
  webhook_calls_24h: number
  vault_entries: number
}

// ---------- Auth/me response (locked) ----------
// `experiments` is the server-bucketed A/B map (keyed by experiment
// name → variant). The dashboard reads this to render variant copy
// and to know which variant to send back when firing the conversion
// endpoint. Missing or {} means "no experiments running" — every
// consumer treats absent variants as "control" so the field is
// safe to omit on older API builds.
//
// Known keys today (track P1): "upgrade_button" → "control" | "urgent" | "value".
// The variant→label/style mapping lives in src/components/UpgradeButton.tsx;
// U2's UpgradePromptCard composes that component so it doesn't read variants directly.
export interface AuthMeResponse {
  user: User
  team: DashboardTeam
  access_token?: string
  experiments?: Record<string, string>
  /** Track A platform-admin flag — when true, the dashboard renders the
   *  `/app/admin/customers` route + sidebar link. Older API builds omit
   *  the field entirely, in which case the dashboard treats the caller
   *  as a regular user (404 on the admin route, link hidden). The flag
   *  is server-authoritative; the dashboard never elevates by itself. */
  is_platform_admin?: boolean
  /** Unguessable URL segment under which the founder-only customer-management
   *  endpoints register on the API. The agent API serves this field ONLY
   *  for callers on the ADMIN_EMAILS allowlist AND when the operator has
   *  configured ADMIN_PATH_PREFIX. For every non-admin caller and every
   *  deploy without an admin path, the field is absent (not empty — absent;
   *  the field's mere presence would leak the surface's existence).
   *
   *  The admin API URL builders in src/api/index.ts read this value at
   *  fetchMe-time and stash it in a module-local var. URLs are built as
   *  `/api/v1/${prefix}/customers/...`. With no prefix loaded, the
   *  builders throw a clear error and the admin route hides itself. */
  admin_path_prefix?: string
}

// ---------- Admin customers (Track A — founder console) ----------
//
// Shape of GET /api/v1/admin/customers responses. Track A is shipping
// the backend in parallel; we mirror the contract here so the dashboard
// compiles independently. Fields the agent API hasn't pinned yet are
// marked optional so the adapter can degrade gracefully.

export interface AdminCustomerSummary {
  team_id: string
  primary_email: string
  /** Display name — agents that never set one fall back to the email
   *  local part on the server side. May be empty for very old teams. */
  name?: string
  tier: Tier
  /** Monthly MRR in INR paise (×100). Track A returns 0 for unpaid teams. */
  mrr_monthly: number
  /** Yearly MRR in INR paise — 0 when the team isn't on a yearly plan. */
  mrr_yearly: number
  /** Aggregate storage across every resource owned by the team. */
  storage_bytes: number
  /** Count of running deployments. */
  deployments_active: number
  /** ISO-8601 — last authenticated request (auth, provision, dashboard). */
  last_active: string | null
  created_at: string
}

export interface AdminCustomerListResponse {
  ok: true
  customers: AdminCustomerSummary[]
  total: number
}

export interface AdminAuditEntry {
  id: string
  kind: string
  summary: string
  at: string
  actor?: string
}

export interface AdminPromoEntry {
  id: string
  code: string
  kind: 'percent_off' | 'first_month_free' | 'amount_off'
  value: number
  applies_to: number
  valid_for_days: number
  expires_at: string | null
  created_at: string
}

export interface AdminSubscriptionInfo {
  status?: string
  next_renewal_at?: string | null
  amount_inr?: number | null
  razorpay_subscription_id?: string | null
}

export interface AdminCustomerDetailResponse {
  ok: true
  team: DashboardTeam & { primary_email?: string }
  users: User[]
  resources: Resource[]
  audit_log: AdminAuditEntry[]
  deploys: DashboardDeployment[]
  subscription: AdminSubscriptionInfo | null
  promos?: AdminPromoEntry[]
}

export interface AdminIssuePromoInput {
  kind: 'percent_off' | 'first_month_free' | 'amount_off'
  /** Integer — 15 for 15% off; 49 for $49 off; ignored for first_month_free. */
  value: number
  /** Integer — 1 = first month only, 3 = first 3 months, 0 = ongoing. */
  applies_to: number
  /** Days the code is redeemable for. Default 30. */
  valid_for_days: number
}

export interface AdminIssuePromoResponse {
  ok: true
  code: string
  expires_at: string | null
}

export interface AdminSetTierInput {
  tier: Tier
  reason: string
}

export interface AdminSetTierResponse {
  ok: true
  team: DashboardTeam
}
