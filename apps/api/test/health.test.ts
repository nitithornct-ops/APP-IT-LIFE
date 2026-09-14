import type { ApiResponse, HealthResponse } from '@itlife/shared';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/types';

const testEnv: Bindings = {
  SUPABASE_URL: 'https://health-check.invalid',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

describe('GET /api/v1/health', () => {
  it('returns a safe public readiness envelope', async () => {
    // testEnv ไม่ได้ชี้ไปยัง Supabase Project จริง — checkDatabase() จึงต้อง error ออกมาเป็น
    // 'error' เสมอ (ไม่ throw/ไม่ค้าง) และ readiness ต้องตอบ 503 เพื่อให้ deploy/load balancer
    // ไม่รับระบบที่ยังใช้ฐานข้อมูลไม่ได้
    const res = await app.request('/api/v1/health', {}, testEnv);
    expect([200, 503]).toContain(res.status);

    const body = (await res.json()) as ApiResponse<HealthResponse>;
    expect(body.success).toBe(true);
    if (!body.success) throw new Error('expected a success response');

    expect(['ok', 'degraded']).toContain(body.data.status);
    expect(body.data.service).toBe('itlife-api');
    expect(body.data.responseTimeMs).toEqual(expect.any(Number));
    expect(body.data).not.toHaveProperty('environment');
    expect(body.data).not.toHaveProperty('checks');
    expect(body.meta.requestId).toBeTruthy();
    expect(body.meta.timestamp).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  }, 10000);

  it('keeps a dependency-free liveness endpoint for process monitoring', async () => {
    const res = await app.request('/api/v1/health/live', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { status: string; service: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.service).toBe('itlife-api');
  });
});

describe('public edge rate limiting', () => {
  it('returns 429 before executing a public endpoint when the Cloudflare limiter rejects it', async () => {
    const env: Bindings = {
      ...testEnv,
      PUBLIC_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };
    // ยิงที่ public knowledge เพราะเป็น endpoint สาธารณะที่ยังใช้ edgeRateLimit อยู่ (หน้าแจ้งซ่อม
    // สาธารณะถูกถอดออกแล้ว) ตัวจำกัดต้องตอบ 429 ตั้งแต่ middleware ก่อนถึง handler และก่อน validate query
    const res = await app.request('/api/v1/public/knowledge', {}, env);
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

describe('GET /api/v1/system-status', () => {
  it('keeps the detailed status view behind authentication', async () => {
    const res = await app.request('/api/v1/system-status', {}, testEnv);
    expect(res.status).toBe(401);
  });
});
