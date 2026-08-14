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
  it('returns the standard success envelope, reporting the database check as degraded when unreachable', async () => {
    // testEnv ไม่ได้ชี้ไปยัง Supabase Project จริง — checkDatabase() จึงต้อง error ออกมาเป็น
    // 'error' เสมอ (ไม่ throw/ไม่ค้าง) และ endpoint เองยังต้องตอบ 200 (ตัว API ยังทำงานอยู่ แค่
    // dependency ล่ม) การทดสอบกับ Supabase Project จริงที่ต่อได้อยู่นอกขอบเขตของ unit test ชุดนี้
    const res = await app.request('/api/v1/health', {}, testEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as ApiResponse<HealthResponse>;
    expect(body.success).toBe(true);
    if (!body.success) throw new Error('expected a success response');

    expect(body.data.status).toBe('degraded');
    expect(body.data.checks.database).toBe('error');
    expect(body.data.service).toBe('itlife-api');
    expect(body.data.environment).toBe('test');
    expect(body.meta.requestId).toBeTruthy();
    expect(body.meta.timestamp).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  }, 10000);
});

describe('public edge rate limiting', () => {
  it('returns 429 before executing a public endpoint when the Cloudflare limiter rejects it', async () => {
    const env: Bindings = {
      ...testEnv,
      PUBLIC_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };
    const res = await app.request('/api/v1/public/tickets/not-a-ticket?token=12345678901234567890123456789012', {}, env);
    expect(res.status).toBe(429);
    const body = (await res.json()) as ApiResponse<never>;
    expect(body.success).toBe(false);
    if (body.success) throw new Error('expected an error response');
    expect(body.error.code).toBe('RATE_LIMITED');
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
