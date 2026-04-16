export type ResourceType = 'postgres' | 'redis' | 'mongodb' | 'queue' | 'webhook' | 'storage';
export type ResourceStatus = 'active' | 'deleted' | 'suspended';
export type ResourceTier = 'anonymous' | 'hobby' | 'pro' | 'team';

export interface Resource {
  id: string;
  token: string;
  /** Connection string when exposed by the API (may be absent for some types). */
  connection_url?: string;
  resource_type: ResourceType;
  tier: ResourceTier;
  status: ResourceStatus;
  name?: string;
  storage_bytes?: number;
  storage_exceeded?: boolean;  // set by API when storage_bytes >= plan limit
  key_prefix?: string;     // Redis: ACL namespace prefix
  cloud_vendor?: string;
  country_code?: string;
  expires_at?: string;     // ISO8601, null for claimed resources
  created_at: string;
}

export interface ResourceListResponse {
  ok: boolean;
  items: Resource[];
  total: number;
}

export interface RotateCredentialsResponse {
  ok: boolean;
  connection_url: string;
  token: string;
}

export interface DeleteResourceResponse {
  ok: boolean;
}

// Quotas per tier (bytes)
export const STORAGE_QUOTA: Record<ResourceTier, number | null> = {
  anonymous: 256 * 1024 * 1024,   // 256 MB
  hobby: 1024 * 1024 * 1024,      // 1 GB
  pro: 10 * 1024 * 1024 * 1024,   // 10 GB
  team: null,                       // unlimited
};

export const RESOURCE_EMOJI: Record<ResourceType, string> = {
  postgres: '🐘',
  redis: '⚡',
  mongodb: '🍃',
  queue: '📨',
  webhook: '🔗',
  storage: '📦',
};

export const RESOURCE_LABEL: Record<ResourceType, string> = {
  postgres: 'Postgres',
  redis: 'Redis',
  mongodb: 'MongoDB',
  queue: 'NATS Queue',
  webhook: 'Webhook',
  storage: 'Storage',
};
