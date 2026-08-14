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

/**
 * ตัวเลือกเพิ่มเติมของ apiFetch นอกเหนือจาก RequestInit มาตรฐาน
 *
 * `silent` ใช้กับการเรียกที่เป็นงานเบื้องหลัง ไม่ใช่การกระทำที่ผู้ใช้กดเอง เช่นการบันทึก log
 * ถ้าไม่ปิด ผู้ใช้ที่ login ไม่ผ่านจะเห็นข้อความเขียว "บันทึกข้อมูลเรียบร้อยแล้ว" ขึ้นคู่กับข้อความแดง
 * "อีเมลหรือรหัสผ่านไม่ถูกต้อง" พร้อมกัน (พบตอน Pre-production QA audit 2026-08-13)
 */
export interface ApiFetchOptions {
  silent?: boolean;
}

/** ส่งข้อความแจ้งเตือนมุมจอผ่าน ToastProvider ที่ครอบทั้งแอปอยู่ */
export function showToast(tone: 'success' | 'error', message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('itlife:toast', { detail: { tone, message } }));
}

/** เรียก Backend API เสมอผ่านตัวนี้ — ห้าม Frontend เรียกฐานข้อมูลตรง (ยกเว้น Supabase Auth) */
export async function apiFetch<T>(path: string, init?: RequestInit, options?: ApiFetchOptions): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const body = (await res.json()) as ApiResponse<T>;

  if (!body.success) {
    if (!options?.silent) showToast('error', body.error.message || 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
    throw new ApiError(body.error.code, body.error.message);
  }

  const method = (init?.method ?? 'GET').toUpperCase();
  if (!options?.silent && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const message = method === 'DELETE' ? 'ลบข้อมูลเรียบร้อยแล้ว' : method === 'POST' ? 'บันทึกข้อมูลเรียบร้อยแล้ว' : 'แก้ไขข้อมูลเรียบร้อยแล้ว';
    showToast('success', message);
  }

  return body.data;
}
