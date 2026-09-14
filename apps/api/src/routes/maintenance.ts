import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { buildPmRoster } from '../services/pmRosterService';
import type { AppEnv } from '../types';
import { checkExportSize, exportFileName, listCsv, LIST_EXPORT_MAX_ROWS, type ExportColumn } from '../utils/listExport';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  cancelMaintenanceSchema,
  createMaintenancePlanSchema,
  createPmTemplateSchema,
  listMaintenancePlansQuerySchema,
  PM_CHECK_RESULTS,
  PM_RECURRENCES,
  PM_RECURRENCE_BASES,
  PM_STATUSES,
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
  'id, asset_id, plan_date, original_plan_date, actual_date, status, work_type, recurrence, recurrence_basis, next_due_date, technician_id, checklist_json, ' +
  'result, notes, template_id, recurring_parent_id, vendor_id, contract_id, created_at, updated_at, ' +
  'asset:assets(id, asset_code, name), technician:employees(id, first_name_th, last_name_th, nickname), ' +
  'vendor:vendors(id, vendor_code, name, status), contract:contracts(id, contract_number, name, status, end_date)';

interface ChecklistItem {
  text: string;
  required: boolean;
  result: (typeof PM_CHECK_RESULTS)[number];
  note?: string;
}

const PM_STATUS_PLANNED = PM_STATUSES[0];
const PM_STATUS_IN_PROGRESS = PM_STATUSES[1];
const PM_STATUS_COMPLETED = PM_STATUSES[2];
const PM_STATUS_CANCELLED = PM_STATUSES[3];
const PM_RECURRENCE_ONCE = PM_RECURRENCES[0];
const PM_RECURRENCE_SCHEDULED = PM_RECURRENCE_BASES[0];
const PM_RECURRENCE_ACTUAL = PM_RECURRENCE_BASES[1];

function isChecklistResult(value: unknown): value is (typeof PM_CHECK_RESULTS)[number] {
  return typeof value === 'string' && (PM_CHECK_RESULTS as readonly string[]).includes(value);
}

function normalizeChecklist(items: unknown, resetResults = false): ChecklistItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const row = it && typeof it === 'object' ? it as { text?: unknown; required?: unknown; result?: unknown; note?: unknown } : {};
      return {
        text: String(row.text ?? '').trim(),
        required: row.required !== false,
        result: resetResults ? PM_CHECK_RESULTS[0] : (isChecklistResult(row.result) ? row.result : PM_CHECK_RESULTS[0]),
        ...(typeof row.note === 'string' && row.note.trim() ? { note: row.note.trim() } : {}),
      };
    })
    .filter((it) => it.text.length > 0);
}

function resetChecklist(items: unknown): ChecklistItem[] {
  return normalizeChecklist(items, true);
}

function mergeChecklistResults(currentItems: unknown, incoming: Array<{ text: string; result?: (typeof PM_CHECK_RESULTS)[number]; note?: string }> | undefined): ChecklistItem[] | null {
  const current = normalizeChecklist(currentItems);
  if (incoming === undefined) return current;
  if (incoming.length !== current.length || incoming.some((item, index) => item.text !== current[index]?.text)) return null;
  return current.map((item, index) => ({
    ...item,
    result: incoming[index]?.result ?? item.result,
    ...(incoming[index]?.note !== undefined ? { note: incoming[index].note } : {}),
  }));
}

