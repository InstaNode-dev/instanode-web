// ------------------------------------------------------------------
// Types — mirror the agent API JSON shapes the dashboard consumes.
// Source of truth: /InstaNode/api/internal/handlers/*
// ------------------------------------------------------------------

export type Tier = 'anonymous' | 'free' | 'hobby' | 'pro' | 'team' | 'growth'
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

export type ResourceStatus = 'active' | 'expired' | 'tombstoned' | 'deleted'

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
export interface AuthMeResponse {
  user: User
  team: DashboardTeam
  access_token?: string
  experiments?: Record<string, string>
}
