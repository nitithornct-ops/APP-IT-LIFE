import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

/** สร้าง Request ID ให้ทุก request เพื่อใช้ใน Structured Logging / Audit Log / Response meta */
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && incoming.length > 0 ? incoming : crypto.randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
};
