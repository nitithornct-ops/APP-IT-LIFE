import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  accessGroupPermissionSchema,
  createAccessGroupSchema,
  updateAccessGroupSchema,
} from '../validators/permissionAdmin';

export const accessGroupsRoute = new Hono<AppEnv>();
accessGroupsRoute.use('*', requireAuth);

accessGroupsRoute.get('/', requireAnyPermission(['role.view', 'role.manage', 'user.manage']), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('access_groups').select('*').order('key', { ascending: true });
  if (error) return c.json(fail(reqId, 'ACCESS_GROUPS_LIST_FAILED', 'ดึงรายการกลุ่มสิทธิ์ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

accessGroupsRoute.post(
  '/',
  requirePermission('role.manage'),
  zValidator('json', createAccessGroupSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');
    const { data, error } = await supabase
      .from('access_groups')
      .insert({ key: body.key, name: body.name, description: body.description ?? null, created_by: actorId })
      .select('*')
      .single();
    if (error) return dbFailJson(c, 'ACCESS_GROUP_CREATE_FAILED', error);
    await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'access_group', targetTable: 'access_groups', targetId: data.id, detail: body, requestId: reqId });
    return c.json(ok(reqId, data), 201);
  },
);

accessGroupsRoute.patch(
  '/:id',
  requirePermission('role.manage'),
  zValidator('json', updateAccessGroupSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.key !== undefined) patch.key = body.key;
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status !== undefined) patch.status = body.status;
    const auditBefore = await loadAuditSnapshot(supabase, 'access_groups', id);
    if (!auditBefore) return c.json(fail(reqId, 'ACCESS_GROUP_NOT_FOUND', 'ไม่พบกลุ่มสิทธิ์ที่ระบุ'), 404);
    const { data, error } = await supabase.from('access_groups').update(patch).eq('id', id).select('*').single();
    if (error) return dbFailJson(c, 'ACCESS_GROUP_UPDATE_FAILED', error);
    await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'access_group', targetTable: 'access_groups', targetId: id, detail: body, requestId: reqId, before: auditBefore, after: data });
    return c.json(ok(reqId, data));
  },
);

accessGroupsRoute.get('/:id/permissions', requireAnyPermission(['role.view', 'role.manage', 'user.manage']), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase
    .from('access_group_permissions')
    .select('*, permissions(key, module_key, action, description, is_privileged)')
    .eq('group_id', c.req.param('id'))
    .order('created_at', { ascending: false });
  if (error) return c.json(fail(reqId, 'ACCESS_GROUP_PERMISSIONS_LIST_FAILED', 'ดึงสิทธิ์ของกลุ่มไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

accessGroupsRoute.post(
  '/:id/permissions',
  requirePermission('role.manage'),
  zValidator('json', accessGroupPermissionSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const groupId = c.req.param('id');
    const body = c.req.valid('json');
    const { data, error } = await supabase
      .from('access_group_permissions')
      .insert({ group_id: groupId, permission_id: body.permissionId, effect: body.effect, notes: body.notes ?? null, created_by: actorId })
      .select('*, permissions(key, module_key, action, description, is_privileged)')
      .single();
    if (error) return dbFailJson(c, 'ACCESS_GROUP_PERMISSION_SAVE_FAILED', error);
    await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'ASSIGN_GROUP_PERMISSION', module: 'access_group', targetTable: 'access_group_permissions', targetId: data.id, detail: body, requestId: reqId });
    return c.json(ok(reqId, data), 201);
  },
);

accessGroupsRoute.delete('/:id/permissions/:permissionId', requirePermission('role.manage'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const groupId = c.req.param('id');
  const permissionId = c.req.param('permissionId');
  const { error } = await supabase.from('access_group_permissions').delete().eq('group_id', groupId).eq('permission_id', permissionId);
  if (error) return dbFailJson(c, 'ACCESS_GROUP_PERMISSION_REMOVE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'REMOVE_GROUP_PERMISSION', module: 'access_group', targetTable: 'access_group_permissions', targetId: groupId, detail: { permissionId }, requestId: reqId });
  return c.json(ok(reqId, { removed: true }));
});
