import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { assignRoleSchema, inviteUserSchema, listUsersQuerySchema, updateUserSchema } from '../validators/users';

export const usersRoute = new Hono<AppEnv>();

usersRoute.use('*', requireAuth);

usersRoute.get('/', requirePermission('user.manage'), zValidator('query', listUsersQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, search } = c.req.valid('query');

  let query = supabase
    .from('profiles')
    .select(
      'id, employee_code, full_name, email, phone, department_id, position_id, status, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return c.json(fail(reqId, 'USERS_LIST_FAILED', 'ดึงรายชื่อผู้ใช้ไม่สำเร็จ'), 400);
  }

  const totalItems = count ?? 0;
  return c.json(
    ok(reqId, {
      items: data,
      pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
    }),
  );
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
    return c.json(fail(reqId, 'USER_INVITE_FAILED', inviteError?.message ?? 'เชิญผู้ใช้ไม่สำเร็จ'), 400);
  }

  const supabase = c.get('supabase');
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
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const targetId = c.req.param('id');
  const body = c.req.valid('json');

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.fullName !== undefined) patch.full_name = body.fullName;
  if (body.phone !== undefined) patch.phone = body.phone;
  if (body.employeeCode !== undefined) patch.employee_code = body.employeeCode;
  if (body.departmentId !== undefined) patch.department_id = body.departmentId;
  if (body.positionId !== undefined) patch.position_id = body.positionId;
  if (body.supervisorId !== undefined) patch.supervisor_id = body.supervisorId;
  if (body.status !== undefined) patch.status = body.status;

  const { data, error } = await supabase.from('profiles').update(patch).eq('id', targetId).select().single();

  if (error) {
    return c.json(fail(reqId, 'USER_UPDATE_FAILED', 'บันทึกข้อมูลผู้ใช้ไม่สำเร็จ'), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'user',
    targetTable: 'profiles',
    targetId,
    detail: body,
    requestId: reqId,
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
  const targetId = c.req.param('id');
  const { roleId } = c.req.valid('json');

  const { error } = await supabase.from('user_roles').insert({ user_id: targetId, role_id: roleId, assigned_by: actorId });

  if (error) {
    return c.json(fail(reqId, 'ROLE_ASSIGN_FAILED', error.message), 400);
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

  return c.json(ok(reqId, { assigned: true }), 201);
});

/** การลบบทบาทสุดท้ายของ super_admin ถูกปฏิเสธที่ระดับ Database เสมอ (last-admin guard, Phase 2) */
usersRoute.delete('/:id/roles/:roleId', requirePermission('role.manage'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const targetId = c.req.param('id');
  const roleId = c.req.param('roleId');

  const { error } = await supabase.from('user_roles').delete().eq('user_id', targetId).eq('role_id', roleId);

  if (error) {
    return c.json(fail(reqId, 'ROLE_REMOVE_FAILED', error.message), 400);
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

  return c.json(ok(reqId, { removed: true }));
});
