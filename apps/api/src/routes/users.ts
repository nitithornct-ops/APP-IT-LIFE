import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { isMfaMandatoryForUser } from '../services/mfaPolicy';
import { sendNotification } from '../services/notificationService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { applySort } from '../utils/sort';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  assignRoleSchema,
  createLocalUserSchema,
  inviteUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateMfaSchema,
  updateUserSchema,
} from '../validators/users';

export const usersRoute = new Hono<AppEnv>();

usersRoute.use('*', requireAuth);

const USER_SORT_COLUMNS = ['full_name', 'email', 'username', 'employee_code', 'status', 'created_at'] as const;

/**
 * บัญชีที่ไม่มีอีเมลจริงถูกผูกไว้กับอีเมลปลอมโดเมนนี้ (ดู migration 20261013100000) — ใช้เฉพาะเป็น
 * ตัวระบุภายในของ Supabase Auth เท่านั้น ห้ามนำไปแสดงหรือใช้ติดต่อ
 */
const LOCAL_ACCOUNT_EMAIL_DOMAIN = 'no-email.invalid';

usersRoute.get('/', requirePermission('user.manage'), zValidator('query', listUsersQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, sort, order, search } = c.req.valid('query');

  // ใช้ Admin Client เพราะหน้าจัดการผู้ใช้ต้องเห็น phone ซึ่งถูกตัดออกจาก GRANT ของ authenticated
  // (ดู 20260908100000_tighten_directory_access.sql) — สิทธิ์ถูกตรวจด้วย user.manage ที่ middleware แล้ว
  let query = createAdminClient(c.env)
    .from('profiles')
    .select(
      'id, employee_code, full_name, email, username, phone, department_id, position_id, supervisor_id, status, mfa_enabled, created_at',
      { count: 'exact' },
    )
    .range(...paginationRange(page, pageSize));
  query = applySort(query, { sort, order }, USER_SORT_COLUMNS, { column: 'created_at', ascending: false });

  const safeSearch = search ? cleanSearch(search) : '';
  if (safeSearch) {
    query = query.or(`full_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,username.ilike.%${safeSearch}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return c.json(fail(reqId, 'USERS_LIST_FAILED', 'ดึงรายชื่อผู้ใช้ไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});

usersRoute.patch('/:id/mfa', requirePermission('user.manage'), zValidator('json', updateMfaSchema, zodValidationHook), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const targetId = c.req.param('id')!;
  const { enabled } = c.req.valid('json');

  if (!enabled && targetId === actorId) {
    return c.json(fail(reqId, 'USER_MFA_SELF_DISABLE_FORBIDDEN', 'ไม่สามารถปิด 2FA ของบัญชีที่กำลังใช้งานอยู่ได้'), 409);
  }

  const auditBefore = await loadAuditSnapshot(admin, 'profiles', targetId);
  if (!auditBefore) {
    return c.json(fail(reqId, 'USER_NOT_FOUND', 'ไม่พบผู้ใช้งานที่ระบุ'), 404);
  }

  if (!enabled) {
    try {
      if (await isMfaMandatoryForUser(c.env, targetId)) {
        return c.json(fail(reqId, 'USER_MFA_REQUIRED_BY_POLICY', 'บัญชีนี้ถูกบังคับใช้ 2FA จากบทบาทหรือสิทธิ์ จึงปิดไม่ได้'), 409);
      }
    } catch {
      return c.json(fail(reqId, 'USER_MFA_POLICY_LOOKUP_FAILED', 'ตรวจสอบนโยบาย 2FA ของผู้ใช้งานไม่สำเร็จ กรุณาลองใหม่'), 503);
    }
  }

  let removedFactorCount = 0;
  if (!enabled) {
    const { data: factorData, error: factorListError } = await admin.auth.admin.mfa.listFactors({ userId: targetId });
    if (factorListError) {
      return dbFailJson(c, 'USER_MFA_FACTORS_LOAD_FAILED', factorListError, 'โหลดอุปกรณ์ 2FA ของผู้ใช้งานไม่สำเร็จ');
    }

    for (const factor of factorData?.factors ?? []) {
      const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ userId: targetId, id: factor.id });
      if (deleteError) {
        // Keep the profile flag enabled when factor cleanup is incomplete. This fails closed:
        // the user must enroll again instead of silently losing MFA protection.
        return dbFailJson(c, 'USER_MFA_FACTOR_DELETE_FAILED', deleteError, 'ปิด 2FA ไม่สำเร็จ อุปกรณ์ยืนยันตัวตนบางรายการยังถูกเก็บไว้');
      }
      removedFactorCount += 1;
    }
  }

  const { data: updated, error: updateError } = await admin
    .from('profiles')
    .update({ mfa_enabled: enabled, updated_by: actorId })
    .eq('id', targetId)
    .select('*')
    .maybeSingle();

  if (updateError || !updated) {
    return dbFailJson(c, 'USER_MFA_UPDATE_FAILED', updateError, 'บันทึกสถานะ 2FA ของผู้ใช้งานไม่สำเร็จ');
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: enabled ? 'ENABLE_MFA' : 'DISABLE_MFA',
    module: 'user',
    targetTable: 'profiles',
    targetId,
    detail: { enabled, removedFactorCount },
    requestId: reqId,
    before: auditBefore,
    after: updated,
  });

  return c.json(ok(reqId, { id: targetId, enabled: updated.mfa_enabled, removedFactorCount }));
});

/**
 * เชิญผู้ใช้ใหม่ผ่าน Supabase Auth Admin API (ต้องใช้ Service Role — ไม่มี RLS เทียบเท่าสำหรับ
 * การสร้างบัญชี Auth) ระบบส่งอีเมลเชิญให้ผู้ใช้ตั้งรหัสผ่านเอง ตรงตามสเปก "ปิด Public Sign-up +
 * ผู้ดูแลระบบเป็นผู้เชิญ" — handle_new_user() trigger (Phase 2) จะสร้างแถว profiles ให้อัตโนมัติ
 */
usersRoute.post('/invite', requirePermission('user.manage'), zValidator('json', inviteUserSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(body.email, {
    data: { full_name: body.fullName },
  });

  if (inviteError || !invited.user) {
    return dbFailJson(c, 'USER_INVITE_FAILED', inviteError, 'เชิญผู้ใช้ไม่สำเร็จ');
  }

  const supabase = createAdminClient(c.env);
  let profileWarning: string | null = null;

  if (body.employeeCode || body.departmentId || body.positionId) {
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        employee_code: body.employeeCode ?? null,
        department_id: body.departmentId ?? null,
        position_id: body.positionId ?? null,
        updated_by: actorId,
      })
      .eq('id', invited.user.id);

    if (updateError) {
      profileWarning = 'เชิญผู้ใช้สำเร็จ แต่บันทึกหน่วยงาน/ตำแหน่งเพิ่มเติมไม่สำเร็จ กรุณาแก้ไขภายหลัง';
    }
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'user',
    targetTable: 'profiles',
    targetId: invited.user.id,
    detail: { email: body.email },
    requestId: reqId,
  });

  return c.json(ok(reqId, { id: invited.user.id, email: body.email, warning: profileWarning }), 201);
});

/**
 * สร้างบัญชีให้ผู้ใช้ที่ไม่มีอีเมลองค์กร — login ด้วย username/password โดยตรง
 *
 * ใช้ createUser() แทน inviteUserByEmail() เพราะไม่มีกล่องจดหมายให้ส่งลิงก์เชิญไปตั้งรหัสผ่านเอง
 * ผู้ดูแลจึงตั้งรหัสผ่านเริ่มต้นให้ในฟอร์มแล้วแจ้งผู้ใช้ด้วยช่องทางอื่น ส่วน email_confirm: true เป็นการ
 * ยืนยันอีเมลของบัญชีนี้บัญชีเดียวผ่าน Admin API ไม่ได้ไปปิดการยืนยันอีเมลระดับโปรเจกต์
 * (scripts/check-runtime-gate.mjs ยังบังคับให้ mailer_autoconfirm ปิดอยู่ตามเดิม)
 *
 * username ถูกส่งไปกับ user_metadata เพื่อให้ trigger handle_new_user() เขียนลง profiles ในทรานแซกชัน
 * เดียวกับที่บัญชีเกิด — ถ้าแยกไปเขียนทีหลังแล้วล้ม จะได้บัญชีที่ login ไม่ได้เลย เพราะไม่มีทั้ง username
 * ให้ค้นและอีเมลที่ผู้ใช้รู้ค่า และการเขียนพร้อมกันยังให้ unique index ปฏิเสธชื่อซ้ำได้ตั้งแต่ต้น
 */
usersRoute.post('/local', requirePermission('user.manage'), zValidator('json', createLocalUserSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: `${body.username}@${LOCAL_ACCOUNT_EMAIL_DOMAIN}`,
    password: body.password,
    email_confirm: true,
    user_metadata: { full_name: body.fullName, username: body.username },
  });

  if (createError || !created.user) {
    // ชื่อผู้ใช้ซ้ำมาถึงตรงนี้ในรูปของ unique violation ที่ trigger โยนออกมา (อีเมลปลอมก็ซ้ำด้วยเช่นกัน)
    const duplicate = /duplicate key|already (been )?registered|profiles_username_unique_idx/i.test(createError?.message ?? '');
    if (duplicate) {
      return c.json(fail(reqId, 'USERNAME_TAKEN', 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น'), 409);
    }
    return dbFailJson(c, 'USER_LOCAL_CREATE_FAILED', createError, 'สร้างบัญชีผู้ใช้ไม่สำเร็จ');
  }

  let profileWarning: string | null = null;

  if (body.employeeCode || body.departmentId || body.positionId) {
    const { error: updateError } = await admin
      .from('profiles')
      .update({
        employee_code: body.employeeCode ?? null,
        department_id: body.departmentId ?? null,
        position_id: body.positionId ?? null,
        updated_by: actorId,
      })
      .eq('id', created.user.id);

    // ไม่ลบบัญชีที่สร้างสำเร็จแล้วทิ้งเมื่อข้อมูลประกอบล้ม — บัญชีใช้งานได้จริงแล้ว (login ได้ มีสิทธิ์ได้)
    // และ profiles(id) มีตารางอื่น cascade ตามอยู่จำนวนมาก จึงไม่ควรมี code path ใดลบบัญชีอัตโนมัติ
    if (updateError) {
      profileWarning = 'สร้างบัญชีสำเร็จ แต่บันทึกหน่วยงาน/ตำแหน่งเพิ่มเติมไม่สำเร็จ กรุณาแก้ไขภายหลัง';
    }
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'user',
    targetTable: 'profiles',
    targetId: created.user.id,
    detail: { username: body.username, mode: 'local' },
    requestId: reqId,
  });

  return c.json(ok(reqId, { id: created.user.id, username: body.username, warning: profileWarning }), 201);
});

/**
 * ผู้ดูแลตั้งรหัสผ่านใหม่ให้ผู้ใช้
 *
 * จำเป็นสำหรับบัญชีแบบ username เพราะ "ลืมรหัสผ่าน" ทางอีเมลใช้ไม่ได้ (อีเมลที่ผูกไว้ส่งไม่ถึงจริง)
 * และใช้กับบัญชีอีเมลได้ด้วยในกรณีที่ผู้ใช้เข้าถึงกล่องจดหมายของตนเองไม่ได้
 */
usersRoute.post('/:id/reset-password', requirePermission('user.manage'), zValidator('json', resetPasswordSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const targetId = c.req.param('id')!;
  const { password } = c.req.valid('json');

  const { error } = await createAdminClient(c.env).auth.admin.updateUserById(targetId, { password });

  if (error) {
    return dbFailJson(c, 'USER_PASSWORD_RESET_FAILED', error, 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ');
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'RESET_PASSWORD',
    module: 'user',
    targetTable: 'profiles',
    targetId,
    requestId: reqId,
  });

  await sendNotification(c.env, {
    recipientId: targetId,
    type: 'account_security',
    title: 'รหัสผ่านของท่านถูกตั้งใหม่',
    body: 'ผู้ดูแลระบบตั้งรหัสผ่านใหม่ให้บัญชีของท่าน หากท่านไม่ได้ร้องขอ กรุณาแจ้งผู้ดูแลระบบทันที',
  });

  return c.json(ok(reqId, { reset: true }));
});

usersRoute.patch('/:id', requirePermission('user.manage'), zValidator('json', updateUserSchema, zodValidationHook), async (c) => {
  const supabase = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const targetId = c.req.param('id')!;
  const body = c.req.valid('json');

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.fullName !== undefined) patch.full_name = body.fullName;
  if (body.phone !== undefined) patch.phone = body.phone;
  if (body.username !== undefined) patch.username = body.username;
  if (body.employeeCode !== undefined) patch.employee_code = body.employeeCode;
  if (body.departmentId !== undefined) patch.department_id = body.departmentId;
  if (body.positionId !== undefined) patch.position_id = body.positionId;
  if (body.supervisorId !== undefined) patch.supervisor_id = body.supervisorId;
  if (body.status !== undefined) patch.status = body.status;

  // profiles ปิด UPDATE ของ authenticated แล้ว (20260915100000) จึงเขียนด้วย Admin client
  // หลัง requirePermission('user.manage') ตรวจสิทธิ์เรียบร้อย และบันทึก audit ทุกครั้ง
  const auditBefore = await loadAuditSnapshot(supabase, 'profiles', targetId);

  if (!auditBefore) {
    return c.json(fail(reqId, 'USER_NOT_FOUND', 'ไม่พบผู้ใช้ที่ระบุ'), 404);
  }

  if (body.status !== undefined && body.status !== auditBefore.status) {
    const { error: authStatusError } = await supabase.auth.admin.updateUserById(targetId, {
      // Supabase ใช้ "none" สำหรับยกเลิกการ ban; 100 ปีใช้แทนการระงับแบบไม่มีกำหนด
      ban_duration: body.status === 'inactive' ? '876000h' : 'none',
    });
    if (authStatusError) {
      return c.json(fail(reqId, 'USER_AUTH_STATUS_UPDATE_FAILED', 'ปรับสถานะบัญชีเข้าสู่ระบบไม่สำเร็จ'), 502);
    }
  }

  const { error } = await supabase.from('profiles').update(patch).eq('id', targetId);

  if (error) {
    if (body.status !== undefined && body.status !== auditBefore.status) {
      // คืนสถานะ Auth แบบ best effort หาก profile update ล้ม เพื่อไม่ให้สองระบบค้างคนละสถานะ
      const rollback = await supabase.auth.admin.updateUserById(targetId, {
        ban_duration: auditBefore.status === 'inactive' ? '876000h' : 'none',
      });
      if (rollback.error) {
        console.error(JSON.stringify({ requestId: reqId, code: 'USER_AUTH_STATUS_ROLLBACK_FAILED', targetId }));
      }
    }
    if (error.code === '23505') {
      return c.json(fail(reqId, 'USERNAME_TAKEN', 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น'), 409);
    }
    return c.json(fail(reqId, 'USER_UPDATE_FAILED', 'บันทึกข้อมูลผู้ใช้ไม่สำเร็จ'), 400);
  }

  const { data } = await supabase
    .from('profiles')
    .select('id, employee_code, full_name, email, username, phone, department_id, position_id, supervisor_id, status, mfa_enabled, created_at')
    .eq('id', targetId)
    .maybeSingle();

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'user',
    targetTable: 'profiles',
    targetId,
    detail: body,
    requestId: reqId,
    before: auditBefore,
    after: data,
  });

  return c.json(ok(reqId, data));
});

usersRoute.get('/:id/roles', requireAnyPermission(['role.view', 'role.manage']), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const targetId = c.req.param('id');

  const { data, error } = await supabase
    .from('user_roles')
    .select('id, role_id, assigned_at, roles(key, name_th, name_en)')
    .eq('user_id', targetId);

  if (error) {
    return c.json(fail(reqId, 'USER_ROLES_LOAD_FAILED', 'โหลดบทบาทผู้ใช้ไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, data));
});

usersRoute.post('/:id/roles', requirePermission('role.manage'), zValidator('json', assignRoleSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  // requirePermission()'s MiddlewareHandler<AppEnv> ไม่มี path generic ผูกกับ '/:id/roles' ทำให้
  // TypeScript อนุมาน c.req.param('id') เป็น string | undefined แม้ Hono จะรับประกันว่ามีค่าจริง
  // เสมอเมื่อ handler นี้ถูกเรียก (route match แล้ว) — assert เป็น string ตรงนี้แทน
  const targetId = c.req.param('id')!;
  const { roleId } = c.req.valid('json');

  const { error } = await supabase.from('user_roles').insert({ user_id: targetId, role_id: roleId, assigned_by: actorId });

  if (error) {
    return dbFailJson(c, 'ROLE_ASSIGN_FAILED', error);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'ASSIGN_ROLE',
    module: 'role',
    targetTable: 'user_roles',
    targetId,
    detail: { roleId },
    requestId: reqId,
  });

  await sendNotification(c.env, {
    recipientId: targetId,
    type: 'role_changed',
    title: 'บทบาทของท่านมีการเปลี่ยนแปลง',
    body: 'ท่านได้รับมอบหมายบทบาทใหม่ กรุณาเข้าสู่ระบบใหม่หากเมนูยังไม่อัปเดต',
  });

  return c.json(ok(reqId, { assigned: true }), 201);
});

/** การลบบทบาทสุดท้ายของ super_admin ถูกปฏิเสธที่ระดับ Database เสมอ (last-admin guard, Phase 2) */
usersRoute.delete('/:id/roles/:roleId', requirePermission('role.manage'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const targetId = c.req.param('id')!; // ดูคำอธิบายที่ POST /:id/roles ด้านบน
  const roleId = c.req.param('roleId');

  const { error } = await supabase.from('user_roles').delete().eq('user_id', targetId).eq('role_id', roleId);

  if (error) {
    return dbFailJson(c, 'ROLE_REMOVE_FAILED', error);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'REMOVE_ROLE',
    module: 'role',
    targetTable: 'user_roles',
    targetId,
    detail: { roleId },
    requestId: reqId,
  });

  await sendNotification(c.env, {
    recipientId: targetId,
    type: 'role_changed',
    title: 'บทบาทของท่านมีการเปลี่ยนแปลง',
    body: 'บทบาทหนึ่งของท่านถูกถอดถอน กรุณาเข้าสู่ระบบใหม่หากเมนูยังไม่อัปเดต',
  });

  return c.json(ok(reqId, { removed: true }));
});
