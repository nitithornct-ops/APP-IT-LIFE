import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  cloneRoleSchema,
  compareRoleVersionsQuerySchema,
  createRolePermissionChangeRequestSchema,
  createRoleSchema,
  decideRolePermissionChangeRequestSchema,
  setRolePermissionsSchema,
  updateRoleSchema,
} from '../validators/roles';

export const rolesRoute = new Hono<AppEnv>();

rolesRoute.use('*', requireAuth);

const viewOrManage = requireAnyPermission(['role.view', 'role.manage']);

type RoleOwner = { id: string; full_name: string; email: string };
type RolePermissionRow = {
  role_id: string;
  permission_id: string;
  effect: 'allow' | 'deny';
  permissions: { key: string } | Array<{ key: string }> | null;
};
type SodRule = { key: string; label: string; description: string; permission_keys: string[] };

function embedded<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function roleMutationFailure(c: Context<AppEnv>, code: string, error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? '';
  if (message.includes('SYSTEM_ROLE_LOCKED')) return c.json(fail(c.get('requestId'), 'SYSTEM_ROLE_LOCKED', 'บทบาทระบบถูกล็อก ไม่สามารถแก้ไขหรือลบได้'), 409);
  if (message.includes('ROLE_HAS_ASSIGNED_USERS')) return c.json(fail(c.get('requestId'), 'ROLE_HAS_ASSIGNED_USERS', 'ลบบทบาทไม่ได้ เพราะยังมีผู้ใช้งานได้รับบทบาทนี้อยู่'), 409);
  if (message.includes('ROLE_OWNER_INACTIVE')) return c.json(fail(c.get('requestId'), 'ROLE_OWNER_INACTIVE', 'Role Owner ต้องเป็นผู้ใช้งานที่ยังเปิดใช้งานอยู่'), 409);
  if (message.includes('ROLE_NOT_FOUND') || error?.code === 'PGRST116') return c.json(fail(c.get('requestId'), 'ROLE_NOT_FOUND', 'ไม่พบบทบาทที่ระบุ'), 404);
  return dbFailJson(c, code, error as never);
}

rolesRoute.get('/', viewOrManage, async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const [rolesResult, assignmentsResult, permissionsResult, rulesResult] = await Promise.all([
    supabase.from('roles').select('*').order('created_at', { ascending: false }),
    supabase.from('user_roles').select('role_id, user_id'),
    supabase.from('role_permissions').select('role_id, permission_id, effect, permissions(key)'),
    supabase.from('role_sod_conflict_rules').select('key, label, description, permission_keys').eq('status', 'active'),
  ]);

  if (rolesResult.error) {
    return c.json(fail(reqId, 'ROLES_LIST_FAILED', 'ดึงรายการบทบาทไม่สำเร็จ'), 400);
  }
  if (assignmentsResult.error || permissionsResult.error || rulesResult.error) {
    return c.json(fail(reqId, 'ROLES_GOVERNANCE_METADATA_FAILED', 'ดึงข้อมูลกำกับดูแลบทบาทไม่สำเร็จ'), 400);
  }

  const roles = (rolesResult.data ?? []) as Array<Record<string, unknown>>;
  const assignmentCounts = new Map<string, number>();
  for (const row of assignmentsResult.data ?? []) assignmentCounts.set(row.role_id, (assignmentCounts.get(row.role_id) ?? 0) + 1);

  const permissionRows = (permissionsResult.data ?? []) as unknown as RolePermissionRow[];
  const permissionsByRole = new Map<string, Set<string>>();
  for (const row of permissionRows) {
    if (row.effect !== 'allow') continue;
    const permission = embedded(row.permissions)?.key;
    if (!permission) continue;
    const keys = permissionsByRole.get(row.role_id) ?? new Set<string>();
    keys.add(permission);
    permissionsByRole.set(row.role_id, keys);
  }

  const rules = (rulesResult.data ?? []) as SodRule[];
  const ownerIds = [...new Set(roles.map((role) => (typeof role.owner_id === 'string' ? role.owner_id : null)).filter((id): id is string => Boolean(id)))];
  const ownersById = new Map<string, RoleOwner>();
  if (ownerIds.length) {
    const { data: owners, error: ownersError } = await createAdminClient(c.env).from('profiles').select('id, full_name, email').in('id', ownerIds);
    if (ownersError) return c.json(fail(reqId, 'ROLE_OWNER_LOOKUP_FAILED', 'ดึงรายชื่อ Role Owner ไม่สำเร็จ'), 400);
    for (const owner of owners ?? []) ownersById.set(owner.id, owner);
  }

  const enriched = roles.map((role) => {
    const roleId = String(role.id);
    const assignedUserCount = assignmentCounts.get(roleId) ?? 0;
    const permissionKeys = permissionsByRole.get(roleId) ?? new Set<string>();
    const sodConflicts = rules.filter((rule) => rule.permission_keys.every((key) => permissionKeys.has(key)));
    const ownerId = typeof role.owner_id === 'string' ? role.owner_id : null;
    return {
      ...role,
      owner: ownerId ? ownersById.get(ownerId) ?? null : null,
      assigned_user_count: assignedUserCount,
      sod_conflict_count: sodConflicts.length,
      sod_conflicts: sodConflicts,
      system_role_locked: role.is_system === true,
    };
  });

  return c.json(ok(reqId, enriched));
});

