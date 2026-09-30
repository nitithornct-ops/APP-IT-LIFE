import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  rateLimit,
  rateLimitBucketCountForTest,
  resetRateLimitBucketsForTest,
} from '../src/middleware/rateLimit';
import type { AppEnv, Bindings } from '../src/types';

const testEnv: Bindings = {
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

function createRateLimitedApp() {
  const app = new Hono<AppEnv>();
  app.use('*', rateLimit({
    windowMs: 1_000,
    max: 2,
    keyFn: (c) => c.req.header('x-test-key') ?? 'missing',
  }));
  app.get('*', (c) => c.text('ok'));
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimitBucketsForTest();
});

describe('in-memory rate limiter', () => {
  it('returns 429 after the configured request budget is exhausted', async () => {
    const app = createRateLimitedApp();
    const request = () => app.request('/', { headers: { 'x-test-key': 'same-client' } }, testEnv);

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429);
  });

  it('expires a bucket at the end of its window', async () => {
    const app = createRateLimitedApp();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const request = () => app.request('/', { headers: { 'x-test-key': 'same-client' } }, testEnv);

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429);

    now.mockReturnValue(11_001);
    expect((await request()).status).toBe(200);
  });

  it('keeps the isolate map bounded when identifiers churn', async () => {
    const app = createRateLimitedApp();
    const requests = Array.from({ length: 10_050 }, (_, index) => app.request('/', {
      headers: { 'x-test-key': `client-${index}` },
    }, testEnv));

    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(rateLimitBucketCountForTest()).toBeLessThanOrEqual(10_000);
  });
});
