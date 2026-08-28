import { ApiError, requestApiData } from './apiClient';

const STORAGE_KEY = 'vendor_portal_session_token';

export function getVendorSessionToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setVendorSessionToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearVendorSessionToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function vendorPortalApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getVendorSessionToken();
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('x-vendor-session', token);
  try {
    return await requestApiData<T>(path, { ...init, headers });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VENDOR_SESSION_REQUIRED') clearVendorSessionToken();
    throw error;
  }
}

