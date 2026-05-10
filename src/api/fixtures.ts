// Stubbed data — realistic shapes matching the locked contracts.
// Replace this file with real fetches when backend lands.

import type {
  Resource, DashboardStack, DashboardTeam, User, TeamMember, TeamInvitation,
  BillingDetails, Invoice, VaultEntry, AuditEvent, ActivityItem
} from './types'

const now = new Date().toISOString()
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

export const FIXTURE_USER: User = {
  id: 'u_aanya',
  email: 'aanya@acme.dev',
  tier: 'pro',
  team_id: 't_acme',
  created_at: days(42),
  github_handle: 'aanyapatel',
  display_name: 'Aanya Patel',
  role: 'owner'
}

export const FIXTURE_TEAM: DashboardTeam = {
  id: 't_acme',
  name: 'acme-corp',
  slug: 'acme-corp',
  owner_id: 'u_aanya',
  member_count: 6,
  tier: 'pro',
  created_at: days(42),
  display_name: 'acme-corp',
  default_env: 'production'
}

export const FIXTURE_RESOURCES: Resource[] = [
  {
    id: 'd_xY9z2k7m',
    token: 'd_xY9z2k7m',
    resource_type: 'postgres',
    tier: 'pro',
    status: 'active',
    name: 'flashcards-db',
    env: 'production',
    storage_bytes: 47_300_000,
    storage_limit_bytes: 500_000_000,
    storage_exceeded: false,
    connections_in_use: 3,
    connections_limit: 5,
    cloud_vendor: 'aws',
    country_code: 'IN',
    expires_at: null,
    created_at: days(19),
    connection_url:
      'postgres://usr_xY9z2k7m:****@db.instanode.dev:5432/d_xY9z2k7m?sslmode=require'
  },
  {
    id: 'r_5tYn2k',
    token: 'r_5tYn2k',
    resource_type: 'redis',
    tier: 'pro',
    status: 'active',
    name: 'cache-sessions',
    env: 'production',
    storage_bytes: 163_000_000,
    storage_limit_bytes: 256_000_000,
    storage_exceeded: false,
    connections_in_use: 14,
    connections_limit: 20,
    cloud_vendor: 'aws',
    country_code: 'IN',
    expires_at: null,
    created_at: days(14)
  },
  {
    id: 'm_2a8f10',
    token: 'm_2a8f10',
    resource_type: 'mongodb',
    tier: 'pro',
    status: 'active',
    name: 'events-store',
    env: 'staging',
    storage_bytes: 1_640_000_000,
    storage_limit_bytes: 2_000_000_000,
    storage_exceeded: false,
    connections_in_use: 7,
    connections_limit: 20,
    cloud_vendor: 'aws',
    country_code: 'IN',
    expires_at: null,
    created_at: days(8)
  },
  {
    id: 'q_cb091f',
    token: 'q_cb091f',
    resource_type: 'queue',
    tier: 'pro',
    status: 'active',
    name: 'render-queue',
    env: 'production',
    storage_bytes: 204_000,
    storage_limit_bytes: 1_000_000,
    storage_exceeded: false,
    expires_at: null,
    created_at: days(5)
  },
  {
    id: 's_8a7c4d',
    token: 's_8a7c4d',
    resource_type: 'storage',
    tier: 'pro',
    status: 'active',
    name: 'user-uploads',
    env: 'production',
    storage_bytes: 1_550_000_000,
    storage_limit_bytes: 5_000_000_000,
    storage_exceeded: false,
    expires_at: null,
    created_at: days(2)
  },
  {
    id: 'w_4f7n9p',
    token: 'w_4f7n9p',
    resource_type: 'webhook',
    tier: 'pro',
    status: 'active',
    name: 'stripe-webhooks',
    env: 'production',
    storage_bytes: 1_200,
    storage_limit_bytes: 10_000,
    storage_exceeded: false,
    expires_at: null,
    created_at: ago(60 * 8)
  },
  {
    id: 'd_kP4n8b',
    token: 'd_kP4n8b',
    resource_type: 'postgres',
    tier: 'pro',
    status: 'active',
    name: 'analytics-db',
    env: 'staging',
    storage_bytes: 22_000_000,
    storage_limit_bytes: 500_000_000,
    storage_exceeded: false,
    connections_in_use: 2,
    connections_limit: 5,
    expires_at: null,
    created_at: ago(60 * 4)
  }
]

