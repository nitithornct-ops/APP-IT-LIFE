import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createUserScopedClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { clientIp, rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { writeLoginLog } from '../services/loginLogService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { loginLogSchema, updateOwnProfileSchema } from '../validators/auth';

export const authRoute = new Hono<AppEnv>();

/** ข้อมูลผู้ใช้ปัจจุบัน + บทบาท + สิทธิ์ที่ resolve แล้ว — Frontend ใช้ผลลัพธ์นี้ทำ Permission-aware Menu */
authRoute.get('/me', requireAuth, async (c) => {
  const supabase = c.get('supabase');
  const userId = c.get('userId');
  const reqId = c.get('requestId');

  const [profileResult, rolesResult, permissionsResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.rpc('my_roles'),
    supabase.rpc('my_permissions'),
  ]);

  if (profileResult.error || !profileResult.data) {
    return c.json(fail(reqId, 'PROFILE_NOT_FOUND', 'ไม่พบข้อมูลผู้ใช้'), 404);
  }

  return c.json(
    ok(reqId, {
      profile: profileResult.data,
      roles: rolesResult.data ?? [],
      permissions: (permissionsResult.data ?? []).map((row: { permission_key: string }) => row.permission_key),
    }),
  );
});

/** แก้ไขข้อมูลของตนเอง — จำกัดเฉพาะ full_name/phone เท่านั้น (ห้ามแก้ department/status ของตนเอง) */
authRoute.patch('/profile', requireAuth, zValidator('json', updateOwnProfileSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const userId = c.get('userId');
  const reqId = c.get('requestId');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: body.fullName, phone: body.phone || null })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'PROFILE_UPDATE_FAILED', 'บันทึกข้อมูลไม่สำเร็จ'), 400);
  }

  await writeAuditLog(c.env, {
    actorId: userId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'profile',
    targetTable: 'profiles',
    targetId: userId,
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});

/**
 * บันทึกความพยายาม Login ทุกครั้ง (Frontend เรียกหลัง signInWithPassword ไม่ว่าสำเร็จหรือไม่)
 * ไม่บังคับ Login ก่อนเรียก เพราะกรณี login ล้มเหลวยังไม่มี Session — จำกัดด้วย Rate Limit ต่อ IP แทน
 */
authRoute.post(
  '/login-log',
  rateLimit({ windowMs: 60_000, max: 10, keyFn: (c) => `login-log:${clientIp(c)}` }),
  zValidator('json', loginLogSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const body = c.req.valid('json');

    let userId: string | null = null;
    const authHeader = c.req.header('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';

    if (token) {
      const supabase = createUserScopedClient(c.env, token);
      const { data } = await supabase.auth.getUser(token);
      userId = data.user?.id ?? null;
    }

    await writeLoginLog(c.env, {
      userId,
      emailAttempted: body.email,
      success: body.success,
      failureReason: body.failureReason,
      mfaUsed: body.mfaUsed,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
    });

    return c.json(ok(reqId, { recorded: true }));
  },
);
