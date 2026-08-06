import type { MiddlewareHandler } from 'hono';
import { createUserScopedClient } from '../lib/supabase';
import type { AppEnv } from '../types';
import { fail } from '../utils/response';

/** ตรวจ Supabase JWT จาก Authorization: Bearer — ปฏิเสธถ้าไม่มี/หมดอายุ/ไม่ถูกต้อง */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';

  if (!token) {
    return c.json(fail(c.get('requestId'), 'SESSION_REQUIRED', 'กรุณาเข้าสู่ระบบ'), 401);
  }

  const supabase = createUserScopedClient(c.env, token);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return c.json(fail(c.get('requestId'), 'SESSION_REQUIRED', 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่'), 401);
  }

  c.set('supabase', supabase);
  c.set('userId', data.user.id);
  c.set('userEmail', data.user.email ?? '');

  await next();
};
