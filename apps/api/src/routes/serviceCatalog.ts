import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { createServiceCatalogSchema, listServiceCatalogQuerySchema, updateServiceCatalogSchema } from '../validators/serviceCatalog';

/**
 * Service Catalog — สืบทอดจาก ServiceCatalog เดิม (Module_ServiceCatalog.gs) เฉพาะการนิยามบริการ
 * (ดู routes/serviceRequests.ts สำหรับการยื่น/ดำเนินการคำขอ) — ขอบเขตที่ตัดออกอธิบายไว้ใน header
 * comment ของ supabase/migrations/20260811100000_service_catalog.sql
 */
export const serviceCatalogRoute = new Hono<AppEnv>();
serviceCatalogRoute.use('*', requireAuth);

serviceCatalogRoute.get('/', zValidator('query', listServiceCatalogQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, status } = c.req.valid('query');

  const { data: canManage } = await supabase.rpc('has_permission', { permission_key_input: 'service_catalog.manage' });

  let query = supabase
    .from('service_catalog')
    .select('*', { count: 'exact' })
    .order('service_name', { ascending: true })
    .range(...paginationRange(page, pageSize));

  // ผู้ใช้ทั่วไป (ไม่มี service_catalog.manage) เห็นเฉพาะบริการที่เปิดใช้งานจริงเสมอ ไม่ว่า query
  // จะขอ status อื่นมาหรือไม่ — RLS อนุญาตอ่านทุกแถว (จำเป็นสำหรับหน้าจัดการของแอดมิน) จุดนี้จึง
  // เป็นตัวกรองระดับ UX/ธุรกิจ ไม่ใช่ตัวกรองสิทธิ์
  if (canManage === true) {
    if (status) query = query.eq('status', status);
  } else {
    query = query.eq('status', 'active');
  }

  const { data, count, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'SERVICE_CATALOG_LIST_FAILED', 'ดึงรายการบริการไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});

serviceCatalogRoute.get('/:id', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id');

  const { data, error } = await supabase.from('service_catalog').select('*').eq('id', id).maybeSingle();
  if (error) {
    return c.json(fail(reqId, 'SERVICE_CATALOG_LOAD_FAILED', 'ดึงข้อมูลบริการไม่สำเร็จ'), 400);
  }
  if (!data) {
    return c.json(fail(reqId, 'SERVICE_CATALOG_NOT_FOUND', 'ไม่พบบริการนี้'), 404);
  }
  return c.json(ok(reqId, data));
});

serviceCatalogRoute.post(
  '/',
  requirePermission('service_catalog.manage'),
  zValidator('json', createServiceCatalogSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('service_catalog')
      .insert({
        service_code: body.serviceCode,
        service_name: body.serviceName,
        category: body.category ?? null,
        description: body.description ?? null,
        eligibility: body.eligibility ?? null,
        form_schema: body.formSchema ?? [],
        attachment_required: body.attachmentRequired ?? false,
        sla_hours: body.slaHours ?? 24,
        approval_mode: body.approvalMode ?? 'none',
        approval_group_id: body.approvalMode === 'group' ? body.approvalGroupId : null,
        fulfillment_group_id: body.fulfillmentGroupId ?? null,
        checklist: body.checklist ?? [],
        close_mode: body.closeMode ?? 'requester_confirms',
        close_condition: body.closeCondition ?? null,
        owner_id: body.ownerId ?? null,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return c.json(fail(reqId, 'SERVICE_CATALOG_CREATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'service_catalog',
      targetTable: 'service_catalog',
      targetId: data.id,
      detail: { serviceCode: body.serviceCode, serviceName: body.serviceName },
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

serviceCatalogRoute.patch(
  '/:id',
  requirePermission('service_catalog.manage'),
  zValidator('json', updateServiceCatalogSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('service_catalog').select('*').eq('id', id).maybeSingle();
    if (currentError || !current) {
      return c.json(fail(reqId, 'SERVICE_CATALOG_NOT_FOUND', 'ไม่พบบริการนี้'), 404);
    }

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.serviceCode !== undefined) patch.service_code = body.serviceCode;
    if (body.serviceName !== undefined) patch.service_name = body.serviceName;
    if (body.category !== undefined) patch.category = body.category;
    if (body.description !== undefined) patch.description = body.description;
    if (body.eligibility !== undefined) patch.eligibility = body.eligibility;
    if (body.formSchema !== undefined) patch.form_schema = body.formSchema;
    if (body.attachmentRequired !== undefined) patch.attachment_required = body.attachmentRequired;
    if (body.slaHours !== undefined) patch.sla_hours = body.slaHours;
    if (body.fulfillmentGroupId !== undefined) patch.fulfillment_group_id = body.fulfillmentGroupId;
    if (body.checklist !== undefined) patch.checklist = body.checklist;
    if (body.closeMode !== undefined) patch.close_mode = body.closeMode;
    if (body.closeCondition !== undefined) patch.close_condition = body.closeCondition;
    if (body.ownerId !== undefined) patch.owner_id = body.ownerId;
    if (body.notes !== undefined) patch.notes = body.notes;

    const nextApprovalMode = body.approvalMode ?? current.approval_mode;
    const nextApprovalGroupId = body.approvalGroupId !== undefined ? body.approvalGroupId : current.approval_group_id;
    if (body.approvalMode !== undefined) patch.approval_mode = body.approvalMode;
    if (nextApprovalMode === 'group' && !nextApprovalGroupId) {
      return c.json(
        fail(reqId, 'VALIDATION_ERROR', 'กรุณาเลือกกลุ่มอนุมัติเมื่อรูปแบบการอนุมัติเป็น "กลุ่มอนุมัติ"', [
          { field: 'approvalGroupId', message: 'จำเป็น' },
        ]),
        400,
      );
    }
    patch.approval_group_id = nextApprovalMode === 'group' ? nextApprovalGroupId : null;

    if (body.status !== undefined) {
      patch.status = body.status;
      if (body.status === 'active' && !current.published_at) patch.published_at = new Date().toISOString();
    }
    // ปรับ field ที่กระทบสัญญาของคำขอที่มีอยู่แล้ว (SLA/checklist/form) ต้องขึ้น version ใหม่ เพื่อให้
    // คำขอเดิมยังอ้างอิง snapshot ของ version เดิมได้ตามหลัก immutable snapshot (แนวทางเดิมของระบบ)
    const versionBumpFields = ['formSchema', 'slaHours', 'checklist', 'approvalMode', 'approvalGroupId', 'closeMode'] as const;
    if (versionBumpFields.some((field) => body[field] !== undefined)) {
      patch.version = (current.version ?? 1) + 1;
    }

    const { data, error } = await supabase.from('service_catalog').update(patch).eq('id', id).select().single();
    if (error) {
      return c.json(fail(reqId, 'SERVICE_CATALOG_UPDATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'service_catalog',
      targetTable: 'service_catalog',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);
