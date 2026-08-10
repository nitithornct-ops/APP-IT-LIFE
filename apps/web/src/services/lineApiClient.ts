import type { ApiResponse } from '@itlife/shared';
import { ApiError } from './apiClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
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
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-line-session': token } : {}),
      ...init?.headers,
    },
  });

  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) {
    if (body.error.code === 'LINE_SESSION_REQUIRED') clearLineSessionToken();
    throw new ApiError(body.error.code, body.error.message);
  }
  return body.data;
}
