import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { applySort } from '../utils/sort';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import { assignRoleSchema, inviteUserSchema, listUsersQuerySchema, updateUserSchema } from '../validators/users';

export const usersRoute = new Hono<AppEnv>();

usersRoute.use('*', requireAuth);

const USER_SORT_COLUMNS = ['full_name', 'email', 'employee_code', 'status', 'created_at'] as const;

usersRoute.get('/', requirePermission('user.manage'), zValidator('query', listUsersQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, sort, order, search } = c.req.valid('query');

  // ใช้ Admin Client เพราะหน้าจัดการผู้ใช้ต้องเห็น phone ซึ่งถูกตัดออกจาก GRANT ของ authenticated
  // (ดู 20260908100000_tighten_directory_access.sql) — สิทธิ์ถูกตรวจด้วย user.manage ที่ middleware แล้ว
  let query = createAdminClient(c.env)
    .from('profiles')
    .select(
      'id, employee_code, full_name, email, phone, department_id, position_id, supervisor_id, status, created_at',
      { count: 'exact' },
    )
    .range(...paginationRange(page, pageSize));
  query = applySort(query, { sort, order }, USER_SORT_COLUMNS, { column: 'created_at', ascending: false });

  const safeSearch = search ? cleanSearch(search) : '';
  if (safeSearch) {
    query = query.or(`full_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return c.json(fail(reqId, 'USERS_LIST_FAILED', 'ดึงรายชื่อผู้ใช้ไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
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

usersRoute.patch('/:id', requirePermission('user.manage'), zValidator('json', updateUserSchema, zodValidationHook), async (c) => {
  const supabase = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const targetId = c.req.param('id')!;
  const body = c.req.valid('json');

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.fullName !== undefined) patch.full_name = body.fullName;
  if (body.phone !== undefined) patch.phone = body.phone;
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
    return c.json(fail(reqId, 'USER_UPDATE_FAILED', 'บันทึกข้อมูลผู้ใช้ไม่สำเร็จ'), 400);
  }

  const { data } = await supabase
    .from('profiles')
    .select('id, employee_code, full_name, email, phone, department_id, position_id, supervisor_id, status, created_at')
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
