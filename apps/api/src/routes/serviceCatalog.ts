import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
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
    query = query.eq('status', 'active').lte('effective_date', new Date().toISOString().slice(0, 10));
  }

  const { data, count, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'SERVICE_CATALOG_LIST_FAILED', 'ดึงรายการบริการไม่สำเร็จ'), 400);
  }
  const items = data ?? [];
  const serviceIds = items.map((item) => item.id);
  const knowledgeAdmin = createAdminClient(c.env);
  const linked = serviceIds.length
    ? await knowledgeAdmin.from('knowledge_article_services').select('service_id, article:knowledge_articles!knowledge_article_services_article_id_fkey(id,article_code,title,symptom,status,is_deprecated,expiry_date,search_rank)').in('service_id', serviceIds)
    : { data: [], error: null };
  if (linked.error) return c.json(fail(reqId, 'SERVICE_CATALOG_KNOWLEDGE_LOAD_FAILED', 'ดึงบทความแนะนำของบริการไม่สำเร็จ'), 400);
  const today = new Date().toISOString().slice(0, 10);
  const suggestedByService = new Map<string, Array<{ articleId: string; title: string; summary: string; url: string }>>();
  for (const link of linked.data ?? []) {
    const article = Array.isArray(link.article) ? link.article[0] : link.article;
    if (!article || article.status !== 'เผยแพร่' || article.is_deprecated || (article.expiry_date && article.expiry_date < today)) continue;
    const suggestions = suggestedByService.get(link.service_id) ?? [];
    suggestions.push({ articleId: article.id, title: article.title, summary: article.symptom ?? '', url: `/knowledge?article=${article.id}` });
    suggestedByService.set(link.service_id, suggestions);
  }
  const enriched = items.map((item) => {
    const configured = Array.isArray(item.suggested_knowledge) ? item.suggested_knowledge as Array<{ articleId?: string; title: string; summary?: string; url?: string }> : [];
    const linkedArticles = suggestedByService.get(item.id) ?? [];
    const seen = new Set(configured.map((entry: { articleId?: string; title: string }) => `${entry.articleId ?? ''}:${entry.title}`));
    return { ...item, suggested_knowledge: [...configured, ...linkedArticles.filter((entry) => !seen.has(`${entry.articleId}:${entry.title}`))] };
  });
  return c.json(ok(reqId, toPaginatedData(enriched, count, page, pageSize)));
});

