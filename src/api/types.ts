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
export interface AuthMeResponse {
  user: User
  team: DashboardTeam
  access_token?: string
}
