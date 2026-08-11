import type { ApiResponse } from '@itlife/shared';
import { ApiError } from './apiClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/** No login and no LINE session — every call here is a plain unauthenticated fetch. */
export async function publicTicketApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) throw new ApiError(body.error.code, body.error.message);
  return body.data;
}