serviceCatalogRoute.get('/owners', requirePermission('service_catalog.manage'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .eq('status', 'active')
    .order('full_name');
  if (error) return c.json(fail(reqId, 'SERVICE_CATALOG_OWNERS_LOAD_FAILED', 'ดึงรายชื่อ Service Owner ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
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
        audience: body.audience ?? null,
        eligibility: body.eligibility ?? null,
        form_schema: body.formSchema ?? [],
        attachment_required: body.attachmentRequired ?? false,
        sla_hours: body.slaHours ?? 24,
        approval_mode: body.approvalMode ?? 'none',
        approval_group_id: body.approvalMode === 'group' ? body.approvalGroupId : null,
        fulfillment_group_id: body.fulfillmentGroupId ?? null,
        checklist: body.checklist ?? [],
        auto_assign: body.autoAssign ?? true,
        auto_create_task: body.autoCreateTask ?? false,
        estimated_cost: body.estimatedCost ?? null,
        dependencies: body.dependencies ?? [],
        suggested_knowledge: body.suggestedKnowledge ?? [],
        close_mode: body.closeMode ?? 'requester_confirms',
        close_condition: body.closeCondition ?? null,
        owner_id: body.ownerId ?? null,
        documentation_url: body.documentationUrl ?? null,
        effective_date: body.effectiveDate ?? new Date().toISOString().slice(0, 10),
        review_date: body.reviewDate ?? null,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return dbFailJson(c, 'SERVICE_CATALOG_CREATE_FAILED', error);
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
    if (body.status === 'active' && current.status !== 'active') {
      return c.json(fail(reqId, 'SERVICE_CATALOG_PUBLISH_REQUIRED', 'กรุณาใช้ขั้นตอน Preview และ Publish สำหรับการเปิดใช้งานบริการ'), 409);
    }
    if (body.status === 'suspended' && current.status !== 'active') {
      return c.json(fail(reqId, 'SERVICE_CATALOG_STATUS_TRANSITION_INVALID', 'ระงับได้เฉพาะบริการที่ Published แล้ว'), 409);
    }
    if (body.status === 'retired' && !['active', 'suspended'].includes(current.status)) {
      return c.json(fail(reqId, 'SERVICE_CATALOG_STATUS_TRANSITION_INVALID', 'บริการต้อง Published ก่อน Retire'), 409);
    }
    if (current.status === 'retired' && body.status !== 'retired') {
      return c.json(fail(reqId, 'SERVICE_CATALOG_RETIRED', 'บริการที่ Retire แล้วไม่สามารถเปิดกลับมาใช้งานได้'), 409);
    }

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.serviceCode !== undefined) patch.service_code = body.serviceCode;
    if (body.serviceName !== undefined) patch.service_name = body.serviceName;
    if (body.category !== undefined) patch.category = body.category;
    if (body.description !== undefined) patch.description = body.description;
    if (body.audience !== undefined) patch.audience = body.audience;
    if (body.eligibility !== undefined) patch.eligibility = body.eligibility;
    if (body.formSchema !== undefined) patch.form_schema = body.formSchema;
    if (body.attachmentRequired !== undefined) patch.attachment_required = body.attachmentRequired;
    if (body.slaHours !== undefined) patch.sla_hours = body.slaHours;
    if (body.fulfillmentGroupId !== undefined) patch.fulfillment_group_id = body.fulfillmentGroupId;
    if (body.checklist !== undefined) patch.checklist = body.checklist;
    if (body.autoAssign !== undefined) patch.auto_assign = body.autoAssign;
    if (body.autoCreateTask !== undefined) patch.auto_create_task = body.autoCreateTask;
    if (body.estimatedCost !== undefined) patch.estimated_cost = body.estimatedCost;
    if (body.dependencies !== undefined) patch.dependencies = body.dependencies;
    if (body.suggestedKnowledge !== undefined) patch.suggested_knowledge = body.suggestedKnowledge;
    if (body.closeMode !== undefined) patch.close_mode = body.closeMode;
    if (body.closeCondition !== undefined) patch.close_condition = body.closeCondition;
    if (body.ownerId !== undefined) patch.owner_id = body.ownerId;
    if (body.documentationUrl !== undefined) patch.documentation_url = body.documentationUrl;
    if (body.effectiveDate !== undefined) patch.effective_date = body.effectiveDate;
    if (body.reviewDate !== undefined) patch.review_date = body.reviewDate;
    if (body.notes !== undefined) patch.notes = body.notes;

    const nextEffectiveDate = body.effectiveDate ?? current.effective_date ?? new Date().toISOString().slice(0, 10);
    const nextReviewDate = body.reviewDate !== undefined ? body.reviewDate : current.review_date;
    if (nextReviewDate && nextEffectiveDate && nextReviewDate < nextEffectiveDate) {
      return c.json(
        fail(reqId, 'VALIDATION_ERROR', 'Review Date ต้องไม่ก่อน Effective Date', [
          { field: 'reviewDate', message: 'ต้องไม่ก่อน Effective Date' },
        ]),
        400,
      );
    }

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

    const auditBefore = await loadAuditSnapshot(supabase, 'service_catalog', id);
    const { data, error } = await supabase.from('service_catalog').update(patch).eq('id', id).select().single();
    if (error) {
      return dbFailJson(c, 'SERVICE_CATALOG_UPDATE_FAILED', error);
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
          before: auditBefore,
      after: data,
});

    return c.json(ok(reqId, data));
  },
);

serviceCatalogRoute.post('/:id/publish', requirePermission('service_catalog.manage'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id');

  const { data: current, error: currentError } = await supabase.from('service_catalog').select('*').eq('id', id).maybeSingle();
  if (currentError || !current) {
    return c.json(fail(reqId, 'SERVICE_CATALOG_NOT_FOUND', 'ไม่พบบริการนี้'), 404);
  }
  if (current.status === 'retired') {
    return c.json(fail(reqId, 'SERVICE_CATALOG_RETIRED', 'บริการที่ Retire แล้วไม่สามารถ Publish ซ้ำได้'), 409);
  }
  if (current.status === 'active') {
    return c.json(ok(reqId, current));
  }
  if (current.review_date && current.effective_date && current.review_date < current.effective_date) {
    return c.json(fail(reqId, 'SERVICE_CATALOG_DATES_INVALID', 'Review Date ต้องไม่ก่อน Effective Date'), 400);
  }

  const publishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('service_catalog')
    .update({ status: 'active', published_at: publishedAt, updated_by: actorId })
    .eq('id', id)
    .select()
    .single();
  if (error) return dbFailJson(c, 'SERVICE_CATALOG_PUBLISH_FAILED', error);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'PUBLISH',
    module: 'service_catalog',
    targetTable: 'service_catalog',
    targetId: id,
    detail: { fromStatus: current.status, toStatus: 'active', version: data.version },
    requestId: reqId,
    before: current,
    after: data,
  });

  return c.json(ok(reqId, data));
});
