import { apiFetch, setAccessToken } from './client';
import type { AuthMeResponse, LogoutResponse } from '../types/auth';

export interface LoginResponse {
  ok: boolean;
  // MVP: server returns token directly so we can sign in immediately.
  // When magic-link flow is added, access_token will be absent and
  // message will contain "check your inbox".
  access_token?: string;
  message?: string;
  redirect_url?: string;
}

export async function fetchMe(): Promise<AuthMeResponse> {
  return apiFetch<AuthMeResponse>('/auth/me');
}

export async function loginMagicLink(email: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { email },
  });
}

export async function logout(): Promise<LogoutResponse> {
  const res = await apiFetch<LogoutResponse>('/auth/logout', { method: 'POST' });
  setAccessToken(null);
  return res;
}

export function loginGitHub(): void {
  window.location.href = '/auth/github';
}

/** SessionStorage key for post–OAuth redirect (e.g. /claim). */
export const OAUTH_REDIRECT_STORAGE_KEY = 'instant_oauth_redirect';

export function getGoogleOAuthRedirectURI(): string {
  return `${window.location.origin}/auth/google/callback`;
}

/** Starts Google OAuth in the browser (requires VITE_GOOGLE_CLIENT_ID). */
export function startGoogleOAuth(postLoginPath: string): void {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    return;
  }
  sessionStorage.setItem(OAUTH_REDIRECT_STORAGE_KEY, postLoginPath);
  const redirectUri = getGoogleOAuthRedirectURI();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    include_granted_scopes: 'true',
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export async function completeGoogleLogin(code: string, redirectUri: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/google', {
    method: 'POST',
    body: { code, redirect_uri: redirectUri },
  });
}

export async function refreshToken(): Promise<{ ok: boolean; access_token: string }> {
  // POST /auth/refresh — sends the httpOnly `rt` cookie automatically (credentials: 'include').
  // The server reads the cookie and issues a new short-lived access_token.
  // No Authorization header needed here.
  const res = await apiFetch<{ ok: boolean; access_token: string }>('/auth/refresh', {
    method: 'POST',
  });
  if (res.ok) {
    setAccessToken(res.access_token);
  }
  return res;
}
