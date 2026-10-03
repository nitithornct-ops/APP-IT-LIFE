import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient, createPublicAuthClient, createUserScopedClient } from '../lib/supabase';
import { requireAuth, requireSession } from '../middleware/auth';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { loadAuditSnapshot, sha256Hex, writeAuditLog } from '../services/auditService';
import { consumeLoginChallenge, issueLoginChallenge } from '../services/loginChallengeService';
import { writeLoginLog } from '../services/loginLogService';
import { loadMfaPolicy } from '../services/mfaPolicy';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { jwtAuthenticatorAssuranceLevel } from '../utils/jwt';
import { zodValidationHook } from '../utils/validation';
import {
  loginLogSchema,
  brokerLoginSchema,
  passwordResetRequestSchema,
  resolveLoginSchema,
  setOnboardingStateSchema,
  updateOwnPreferencesSchema,
  updateOwnProfileSchema,
} from '../validators/auth';

const GENERIC_LOGIN_FAILURE = 'อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง';

async function publicLoginRateLimitKey(c: Parameters<typeof clientIp>[0], prefix: string): Promise<string> {
  let identifier = '';
  try {
    const body = await c.req.raw.clone().json() as { identifier?: unknown; vendorCode?: unknown; username?: unknown };
    identifier = [body.vendorCode, body.username, body.identifier].filter((value): value is string => typeof value === 'string').join(':');
  } catch {
    // The body validator will return the appropriate error; the limiter still
    // falls back to the client context instead of disabling protection.
  }
  return `${prefix}:${clientIp(c)}:${await sha256Hex(identifier.trim().toLowerCase())}`;
}

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

/** Mark MFA as enabled only after Supabase has verified the caller's TOTP factor. */
authRoute.post('/mfa/enable', requireSession, async (c) => {
  const reqId = c.get('requestId');
  const userId = c.get('userId');

  if (c.get('authAal') !== 'aal2' || !c.get('hasVerifiedMfa')) {
    return c.json(fail(reqId, 'MFA_VERIFICATION_REQUIRED', 'กรุณายืนยันรหัส MFA ให้สำเร็จก่อนเปิดใช้งาน MFA'), 403);
  }

  const admin = createAdminClient(c.env);
  const auditBefore = await loadAuditSnapshot(admin, 'profiles', userId);
  if (!auditBefore) return c.json(fail(reqId, 'PROFILE_NOT_FOUND', 'ไม่พบข้อมูลผู้ใช้งาน'), 404);

  const { data: updated, error } = await admin
    .from('profiles')
    .update({ mfa_enabled: true, updated_by: userId })
    .eq('id', userId)
    .select('*')
    .maybeSingle();
  if (error || !updated) return dbFailJson(c, 'MFA_ENABLE_FAILED', error, 'เปิดใช้งาน MFA ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');

  if (auditBefore.mfa_enabled !== true) {
    await writeAuditLog(c.env, {
      actorId: userId,
      actorEmail: c.get('userEmail'),
      action: 'ENABLE_MFA',
      module: 'auth',
      targetTable: 'profiles',
      targetId: userId,
      detail: { source: 'self_enrollment' },
      requestId: reqId,
      before: auditBefore,
      after: updated,
    });
  }

  return c.json(ok(reqId, { enabled: updated.mfa_enabled === true }));
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

  // Department/Position are owned by Employee Master. Return the directory
  // projection separately so the profile page never treats profile columns as
  // editable employment data.
  type EmployeeDirectory = {
    id: string;
    employee_code: string;
    department_id: string | null;
    position_id: string | null;
    department: { id: string; name_th: string; name_en: string | null } | null;
    position: { id: string; name_th: string; name_en: string | null } | null;
  };
  let employeeDirectory: EmployeeDirectory | null = null;
  if (typeof profile.employee_id === 'string' && profile.employee_id) {
    const { data: employee } = await supabase
      .from('employees')
      .select('id, employee_code, department_id, position_id, department:departments(id, name_th, name_en), position:positions(id, name_th, name_en)')
      .eq('id', profile.employee_id)
      .maybeSingle();
    if (employee) {
      const row = employee as unknown as EmployeeDirectory & {
        department: EmployeeDirectory['department'][];
        position: EmployeeDirectory['position'][];
      };
      employeeDirectory = {
        ...row,
        department: row.department?.[0] ?? null,
        position: row.position?.[0] ?? null,
      };
    }
  }

  return c.json(
    ok(reqId, {
      profile,
      employeeDirectory,
      roles: rolesResult.data ?? [],
      permissions: (permissionsResult.data ?? []).map((row: { permission_key: string }) => row.permission_key),
    }),
  );
});

