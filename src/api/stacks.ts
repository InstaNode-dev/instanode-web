import { apiFetch, getAccessToken, ApiError } from './client';

export interface DashboardStack {
  id: string;
  slug: string;
  name: string;
  status: string;
  url: string;
  created_at: string;
  team_id: string;
  logs_service: string;
}

export interface StacksListResponse {
  ok: boolean;
  items: DashboardStack[];
  total: number;
}

export interface StackDeployAccepted {
  ok: boolean;
  stack_id: string;
  status: string;
  tier?: string;
  expires_in?: string;
  note?: string;
  error?: string;
  message?: string;
}

/** Relative or absolute base for agent stack routes (POST /stacks/new, logs, etc.). */
export function agentStacksURL(path: string): string {
  const base = (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? '';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export async function listStacks(): Promise<StacksListResponse> {
  return apiFetch<StacksListResponse>('/api/v1/stacks');
}

export async function getStack(slug: string): Promise<{ ok: boolean; stack: DashboardStack }> {
  return apiFetch<{ ok: boolean; stack: DashboardStack }>(
    `/api/v1/stacks/${encodeURIComponent(slug)}`,
  );
}

export async function deleteStack(slug: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/v1/stacks/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  });
}

export async function createStackDeployment(formData: FormData): Promise<StackDeployAccepted> {
  const token = getAccessToken();
  const res = await fetch(agentStacksURL('/stacks/new'), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
    credentials: 'include',
  });
  const body = (await res.json()) as StackDeployAccepted;
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? 'unknown', body.message ?? res.statusText);
  }
  return body;
}

export async function redeployStack(
  slug: string,
  formData: FormData,
): Promise<StackDeployAccepted> {
  const token = getAccessToken();
  const res = await fetch(
    agentStacksURL(`/stacks/${encodeURIComponent(slug)}/redeploy`),
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      credentials: 'include',
    },
  );
  const body = (await res.json()) as StackDeployAccepted;
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? 'unknown', body.message ?? res.statusText);
  }
  return body;
}
