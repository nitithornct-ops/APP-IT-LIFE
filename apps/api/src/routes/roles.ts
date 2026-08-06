import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { createRoleSchema, setRolePermissionsSchema, updateRoleSchema } from '../validators/roles';

export const rolesRoute = new Hono<AppEnv>();

rolesRoute.use('*', requireAuth);

const viewOrManage = requireAnyPermission(['role.view', 'role.manage']);

rolesRoute.get('/', viewOrManage, async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('roles').select('*').order('created_at', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'ROLES_LIST_FAILED', 'ดึงรายการบทบาทไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

rolesRoute.post('/', requirePermission('role.manage'), zValidator('json', createRoleSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('roles')
    .insert({
      key: body.key,
      name_th: body.nameTh,
      name_en: body.nameEn ?? null,
      description: body.description ?? null,
      is_system: false,
      created_by: actorId,
    })
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'ROLE_CREATE_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'role',
    targetTable: 'roles',
    targetId: data.id,
    detail: body,
    requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

rolesRoute.patch('/:id', requirePermission('role.manage'), zValidator('json', updateRoleSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const roleId = c.req.param('id');
  const body = c.req.valid('json');

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.nameTh !== undefined) patch.name_th = body.nameTh;
  if (body.nameEn !== undefined) patch.name_en = body.nameEn;
  if (body.description !== undefined) patch.description = body.description;
  if (body.status !== undefined) patch.status = body.status;

  const { data, error } = await supabase.from('roles').update(patch).eq('id', roleId).select().single();

  if (error) {
    return c.json(fail(reqId, 'ROLE_UPDATE_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'role',
    targetTable: 'roles',
    targetId: roleId,
    detail: body,
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});

rolesRoute.get('/:id/permissions', viewOrManage, async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const roleId = c.req.param('id');

  const { data, error } = await supabase
    .from('role_permissions')
    .select('id, permission_id, effect, permissions(key, module_key, action, description)')
    .eq('role_id', roleId);

  if (error) {
    return c.json(fail(reqId, 'ROLE_PERMISSIONS_LOAD_FAILED', 'โหลดสิทธิ์ของบทบาทไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

/** บันทึกตาราง Permission Matrix ของบทบาทหนึ่งแบบเต็มชุด (แทนที่ของเดิมทั้งหมด) */
rolesRoute.put(
  '/:id/permissions',
  requirePermission('role.manage'),
  zValidator('json', setRolePermissionsSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const roleId = c.req.param('id');
    const { permissions } = c.req.valid('json');

    const { data: role } = await supabase.from('roles').select('is_system, key').eq('id', roleId).single();
    if (role?.is_system && role.key === 'super_admin') {
      return c.json(
        fail(reqId, 'ROLE_PROTECTED', 'ไม่สามารถแก้ไขสิทธิ์ของบทบาท super_admin ได้ (สิทธิ์เต็มเสมอโดยออกแบบ)'),
        400,
      );
    }

    const { error: deleteError } = await supabase.from('role_permissions').delete().eq('role_id', roleId);
    if (deleteError) {
      return c.json(fail(reqId, 'ROLE_PERMISSIONS_SAVE_FAILED', deleteError.message), 400);
    }

    if (permissions.length > 0) {
      const rows = permissions.map((p) => ({
        role_id: roleId,
        permission_id: p.permissionId,
        effect: p.effect,
        created_by: actorId,
      }));
      const { error: insertError } = await supabase.from('role_permissions').insert(rows);
      if (insertError) {
        return c.json(fail(reqId, 'ROLE_PERMISSIONS_SAVE_FAILED', insertError.message), 400);
      }
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE_PERMISSIONS',
      module: 'role',
      targetTable: 'role_permissions',
      targetId: roleId,
      detail: { permissionCount: permissions.length },
      requestId: reqId,
    });

    return c.json(ok(reqId, { saved: true }));
  },
);

export const permissionsRoute = new Hono<AppEnv>();

permissionsRoute.use('*', requireAuth);

permissionsRoute.get('/', viewOrManage, async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('permissions').select('*').order('module_key', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'PERMISSIONS_LIST_FAILED', 'ดึงรายการสิทธิ์ไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});
