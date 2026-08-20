import type { ApiResponse } from '@itlife/shared';
import { supabase } from '../lib/supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
    public requestId?: string,
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
  timeoutMs?: number;
}

/** ส่งข้อความแจ้งเตือนมุมจอผ่าน ToastProvider ที่ครอบทั้งแอปอยู่ */
export function showToast(tone: 'success' | 'error', message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('itlife:toast', { detail: { tone, message } }));
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Fetch and validate the standard API envelope, including gateway/non-JSON failures. */
export async function requestApiData<T>(path: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) abortFromCaller();
  else init?.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      const timedOut = controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError';
      throw new ApiError(
        timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED',
        timedOut ? 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง' : 'ยกเลิกคำขอแล้ว',
        timedOut ? 408 : undefined,
      );
    }
    throw new ApiError('NETWORK_ERROR', 'เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่อีกครั้ง', undefined, undefined);
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', abortFromCaller);
  }

  const requestId = res.headers.get('x-request-id') ?? undefined;
  if (res.status === 204) return undefined as T;

  const raw = await res.text();
  let body: ApiResponse<T>;
  try {
    body = JSON.parse(raw) as ApiResponse<T>;
  } catch {
    throw new ApiError(
      'INVALID_API_RESPONSE',
      res.ok ? 'ระบบตอบกลับในรูปแบบที่ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' : `บริการขัดข้องชั่วคราว (HTTP ${res.status})`,
      res.status,
      requestId,
    );
  }

  if (!body || typeof body !== 'object' || typeof body.success !== 'boolean') {
    throw new ApiError('INVALID_API_RESPONSE', 'ระบบตอบกลับในรูปแบบที่ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', res.status, requestId);
  }
  if (!body.success) {
    throw new ApiError(body.error.code, body.error.message, res.status, body.meta?.requestId ?? requestId);
  }
  if (!res.ok) {
    throw new ApiError('HTTP_ERROR', `บริการขัดข้องชั่วคราว (HTTP ${res.status})`, res.status, body.meta?.requestId ?? requestId);
  }
  return body.data;
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

  let data: T;
  try {
    data = await requestApiData<T>(path, { ...init, headers }, options?.timeoutMs);
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError('UNKNOWN_ERROR', 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง');
    if (!options?.silent) showToast('error', apiError.message || 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
    throw apiError;
  }

  const method = (init?.method ?? 'GET').toUpperCase();
  if (!options?.silent && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const message = method === 'DELETE' ? 'ลบข้อมูลเรียบร้อยแล้ว' : method === 'POST' ? 'บันทึกข้อมูลเรียบร้อยแล้ว' : 'แก้ไขข้อมูลเรียบร้อยแล้ว';
    showToast('success', message);
  }

  return data;
}
