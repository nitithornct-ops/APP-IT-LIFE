import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient, createUserScopedClient } from '../lib/supabase';
import { requireAuth, requireSession } from '../middleware/auth';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { writeLoginLog } from '../services/loginLogService';
import { loadMfaPolicy } from '../services/mfaPolicy';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { jwtAuthenticatorAssuranceLevel } from '../utils/jwt';
import { zodValidationHook } from '../utils/validation';
import { loginLogSchema, resolveLoginSchema, setOnboardingStateSchema, updateOwnProfileSchema } from '../validators/auth';

/**
 * อีเมลปลอมคงที่ที่คืนให้เมื่อค้นหาตัวระบุที่ผู้ใช้พิมพ์แล้วไม่พบบัญชี — ไม่มีทางตรงกับบัญชีจริง
 * เพราะ .invalid เป็น TLD สงวนตาม RFC 2606 ที่จดโดเมนจริงไม่ได้
 */
const UNRESOLVED_LOGIN_EMAIL = 'no-such-account@no-email.invalid';

export const authRoute = new Hono<AppEnv>();

/**
 * MFA bootstrap is the only authenticated endpoint intentionally available at AAL1. The
 * browser uses it to learn that a newly privileged account must enroll before /auth/me and
 * every business API are unlocked.
 */
