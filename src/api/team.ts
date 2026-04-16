import { apiFetch } from './client';
import type { Team } from '../types/auth';

export interface TeamResponse {
  ok: boolean;
  team: Team;
}

export async function fetchTeam(): Promise<TeamResponse> {
  return apiFetch<TeamResponse>('/api/v1/team');
}

export async function updateTeam(patch: { name?: string; display_name?: string }): Promise<TeamResponse> {
  return apiFetch<TeamResponse>('/api/v1/team', {
    method: 'PATCH',
    body: patch,
  });
}

export type { BillingResponse, CheckoutResponse } from './billing';
export { fetchBilling, createCheckout } from './billing';