export function computeNextPmDate(baseDate: string, recurrence: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) return null;
  const [year, month, day] = baseDate.split('-').map(Number);
  const monthOffset = recurrence === PM_RECURRENCES[1] ? 1 : recurrence === PM_RECURRENCES[2] ? 3 : recurrence === PM_RECURRENCES[3] ? 12 : 0;
  if (!monthOffset || !year || !month || !day) return null;
  const monthIndex = month - 1 + monthOffset;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear.toString().padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function todayInBangkok(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

interface MaintenanceExportRow {
  asset?: { asset_code?: string | null; name?: string | null } | Array<{ asset_code?: string | null; name?: string | null }> | null;
  technician?: { first_name_th?: string | null; last_name_th?: string | null } | Array<{ first_name_th?: string | null; last_name_th?: string | null }> | null;
  plan_date?: string | null;
  original_plan_date?: string | null;
  actual_date?: string | null;
  recurrence?: string | null;
  recurrence_basis?: string | null;
  next_due_date?: string | null;
  status?: string | null;
  result?: string | null;
}

const PM_EXPORT_COLUMNS: ExportColumn<MaintenanceExportRow>[] = [
  { label: 'Asset Code', value: (row) => relationOne(row.asset)?.asset_code ?? '' },
  { label: 'Asset Name', value: (row) => relationOne(row.asset)?.name ?? '' },
  { label: 'Original Plan Date', value: (row) => row.original_plan_date ?? '' },
  { label: 'Scheduled Plan Date', value: (row) => row.plan_date ?? '' },
  { label: 'Actual Date', value: (row) => row.actual_date ?? '' },
  { label: 'Recurrence', value: (row) => row.recurrence ?? '' },
  { label: 'Recurrence Basis', value: (row) => row.recurrence_basis ?? '' },
  { label: 'Next Due Date', value: (row) => row.next_due_date ?? '' },
  { label: 'Technician', value: (row) => { const person = relationOne(row.technician); return [person?.first_name_th, person?.last_name_th].filter(Boolean).join(' '); } },
  { label: 'Status', value: (row) => row.status ?? '' },
  { label: 'Result', value: (row) => row.result ?? '' },
];

maintenancePlansRoute.get(
  '/',
  requirePermission('maintenance.view'),
  zValidator('query', listMaintenancePlansQuerySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const { page, pageSize, status, recurrence, assetId, workType, search, planDateFrom, planDateTo } = c.req.valid('query');

    let searchPlanIds: string[] | undefined;
    if (search) {
      const safeSearch = cleanSearch(search);
      if (safeSearch) {
        const [assetSearch, employeeSearch, vendorSearch] = await Promise.all([
          supabase.from('assets').select('id').or(`asset_code.ilike.%${safeSearch}%,name.ilike.%${safeSearch}%`),
          supabase.from('employees').select('id').or(`first_name_th.ilike.%${safeSearch}%,last_name_th.ilike.%${safeSearch}%,nickname.ilike.%${safeSearch}%`),
          supabase.from('vendors').select('id').or(`vendor_code.ilike.%${safeSearch}%,name.ilike.%${safeSearch}%`),
        ]);
        const searchError = assetSearch.error ?? employeeSearch.error ?? vendorSearch.error;
        if (searchError) return dbFailJson(c, 'MAINTENANCE_LIST_FAILED', searchError);
        const employeeIds = (employeeSearch.data ?? []).map((row) => row.id);
        const vendorIds = (vendorSearch.data ?? []).map((row) => row.id);
        const assetIds = (assetSearch.data ?? []).map((row) => row.id);

        // An employee/vendor match must be resolved to plans before pagination;
        // otherwise a search would silently miss records outside the first page.
        const [assetPlans, employeePlans, vendorPlans] = await Promise.all([
          assetIds.length ? supabase.from('maintenance_plans').select('id').in('asset_id', assetIds) : Promise.resolve({ data: [], error: null }),
          employeeIds.length ? supabase.from('maintenance_plans').select('id, asset_id').in('technician_id', employeeIds) : Promise.resolve({ data: [], error: null }),
          vendorIds.length ? supabase.from('maintenance_plans').select('id, asset_id').in('vendor_id', vendorIds) : Promise.resolve({ data: [], error: null }),
        ]);
        const planSearchError = assetPlans.error ?? employeePlans.error ?? vendorPlans.error;
        if (planSearchError) return dbFailJson(c, 'MAINTENANCE_LIST_FAILED', planSearchError);
        searchPlanIds = [...new Set([
          ...(assetPlans.data ?? []).map((row) => row.id),
          ...(employeePlans.data ?? []).map((row) => row.id),
          ...(vendorPlans.data ?? []).map((row) => row.id),
        ])];
        if (searchPlanIds.length === 0) return c.json(ok(reqId, toPaginatedData([], 0, page, pageSize)));
      }
    }

    let query = supabase
      .from('maintenance_plans')
      .select(PLAN_SELECT, { count: 'exact' })
      .order('plan_date', { ascending: false })
      .range(...paginationRange(page, pageSize));

    if (status) query = query.eq('status', status);
    if (recurrence) query = query.eq('recurrence', recurrence);
    if (assetId) query = query.eq('asset_id', assetId);
    if (workType) query = query.eq('work_type', workType);
    if (searchPlanIds) query = query.in('id', searchPlanIds);
    if (planDateFrom) query = query.gte('plan_date', planDateFrom);
    if (planDateTo) query = query.lte('plan_date', planDateTo);

    const { data, count, error } = await query;
    if (error) return c.json(fail(reqId, 'MAINTENANCE_LIST_FAILED', 'ดึงแผน PM ไม่สำเร็จ'), 400);
    return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
  },
);

maintenancePlansRoute.get('/summary', requirePermission('maintenance.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const today = todayInBangkok();
  const upcomingLimit = new Date(`${today}T00:00:00.000Z`);
  upcomingLimit.setUTCDate(upcomingLimit.getUTCDate() + 7);
  const upcomingTo = upcomingLimit.toISOString().slice(0, 10);

  const [total, upcoming, overdue, completed] = await Promise.all([
    supabase.from('maintenance_plans').select('id', { count: 'exact', head: true }),
    supabase.from('maintenance_plans').select('id', { count: 'exact', head: true }).eq('status', PM_STATUS_PLANNED).gte('plan_date', today).lte('plan_date', upcomingTo),
    supabase.from('maintenance_plans').select('id', { count: 'exact', head: true }).in('status', [PM_STATUS_PLANNED, PM_STATUS_IN_PROGRESS]).lt('plan_date', today),
    supabase.from('maintenance_plans').select('id', { count: 'exact', head: true }).eq('status', PM_STATUS_COMPLETED),
  ]);
  const summaryError = total.error ?? upcoming.error ?? overdue.error ?? completed.error;
  if (summaryError) return dbFailJson(c, 'MAINTENANCE_SUMMARY_FAILED', summaryError);
  return c.json(ok(reqId, {
    total: total.count ?? 0,
    upcoming: upcoming.count ?? 0,
    overdue: overdue.count ?? 0,
    completed: completed.count ?? 0,
  }));
});

/** ส่งออกข้อมูล PM ทั้งชุดตามตัวกรองเดียวกับรายการบนหน้าจอ */
maintenancePlansRoute.get('/export', requirePermission('maintenance.view'), zValidator('query', listMaintenancePlansQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { status, recurrence, assetId, workType, search, planDateFrom, planDateTo } = c.req.valid('query');

  let searchPlanIds: string[] | undefined;
  if (search) {
    const safeSearch = cleanSearch(search);
    if (safeSearch) {
      const [assetSearch, employeeSearch, vendorSearch] = await Promise.all([
        supabase.from('assets').select('id').or(`asset_code.ilike.%${safeSearch}%,name.ilike.%${safeSearch}%`),
        supabase.from('employees').select('id').or(`first_name_th.ilike.%${safeSearch}%,last_name_th.ilike.%${safeSearch}%,nickname.ilike.%${safeSearch}%`),
        supabase.from('vendors').select('id').or(`vendor_code.ilike.%${safeSearch}%,name.ilike.%${safeSearch}%`),
      ]);
      const searchError = assetSearch.error ?? employeeSearch.error ?? vendorSearch.error;
      if (searchError) return dbFailJson(c, 'MAINTENANCE_EXPORT_FAILED', searchError);
      const employeeIds = (employeeSearch.data ?? []).map((row) => row.id);
      const vendorIds = (vendorSearch.data ?? []).map((row) => row.id);
      const assetIds = (assetSearch.data ?? []).map((row) => row.id);
      const [assetPlans, employeePlans, vendorPlans] = await Promise.all([
        assetIds.length ? supabase.from('maintenance_plans').select('id').in('asset_id', assetIds) : Promise.resolve({ data: [], error: null }),
        employeeIds.length ? supabase.from('maintenance_plans').select('id').in('technician_id', employeeIds) : Promise.resolve({ data: [], error: null }),
        vendorIds.length ? supabase.from('maintenance_plans').select('id').in('vendor_id', vendorIds) : Promise.resolve({ data: [], error: null }),
      ]);
      const planSearchError = assetPlans.error ?? employeePlans.error ?? vendorPlans.error;
      if (planSearchError) return dbFailJson(c, 'MAINTENANCE_EXPORT_FAILED', planSearchError);
      searchPlanIds = [...new Set([
        ...(assetPlans.data ?? []).map((row) => row.id),
        ...(employeePlans.data ?? []).map((row) => row.id),
        ...(vendorPlans.data ?? []).map((row) => row.id),
      ])];
      if (searchPlanIds.length === 0) {
        return c.json(ok(reqId, { filename: exportFileName('pm-plans'), csv: listCsv(PM_EXPORT_COLUMNS, []), rowCount: 0 }));
      }
    }
  }

  let countQuery = supabase.from('maintenance_plans').select('id', { count: 'exact', head: true });
  if (status) countQuery = countQuery.eq('status', status);
  if (recurrence) countQuery = countQuery.eq('recurrence', recurrence);
  if (assetId) countQuery = countQuery.eq('asset_id', assetId);
  if (workType) countQuery = countQuery.eq('work_type', workType);
  if (searchPlanIds) countQuery = countQuery.in('id', searchPlanIds);
  if (planDateFrom) countQuery = countQuery.gte('plan_date', planDateFrom);
  if (planDateTo) countQuery = countQuery.lte('plan_date', planDateTo);
  const { count, error: countError } = await countQuery;
  if (countError) return dbFailJson(c, 'MAINTENANCE_EXPORT_FAILED', countError);
  const tooLarge = checkExportSize(count);
  if (tooLarge) return c.json(fail(reqId, 'EXPORT_TOO_LARGE', tooLarge.message), 400);

  let query = supabase.from('maintenance_plans').select(
    'plan_date, original_plan_date, actual_date, recurrence, recurrence_basis, next_due_date, status, result, asset:assets(asset_code, name), technician:employees(first_name_th, last_name_th)',
  ).order('plan_date', { ascending: false }).range(0, LIST_EXPORT_MAX_ROWS - 1);
  if (status) query = query.eq('status', status);
  if (recurrence) query = query.eq('recurrence', recurrence);
  if (assetId) query = query.eq('asset_id', assetId);
  if (workType) query = query.eq('work_type', workType);
  if (searchPlanIds) query = query.in('id', searchPlanIds);
  if (planDateFrom) query = query.gte('plan_date', planDateFrom);
  if (planDateTo) query = query.lte('plan_date', planDateTo);
  const { data, error } = await query;
  if (error) return dbFailJson(c, 'MAINTENANCE_EXPORT_FAILED', error);

  const rows = (data ?? []) as unknown as MaintenanceExportRow[];
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'EXPORT',
    module: 'maintenance',
    targetTable: 'maintenance_plans',
    detail: { filters: { status, recurrence, assetId, workType, search, planDateFrom, planDateTo }, rowCount: rows.length, totalRows: count ?? 0 },
    requestId: reqId,
  });
  return c.json(ok(reqId, { filename: exportFileName('pm-plans'), csv: listCsv(PM_EXPORT_COLUMNS, rows), rowCount: rows.length }));
});

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
    const today = todayInBangkok();

    const [weekResult, overdueResult] = await Promise.all([
      supabase.from('maintenance_plans').select(PLAN_SELECT).gte('plan_date', weekStart).lte('plan_date', weekEnd).order('plan_date'),
      supabase.from('maintenance_plans').select(PLAN_SELECT, { count: 'exact' }).lt('plan_date', today).in('status', [PM_STATUS_PLANNED, PM_STATUS_IN_PROGRESS]).order('plan_date').limit(1000),
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

    const requestedChecklist = body.checklistItems ?? [];
    let checklist: unknown = requestedChecklist;
    if ((!Array.isArray(requestedChecklist) || requestedChecklist.length === 0) && body.templateId) {
      const { data: template } = await supabase.from('pm_checklist_templates').select('items_json').eq('id', body.templateId).maybeSingle();
      if (template) checklist = resetChecklist(template.items_json);
    }

    const { data, error } = await supabase
      .from('maintenance_plans')
      .insert({
        asset_id: body.assetId,
        plan_date: body.planDate,
        work_type: body.workType ?? 'PM',
        recurrence: body.recurrence ?? PM_RECURRENCES[0],
        recurrence_basis: body.recurrenceBasis ?? PM_RECURRENCE_SCHEDULED,
        original_plan_date: body.planDate,
        technician_id: body.technicianId ?? null,
        vendor_id: body.vendorId ?? null,
        contract_id: body.contractId ?? null,
        template_id: body.templateId ?? null,
        checklist_json: normalizeChecklist(checklist, true),
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
    if (current.status === PM_STATUS_COMPLETED || current.status === PM_STATUS_CANCELLED) {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้เสร็จสิ้น/ยกเลิกแล้ว ไม่สามารถเริ่มดำเนินการได้'), 400);
    }

    const patch: Record<string, unknown> = { status: PM_STATUS_IN_PROGRESS, updated_by: actorId };
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
    if (current.status === PM_STATUS_COMPLETED || current.status === PM_STATUS_CANCELLED) {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้ปิดงานหรือยกเลิกแล้ว ไม่สามารถแก้ผลผ่าน API ได้'), 400);
    }

    const checklist = mergeChecklistResults(current.checklist_json, checklistResults);
    if (!checklist) {
      return c.json(fail(reqId, 'MAINTENANCE_CHECKLIST_INVALID', 'รายการเช็กลิสต์ไม่ตรงกับแผน PM นี้'), 400);
    }
    const actualDateValue = actualDate || todayInBangkok();
    const incompleteRequired = checklist.filter((item) => item.required && item.result === PM_CHECK_RESULTS[0]);
    if (status === PM_STATUS_COMPLETED && incompleteRequired.length > 0) {
      return c.json(fail(reqId, 'MAINTENANCE_CHECKLIST_INCOMPLETE', `กรุณาระบุผลตรวจรายการที่จำเป็นให้ครบ (${incompleteRequired.length} รายการ)`), 422);
    }

    const passCount = checklist.filter((item) => item.result === PM_CHECK_RESULTS[1]).length;
    const pendingCount = checklist.filter((item) => item.result === PM_CHECK_RESULTS[0]).length;
    const resultSummary = checklist.length
      ? `เช็กลิสต์ผ่าน ${passCount}/${checklist.length}${pendingCount ? ` ยังไม่ตรวจ ${pendingCount} รายการ` : ''}${notes ? ` — ${notes}` : ''}`
      : notes ?? current.result ?? '';

    if (status !== PM_STATUS_COMPLETED) {
      const patch: Record<string, unknown> = {
        status,
        checklist_json: checklist,
        result: resultSummary,
        notes: notes ?? current.notes,
        updated_by: actorId,
      };
      if (actualDate) patch.actual_date = actualDate;
      const { data, error } = await supabase.from('maintenance_plans').update(patch).eq('id', id).select(PLAN_SELECT).single();
      if (error) return dbFailJson(c, 'MAINTENANCE_RESULT_FAILED', error);
      await writeAuditLog(c.env, {
        actorId,
        actorEmail: c.get('userEmail'),
        action: 'RECORD_RESULT',
        module: 'maintenance',
        targetTable: 'maintenance_plans',
        targetId: id,
        detail: { status, pendingCount },
        requestId: reqId,
      });
      return c.json(ok(reqId, { ...(data as unknown as Record<string, unknown>), nextPlanCreated: false, nextPlanId: null }));
    }

    const nextDueDate = current.recurrence !== PM_RECURRENCE_ONCE
      ? computeNextPmDate(current.recurrence_basis === PM_RECURRENCE_ACTUAL ? actualDateValue : current.plan_date, current.recurrence)
      : null;
    if (current.recurrence !== PM_RECURRENCE_ONCE && !nextDueDate) {
      return c.json(fail(reqId, 'MAINTENANCE_NEXT_PLAN_FAILED', 'คำนวณกำหนดรอบถัดไปไม่สำเร็จ งานเดิมยังไม่ถูกปิด'), 422);
    }

    const { data: transaction, error: transactionError } = await createAdminClient(c.env).rpc('complete_maintenance_plan', {
      plan_id_input: id,
      actual_date_input: actualDateValue,
      checklist_input: checklist,
      result_input: resultSummary,
      notes_input: notes ?? current.notes,
      next_due_date_input: nextDueDate,
      next_checklist_input: resetChecklist(checklist),
      actor_id_input: actorId,
      actor_email_input: c.get('userEmail'),
      request_id_input: reqId,
    });
    if (transactionError?.message.includes('MAINTENANCE_TERMINAL')) {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้ปิดงานหรือยกเลิกแล้ว ไม่สามารถแก้ผลผ่าน API ได้'), 400);
    }
    if (transactionError?.message.includes('MAINTENANCE_NOT_FOUND')) {
      return c.json(fail(reqId, 'MAINTENANCE_NOT_FOUND', 'ไม่พบแผน PM นี้'), 404);
    }
    if (transactionError?.message.includes('MAINTENANCE_NEXT_PLAN_FAILED')) {
      return c.json(fail(reqId, 'MAINTENANCE_NEXT_PLAN_FAILED', 'สร้างรอบถัดไปไม่สำเร็จ งานเดิมยังไม่ถูกปิดเพื่อป้องกันข้อมูลไม่ครบ'), 409);
    }
    if (transactionError) return dbFailJson(c, 'MAINTENANCE_RESULT_FAILED', transactionError, 'บันทึกผล PM และสร้างรอบถัดไปไม่สำเร็จ งานเดิมยังไม่ถูกปิด');

    const { data, error } = await supabase.from('maintenance_plans').select(PLAN_SELECT).eq('id', id).single();
    if (error) return dbFailJson(c, 'MAINTENANCE_RESULT_FAILED', error);
    const transactionResult = transaction as { nextPlanCreated?: boolean; nextPlanId?: string | null } | null;
    return c.json(ok(reqId, {
      ...(data as unknown as Record<string, unknown>),
      nextPlanCreated: transactionResult?.nextPlanCreated ?? false,
      nextPlanId: transactionResult?.nextPlanId ?? null,
    }));
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
    if (current.status === PM_STATUS_COMPLETED || current.status === PM_STATUS_CANCELLED) {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้เสร็จสิ้น/ยกเลิกแล้ว ไม่สามารถเลื่อนวันได้'), 400);
    }

    const trail = `เลื่อนวันจาก ${current.plan_date} เป็น ${planDate} (${reason})`;
    const patch: Record<string, unknown> = {
      plan_date: planDate,
      notes: current.notes ? `${current.notes}\n${trail}` : trail,
      updated_by: actorId,
    };
    if (current.recurrence && current.recurrence !== PM_RECURRENCE_ONCE) {
      patch.next_due_date = current.recurrence_basis === PM_RECURRENCE_ACTUAL ? null : computeNextPmDate(planDate, current.recurrence);
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
      detail: {
        fromPlanDate: current.plan_date,
        toPlanDate: planDate,
        originalPlanDate: current.original_plan_date ?? current.plan_date,
        reason,
      },
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
    if (current.status === PM_STATUS_COMPLETED || current.status === PM_STATUS_CANCELLED) {
      return c.json(fail(reqId, 'MAINTENANCE_TERMINAL', 'แผนนี้ปิดงานหรือยกเลิกแล้ว ไม่สามารถยกเลิกซ้ำได้'), 400);
    }

    const patch = {
      status: PM_STATUS_CANCELLED,
      notes: `${current.notes ? `${current.notes}\n` : ''}ยกเลิก: ${reason}`,
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
      detail: {
        planDate: current.plan_date,
        originalPlanDate: current.original_plan_date ?? current.plan_date,
        reason,
      },
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

  let query = supabase.from('pm_checklist_templates').select('*').order('created_at', { ascending: false });
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
