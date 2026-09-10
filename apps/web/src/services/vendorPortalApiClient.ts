import { ApiError, requestApiData } from './apiClient';

let csrfToken: string | null = null;
let bootstrapPromise: Promise<void> | null = null;

export function setVendorPortalCsrfToken(token: string): void {
  csrfToken = token;
}

export function clearVendorSessionToken(): void {
  csrfToken = null;
  bootstrapPromise = null;
}

export async function vendorPortalApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!path.endsWith('/bootstrap') && !csrfToken) await bootstrapVendorPortal();
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const method = (init?.method ?? 'GET').toUpperCase();
  if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('x-vendor-csrf', csrfToken);
  try {
    return await requestApiData<T>(path, { ...init, credentials: 'include', headers });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VENDOR_SESSION_REQUIRED') clearVendorSessionToken();
    throw error;
  }
}

export async function bootstrapVendorPortal(): Promise<void> {
  if (csrfToken) return;
  if (!bootstrapPromise) {
    bootstrapPromise = requestApiData<{ enabled: boolean; csrfToken: string }>('/api/v1/vendor-portal/bootstrap', { credentials: 'include' })
      .then((result) => setVendorPortalCsrfToken(result.csrfToken));
  }
  await bootstrapPromise;
}