export const FIXTURE_STACKS: DashboardStack[] = [
  {
    id: 'dep_3f2c1a',
    slug: 'flashcards',
    name: 'flashcards',
    status: 'running',
    url: 'https://flashcards.deployment.instanode.dev',
    created_at: days(5),
    last_deploy_at: ago(7),
    build_duration_s: 38,
    team_id: 't_acme',
    env: 'production',
    tier: 'pro'
  },
  {
    id: 'dep_8a7c4d',
    slug: 'api-gateway',
    name: 'api-gateway',
    status: 'running',
    url: 'https://api.acme-corp.com',
    created_at: days(12),
    last_deploy_at: ago(120),
    build_duration_s: 52,
    team_id: 't_acme',
    env: 'production',
    tier: 'pro'
  },
  {
    id: 'dep_kP4n8b',
    slug: 'worker',
    name: 'worker',
    status: 'building',
    url: null,
    created_at: days(3),
    last_deploy_at: ago(1),
    build_duration_s: 28,
    team_id: 't_acme',
    env: 'staging',
    tier: 'pro'
  }
]

export const FIXTURE_MEMBERS: TeamMember[] = [
  { id: 'u_aanya',  email: 'aanya@acme.dev',  role: 'owner',     created_at: days(42), display_name: 'Aanya Patel',  _avatar_color: '#FF6B00' },
  { id: 'u_marcus', email: 'marcus@acme.dev', role: 'admin',     created_at: days(35), display_name: 'Marcus Chen',  _avatar_color: '#6CCEFF' },
  { id: 'u_kavya',  email: 'kavya@acme.dev',  role: 'admin',     created_at: days(20), display_name: 'Kavya Reddy',  _avatar_color: '#B794F6' },
  { id: 'u_jay',    email: 'jay@acme.dev',    role: 'developer', created_at: days(18), display_name: 'Jay Iyer',     _avatar_color: '#00E48E' },
  { id: 'u_neha',   email: 'neha@acme.dev',   role: 'developer', created_at: days(12), display_name: 'Neha Sharma',  _avatar_color: '#FFC069' },
  { id: 'u_rohan',  email: 'rohan@acme.dev',  role: 'developer', created_at: days(7),  display_name: 'Rohan Das',    _avatar_color: '#FF7A8A' }
]

export const FIXTURE_INVITATIONS: TeamInvitation[] = [
  {
    id: 'inv_8a7c',
    email: 'priya@acme.dev',
    role: 'developer',
    status: 'pending',
    invited_by: 'u_aanya',
    invited_by_name: 'aanya',
    created_at: days(2),
    expires_at: future(5)
  },
  {
    id: 'inv_2k9p',
    email: 'arjun@external.io',
    role: 'viewer',
    status: 'pending',
    invited_by: 'u_marcus',
    invited_by_name: 'marcus',
    created_at: ago(60 * 5),
    expires_at: future(7)
  }
]

export const FIXTURE_BILLING: BillingDetails = {
  status: 'active',
  current_period_end: future(9),
  razorpay_configured: true,
  subscription_status: 'active',
  payment_last4: '4242',
  payment_exp_month: 9,
  payment_exp_year: 27,
  payment_network: 'visa',
  cancel_at_period_end: false
}

