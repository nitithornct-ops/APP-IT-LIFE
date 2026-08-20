import { ApiError, requestApiData } from './apiClient';
const STORAGE_KEY = 'line_session_token';

/** LINE users have no Supabase session — the token lives in localStorage and rides on x-line-session instead of Authorization. */
export function getLineSessionToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setLineSessionToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearLineSessionToken(): void {
  localStorage.removeItem(STORAGE_KEY);
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
