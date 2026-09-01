import type { Context, MiddlewareHandler } from 'hono';
import { createUserScopedClient } from '../lib/supabase';
import { loadMfaPolicy } from '../services/mfaPolicy';
import type { AppEnv } from '../types';
import { jwtAuthenticatorAssuranceLevel } from '../utils/jwt';
import { fail } from '../utils/response';

type AuthenticationResult =
  | { ok: true; aal: string | null; hasVerifiedMfa: boolean }
  | { ok: false; response: Response };

/** Validate the Supabase session and active profile, without applying the MFA policy yet. */
async function authenticateRequest(c: Context<AppEnv>): Promise<AuthenticationResult> {
  const authHeader = c.req.header('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';

  if (!token) {
    return { ok: false, response: c.json(fail(c.get('requestId'), 'SESSION_REQUIRED', 'กรุณาเข้าสู่ระบบ'), 401) };
  }

  const supabase = createUserScopedClient(c.env, token);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { ok: false, response: c.json(fail(c.get('requestId'), 'SESSION_REQUIRED', 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่'), 401) };
  }

  // JWT ที่ออกไปแล้วอาจยังใช้ได้จนหมดอายุ แม้ Admin จะปิดบัญชีหรือเพิกถอน refresh token
  // จึงต้องตรวจสถานะจากฐานข้อมูลทุก request เพื่อให้การ deactivate มีผลทันที
  const { data: profiles, error: profileError } = await supabase.rpc('my_profile');
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  if (profileError || !profile) {
    return { ok: false, response: c.json(fail(c.get('requestId'), 'PROFILE_NOT_FOUND', 'ไม่พบข้อมูลผู้ใช้ที่ใช้งานได้'), 403) };
  }
  if (profile.status !== 'active') {
    return { ok: false, response: c.json(fail(c.get('requestId'), 'ACCOUNT_INACTIVE', 'บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ'), 403) };
  }

  const aal = jwtAuthenticatorAssuranceLevel(token);
  const hasVerifiedMfa = data.user.factors?.some((factor) => factor.status === 'verified') ?? false;
  c.set('supabase', supabase);
  c.set('userId', data.user.id);
  c.set('userEmail', data.user.email ?? '');
  c.set('authAal', aal);
  c.set('hasVerifiedMfa', hasVerifiedMfa);

  return { ok: true, aal, hasVerifiedMfa };
}

/**
 * Session-only middleware for the MFA bootstrap endpoint. It is deliberately not suitable
 * for business routes, because a privileged AAL1 session is allowed through for enrollment.
 */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authentication = await authenticateRequest(c);
  if (!authentication.ok) return authentication.response;
  await next();
};

/** ตรวจ Supabase JWT + บังคับ MFA ตาม role/permission จริงก่อนเปิด protected API */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authentication = await authenticateRequest(c);
  if (!authentication.ok) return authentication.response;

  if (authentication.aal !== 'aal2') {
    let policy;
    try {
      policy = await loadMfaPolicy(c.get('supabase'), authentication.hasVerifiedMfa);
    } catch {
      // A policy lookup outage must not downgrade a privileged account to AAL1.
      return c.json(fail(c.get('requestId'), 'MFA_POLICY_UNAVAILABLE', 'ตรวจสอบนโยบาย MFA ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 503);
    }
    if (policy.required) {
      const message = authentication.hasVerifiedMfa
        ? 'กรุณายืนยันรหัส MFA เพื่อเข้าสู่ระบบต่อ'
        : 'บัญชีนี้ต้องตั้งค่า MFA ก่อนใช้งานระบบ กรุณาดำเนินการยืนยันตัวตนสองขั้นตอน';
      return c.json(fail(c.get('requestId'), 'MFA_REQUIRED', message), 403);
    }
  }

  await next();
};
