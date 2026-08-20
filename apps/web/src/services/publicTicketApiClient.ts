import { requestApiData } from './apiClient';

/** No login and no LINE session — every call here is a plain unauthenticated fetch. */
export async function publicTicketApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return requestApiData<T>(path, { ...init, headers });
}
