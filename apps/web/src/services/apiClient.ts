import type { ApiResponse } from '@itlife/shared';
import { supabase } from '../lib/supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** เรียก Backend API เสมอผ่านตัวนี้ — ห้าม Frontend เรียกฐานข้อมูลตรง (ยกเว้น Supabase Auth) */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init?.headers,
    },
  });

  const body = (await res.json()) as ApiResponse<T>;

  if (!body.success) {
    throw new ApiError(body.error.code, body.error.message);
  }

  return body.data;
}
