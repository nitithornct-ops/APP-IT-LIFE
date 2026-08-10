import type { ApiResponse } from '@itlife/shared';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/types';

// ค่าทดสอบล้วนๆ ไม่ใช่ Supabase Project จริง — เคสในไฟล์นี้ต้องไม่ยิง network request ออกไปจริง
// (requireAuth คืน 401 ก่อนเรียก Supabase เสมอเมื่อไม่มี Bearer token, และ zValidator ทำงาน
// ก่อน handler เสมอ) — การทดสอบกับ Supabase Project จริงอยู่นอกขอบเขตของ unit test ชุดนี้
const testEnv: Bindings = {
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

describe('requireAuth', () => {
  it.each([
    ['GET', '/api/v1/users'],
    ['GET', '/api/v1/roles'],
    ['GET', '/api/v1/permissions'],
    ['GET', '/api/v1/departments'],
    ['GET', '/api/v1/positions'],
    ['GET', '/api/v1/ticket-categories'],
    ['GET', '/api/v1/asset-categories'],
    ['GET', '/api/v1/permission-overrides'],
    ['GET', '/api/v1/approval-groups'],
    ['GET', '/api/v1/employees'],
    ['GET', '/api/v1/tickets'],
    ['GET', '/api/v1/service-catalog'],
    ['GET', '/api/v1/service-requests'],
    ['GET', '/api/v1/access-systems'],
    ['GET', '/api/v1/access-requests'],
    ['GET', '/api/v1/access-registry'],
    ['GET', '/api/v1/tasks'],
    ['GET', '/api/v1/assets'],
    ['GET', '/api/v1/maintenance-plans'],
    ['GET', '/api/v1/pm-templates'],
    ['GET', '/api/v1/inventory-items'],
    ['GET', '/api/v1/software-licenses'],
    ['GET', '/api/v1/backup-monitoring'],
    ['GET', '/api/v1/workflows'],
    ['GET', '/api/v1/knowledge'],
    ['GET', '/api/v1/governance/risk'],
    ['GET', '/api/v1/reports'],
    ['GET', '/api/v1/dashboard/summary'],
    ['GET', '/api/v1/employee-assignments'],
    ['GET', '/api/v1/cmdb/items'],
    ['GET', '/api/v1/cmdb/relationships'],
    ['GET', '/api/v1/incidents'],
    ['GET', '/api/v1/problems'],
    ['GET', '/api/v1/changes'],
    ['GET', '/api/v1/audit-logs'],
    ['GET', '/api/v1/settings'],
    ['GET', '/api/v1/auth/me'],
    ['GET', '/api/v1/notifications'],
    ['GET', '/api/v1/notifications/unread-count'],
    ['POST', '/api/v1/files'],
  ])('rejects %s %s without an Authorization header', async (method, path) => {
    const res = await app.request(path, { method }, testEnv);
    expect(res.status).toBe(401);

    const body = (await res.json()) as ApiResponse<never>;
    expect(body.success).toBe(false);
    if (body.success) throw new Error('expected an error response');
    expect(body.error.code).toBe('SESSION_REQUIRED');
  });

  it('rejects requests with a malformed Authorization header (no Bearer prefix)', async () => {
    const res = await app.request('/api/v1/users', { headers: { authorization: 'not-a-bearer-token' } }, testEnv);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/login-log validation', () => {
  it('rejects a body missing required fields before touching Supabase', async () => {
    const res = await app.request(
      '/api/v1/auth/login-log',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
      testEnv,
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as ApiResponse<never>;
    expect(body.success).toBe(false);
    if (body.success) throw new Error('expected an error response');
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
  });
});