authRoute.get('/mfa-policy', requireSession, async (c) => {
  try {
    const policy = await loadMfaPolicy(c.get('supabase'), c.get('hasVerifiedMfa'), c.get('mfaEnabled'));
    return c.json(ok(c.get('requestId'), {
      ...policy,
      enrolled: c.get('hasVerifiedMfa'),
      currentLevel: c.get('authAal'),
      needsEnrollment: policy.required && !c.get('hasVerifiedMfa'),
    }));
  } catch {
    return c.json(fail(c.get('requestId'), 'MFA_POLICY_UNAVAILABLE', 'ตรวจสอบนโยบาย MFA ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 503);
  }
});

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

/**
 * ปิดคำแนะนำเริ่มต้นของตนเอง (design handoff 3k การ์ด "เริ่มใช้ครั้งแรก")
 *
 * เขียนผ่าน RPC เพราะ authenticated ไม่มีสิทธิ์ UPDATE ตาราง profiles ตรง ๆ แล้ว และ RPC ล็อกไว้ที่
 * auth.uid() จึงไม่ต้องรับ user id จาก client ให้มีทางปิด onboarding ให้คนอื่น
 */
authRoute.post('/onboarding', requireAuth, zValidator('json', setOnboardingStateSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { dismissed } = c.req.valid('json');

  const { data, error } = await supabase.rpc('set_my_onboarding_state', { dismissed_input: dismissed });
  if (error) return dbFailJson(c, 'ONBOARDING_STATE_FAILED', error, 'บันทึกสถานะคำแนะนำเริ่มต้นไม่สำเร็จ');

  const row = Array.isArray(data) ? data[0] : data;
  return c.json(ok(reqId, row ?? { onboarding_completed_at: null, onboarding_dismissed_at: null }));
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
 * แปลงสิ่งที่ผู้ใช้พิมพ์ในช่อง login (อีเมล หรือ ชื่อผู้ใช้) เป็นอีเมลที่ Supabase Auth รู้จัก
 *
 * จำเป็นเพราะ Supabase Auth รับตัวระบุได้แค่ email/phone ไม่มี username ส่วนบัญชีที่ผู้ดูแลสร้างให้
 * พนักงานที่ไม่มีอีเมลองค์กรนั้นถูกผูกไว้กับอีเมลปลอมที่ผู้ใช้ไม่เคยรู้ค่า จึงต้องถามฝั่ง Server ก่อนเสมอ
 * หน้า Login ยังเรียก signInWithPassword ตรงไปที่ Supabase เหมือนเดิม (ตามสถาปัตยกรรมใน
 * docs/architecture.md) — endpoint นี้เพิ่มแค่การ "ค้นหา" ไว้ข้างหน้า ไม่ได้ย้ายการตรวจรหัสผ่านมาที่ Worker
 *
 * กติกาที่ห้ามแก้:
 *  - คืน 200 รูปแบบเดียวเสมอ ไม่ว่าจะพบบัญชีหรือไม่ ถ้าไม่พบให้คืนอีเมลปลอมคงที่ เพื่อให้ signInWithPassword
 *    ที่ตามมาล้มด้วยข้อความเดียวกันทั้งกรณี "ไม่มีบัญชีนี้" และ "รหัสผ่านผิด" — ไม่มีสัญญาณให้ไล่เดาว่า
 *    ชื่อผู้ใช้ใดมีอยู่จริง (การคืน 404 หรือข้อความต่างกันจะทำให้ endpoint นี้กลายเป็นเครื่องมือรวบรวมรายชื่อ
 *    บัญชีของทั้งองค์กรให้คนที่ยังไม่ได้ login)
 *  - ต้องเรียก RPC ทุกครั้ง ห้าม return ก่อนคิวรีเมื่อเดาได้ว่าไม่พบ มิฉะนั้นเวลาตอบที่ต่างกันจะบอกได้เองว่า
 *    บัญชีมีจริงหรือไม่
 *  - ค้นผ่าน resolve_login_email() ซึ่งเทียบด้วย = แบบ parameterized เท่านั้น ห้ามเปลี่ยนไปต่อสตริง
 *    ตัวกรองของ PostgREST (.or()/.ilike()) กับค่าที่ผู้ใช้พิมพ์เอง เพราะ % และ , เป็นไวลด์การ์ด/ไวยากรณ์
 *    ตัวกรอง ผู้ไม่หวังดีส่ง "%" เข้ามาจะได้อีเมลจริงของผู้ใช้คนอื่นกลับไป (บั๊กชนิดเดียวกับที่ utils/search.ts แก้ไว้)
 *  - ตั้งใจไม่ใส่ edgeRateLimit ต่างจาก /login-log ด้านล่าง เพราะ binding PUBLIC_RATE_LIMITER ถูกล็อกไว้ที่
 *    10 ครั้ง/60 วินาทีต่อ key และ endpoint นี้อยู่บนเส้นทางหลักของการเข้าสู่ระบบ สำนักงานที่ออกอินเทอร์เน็ต
 *    ด้วย IP เดียวกันจะมีคน login เกิน 10 คนต่อนาทีในช่วงเช้าได้ง่าย ซึ่งจะกลายเป็น "เข้าระบบไม่ได้ทั้งสำนักงาน"
 *    การจำกัดระดับ isolate ที่ 60 ครั้ง/นาที/IP จึงพอสำหรับกันสคริปต์ยิงรัว ส่วนการกัน brute force ตัวจริง
 *    ยังเป็นหน้าที่ของ Supabase Auth ที่ปลายทาง
 */
authRoute.post(
  '/resolve-login',
  rateLimit({ windowMs: 60_000, max: 60, keyFn: (c) => `resolve-login:${clientIp(c)}` }),
  zValidator('json', resolveLoginSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { identifier } = c.req.valid('json');

    const { data, error } = await createAdminClient(c.env).rpc('resolve_login_email', {
      identifier_input: identifier,
    });

    if (error) {
      return c.json(fail(reqId, 'LOGIN_RESOLVE_FAILED', 'ตรวจสอบข้อมูลเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 503);
    }

    return c.json(ok(reqId, { email: typeof data === 'string' && data ? data : UNRESOLVED_LOGIN_EMAIL }));
  },
);

/**
 * บันทึกความพยายาม Login (Frontend เรียกหลัง signInWithPassword ไม่ว่าสำเร็จหรือไม่)
 *
 * Login Log ใช้เป็นหลักฐานตรวจสอบย้อนหลัง จึงห้ามเชื่อคำกล่าวอ้างของ Client:
 *  - success = true  ต้องแนบ JWT ที่ใช้ได้จริงมาด้วย และระบบจะบันทึก "อีเมลจาก JWT" เท่านั้น
 *               (ไม่ใช้ค่า identifier ที่ Client ส่งมา) มิฉะนั้นใครก็ปลอมว่าอีเมลใดล็อกอินสำเร็จได้
 *  - success = false ยังไม่มี Session จึงยอมให้เรียกโดยไม่ต้อง Login แต่บันทึกเป็น
 *               "ความพยายามที่ Client รายงาน" เท่านั้น (user_id เป็น null เสมอ) และค่าที่บันทึกคือสิ่งที่
 *               ผู้ใช้พิมพ์จริง ซึ่งเป็นชื่อผู้ใช้ก็ได้ ไม่ใช่อีเมลเสมอไป
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
    let verifiedMfaUsed = false;
    let verifiedUserHasMfa = false;
    let verifiedMfaPolicyRequired = false;
    let mfaPolicyLookupFailed = false;
    if (token) {
      const supabase = createUserScopedClient(c.env, token);
      const { data } = await supabase.auth.getUser(token);
      verifiedUserId = data.user?.id ?? null;
      verifiedEmail = data.user?.email ?? null;
      verifiedMfaUsed = Boolean(data.user) && jwtAuthenticatorAssuranceLevel(token) === 'aal2';
      verifiedUserHasMfa = data.user?.factors?.some((factor) => factor.status === 'verified') ?? false;
      if (data.user && !verifiedMfaUsed) {
        try {
          verifiedMfaPolicyRequired = (await loadMfaPolicy(supabase, verifiedUserHasMfa)).required;
        } catch {
          mfaPolicyLookupFailed = true;
        }
      }
    }

    if (body.success && !verifiedUserId) {
      return c.json(fail(reqId, 'SESSION_REQUIRED', 'ต้องมี Session ที่ใช้งานได้จึงจะบันทึกการเข้าสู่ระบบสำเร็จได้'), 401);
    }
    if (body.success && mfaPolicyLookupFailed) {
      return c.json(fail(reqId, 'MFA_POLICY_UNAVAILABLE', 'ตรวจสอบนโยบาย MFA ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 503);
    }
    if (body.success && verifiedMfaPolicyRequired && !verifiedMfaUsed) {
      const message = verifiedUserHasMfa
        ? 'กรุณายืนยันรหัส MFA ก่อนบันทึกการเข้าสู่ระบบสำเร็จ'
        : 'บัญชีนี้ต้องตั้งค่า MFA ก่อนบันทึกการเข้าสู่ระบบสำเร็จ';
      return c.json(fail(reqId, 'MFA_REQUIRED', message), 403);
    }

    await writeLoginLog(c.env, {
      userId: body.success ? verifiedUserId : null,
      emailAttempted: body.success ? (verifiedEmail ?? body.identifier) : body.identifier,
      success: body.success,
      failureReason: body.success ? null : body.failureReason,
      mfaUsed: verifiedMfaUsed,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
    });

    return c.json(ok(reqId, { recorded: true }));
  },
);
