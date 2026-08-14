import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  createApprovalGroupMemberSchema,
  createApprovalGroupSchema,
  updateApprovalGroupMemberSchema,
  updateApprovalGroupSchema,
} from '../validators/permissionAdmin';

/**
 * กลุ่มอนุมัติ — สืบทอดจาก ApprovalGroups/ApprovalGroupMembers เดิม (Module_ActionPermission.gs)
 * ใช้สำหรับ routing การอนุมัติในโมดูล Workflow/Access Request/Change ที่จะตามมาใน Phase 6 ถัดไป
 */
export const approvalGroupsRoute = new Hono<AppEnv>();
approvalGroupsRoute.use('*', requireAuth);

approvalGroupsRoute.get('/', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('approval_groups').select('*').order('code', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'APPROVAL_GROUPS_LIST_FAILED', 'ดึงรายการกลุ่มอนุมัติไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

approvalGroupsRoute.post(
  '/',
  requirePermission('approval_group.manage'),
  zValidator('json', createApprovalGroupSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('approval_groups')
      .insert({
        code: body.code,
        name: body.name,
        department_id: body.departmentId ?? null,
        description: body.description ?? null,
        owner_id: body.ownerId ?? null,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return dbFailJson(c, 'APPROVAL_GROUP_CREATE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'approval_group',
      targetTable: 'approval_groups',
      targetId: data.id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

approvalGroupsRoute.patch(
  '/:id',
  requirePermission('approval_group.manage'),
  zValidator('json', updateApprovalGroupSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.code !== undefined) patch.code = body.code;
    if (body.name !== undefined) patch.name = body.name;
    if (body.departmentId !== undefined) patch.department_id = body.departmentId;
    if (body.description !== undefined) patch.description = body.description;
    if (body.ownerId !== undefined) patch.owner_id = body.ownerId;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status !== undefined) patch.status = body.status;

    const auditBefore = await loadAuditSnapshot(supabase, 'approval_groups', id);
    const { data, error } = await supabase.from('approval_groups').update(patch).eq('id', id).select().single();
    if (error) {
      return dbFailJson(c, 'APPROVAL_GROUP_UPDATE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'approval_group',
      targetTable: 'approval_groups',
      targetId: id,
      detail: body,
      requestId: reqId,
          before: auditBefore,
      after: data,
});

    return c.json(ok(reqId, data));
  },
);

approvalGroupsRoute.get('/:id/members', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const groupId = c.req.param('id');

  const { data, error } = await supabase
    .from('approval_group_members')
    .select('*, profiles(full_name, email)')
    .eq('group_id', groupId)
    .order('priority', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'APPROVAL_GROUP_MEMBERS_LIST_FAILED', 'ดึงรายชื่อสมาชิกกลุ่มอนุมัติไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

approvalGroupsRoute.post(
  '/:id/members',
  requirePermission('approval_group.manage'),
  zValidator('json', createApprovalGroupMemberSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const groupId = c.req.param('id');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('approval_group_members')
      .insert({
        group_id: groupId,
        user_id: body.userId,
        member_role: body.memberRole ?? 'member',
        priority: body.priority ?? 100,
        valid_from: body.validFrom ?? null,
        valid_until: body.validUntil ?? null,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select('*, profiles(full_name, email)')
      .single();

    if (error) {
      return dbFailJson(c, 'APPROVAL_GROUP_MEMBER_CREATE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'approval_group',
      targetTable: 'approval_group_members',
      targetId: data.id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

approvalGroupsRoute.patch(
  '/:id/members/:memberId',
  requirePermission('approval_group.manage'),
  zValidator('json', updateApprovalGroupMemberSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const memberId = c.req.param('memberId');
    const body = c.req.valid('json');

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.memberRole !== undefined) patch.member_role = body.memberRole;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.validFrom !== undefined) patch.valid_from = body.validFrom;
    if (body.validUntil !== undefined) patch.valid_until = body.validUntil;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status !== undefined) patch.status = body.status;

    const auditBefore = await loadAuditSnapshot(supabase, 'approval_group_members', memberId);
    const { data, error } = await supabase
      .from('approval_group_members')
      .update(patch)
      .eq('id', memberId)
      .select('*, profiles(full_name, email)')
      .single();

    if (error) {
      return dbFailJson(c, 'APPROVAL_GROUP_MEMBER_UPDATE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'approval_group',
      targetTable: 'approval_group_members',
      targetId: memberId,
      detail: body,
      requestId: reqId,
          before: auditBefore,
      after: data,
});

    return c.json(ok(reqId, data));
  },
);
