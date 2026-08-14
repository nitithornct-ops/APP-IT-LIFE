import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../src/middleware/errorHandler';
import { requestId } from '../src/middleware/requestId';
import type { AppEnv } from '../src/types';
import { ok } from '../src/utils/response';
import { zodValidationHook } from '../src/utils/validation';

/**
 * Hono ตรวจ body ก่อนถึง handler และโยน HTTPException(400) เมื่อ JSON ไม่สมบูรณ์
 * ตัวจัดการ error กลางเคยไม่รู้จัก HTTPException จึงกลืนสถานะเดิมแล้วตอบ 500 ทุกกรณี
 * ทำให้ผู้เรียกได้ 500 ทั้งที่ตัวเองส่งข้อมูลผิด และ log เต็มไปด้วย INTERNAL_ERROR ปลอม
 * (พบตอน Pre-production QA audit 2026-08-13)
 */
function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId);
  app.post(
    '/echo',
    zValidator('json', z.object({ name: z.string().min(1) }), zodValidationHook),
    (c) => c.json(ok(c.get('requestId'), c.req.valid('json'))),
  );
  app.get('/boom', () => {
    throw new Error('ข้อความภายในที่ห้ามหลุดถึงผู้ใช้');
  });
  app.get('/teapot', () => {
    throw new HTTPException(418, { message: 'I am a teapot' });
  });
  app.onError(errorHandler);
  return app;
}

const post = (body: string) =>
  buildApp().request('/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

describe('errorHandler with a malformed request body', () => {
  it.each([
    ['truncated object', '{"name"'],
    ['empty body', ''],
    ['plain text', 'not json at all'],
    ['unclosed array', '{"a":[1,2'],
  ])('answers 400 INVALID_JSON for %s', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);

    const parsed = (await res.json()) as { success: boolean; error: { code: string; message: string } };
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('INVALID_JSON');
    expect(parsed.error.message).toContain('JSON');
  });

  it('still reports schema problems as VALIDATION_ERROR, not INVALID_JSON', async () => {
    const res = await post(JSON.stringify({ name: '' }));
    expect(res.status).toBe(400);

    const parsed = (await res.json()) as { error: { code: string } };
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets a well-formed body through untouched', async () => {
    const res = await post(JSON.stringify({ name: 'สมชาย' }));
    expect(res.status).toBe(200);

    const parsed = (await res.json()) as { success: boolean; data: { name: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.name).toBe('สมชาย');
  });
});

describe('errorHandler with other failures', () => {
  it('keeps the status of an HTTPException instead of turning it into 500', async () => {
    const res = await buildApp().request('/teapot');
    expect(res.status).toBe(418);

    const parsed = (await res.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('BAD_REQUEST');
    expect(parsed.error.message).not.toContain('teapot');
  });

  it('reports an unexpected error as 500 without leaking the internal message', async () => {
    const res = await buildApp().request('/boom');
    expect(res.status).toBe(500);

    const parsed = (await res.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('INTERNAL_ERROR');
    expect(parsed.error.message).not.toContain('ข้อความภายในที่ห้ามหลุด');
  });
});