rolesRoute.get('/owners', requirePermission('role.manage'), async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await createAdminClient(c.env)
    .from('profiles')
    .select('id, full_name, email')
    .eq('status', 'active')
    .order('full_name', { ascending: true })
    .limit(1000);
  if (error) return c.json(fail(reqId, 'ROLE_OWNERS_LIST_FAILED', 'ดึงรายชื่อ Role Owner ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

rolesRoute.get('/permission-change-requests', viewOrManage, async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('role_permission_change_requests')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(100);
  if (error) return dbFailJson(c, 'ROLE_PERMISSION_REQUESTS_LOAD_FAILED', error);

  const rows = data ?? [];
  const roleIds = [...new Set(rows.map((row) => row.role_id))];
  const profileIds = [...new Set(rows.flatMap((row) => [row.requested_by, row.approver_id]))];
  const [{ data: roleRows, error: roleError }, { data: profiles, error: profileError }] = await Promise.all([
    roleIds.length ? admin.from('roles').select('id,key,name_th').in('id', roleIds) : Promise.resolve({ data: [], error: null }),
    profileIds.length ? admin.from('profiles').select('id,full_name,email').in('id', profileIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (roleError || profileError) return dbFailJson(c, 'ROLE_PERMISSION_REQUESTS_METADATA_FAILED', roleError ?? profileError);
  const roleById = new Map((roleRows ?? []).map((row) => [row.id, row]));
  const profileById = new Map((profiles ?? []).map((row) => [row.id, row]));
  return c.json(ok(reqId, rows.map((row) => ({
    ...row,
    role: roleById.get(row.role_id) ?? null,
    requester: profileById.get(row.requested_by) ?? null,
    approver: profileById.get(row.approver_id) ?? null,
  }))));
});

rolesRoute.post('/', requirePermission('role.manage'), zValidator('json', createRoleSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const { data, error } = await createAdminClient(c.env).rpc('create_role_with_version', {
    key_input: body.key,
    name_th_input: body.nameTh,
    name_en_input: body.nameEn ?? null,
    description_input: body.description ?? null,
    scope_input: body.scope ?? null,
    owner_id_input: body.ownerId ?? null,
    review_frequency_input: body.reviewFrequency,
    sensitive_role_input: body.sensitiveRole,
    actor_id_input: actorId,
  });

  if (error) {
    return roleMutationFailure(c, 'ROLE_CREATE_FAILED', error);
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
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const roleId = c.req.param('id');
  const body = c.req.valid('json');

  const admin = createAdminClient(c.env);
  const { data: current, error: currentError } = await admin.from('roles').select('*').eq('id', roleId).maybeSingle();
  if (currentError || !current) return roleMutationFailure(c, 'ROLE_UPDATE_FAILED', currentError ?? { code: 'PGRST116', message: 'ROLE_NOT_FOUND' });
  if (current.is_system) return c.json(fail(reqId, 'SYSTEM_ROLE_LOCKED', 'บทบาทระบบถูกล็อก ไม่สามารถแก้ไขหรือลบได้'), 409);

  const auditBefore = await loadAuditSnapshot(admin, 'roles', roleId);
  const { data, error } = await admin.rpc('update_role_with_version', {
    role_id_input: roleId,
    name_th_input: body.nameTh ?? current.name_th,
    name_en_input: body.nameEn !== undefined ? body.nameEn : current.name_en,
    description_input: body.description !== undefined ? body.description : current.description,
    scope_input: body.scope !== undefined ? body.scope : current.scope,
    owner_id_input: body.ownerId !== undefined ? body.ownerId : current.owner_id,
    review_frequency_input: body.reviewFrequency ?? current.review_frequency,
    sensitive_role_input: body.sensitiveRole ?? current.sensitive_role,
    status_input: body.status ?? current.status,
    actor_id_input: actorId,
    change_summary_input: 'แก้ไขข้อมูลบทบาท',
  });

  if (error) {
    return roleMutationFailure(c, 'ROLE_UPDATE_FAILED', error);
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
      before: auditBefore,
    after: data,
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

rolesRoute.post(
  '/:id/permission-change-requests',
  requirePermission('role.manage'),
  zValidator('json', createRolePermissionChangeRequestSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const roleId = c.req.param('id');
    const body = c.req.valid('json');
    const admin = createAdminClient(c.env);
    const permissionIds = [...new Set([...body.permissions.map((item) => item.permissionId), ...body.changes.map((item) => item.permissionId)])];

    const [{ data: role, error: roleError }, { data: permissionRows, error: permissionError }, { data: approver, error: approverError }, { data: pending, error: pendingError }, { data: currentRolePermissions, error: currentRolePermissionsError }] = await Promise.all([
      admin.from('roles').select('id,key,name_th,is_system,version').eq('id', roleId).maybeSingle(),
      admin.from('permissions').select('id,key,is_privileged,status').in('id', permissionIds),
      admin.from('profiles').select('id,full_name,email').eq('id', body.approverId).eq('status', 'active').maybeSingle(),
      admin.from('role_permission_change_requests').select('id').eq('role_id', roleId).eq('status', 'pending').maybeSingle(),
      admin.from('role_permissions').select('permission_id,effect').eq('role_id', roleId),
    ]);
    if (roleError || !role) return c.json(fail(reqId, 'ROLE_NOT_FOUND', 'ไม่พบบทบาทที่ระบุ'), 404);
    if (role.is_system) return c.json(fail(reqId, 'SYSTEM_ROLE_LOCKED', 'บทบาทระบบถูกล็อก ไม่สามารถขอเปลี่ยน Permission Matrix ได้'), 409);
    if (permissionError || (permissionRows ?? []).length !== permissionIds.length || (permissionRows ?? []).some((row) => row.status !== 'active')) {
      return c.json(fail(reqId, 'ROLE_PERMISSION_REQUEST_INVALID', 'รายการสิทธิ์ที่ส่งมาไม่ถูกต้องหรือไม่เปิดใช้งานแล้ว'), 400);
    }
    if (approverError || !approver) return c.json(fail(reqId, 'ROLE_PERMISSION_APPROVER_NOT_FOUND', 'ไม่พบผู้อนุมัติที่ยังใช้งานอยู่'), 400);
    if (body.approverId === actorId) return c.json(fail(reqId, 'ROLE_PERMISSION_SELF_APPROVAL_FORBIDDEN', 'ผู้ขอเปลี่ยนแปลงและผู้อนุมัติต้องเป็นคนละคนกัน'), 400);
    if (pendingError) return dbFailJson(c, 'ROLE_PERMISSION_REQUEST_LOOKUP_FAILED', pendingError);
    if (currentRolePermissionsError) return dbFailJson(c, 'ROLE_PERMISSION_CURRENT_STATE_LOOKUP_FAILED', currentRolePermissionsError);
    if (pending) return c.json(fail(reqId, 'ROLE_PERMISSION_REQUEST_PENDING', 'บทบาทนี้มีคำขอเปลี่ยนสิทธิ์ที่รออนุมัติอยู่แล้ว'), 409);
    if (!body.changes.some((change) => change.isPrivileged && change.from !== change.to)) {
      return c.json(fail(reqId, 'ROLE_PERMISSION_APPROVAL_NOT_REQUIRED', 'คำขอนี้ไม่มีการเปลี่ยนแปลงสิทธิ์ระดับสูง'), 400);
    }

    const permissionById = new Map((permissionRows ?? []).map((row) => [row.id, row]));
    const invalidChange = body.changes.some((change) => {
      const permission = permissionById.get(change.permissionId);
      return !permission || permission.key !== change.permissionKey || permission.is_privileged !== change.isPrivileged || change.from === change.to;
    });
    if (invalidChange) return c.json(fail(reqId, 'ROLE_PERMISSION_REQUEST_CHANGES_INVALID', 'สรุปการเปลี่ยนแปลงสิทธิ์ไม่ตรงกับข้อมูลล่าสุด'), 409);
    const currentEffectByPermissionId = new Map((currentRolePermissions ?? []).map((item) => [item.permission_id, item.effect]));
    const staleChange = body.changes.some((change) => (currentEffectByPermissionId.get(change.permissionId) ?? 'none') !== change.from);
    if (staleChange) return c.json(fail(reqId, 'ROLE_PERMISSION_REQUEST_STALE', 'Role ถูกเปลี่ยนแปลงระหว่างที่เปิดหน้า กรุณาโหลดข้อมูลใหม่แล้วตรวจสอบอีกครั้ง'), 409);

    const { data, error } = await admin.from('role_permission_change_requests').insert({
      role_id: roleId,
      base_version: role.version,
      requested_by: actorId,
      approver_id: body.approverId,
      proposed_permissions: body.permissions.map((item) => ({ permission_id: item.permissionId, effect: item.effect })),
      changes: body.changes.map((change) => ({ permission_id: change.permissionId, permission_key: change.permissionKey, from: change.from, to: change.to, is_privileged: change.isPrivileged })),
      reason: body.reason,
    }).select('*').single();
    if (error) return dbFailJson(c, 'ROLE_PERMISSION_REQUEST_CREATE_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'REQUEST_PERMISSION_CHANGE_APPROVAL',
      module: 'role',
      targetTable: 'role_permission_change_requests',
      targetId: data.id,
      detail: { roleId, approverId: body.approverId, changes: body.changes },
      requestId: reqId,
    });
    await sendNotification(c.env, {
      recipientId: body.approverId,
      type: 'role_permission_approval',
      title: `รออนุมัติการเปลี่ยนสิทธิ์: ${role.name_th}`,
      body: body.changes.map((change) => `${change.to === 'allow' ? 'เพิ่ม' : change.to === 'deny' ? 'ปฏิเสธ' : 'นำออก'} ${change.permissionKey}`).join(', '),
      link: '/admin/permission-matrix',
    });
    return c.json(ok(reqId, { ...data, role: { id: role.id, key: role.key, name_th: role.name_th }, approver }), 201);
  },
);

rolesRoute.patch(
  '/:id/permission-change-requests/:requestId',
  requirePermission('role.manage'),
  zValidator('json', decideRolePermissionChangeRequestSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const roleId = c.req.param('id');
    const requestId = c.req.param('requestId');
    const body = c.req.valid('json');
    const admin = createAdminClient(c.env);
    const { data: request, error: requestError } = await admin
      .from('role_permission_change_requests')
      .select('*')
      .eq('id', requestId)
      .eq('role_id', roleId)
      .maybeSingle();
    if (requestError || !request) return c.json(fail(reqId, 'ROLE_PERMISSION_REQUEST_NOT_FOUND', 'ไม่พบคำขอเปลี่ยนสิทธิ์ที่ระบุ'), 404);
    if (request.status !== 'pending') return c.json(fail(reqId, 'ROLE_PERMISSION_REQUEST_ALREADY_DECIDED', 'คำขอนี้ถูกตัดสินไปแล้ว'), 409);
    if (request.approver_id !== actorId) return c.json(fail(reqId, 'ROLE_PERMISSION_APPROVER_MISMATCH', 'คำขอนี้ไม่ได้มอบหมายให้ท่าน'), 403);

    const { data, error } = await admin.rpc('decide_role_permission_change_request', {
      request_id_input: requestId,
      actor_id_input: actorId,
      decision_input: body.decision,
      comment_input: body.comment ?? null,
    });
    if (error) return dbFailJson(c, 'ROLE_PERMISSION_REQUEST_DECISION_FAILED', error);
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: body.decision === 'approve' ? 'APPROVE_PERMISSION_CHANGE' : 'REJECT_PERMISSION_CHANGE',
      module: 'role',
      targetTable: 'role_permission_change_requests',
      targetId: requestId,
      detail: { roleId, comment: body.comment ?? null },
      requestId: reqId,
    });
    await sendNotification(c.env, {
      recipientId: request.requested_by,
      type: 'role_permission_approval_result',
      title: `${body.decision === 'approve' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'}: การเปลี่ยนสิทธิ์ ${roleId}`,
      body: body.comment ?? 'มีการตัดสินคำขอเปลี่ยนสิทธิ์ของท่านแล้ว',
      link: '/admin/permission-matrix',
    });
    return c.json(ok(reqId, data));
  },
);

/** บันทึกตาราง Permission Matrix ของบทบาทหนึ่งแบบเต็มชุด (แทนที่ของเดิมทั้งหมด) */
rolesRoute.put(
  '/:id/permissions',
  requirePermission('role.manage'),
  zValidator('json', setRolePermissionsSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const roleId = c.req.param('id');
    const { permissions } = c.req.valid('json');
    const admin = createAdminClient(c.env);

    const [{ data: role, error: roleError }, { data: currentPermissions, error: currentPermissionsError }] = await Promise.all([
      admin.from('roles').select('is_system, key').eq('id', roleId).maybeSingle(),
      admin.from('role_permissions').select('permission_id, effect').eq('role_id', roleId),
    ]);
    if (roleError || !role) {
      return c.json(fail(reqId, 'ROLE_NOT_FOUND', 'ไม่พบบทบาทที่ระบุ'), 404);
    }
    if (currentPermissionsError) {
      return dbFailJson(c, 'ROLE_PERMISSIONS_CURRENT_STATE_FAILED', currentPermissionsError);
    }
    if (role.is_system) {
      return c.json(
        fail(reqId, 'SYSTEM_ROLE_LOCKED', 'บทบาทระบบถูกล็อก ไม่สามารถแก้ไข Permission Matrix ได้'),
        409,
      );
    }

    const permissionIds = [...new Set([...(currentPermissions ?? []).map((item) => item.permission_id), ...permissions.map((item) => item.permissionId)])];
    if (permissionIds.length) {
      const { data: permissionRows, error: permissionError } = await admin.from('permissions').select('id, is_privileged').in('id', permissionIds);
      if (permissionError) return dbFailJson(c, 'ROLE_PERMISSIONS_CATALOG_FAILED', permissionError);
      const currentEffectById = new Map((currentPermissions ?? []).map((item) => [item.permission_id, item.effect]));
      const nextEffectById = new Map(permissions.map((item) => [item.permissionId, item.effect]));
      const privilegedChanged = (permissionRows ?? []).some((permission) => permission.is_privileged && (currentEffectById.get(permission.id) ?? 'none') !== (nextEffectById.get(permission.id) ?? 'none'));
      if (privilegedChanged) {
        return c.json(fail(reqId, 'ROLE_PERMISSION_APPROVAL_REQUIRED', 'การเปลี่ยน Sensitive Permission ต้องส่งคำขอ Approval ก่อนจึงจะมีผล'), 409);
      }
    }

    const { data, error } = await admin.rpc('set_role_permissions_with_version', {
      role_id_input: roleId,
      permissions_input: permissions,
      actor_id_input: actorId,
      change_summary_input: 'แก้ไข Permission Matrix',
    });
    if (error) return roleMutationFailure(c, 'ROLE_PERMISSIONS_SAVE_FAILED', error);

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

    return c.json(ok(reqId, data));
  },
);

rolesRoute.post('/:id/clone', requirePermission('role.manage'), zValidator('json', cloneRoleSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const sourceRoleId = c.req.param('id');
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).rpc('clone_role_with_version', {
    source_role_id_input: sourceRoleId,
    key_input: body.key,
    name_th_input: body.nameTh,
    name_en_input: body.nameEn ?? null,
    description_input: body.description ?? null,
    scope_input: body.scope ?? null,
    owner_id_input: body.ownerId ?? null,
    review_frequency_input: body.reviewFrequency,
    sensitive_role_input: body.sensitiveRole,
    actor_id_input: actorId,
  });
  if (error) return roleMutationFailure(c, 'ROLE_CLONE_FAILED', error);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CLONE',
    module: 'role',
    targetTable: 'roles',
    targetId: typeof data === 'object' && data && 'id' in data ? String(data.id) : null,
    detail: { sourceRoleId, ...body },
    requestId: reqId,
  });
  return c.json(ok(reqId, data), 201);
});

rolesRoute.get('/:id/versions/compare', viewOrManage, zValidator('query', compareRoleVersionsQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const roleId = c.req.param('id');
  const { from: fromNumber, to: toNumber } = c.req.valid('query');
  const supabase = c.get('supabase');
  const [fromResult, toResult] = await Promise.all([
    supabase.from('role_versions').select('*').eq('role_id', roleId).eq('version_number', fromNumber).maybeSingle(),
    supabase.from('role_versions').select('*').eq('role_id', roleId).eq('version_number', toNumber).maybeSingle(),
  ]);
  if (fromResult.error || toResult.error) return c.json(fail(reqId, 'ROLE_VERSION_COMPARE_FAILED', 'เปรียบเทียบเวอร์ชันบทบาทไม่สำเร็จ'), 400);
  if (!fromResult.data || !toResult.data) return c.json(fail(reqId, 'ROLE_VERSION_NOT_FOUND', 'ไม่พบเวอร์ชันบทบาทที่เลือก'), 404);

  const fromSnapshot = (fromResult.data.snapshot ?? {}) as Record<string, unknown>;
  const toSnapshot = (toResult.data.snapshot ?? {}) as Record<string, unknown>;
  const fromRole = (fromSnapshot.role ?? {}) as Record<string, unknown>;
  const toRole = (toSnapshot.role ?? {}) as Record<string, unknown>;
  const changes: Array<{ field: string; label: string; from: unknown; to: unknown }> = [];
  const roleFields: Array<[string, string]> = [
    ['name_th', 'ชื่อบทบาท'], ['name_en', 'ชื่อบทบาท (อังกฤษ)'], ['description', 'คำอธิบาย'], ['scope', 'Scope'],
    ['owner_id', 'Role Owner'], ['review_frequency', 'รอบทบทวน'], ['sensitive_role', 'Sensitive Role'], ['status', 'สถานะ'],
  ];
  for (const [field, label] of roleFields) if (JSON.stringify(fromRole[field]) !== JSON.stringify(toRole[field])) changes.push({ field, label, from: fromRole[field] ?? null, to: toRole[field] ?? null });

  const permissionMap = (snapshot: Record<string, unknown>) => new Map(
    (Array.isArray(snapshot.permissions) ? snapshot.permissions : []).map((item) => {
      const row = item as Record<string, unknown>;
      return [String(row.key), row.effect] as const;
    }),
  );
  const fromPermissions = permissionMap(fromSnapshot);
  const toPermissions = permissionMap(toSnapshot);
  const permissionKeys = [...new Set([...fromPermissions.keys(), ...toPermissions.keys()])].sort();
  for (const key of permissionKeys) {
    const fromEffect = fromPermissions.get(key) ?? 'none';
    const toEffect = toPermissions.get(key) ?? 'none';
    if (fromEffect !== toEffect) changes.push({ field: `permission:${key}`, label: `Permission ${key}`, from: fromEffect, to: toEffect });
  }

  return c.json(ok(reqId, { from: fromResult.data, to: toResult.data, changes }));
});

rolesRoute.get('/:id/versions', viewOrManage, async (c) => {
  const reqId = c.get('requestId');
  const roleId = c.req.param('id');
  const { data, error } = await c.get('supabase').from('role_versions').select('id, role_id, version_number, snapshot, change_type, change_summary, created_at, created_by').eq('role_id', roleId).order('version_number', { ascending: false });
  if (error) return c.json(fail(reqId, 'ROLE_VERSIONS_LOAD_FAILED', 'โหลดประวัติเวอร์ชันบทบาทไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

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
