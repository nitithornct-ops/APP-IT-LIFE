import { ApiError, requestApiData } from './apiClient';
import { supabase } from '../lib/supabase';

export function setVendorPortalCsrfToken(_token: string): void {
  // Compatibility no-op for clients that still import this helper during rollout.
}

export function clearVendorSessionToken(): void {
  // Vendor Portal sessions are managed by Supabase Auth, not application cookies.
}

export async function vendorPortalApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  try {
    return await requestApiData<T>(path, { ...init, headers });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VENDOR_SESSION_REQUIRED') clearVendorSessionToken();
    throw error;
  }
}

export async function bootstrapVendorPortal(): Promise<void> {
  await requestApiData<{ enabled: boolean }>('/api/v1/vendor-portal/bootstrap');
}