export const FIXTURE_INVOICES: Invoice[] = [
  { id: 'inv_QzN8bD', period_start: days(20), period_end: future(10), plan: 'pro',   amount_cents: 4900, currency: 'USD', status: 'paid' },
  { id: 'inv_Pp7K2c', period_start: days(50), period_end: days(20),   plan: 'pro',   amount_cents: 4900, currency: 'USD', status: 'paid' },
  { id: 'inv_Lm4F9a', period_start: days(80), period_end: days(50),   plan: 'hobby', amount_cents: 900,  currency: 'USD', status: 'paid' }
]

// VAULT — proposed contract, currently blocked
export const FIXTURE_VAULT: VaultEntry[] = [
  { key: 'STRIPE_SECRET_KEY',      env: 'production', team_id: 't_acme', created_at: days(19), rotated_at: days(9),  last_read_at: ago(120), read_count: 14,  deploys_using: 4 },
  { key: 'OPENAI_API_KEY',         env: 'production', team_id: 't_acme', created_at: days(19), rotated_at: days(2),  last_read_at: ago(15),  read_count: 312, deploys_using: 4 },
  { key: 'ANTHROPIC_API_KEY',      env: 'production', team_id: 't_acme', created_at: days(15), rotated_at: ago(60),  last_read_at: ago(5),   read_count: 47,  deploys_using: 2 },
  { key: 'GITHUB_TOKEN',           env: 'production', team_id: 't_acme', created_at: days(40), rotated_at: days(21), last_read_at: ago(720), read_count: 8,   deploys_using: 1 },
  { key: 'RAZORPAY_WEBHOOK_SECRET', env: 'production', team_id: 't_acme', created_at: days(30), rotated_at: days(30), read_count: 0,   deploys_using: 0 }
]

export const FIXTURE_ACTIVITY: ActivityItem[] = [
  { id: 'a1', at: ago(2),  level: 'ok',   text: '<strong>claude-code</strong> provisioned <code>postgres</code> from <strong>104.28.7.91</strong>' },
  { id: 'a2', at: ago(7),  level: 'info', text: 'deploy <strong>flashcards</strong> rolled out · build 38s' },
  { id: 'a3', at: ago(11), level: 'warn', text: '<strong>events-store</strong> at 82% storage' },
  { id: 'a4', at: ago(42), level: 'info', text: '<strong>marcus</strong> rotated <code>STRIPE_SECRET_KEY</code>' },
  { id: 'a5', at: ago(60), level: 'ok',   text: '<strong>aanya</strong> claimed 3 anonymous resources' }
]

export const FIXTURE_BUILD_LOGS = [
  { ts: '14:42:01', phase: 'queued',   level: 'ok',   message: 'queued at iad-1 · queue position 1 · 0.1s' },
  { ts: '14:42:02', phase: 'cloning',  level: 'ok',   message: 'fetched 12.3 MB · sha256:8a7c4d…' },
  { ts: '14:42:03', phase: 'building', level: 'info', message: 'FROM node:20-alpine · cached layer' },
  { ts: '14:42:04', phase: 'building', level: 'info', message: 'RUN npm ci' },
  { ts: '14:42:22', phase: 'building', level: 'info', message: 'added 412 packages, audited 412 packages in 18.4s' },
  { ts: '14:42:23', phase: 'building', level: 'info', message: 'RUN npm run build' },
  { ts: '14:42:31', phase: 'building', level: 'info', message: 'vite build · ✓ 247 modules transformed in 7.8s' },
  { ts: '14:42:32', phase: 'pushing',  level: 'ok',   message: 'pushing to ghcr.io/acme-corp/flashcards:a31fc8de · 142 MB' },
  { ts: '14:42:35', phase: 'pushing',  level: 'ok',   message: 'push complete · digest sha256:9b3a17a6…' },
  { ts: '14:42:36', phase: 'rolling',  level: 'ok',   message: 'rolling out 2 replicas to iad-1' },
  { ts: '14:42:38', phase: 'rolling',  level: 'ok',   message: 'readiness ok · pod-0 healthy · pod-1 healthy' },
  { ts: '14:42:39', phase: 'rolling',  level: 'ok',   message: 'live at https://flashcards.deployment.instanode.dev' }
]
