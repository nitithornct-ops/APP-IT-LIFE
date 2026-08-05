import type { ApiResponse, HealthResponse } from '@itlife/shared';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/types';

const testEnv: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

describe('GET /api/v1/health', () => {
  it('returns the standard success envelope', async () => {
    const res = await app.request('/api/v1/health', {}, testEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as ApiResponse<HealthResponse>;
    expect(body.success).toBe(true);
    if (!body.success) throw new Error('expected a success response');

    expect(body.data.status).toBe('ok');
    expect(body.data.service).toBe('itlife-api');
    expect(body.data.environment).toBe('test');
    expect(body.meta.requestId).toBeTruthy();
    expect(body.meta.timestamp).toBeTruthy();
  });
});

describe('GET /unknown-route', () => {
  it('returns the standard error envelope with 404', async () => {
    const res = await app.request('/unknown-route', {}, testEnv);
    expect(res.status).toBe(404);

    const body = (await res.json()) as ApiResponse<never>;
    expect(body.success).toBe(false);
    if (body.success) throw new Error('expected an error response');

    expect(body.error.code).toBe('NOT_FOUND');
  });
});
