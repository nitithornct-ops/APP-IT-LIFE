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
  createPermissionOverrideSchema,
  privilegedOverrideDecisionSchema,
  updatePermissionOverrideSchema,
} from '../validators/permissionAdmin';

/**
 * สิทธิ์ยกเว้นรายผู้ใช้ (ALLOW/DENY) — สืบทอดจาก UserPermissionOverrides เดิม
 * (Module_ActionPermission.gs) มี precedence เหนือสิทธิ์จาก Role เสมอ ดู has_permission()
 * ใน 20260805100004_rbac.sql. จัดการโดยผู้ถือสิทธิ์ role.manage เท่านั้น (จุดเดียวกับ Permission Matrix)
 */
export const permissionOverridesRoute = new Hono<AppEnv>();
permissionOverridesRoute.use('*', requireAuth);

permissionOverridesRoute.get('/', requirePermission('role.manage'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const userId = c.req.query('userId');

  let query = supabase
    .from('user_permission_overrides')
    .select('*, permissions(key, module_key, description, is_privileged)')
    .order('created_at', { ascending: false });
  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'PERMISSION_OVERRIDES_LIST_FAILED', 'ดึงรายการ permission override ไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

permissionOverridesRoute.post(
  '/',
  requirePermission('role.manage'),
  zValidator('json', createPermissionOverrideSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    if (body.userId === actorId && body.effect === 'allow') {
      return c.json(fail(reqId, 'SELF_ALLOW_OVERRIDE_FORBIDDEN', 'ผู้ดูแลไม่สามารถเพิ่ม ALLOW override ให้ตนเองได้'), 400);
    }

    // หนึ่งแถวต่อ user+permission (idempotent) — เหมือน saveUserPermissionOverride เดิม: มีอยู่แล้วก็อัปเดตแทนการสร้างซ้ำ
    const { data: permission, error: permissionError } = await supabase
      .from('permissions')
      .select('id, key, is_privileged')
      .eq('id', body.permissionId)
      .eq('status', 'active')
      .maybeSingle();
    if (permissionError || !permission) return c.json(fail(reqId, 'PERMISSION_NOT_FOUND', 'ไม่พบสิทธิ์ที่ระบุ'), 404);

    const isPrivilegedAllow = body.effect === 'allow' && permission.is_privileged === true;
    if (isPrivilegedAllow && !body.endAt) {
      return c.json(fail(reqId, 'PRIVILEGED_OVERRIDE_EXPIRY_REQUIRED', 'Privileged ALLOW Override ต้องระบุวันหมดอายุ'), 400);
    }

    const { data: existing } = await supabase
      .from('user_permission_overrides')
      .select('id')
      .eq('user_id', body.userId)
      .eq('permission_id', body.permissionId)
      .maybeSingle();

    const needsApproval = isPrivilegedAllow;
    const payload = {
      user_id: body.userId,
      permission_id: body.permissionId,
      effect: body.effect,
      start_at: body.startAt ?? null,
      end_at: body.endAt ?? null,
      reason: body.reason,
      is_temporary: body.temporaryAccess ?? Boolean(body.endAt),
      privileged_access: permission.is_privileged === true,
      approval_status: needsApproval ? 'pending' : 'approved',
      approval_requested_by: actorId,
      approval_requested_at: new Date().toISOString(),
      status: needsApproval ? 'inactive' : 'active',
      approved_by: needsApproval ? null : actorId,
      approved_at: needsApproval ? null : new Date().toISOString(),
    };

    const { data, error } = existing
      ? await supabase
          .from('user_permission_overrides')
          .update({ ...payload, updated_by: actorId })
          .eq('id', existing.id)
          .select()
          .single()
      : await supabase
          .from('user_permission_overrides')
          .insert({ ...payload, created_by: actorId })
          .select()
          .single();

    if (error) {
      return dbFailJson(c, 'PERMISSION_OVERRIDE_SAVE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: existing ? 'UPDATE' : 'CREATE',
      module: 'user_permission_override',
      targetTable: 'user_permission_overrides',
      targetId: data.id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, { ...data, approvalRequired: needsApproval }), existing ? 200 : 201);
  },
);

permissionOverridesRoute.patch(
  '/:id',
  requirePermission('role.manage'),
  zValidator('json', updatePermissionOverrideSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const { data: current, error: currentError } = await supabase
      .from('user_permission_overrides')
      .select('user_id, permission_id, effect, end_at, approval_status, approval_requested_by, privileged_access')
      .eq('id', id)
      .single();
    if (currentError || !current) {
      return c.json(fail(reqId, 'PERMISSION_OVERRIDE_NOT_FOUND', 'ไม่พบ permission override ที่ต้องการแก้ไข'), 404);
    }
    if (current.user_id === actorId && body.effect === 'allow') {
      return c.json(fail(reqId, 'SELF_ALLOW_OVERRIDE_FORBIDDEN', 'ผู้ดูแลไม่สามารถเพิ่ม ALLOW override ให้ตนเองได้'), 400);
    }

    const { data: permission } = await supabase
      .from('permissions')
      .select('is_privileged')
      .eq('id', current.permission_id)
      .maybeSingle();
    const nextEffect = body.effect ?? current.effect;
    const nextEndAt = body.endAt !== undefined ? body.endAt : current.end_at;
    const privilegedAllow = nextEffect === 'allow' && permission?.is_privileged === true;
    if (privilegedAllow && !nextEndAt) {
      return c.json(fail(reqId, 'PRIVILEGED_OVERRIDE_EXPIRY_REQUIRED', 'Privileged ALLOW Override ต้องระบุวันหมดอายุ'), 400);
    }
    if (body.status === 'active' && current.approval_status !== 'approved' && privilegedAllow) {
      return c.json(fail(reqId, 'PRIVILEGED_OVERRIDE_APPROVAL_REQUIRED', 'ต้องอนุมัติ Privileged Override ก่อนเปิดใช้งาน'), 409);
    }

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.effect !== undefined) patch.effect = body.effect;
    if (body.startAt !== undefined) patch.start_at = body.startAt;
    if (body.endAt !== undefined) patch.end_at = body.endAt;
    if (body.reason !== undefined) patch.reason = body.reason;
    if (body.status !== undefined) patch.status = body.status;
    if (privilegedAllow && (body.effect !== undefined || body.startAt !== undefined || body.endAt !== undefined || body.reason !== undefined)) {
      patch.approval_status = 'pending';
      patch.approval_requested_by = actorId;
      patch.approval_requested_at = new Date().toISOString();
      patch.approved_by = null;
      patch.approved_at = null;
      patch.status = 'inactive';
    }

    const auditBefore = await loadAuditSnapshot(supabase, 'user_permission_overrides', id);
    const { data, error } = await supabase.from('user_permission_overrides').update(patch).eq('id', id).select().single();
    if (error) {
      return dbFailJson(c, 'PERMISSION_OVERRIDE_UPDATE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'user_permission_override',
      targetTable: 'user_permission_overrides',
      targetId: id,
      detail: body,
      requestId: reqId,
          before: auditBefore,
      after: data,
});

    return c.json(ok(reqId, data));
  },
);

permissionOverridesRoute.patch(
  '/:id/decision',
  requirePermission('role.manage'),
  zValidator('json', privilegedOverrideDecisionSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const { data: current, error: currentError } = await supabase
      .from('user_permission_overrides')
      .select('id, user_id, permission_id, effect, approval_status, approval_requested_by, privileged_access')
      .eq('id', id)
      .maybeSingle();
    if (currentError || !current) return c.json(fail(reqId, 'PERMISSION_OVERRIDE_NOT_FOUND', 'ไม่พบ Permission Override ที่ระบุ'), 404);
    if (!current.privileged_access || current.effect !== 'allow') return c.json(fail(reqId, 'PERMISSION_OVERRIDE_NOT_PRIVILEGED', 'รายการนี้ไม่ใช่ Privileged ALLOW Override'), 400);
    if (current.user_id === actorId || current.approval_requested_by === actorId) {
      return c.json(fail(reqId, 'PRIVILEGED_OVERRIDE_SELF_APPROVAL_FORBIDDEN', 'ผู้ขอและผู้อนุมัติต้องเป็นคนละคนกัน'), 400);
    }
    if (current.approval_status !== 'pending') return c.json(fail(reqId, 'PERMISSION_OVERRIDE_ALREADY_DECIDED', 'รายการนี้ถูกตัดสินไปแล้ว'), 409);

    const approved = body.decision === 'approve';
    const { data, error } = await supabase
      .from('user_permission_overrides')
      .update({
        approval_status: approved ? 'approved' : 'rejected',
        approval_comment: body.comment ?? null,
        approved_by: approved ? actorId : null,
        approved_at: approved ? new Date().toISOString() : null,
        status: approved ? 'active' : 'inactive',
        updated_by: actorId,
      })
      .eq('id', id)
      .select('*, permissions(key, module_key, description, is_privileged)')
      .single();
    if (error) return dbFailJson(c, 'PERMISSION_OVERRIDE_DECISION_FAILED', error);
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: approved ? 'APPROVE_PRIVILEGED_OVERRIDE' : 'REJECT_PRIVILEGED_OVERRIDE',
      module: 'user_permission_override',
      targetTable: 'user_permission_overrides',
      targetId: id,
      detail: body,
      requestId: reqId,
      before: current,
      after: data,
    });
    return c.json(ok(reqId, data));
  },
);
