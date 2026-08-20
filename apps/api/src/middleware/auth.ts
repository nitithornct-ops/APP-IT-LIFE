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

  // JWT ที่ออกไปแล้วอาจยังใช้ได้จนหมดอายุ แม้ Admin จะปิดบัญชีหรือเพิกถอน refresh token
  // จึงต้องตรวจสถานะจากฐานข้อมูลทุก request เพื่อให้การ deactivate มีผลทันที
  const { data: profiles, error: profileError } = await supabase.rpc('my_profile');
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  if (profileError || !profile) {
    return c.json(fail(c.get('requestId'), 'PROFILE_NOT_FOUND', 'ไม่พบข้อมูลผู้ใช้ที่ใช้งานได้'), 403);
  }
  if (profile.status !== 'active') {
    return c.json(fail(c.get('requestId'), 'ACCOUNT_INACTIVE', 'บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ'), 403);
  }

  c.set('supabase', supabase);
  c.set('userId', data.user.id);
  c.set('userEmail', data.user.email ?? '');

  await next();
};
