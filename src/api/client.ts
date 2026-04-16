// Base URL from environment — falls back to same origin in production
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

// In-memory access token — never written to localStorage
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  ok: false;
  error: string;
  code?: string;
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body.code ?? 'unknown', body.error ?? res.statusText);
  } catch {
    return new ApiError(res.status, 'unknown', res.statusText);
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    credentials: 'include', // send httpOnly refresh cookie
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // If 401, the refresh cookie flow should handle re-auth — for now surface the error
  if (!res.ok) {
    throw await parseErrorBody(res);
  }

  return res.json() as Promise<T>;
}
