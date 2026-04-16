import type { ResourceTier } from './resource';

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  tier: ResourceTier;
  team_id?: string;
  role?: string;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  member_count: number;
  tier: ResourceTier;
  billing_email?: string;
  created_at: string;
}

export interface AuthMeResponse {
  ok: boolean;
  user: User;
  team?: Team;
  access_token?: string;
}

export interface LoginResponse {
  ok: boolean;
  message: string; // "magic link sent" or "oauth redirect"
  redirect_url?: string;
}

export interface LogoutResponse {
  ok: boolean;
}

// In-memory token store (never localStorage)
export interface AuthState {
  accessToken: string | null;
  user: User | null;
  team: Team | null;
  isLoading: boolean;
}
