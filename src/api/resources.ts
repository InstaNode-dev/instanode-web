import { apiFetch } from './client';
import type {
  ResourceListResponse,
  DeleteResourceResponse,
  RotateCredentialsResponse,
} from '../types/resource';

export async function fetchResources(): Promise<ResourceListResponse> {
  return apiFetch<ResourceListResponse>('/api/v1/resources');
}

export async function deleteResource(id: string): Promise<DeleteResourceResponse> {
  return apiFetch<DeleteResourceResponse>(`/api/v1/resources/${id}`, {
    method: 'DELETE',
  });
}

export async function rotateCredentials(id: string): Promise<RotateCredentialsResponse> {
  return apiFetch<RotateCredentialsResponse>(`/api/v1/resources/${id}/rotate`, {
    method: 'POST',
  });
}

export async function fetchResource(id: string) {
  return apiFetch<{ ok: boolean; resource: import('../types/resource').Resource }>(
    `/api/v1/resources/${id}`,
  );
}
