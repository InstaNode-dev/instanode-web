import { apiFetch } from './client';
import type { Resource } from '../types/resource';

export interface ClaimResponse {
  ok: boolean;
  claimed: Resource[];
  skipped: number;
}

export interface ClaimPreviewResponse {
  ok: boolean;
  resources: Resource[];
  token_valid: boolean;
  expires_at: string;
}

export async function previewClaim(claimToken: string): Promise<ClaimPreviewResponse> {
  return apiFetch<ClaimPreviewResponse>(`/claim/preview?t=${encodeURIComponent(claimToken)}`);
}

export async function submitClaim(claimToken: string, email?: string): Promise<ClaimResponse> {
  return apiFetch<ClaimResponse>('/claim', {
    method: 'POST',
    body: { jwt: claimToken, ...(email ? { email } : {}) },
  });
}
