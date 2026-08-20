import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createUserScopedClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
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
  const reqId = c.get('requestId');

  // อ่านโปรไฟล์ของตนเองผ่าน my_profile() แทนการ select ตรง เพราะคอลัมน์ส่วนบุคคล (phone/avatar_url)
  // ถูกตัดออกจาก GRANT ของ authenticated แล้ว — ฟังก์ชันนี้ล็อกไว้ที่ auth.uid() เท่านั้น
  const [profileResult, rolesResult, permissionsResult] = await Promise.all([
    supabase.rpc('my_profile'),
    supabase.rpc('my_roles'),
    supabase.rpc('my_permissions'),
  ]);

  let profile = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data;

  // ฐานข้อมูลที่ยังไม่ได้รัน 20260908100000_tighten_directory_access.sql จะไม่มีฟังก์ชันนี้ —
  // ยอมถอยไปอ่านจากตารางตรงเพื่อไม่ให้ทั้งระบบล่มระหว่าง deploy แต่ log ไว้ให้เห็นชัดว่า schema ตามหลังโค้ด
  // (npm run runtime:gate จะจับกรณีนี้ก่อนถึง production อยู่แล้ว)
  if (profileResult.error && !profile) {
    console.error(JSON.stringify({ requestId: reqId, code: 'MY_PROFILE_RPC_MISSING', message: profileResult.error.message }));
    const fallback = await supabase.from('profiles').select('*').eq('id', c.get('userId')).maybeSingle();
    profile = fallback.data;
  }

  if (!profile) {
    return c.json(fail(reqId, 'PROFILE_NOT_FOUND', 'ไม่พบข้อมูลผู้ใช้'), 404);
  }

  return c.json(
    ok(reqId, {
      profile,
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

  // profiles ไม่ให้ authenticated UPDATE ตารางตรงอีกแล้ว (20260915100000) เพื่อป้องกัน
  // ผู้ใช้ข้าม Worker ไปแก้ status/department ของตนเองผ่าน PostgREST
  const beforeProfile = await supabase.rpc('my_profile');
  const auditBefore = Array.isArray(beforeProfile.data) ? beforeProfile.data[0] : beforeProfile.data;

  const { data: updatedRows, error } = await supabase.rpc('update_my_profile', {
    full_name_input: body.fullName,
    phone_input: body.phone || null,
  });

  if (error) {
    return c.json(fail(reqId, 'PROFILE_UPDATE_FAILED', 'บันทึกข้อมูลไม่สำเร็จ'), 400);
  }

  const data = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;

  await writeAuditLog(c.env, {
    actorId: userId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'profile',
    targetTable: 'profiles',
    targetId: userId,
    requestId: reqId,
    before: auditBefore,
    after: data,
  });

  return c.json(ok(reqId, data));
});

/**
 * บันทึกความพยายาม Login (Frontend เรียกหลัง signInWithPassword ไม่ว่าสำเร็จหรือไม่)
 *
 * Login Log ใช้เป็นหลักฐานตรวจสอบย้อนหลัง จึงห้ามเชื่อคำกล่าวอ้างของ Client:
 *  - success = true  ต้องแนบ JWT ที่ใช้ได้จริงมาด้วย และระบบจะบันทึก "อีเมลจาก JWT" เท่านั้น
 *               (ไม่ใช้ค่า email ที่ Client ส่งมา) มิฉะนั้นใครก็ปลอมว่าอีเมลใดล็อกอินสำเร็จได้
 *  - success = false ยังไม่มี Session จึงยอมให้เรียกโดยไม่ต้อง Login แต่บันทึกเป็น
 *               "ความพยายามที่ Client รายงาน" เท่านั้น (user_id เป็น null เสมอ)
 * ทั้งสองกรณีจำกัดด้วย Rate Limit ต่อ IP (edge + isolate)
 */
authRoute.post(
  '/login-log',
  edgeRateLimit({ keyFn: (c) => `login-log:${clientIp(c)}` }),
  rateLimit({ windowMs: 60_000, max: 10, keyFn: (c) => `login-log:${clientIp(c)}` }),
  zValidator('json', loginLogSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const body = c.req.valid('json');

    const authHeader = c.req.header('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';

    let verifiedUserId: string | null = null;
    let verifiedEmail: string | null = null;
    if (token) {
      const supabase = createUserScopedClient(c.env, token);
      const { data } = await supabase.auth.getUser(token);
      verifiedUserId = data.user?.id ?? null;
      verifiedEmail = data.user?.email ?? null;
    }

    if (body.success && !verifiedUserId) {
      return c.json(fail(reqId, 'SESSION_REQUIRED', 'ต้องมี Session ที่ใช้งานได้จึงจะบันทึกการเข้าสู่ระบบสำเร็จได้'), 401);
    }

    await writeLoginLog(c.env, {
      userId: body.success ? verifiedUserId : null,
      emailAttempted: body.success ? (verifiedEmail ?? body.email) : body.email,
      success: body.success,
      failureReason: body.success ? null : body.failureReason,
      mfaUsed: body.mfaUsed,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
    });

    return c.json(ok(reqId, { recorded: true }));
  },
);
