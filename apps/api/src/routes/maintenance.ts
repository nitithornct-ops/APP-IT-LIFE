import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { buildPmRoster } from '../services/pmRosterService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  cancelMaintenanceSchema,
  createMaintenancePlanSchema,
  createPmTemplateSchema,
  listMaintenancePlansQuerySchema,
  pmRosterQuerySchema,
  recordMaintenanceResultSchema,
  rescheduleMaintenanceSchema,
  setPmTemplateStatusSchema,
  startMaintenanceSchema,
  updatePmTemplateSchema,
} from '../validators/maintenance';

/**
 * PM / บำรุงรักษาเชิงป้องกัน — สืบทอดจาก MaintenancePlans เดิม โดยรวมสอง service ของระบบเดิมเข้าเป็น
 * ไฟล์เดียว (Module_ITAssetExtras.gs เป็นเจ้าของ plan CRUD + auto-recurrence, Module_PMExtras.gs เป็น
 * เจ้าของ start/reschedule + templates + คำนวณวันครบกำหนดถัดไป — สองไฟล์เดิมเรียกฟังก์ชันข้ามกันเป็น
 * circular dependency ในระบบเดิม ระบบใหม่รวมเป็นไฟล์เดียวไม่มีเหตุผลต้องแยก) Analytics/6-month trend
 * เลื่อนไป Report Center (roadmap ลำดับ 20) เหมือนโมดูลอื่นในไฟล์นี้
 */
export const maintenancePlansRoute = new Hono<AppEnv>();
maintenancePlansRoute.use('*', requireAuth);

export const pmTemplatesRoute = new Hono<AppEnv>();
pmTemplatesRoute.use('*', requireAuth);

const PLAN_SELECT =
  'id, asset_id, plan_date, actual_date, status, work_type, recurrence, next_due_date, technician_id, checklist_json, ' +
  'result, notes, template_id, recurring_parent_id, vendor_id, contract_id, created_at, updated_at, ' +
  'asset:assets(id, asset_code, name), technician:employees(id, first_name_th, last_name_th, nickname), ' +
  'vendor:vendors(id, vendor_code, name, status), contract:contracts(id, contract_number, name, status, end_date)';

function computeNextPmDate(baseDate: string, recurrence: string): string | null {
  if (!baseDate) return null;
  const d = new Date(baseDate);
  if (Number.isNaN(d.getTime())) return null;
  if (recurrence === 'รายเดือน') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (recurrence === 'รายไตรมาส') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (recurrence === 'รายปี') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}

interface ChecklistItem {
  text: string;
}

function resetChecklist(items: unknown): ChecklistItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({ text: String((it as { text?: string })?.text ?? '').trim() }))
    .filter((it) => it.text.length > 0);
}

maintenancePlansRoute.get(
  '/',
  requirePermission('maintenance.view'),
  zValidator('query', listMaintenancePlansQuerySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const { page, pageSize, status, assetId, workType } = c.req.valid('query');

    let query = supabase
      .from('maintenance_plans')
      .select(PLAN_SELECT, { count: 'exact' })
      .order('plan_date', { ascending: false })
      .range(...paginationRange(page, pageSize));

    if (status) query = query.eq('status', status);
    if (assetId) query = query.eq('asset_id', assetId);
    if (workType) query = query.eq('work_type', workType);

    const { data, count, error } = await query;
    if (error) return c.json(fail(reqId, 'MAINTENANCE_LIST_FAILED', 'ดึงแผน PM ไม่สำเร็จ'), 400);
    return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
  },
);

