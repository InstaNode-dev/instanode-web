import type { Resource, ResourceListResponse } from '../../src/types/resource';
import type { AuthMeResponse } from '../../src/types/auth';

// ------------------------------------------------------------------
// Mock resource fixtures
// ------------------------------------------------------------------

export const mockPostgres: Resource = {
  id: 'res_pg_001',
  token: 'tok_pg_001_abc123def456',
  connection_url: 'postgres://usr_mock:secret@pg.instanode.dev:5432/db_mock',
  resource_type: 'postgres',
  tier: 'hobby',
  status: 'active',
  name: 'My Postgres',
  storage_bytes: 350 * 1024 * 1024, // 350 MB
  cloud_vendor: 'aws',
  country_code: 'us',
  created_at: '2026-01-15T10:00:00Z',
};

export const mockRedis: Resource = {
  id: 'res_rd_001',
  token: 'tok_rd_001_abc123def456',
  resource_type: 'redis',
  tier: 'hobby',
  status: 'active',
  name: 'Session Cache',
  key_prefix: 'myapp:',
  cloud_vendor: 'aws',
  country_code: 'us',
  created_at: '2026-01-20T10:00:00Z',
};

export const mockMongo: Resource = {
  id: 'res_mg_001',
  token: 'tok_mg_001_abc123def456',
  resource_type: 'mongodb',
  tier: 'hobby',
  status: 'active',
  name: 'Product Catalog',
  storage_bytes: 120 * 1024 * 1024, // 120 MB
  cloud_vendor: 'gcp',
  country_code: 'eu',
  created_at: '2026-02-01T10:00:00Z',
};

export const mockQueue: Resource = {
  id: 'res_q_001',
  token: 'tok_q_001_abc123def456',
  resource_type: 'queue',
  tier: 'hobby',
  status: 'active',
  name: 'Task Queue',
  created_at: '2026-02-05T10:00:00Z',
};

// Anonymous resource with expiry
export const mockAnonymousPostgres: Resource = {
  id: 'res_pg_anon_001',
  token: 'tok_pg_anon_001_xyz789',
  resource_type: 'postgres',
  tier: 'anonymous',
  status: 'active',
  storage_bytes: 50 * 1024 * 1024,
  expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 6h from now
  created_at: '2026-04-09T00:00:00Z',
};

// Deleted resource
export const mockDeletedRedis: Resource = {
  id: 'res_rd_del_001',
  token: '',
  resource_type: 'redis',
  tier: 'hobby',
  status: 'deleted',
  name: 'Old Cache',
  created_at: '2025-12-01T10:00:00Z',
};

// ------------------------------------------------------------------
// Composite fixtures
// ------------------------------------------------------------------

export const mockResources: ResourceListResponse = {
  ok: true,
  items: [mockPostgres, mockRedis, mockMongo, mockQueue],
  total: 4,
};

export const mockResourcesWithAnonymous: ResourceListResponse = {
  ok: true,
  items: [mockAnonymousPostgres, mockRedis],
  total: 2,
};

export const mockEmptyResources: ResourceListResponse = {
  ok: true,
  items: [],
  total: 0,
};

// ------------------------------------------------------------------
// Auth fixtures
// ------------------------------------------------------------------

export const mockAuthHobby: AuthMeResponse = {
  ok: true,
  user: {
    id: 'usr_001',
    email: 'test@example.com',
    name: 'Test User',
    tier: 'hobby',
    created_at: '2026-01-01T00:00:00Z',
  },
  team: {
    id: 'team_001',
    name: 'Test Team',
    slug: 'test-team',
    owner_id: 'usr_001',
    member_count: 1,
    tier: 'hobby',
    created_at: '2026-01-01T00:00:00Z',
  },
};

export const mockAuthAnonymous: AuthMeResponse = {
  ok: true,
  user: {
    id: 'usr_anon_001',
    email: 'anon@tmp.instanode.dev',
    tier: 'anonymous',
    created_at: '2026-04-09T00:00:00Z',
  },
};

export const mockAuthPro: AuthMeResponse = {
  ok: true,
  user: {
    id: 'usr_pro_001',
    email: 'pro@example.com',
    name: 'Pro User',
    tier: 'pro',
    created_at: '2025-06-01T00:00:00Z',
  },
};

// ------------------------------------------------------------------
// Claim fixtures
// ------------------------------------------------------------------

export const mockClaimPreview = {
  ok: true,
  resources: [mockAnonymousPostgres],
  token_valid: true,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

export const mockClaimSuccess = {
  ok: true,
  claimed: [{ ...mockAnonymousPostgres, tier: 'hobby' as const, expires_at: undefined }],
  skipped: 0,
};
