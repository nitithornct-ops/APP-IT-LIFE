import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/types';

const allowedOrigin = 'https://life-it.pages.dev';
const testEnv: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ALLOWED_ORIGINS: allowedOrigin,
  ENVIRONMENT: 'test',
};

describe('CORS preflight', () => {
  it('allows the LINE session header used by the public portal', async () => {
    const response = await app.request('/api/v1/line/bootstrap', {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type,x-line-session',
      },
    }, testEnv);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(response.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('x-line-session');
  });

  it('allows secret-bearing tracking headers without putting tokens in URLs', async () => {
    const response = await app.request('/api/v1/public/forms/current', {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type,x-tracking-token,x-vendor-token',
      },
    }, testEnv);

    expect(response.status).toBe(204);
    const allowed = response.headers.get('Access-Control-Allow-Headers')?.toLowerCase() ?? '';
    expect(allowed).toContain('x-tracking-token');
    expect(allowed).toContain('x-vendor-token');
  });
});
