import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { createCauseCodeSchema, listCauseCodesQuerySchema, updateCauseCodeSchema } from '../validators/causeCodes';

/**
 * ทะเบียนรหัสสาเหตุการปิดงาน (migration 20260921100000)
 *
 * มีไว้ให้ช่างเลือกตอนปิดงานแทนการพิมพ์สาเหตุเป็นข้อความอิสระอย่างเดียว ทำให้จัดกลุ่มได้ว่า
 * ปัญหาใดเกิดซ้ำบ่อยที่สุด — ซึ่งเป็นข้อมูลที่ใช้เลือกว่าควรเขียนบทความ KB เรื่องไหนก่อน
 */

const SELECT =
  'id, code, name, description, category_id, is_active, sort_order, created_at, updated_at, ' +
  'category:ticket_categories!ticket_cause_codes_category_id_fkey(id, name)';

export const causeCodesRoute = new Hono<AppEnv>();
causeCodesRoute.use('*', requireAuth);

/**
 * อ่านได้ทุกคนที่ล็อกอิน ไม่ต้องมี permission แยก เพราะชื่อสาเหตุต้องแสดงบนใบงานที่ผู้แจ้งเปิดดูเอง
 * ค่าเริ่มต้นคืนเฉพาะรหัสที่ยังเปิดใช้ หน้าจอเลือกสาเหตุจึงไม่มีตัวเลิกใช้แล้วโผล่ให้กดผิด
 */
causeCodesRoute.get('/', zValidator('query', listCauseCodesQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { categoryId, includeInactive } = c.req.valid('query');

  let query = supabase.from('ticket_cause_codes').select(SELECT);
  if (includeInactive !== 'true') query = query.eq('is_active', true);
  // รหัสที่ไม่ผูกหมวด (category_id is null) ใช้ได้กับทุกงาน จึงต้องติดมาด้วยเสมอ
  if (categoryId) query = query.or(`category_id.eq.${categoryId},category_id.is.null`);

  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) return dbFailJson(c, 'CAUSE_CODES_LIST_FAILED', error);
  return c.json(ok(reqId, data ?? []));
});

causeCodesRoute.post(
  '/',
  requirePermission('cause_code.manage'),
  zValidator('json', createCauseCodeSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('ticket_cause_codes')
      .insert({
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        category_id: body.categoryId ?? null,
        sort_order: body.sortOrder ?? 100,
        created_by: actorId,
      })
      .select(SELECT)
      .single();

    if (error) return dbFailJson(c, 'CAUSE_CODE_CREATE_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'cause_code',
      targetTable: 'ticket_cause_codes',
      targetId: (data as unknown as { id: string }).id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

causeCodesRoute.patch(
  '/:id',
  requirePermission('cause_code.manage'),
  zValidator('json', updateCauseCodeSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id') ?? '';
    const body = c.req.valid('json');

    if (!id) return c.json(fail(reqId, 'CAUSE_CODE_ID_REQUIRED', 'ต้องระบุรหัสสาเหตุที่ต้องการแก้ไข'), 400);

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description ?? null;
    if (body.categoryId !== undefined) patch.category_id = body.categoryId ?? null;
    if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
    if (body.isActive !== undefined) patch.is_active = body.isActive;

    const auditBefore = await loadAuditSnapshot(supabase, 'ticket_cause_codes', id);
    const { data, error } = await supabase.from('ticket_cause_codes').update(patch).eq('id', id).select(SELECT).maybeSingle();

    if (error) return dbFailJson(c, 'CAUSE_CODE_UPDATE_FAILED', error);
    if (!data) return c.json(fail(reqId, 'CAUSE_CODE_NOT_FOUND', 'ไม่พบรหัสสาเหตุที่ระบุ'), 404);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'cause_code',
      targetTable: 'ticket_cause_codes',
      targetId: id,
      detail: body,
      requestId: reqId,
      before: auditBefore,
      after: data,
    });

    return c.json(ok(reqId, data));
  },
);
