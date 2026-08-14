import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { createPermissionOverrideSchema, updatePermissionOverrideSchema } from '../validators/permissionAdmin';

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
    .select('*, permissions(key, module_key, description)')
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
    const { data: existing } = await supabase
      .from('user_permission_overrides')
      .select('id')
      .eq('user_id', body.userId)
      .eq('permission_id', body.permissionId)
      .maybeSingle();

    const payload = {
      user_id: body.userId,
      permission_id: body.permissionId,
      effect: body.effect,
      start_at: body.startAt ?? null,
      end_at: body.endAt ?? null,
      reason: body.reason,
      status: 'active',
      approved_by: actorId,
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

    return c.json(ok(reqId, data), existing ? 200 : 201);
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
      .select('user_id')
      .eq('id', id)
      .single();
    if (currentError || !current) {
      return c.json(fail(reqId, 'PERMISSION_OVERRIDE_NOT_FOUND', 'ไม่พบ permission override ที่ต้องการแก้ไข'), 404);
    }
    if (current.user_id === actorId && body.effect === 'allow') {
      return c.json(fail(reqId, 'SELF_ALLOW_OVERRIDE_FORBIDDEN', 'ผู้ดูแลไม่สามารถเพิ่ม ALLOW override ให้ตนเองได้'), 400);
    }

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.effect !== undefined) patch.effect = body.effect;
    if (body.startAt !== undefined) patch.start_at = body.startAt;
    if (body.endAt !== undefined) patch.end_at = body.endAt;
    if (body.reason !== undefined) patch.reason = body.reason;
    if (body.status !== undefined) patch.status = body.status;

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