authRoute.patch('/preferences', requireAuth, zValidator('json', updateOwnPreferencesSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const userId = c.get('userId');
  const reqId = c.get('requestId');
  const body = c.req.valid('json');

  const { data, error } = await supabase.rpc('update_my_preferences', {
    timezone_input: body.timezone,
    preferred_language_input: body.preferredLanguage,
    notification_in_app_enabled_input: body.inAppNotifications,
  });
  if (error) return dbFailJson(c, 'PROFILE_PREFERENCES_UPDATE_FAILED', error, 'บันทึกการตั้งค่าโปรไฟล์ไม่สำเร็จ');

  const row = Array.isArray(data) ? data[0] : data;
  await writeAuditLog(c.env, {
    actorId: userId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE_PREFERENCES',
    module: 'profile',
    targetTable: 'profiles',
    targetId: userId,
    detail: body,
    requestId: reqId,
  });
  return c.json(ok(reqId, row));
});

authRoute.get('/security-activity', requireAuth, async (c) => {
  const reqId = c.get('requestId');
  const userId = c.get('userId');
  const admin = createAdminClient(c.env);

  const [loginResult, auditResult] = await Promise.all([
    admin
      .from('login_logs')
      .select('id, success, failure_reason, mfa_used, ip_address, user_agent, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8),
    admin
      .from('audit_logs')
      .select('id, action, module, result, ip_address, user_agent, created_at')
      .eq('actor_id', userId)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  if (loginResult.error || auditResult.error) {
    return c.json(fail(reqId, 'SECURITY_ACTIVITY_LOAD_FAILED', 'ดึงประวัติความปลอดภัยไม่สำเร็จ'), 400);
  }

  const loginActivities = (loginResult.data ?? []).map((row) => ({
    id: `login:${row.id}`,
    source: 'login' as const,
    action: row.success ? 'เข้าสู่ระบบสำเร็จ' : 'เข้าสู่ระบบไม่สำเร็จ',
    result: row.success ? 'success' as const : 'fail' as const,
    detail: row.mfa_used ? 'ยืนยัน MFA แล้ว' : row.failure_reason ?? null,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }));
  const auditActivities = (auditResult.data ?? []).map((row) => ({
    id: `audit:${row.id}`,
    source: 'audit' as const,
    action: row.action,
    result: row.result,
    detail: row.module,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }));

  const activities = [...loginActivities, ...auditActivities]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return c.json(ok(reqId, activities));
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

/** Record a password update after Supabase Auth has accepted it. The endpoint only
 * writes server time for the authenticated account; clients cannot provide a timestamp. */
authRoute.post('/password-change-log', requireAuth, async (c) => {
  const supabase = createAdminClient(c.env);
  const userId = c.get('userId');
  const reqId = c.get('requestId');
  const changedAt = new Date().toISOString();
  const { error } = await supabase
    .from('profiles')
    .update({ last_password_change_at: changedAt, updated_by: userId })
    .eq('id', userId);
  if (error) return dbFailJson(c, 'PASSWORD_CHANGE_LOG_FAILED', error, 'บันทึกประวัติการเปลี่ยนรหัสผ่านไม่สำเร็จ');
  await writeAuditLog(c.env, {
    actorId: userId,
    actorEmail: c.get('userEmail'),
    action: 'CHANGE_PASSWORD',
    module: 'profile',
    targetTable: 'profiles',
    targetId: userId,
    requestId: reqId,
  });
  return c.json(ok(reqId, { recorded: true, changedAt }));
});

/**
 * Issue an opaque, short-lived challenge. The browser never receives the
 * resolved Auth email; the API keeps that lookup server-side for the next step.
 */
authRoute.post(
  '/resolve-login',
  edgeRateLimit({ keyFn: (c) => publicLoginRateLimitKey(c, 'resolve-login') }),
  rateLimit({ windowMs: 60_000, max: 60, keyFn: (c) => `resolve-login:${clientIp(c)}` }),
  zValidator('json', resolveLoginSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { identifier } = c.req.valid('json');

    const admin = createAdminClient(c.env);
    const { error } = await admin.rpc('resolve_login_email', {
      identifier_input: identifier,
    });
    if (error) {
      return c.json(fail(reqId, 'LOGIN_RESOLVE_FAILED', 'ตรวจสอบข้อมูลเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 503);
    }

    try {
      const challenge = await issueLoginChallenge(admin, {
        flow: 'internal',
        identifier,
        ip: clientIp(c),
        userAgent: c.req.header('user-agent') ?? '',
      });
      c.header('Cache-Control', 'no-store');
      return c.json(ok(reqId, { challenge, expiresInSeconds: 300 }));
    } catch (challengeError) {
      const dbError = challengeError instanceof Error ? { message: challengeError.message } : null;
      return dbFailJson(c, 'LOGIN_CHALLENGE_FAILED', dbError, 'เตรียมการเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  },
);

/**
 * Secure login broker. The password crosses the API over HTTPS, is never
 * logged, and is sent only to Supabase Auth from a non-persisting public-key
 * client. A challenge is consumed before password verification, so it cannot
 * be replayed to brute-force the same identifier.
 */
authRoute.post(
  '/login',
  edgeRateLimit({ keyFn: (c) => `login:${clientIp(c)}` }),
  rateLimit({ windowMs: 60_000, max: 10, keyFn: (c) => `login:${clientIp(c)}` }),
  zValidator('json', brokerLoginSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const body = c.req.valid('json');
    const admin = createAdminClient(c.env);
    const validChallenge = await consumeLoginChallenge(admin, {
      token: body.challenge,
      flow: 'internal',
      identifier: body.identifier,
      ip: clientIp(c),
      userAgent: c.req.header('user-agent') ?? '',
    });
    if (!validChallenge) return c.json(fail(reqId, 'LOGIN_FAILED', GENERIC_LOGIN_FAILURE), 401);

    const { data: email, error: resolveError } = await admin.rpc('resolve_login_email', { identifier_input: body.identifier });
    const resolvedEmail = typeof email === 'string' && email ? email : 'no-such-account@no-email.invalid';
    if (resolveError) return c.json(fail(reqId, 'LOGIN_FAILED', GENERIC_LOGIN_FAILURE), 401);

    const { data, error } = await createPublicAuthClient(c.env).auth.signInWithPassword({
      email: resolvedEmail,
      password: body.password,
      // Supabase Auth owns CAPTCHA enforcement for sign-in. Verifying this
      // token in the Worker first would consume the one-time Turnstile token,
      // making the subsequent Auth request fail even with a valid password.
      options: { captchaToken: body.turnstileToken },
    });
    if (error || !data.session) return c.json(fail(reqId, 'LOGIN_FAILED', GENERIC_LOGIN_FAILURE), 401);

    c.header('Cache-Control', 'no-store');
    return c.json(ok(reqId, { session: data.session }));
  },
);

/** Password-reset request is brokered with rate limiting; Supabase Auth verifies Turnstile. */
authRoute.post(
  '/password-reset-request',
  edgeRateLimit({ keyFn: (c) => `password-reset:${clientIp(c)}` }),
  rateLimit({ windowMs: 15 * 60_000, max: 5, keyFn: (c) => `password-reset:${clientIp(c)}` }),
  zValidator('json', passwordResetRequestSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { email, turnstileToken } = c.req.valid('json');
    const appOrigin = c.env.PUBLIC_APP_URL?.trim() || new URL(c.req.url).origin;
    const redirectTo = new URL('/reset-password', appOrigin).toString();
    // Supabase intentionally returns a generic response for unknown addresses.
    // Do not reflect provider errors because they can become an enumeration side-channel.
    await createPublicAuthClient(c.env).auth.resetPasswordForEmail(email, { redirectTo, captchaToken: turnstileToken });
    return c.json(ok(reqId, { submitted: true }));
  },
);

/**
 * บันทึกความพยายาม Login (Frontend เรียกหลัง API login broker ไม่ว่าสำเร็จหรือไม่)
 *
 * Login Log ใช้เป็นหลักฐานตรวจสอบย้อนหลัง จึงห้ามเชื่อคำกล่าวอ้างของ Client:
 *  - success = true  ต้องแนบ JWT ที่ใช้ได้จริงมาด้วย และระบบจะบันทึก "อีเมลจาก JWT" เท่านั้น
 *               (ไม่ใช้ค่า identifier ที่ Client ส่งมา) มิฉะนั้นใครก็ปลอมว่าอีเมลใดล็อกอินสำเร็จได้
 *  - success = false ยังไม่มี Session จึงยอมให้เรียกโดยไม่ต้อง Login แต่บันทึกเป็น
 *               "ความพยายามที่ Client รายงาน" เท่านั้น (user_id เป็น null เสมอ) และค่าที่บันทึกคือสิ่งที่
 *               ผู้ใช้พิมพ์จริง ซึ่งเป็นชื่อผู้ใช้ก็ได้ ไม่ใช่อีเมลเสมอไป
 * ทั้งสองกรณีจำกัดด้วย Rate Limit ต่อ IP: ความพยายามที่ไม่สำเร็จใช้เพดานต่ำกว่า
 * ส่วน success=true ผ่าน Session แล้ว จึงรองรับการเข้าสู่ระบบพร้อมกันของสำนักงานได้มากขึ้น
 */
authRoute.post(
  '/login-log',
  zValidator('json', loginLogSchema, zodValidationHook),
  edgeRateLimit({
    keyFn: (c) => {
      const success = (c.req.valid('json' as never) as { success?: boolean }).success === true;
      return `login-log:${success ? 'success' : 'failure'}:${clientIp(c)}`;
    },
  }),
  rateLimit({
    windowMs: 60_000,
    max: (c) => (c.req.valid('json' as never) as { success?: boolean }).success ? 60 : 10,
    keyFn: (c) => {
      const success = (c.req.valid('json' as never) as { success?: boolean }).success === true;
      return `login-log:${success ? 'success' : 'failure'}:${clientIp(c)}`;
    },
  }),
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
      eventType: body.eventType ?? 'login_attempt',
      requestId: reqId,
      correlationId: reqId,
    });

    return c.json(ok(reqId, { recorded: true }));
  },
);