maintenancePlansRoute.get(
  '/roster',
  requirePermission('maintenance.view'),
  zValidator('query', pmRosterQuerySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const { weekStart } = c.req.valid('query');
    const start = new Date(`${weekStart}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() + 6);
    const weekEnd = start.toISOString().slice(0, 10);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    const [weekResult, overdueResult] = await Promise.all([
      supabase.from('maintenance_plans').select(PLAN_SELECT).gte('plan_date', weekStart).lte('plan_date', weekEnd).order('plan_date'),
      supabase.from('maintenance_plans').select(PLAN_SELECT, { count: 'exact' }).lt('plan_date', today).in('status', ['วางแผน', 'กำลังดำเนินการ']).order('plan_date').limit(1000),
    ]);
    if (weekResult.error || overdueResult.error) {
      return dbFailJson(c, 'PM_ROSTER_LOAD_FAILED', weekResult.error ?? overdueResult.error, 'โหลดตารางกำลังคน PM ไม่สำเร็จ');
    }
    return c.json(ok(reqId, buildPmRoster({
      weekRows: (weekResult.data ?? []) as unknown as Array<Record<string, unknown>>,
      overdueRows: (overdueResult.data ?? []) as unknown as Array<Record<string, unknown>>,
      overdueTotal: overdueResult.count ?? undefined,
      weekStart,
      today,
    })));
  },
);

maintenancePlansRoute.get('/:id', requirePermission('maintenance.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data, error } = await supabase.from('maintenance_plans').select(PLAN_SELECT).eq('id', id).maybeSingle();
  if (error) return c.json(fail(reqId, 'MAINTENANCE_LOAD_FAILED', 'ดึงข้อมูลแผน PM ไม่สำเร็จ'), 400);
  if (!data) return c.json(fail(reqId, 'MAINTENANCE_NOT_FOUND', 'ไม่พบแผน PM นี้'), 404);
  return c.json(ok(reqId, data));
});

maintenancePlansRoute.post(
  '/',
  requirePermission('maintenance.manage'),
  zValidator('json', createMaintenancePlanSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    let checklist: ChecklistItem[] = body.checklistItems ?? [];
    if (!checklist.length && body.templateId) {
      const { data: template } = await supabase.from('pm_checklist_templates').select('items_json').eq('id', body.templateId).maybeSingle();
      if (template) checklist = resetChecklist(template.items_json);
    }

    const { data, error } = await supabase
      .from('maintenance_plans')
      .insert({
        asset_id: body.assetId,
        plan_date: body.planDate,
        work_type: body.workType ?? 'PM',
        recurrence: body.recurrence ?? 'ครั้งเดียว',
        technician_id: body.technicianId ?? null,
        vendor_id: body.vendorId ?? null,
        contract_id: body.contractId ?? null,
        template_id: body.templateId ?? null,
        checklist_json: checklist,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select(PLAN_SELECT)
      .single();

    if (error) return dbFailJson(c, 'MAINTENANCE_CREATE_FAILED', error);
    const createdId = (data as unknown as { id: string }).id;

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'maintenance',
      targetTable: 'maintenance_plans',
      targetId: createdId,
      detail: { assetId: body.assetId, planDate: body.planDate },
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

maintenancePlansRoute.post(
  '/:id/start',
  requirePermission('maintenance.manage'),
  zValidator('json', startMaintenanceSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { technicianId } = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('maintenance_plans').select('*').eq('id', id).maybeSingle();
    if (currentError) return c.json(fail(reqId, 'MAINTENANCE_LOAD_FAILED', 'ดึงข้อมูลแผน PM ไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'MAINTENANCE_NOT_FOUND', 'ไม่พบแผน PM นี้'), 404);
    if (current.status === 'ดำเนินการแล้ว' || current.status === 'ยกเลิก') {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้เสร็จสิ้น/ยกเลิกแล้ว ไม่สามารถเริ่มดำเนินการได้'), 400);
    }

    const patch: Record<string, unknown> = { status: 'กำลังดำเนินการ', updated_by: actorId };
    if (technicianId) patch.technician_id = technicianId;

    const { data, error } = await supabase.from('maintenance_plans').update(patch).eq('id', id).select(PLAN_SELECT).single();
    if (error) return dbFailJson(c, 'MAINTENANCE_START_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'START',
      module: 'maintenance',
      targetTable: 'maintenance_plans',
      targetId: id,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

maintenancePlansRoute.post(
  '/:id/result',
  requirePermission('maintenance.manage'),
  zValidator('json', recordMaintenanceResultSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { status, actualDate, checklistResults, notes } = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('maintenance_plans').select('*').eq('id', id).maybeSingle();
    if (currentError) return c.json(fail(reqId, 'MAINTENANCE_LOAD_FAILED', 'ดึงข้อมูลแผน PM ไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'MAINTENANCE_NOT_FOUND', 'ไม่พบแผน PM นี้'), 404);
    if (current.status === 'ยกเลิก') {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้ถูกยกเลิกแล้ว'), 400);
    }

    let resultSummary = notes ?? current.result ?? '';
    const checklist = checklistResults ?? (Array.isArray(current.checklist_json) ? current.checklist_json : []);
    if (checklistResults?.length) {
      const passCount = checklistResults.filter((it) => it.result === 'ผ่าน').length;
      resultSummary = `เช็กลิสต์ผ่าน ${passCount}/${checklistResults.length}${notes ? ` — ${notes}` : ''}`;
    }

    const patch: Record<string, unknown> = {
      status,
      checklist_json: checklist,
      result: resultSummary,
      notes: notes ?? current.notes,
      updated_by: actorId,
    };
    if (status === 'ดำเนินการแล้ว') {
      patch.actual_date = actualDate || new Date().toISOString().slice(0, 10);
    } else if (actualDate) {
      patch.actual_date = actualDate;
    }

    let nextPlanCreated: string | null = null;
    if (status === 'ดำเนินการแล้ว' && current.recurrence && current.recurrence !== 'ครั้งเดียว') {
      const baseDate = (patch.actual_date as string) || current.plan_date;
      const nextDueDate = computeNextPmDate(baseDate, current.recurrence);
      patch.next_due_date = nextDueDate;
      if (nextDueDate) {
        const { data: existing } = await supabase
          .from('maintenance_plans')
          .select('id')
          .eq('recurring_parent_id', id)
          .eq('plan_date', nextDueDate)
          .maybeSingle();
        if (!existing) {
          const { data: nextPlan } = await supabase
            .from('maintenance_plans')
            .insert({
              asset_id: current.asset_id,
              plan_date: nextDueDate,
              recurrence: current.recurrence,
              technician_id: current.technician_id,
              vendor_id: current.vendor_id,
              contract_id: current.contract_id,
              template_id: current.template_id,
              checklist_json: resetChecklist(checklist),
              notes: `สร้างอัตโนมัติต่อจากแผน ${id}`,
              recurring_parent_id: id,
              created_by: actorId,
            })
            .select('id')
            .single();
          nextPlanCreated = nextPlan?.id ?? null;
        }
      }
    }

    const { data, error } = await supabase.from('maintenance_plans').update(patch).eq('id', id).select(PLAN_SELECT).single();
    if (error) return dbFailJson(c, 'MAINTENANCE_RESULT_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'RECORD_RESULT',
      module: 'maintenance',
      targetTable: 'maintenance_plans',
      targetId: id,
      detail: { status, nextPlanCreated },
      requestId: reqId,
    });

    return c.json(ok(reqId, { ...(data as unknown as Record<string, unknown>), nextPlanCreated }));
  },
);

maintenancePlansRoute.post(
  '/:id/reschedule',
  requirePermission('maintenance.manage'),
  zValidator('json', rescheduleMaintenanceSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { planDate, reason } = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('maintenance_plans').select('*').eq('id', id).maybeSingle();
    if (currentError) return c.json(fail(reqId, 'MAINTENANCE_LOAD_FAILED', 'ดึงข้อมูลแผน PM ไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'MAINTENANCE_NOT_FOUND', 'ไม่พบแผน PM นี้'), 404);
    if (current.status === 'ดำเนินการแล้ว' || current.status === 'ยกเลิก') {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้เสร็จสิ้น/ยกเลิกแล้ว ไม่สามารถเลื่อนวันได้'), 400);
    }

    const trail = `เลื่อนวันจาก ${current.plan_date} เป็น ${planDate}${reason ? ` (${reason})` : ''}`;
    const patch: Record<string, unknown> = {
      plan_date: planDate,
      notes: current.notes ? `${current.notes}\n${trail}` : trail,
      updated_by: actorId,
    };
    if (current.recurrence && current.recurrence !== 'ครั้งเดียว') {
      patch.next_due_date = computeNextPmDate(planDate, current.recurrence);
    }

    const { data, error } = await supabase.from('maintenance_plans').update(patch).eq('id', id).select(PLAN_SELECT).single();
    if (error) return dbFailJson(c, 'MAINTENANCE_RESCHEDULE_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'RESCHEDULE',
      module: 'maintenance',
      targetTable: 'maintenance_plans',
      targetId: id,
      detail: { planDate, reason },
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

maintenancePlansRoute.post(
  '/:id/cancel',
  requirePermission('maintenance.manage'),
  zValidator('json', cancelMaintenanceSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { reason } = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('maintenance_plans').select('*').eq('id', id).maybeSingle();
    if (currentError) return c.json(fail(reqId, 'MAINTENANCE_LOAD_FAILED', 'ดึงข้อมูลแผน PM ไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'MAINTENANCE_NOT_FOUND', 'ไม่พบแผน PM นี้'), 404);
    if (current.status === 'ดำเนินการแล้ว') {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้เสร็จสิ้นแล้ว ไม่สามารถยกเลิกได้'), 400);
    }

    const patch = {
      status: 'ยกเลิก',
      notes: reason ? `${current.notes ? `${current.notes}\n` : ''}ยกเลิก: ${reason}` : current.notes,
      updated_by: actorId,
    };

    const { data, error } = await supabase.from('maintenance_plans').update(patch).eq('id', id).select(PLAN_SELECT).single();
    if (error) return dbFailJson(c, 'MAINTENANCE_CANCEL_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CANCEL',
      module: 'maintenance',
      targetTable: 'maintenance_plans',
      targetId: id,
      detail: { reason },
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

// ===== PM Checklist Templates =====

pmTemplatesRoute.get('/', requirePermission('maintenance.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const includeInactive = c.req.query('includeInactive') === 'true';

  let query = supabase.from('pm_checklist_templates').select('*').order('name', { ascending: true });
  if (!includeInactive) query = query.eq('status', 'active');

  const { data, error } = await query;
  if (error) return c.json(fail(reqId, 'PM_TEMPLATES_LIST_FAILED', 'ดึงเทมเพลตเช็กลิสต์ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data));
});

pmTemplatesRoute.post('/', requirePermission('maintenance.manage'), zValidator('json', createPmTemplateSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('pm_checklist_templates')
    .insert({
      name: body.name,
      category: body.category ?? null,
      items_json: body.items.map((text) => ({ text })),
      notes: body.notes ?? null,
      created_by: actorId,
    })
    .select()
    .single();

  if (error) return dbFailJson(c, 'PM_TEMPLATE_CREATE_FAILED', error);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'maintenance',
    targetTable: 'pm_checklist_templates',
    targetId: data.id,
    detail: { name: body.name },
    requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

pmTemplatesRoute.patch('/:id', requirePermission('maintenance.manage'), zValidator('json', updatePmTemplateSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.name !== undefined) patch.name = body.name;
  if (body.category !== undefined) patch.category = body.category;
  if (body.items !== undefined) patch.items_json = body.items.map((text) => ({ text }));
  if (body.notes !== undefined) patch.notes = body.notes;

  const auditBefore = await loadAuditSnapshot(supabase, 'pm_checklist_templates', id);
  const { data, error } = await supabase.from('pm_checklist_templates').update(patch).eq('id', id).select().single();
  if (error) return dbFailJson(c, 'PM_TEMPLATE_UPDATE_FAILED', error);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'maintenance',
    targetTable: 'pm_checklist_templates',
    targetId: id,
    detail: body,
    requestId: reqId,
      before: auditBefore,
    after: data,
});

  return c.json(ok(reqId, data));
});

pmTemplatesRoute.post(
  '/:id/status',
  requirePermission('maintenance.manage'),
  zValidator('json', setPmTemplateStatusSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { status } = c.req.valid('json');

    const { data, error } = await supabase.from('pm_checklist_templates').update({ status, updated_by: actorId }).eq('id', id).select().single();
    if (error) return dbFailJson(c, 'PM_TEMPLATE_STATUS_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE_STATUS',
      module: 'maintenance',
      targetTable: 'pm_checklist_templates',
      targetId: id,
      detail: { status },
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);
