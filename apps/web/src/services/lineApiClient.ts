import { ApiError, requestApiData } from './apiClient';
const STORAGE_KEY = 'line_session_token';

/** LINE users have no Supabase session — keep the bearer token only for this browser session. */
export function getLineSessionToken(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function setLineSessionToken(token: string): void {
  sessionStorage.setItem(STORAGE_KEY, token);
}

export function clearLineSessionToken(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export async function lineApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getLineSessionToken();
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('x-line-session', token);
  try {
    return await requestApiData<T>(path, { ...init, headers });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'LINE_SESSION_REQUIRED') clearLineSessionToken();
    throw error;
  }
}
