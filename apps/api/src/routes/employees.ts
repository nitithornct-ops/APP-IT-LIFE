import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { BulkItemError, runBulk } from '../utils/bulk';
import { checkExportSize, exportFileName, listCsv, LIST_EXPORT_MAX_ROWS, type ExportColumn } from '../utils/listExport';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  bulkUpdateEmployeesSchema,
  createEmployeeSchema,
  employeeLifecycleSchema,
  listEmployeesQuerySchema,
  updateEmployeeSchema,
} from '../validators/employees';

/**
 * ทะเบียนพนักงาน — สืบทอดจาก Employees เดิม (Module_Employee.gs) แยกจาก profiles (บัญชี login)
 * เพราะพนักงานบางคนไม่มีบัญชีในระบบ Ticket/Asset (Phase 6 ลำดับถัดไป) จะผูก "เจ้าของ" กับตารางนี้
 */
export const employeesRoute = new Hono<AppEnv>();
employeesRoute.use('*', requireAuth);

/**
 * รายชื่อแบบย่อสำหรับ dropdown เลือกเจ้าของ/ผู้ครอบครองในโมดูลอื่น — คืนเฉพาะฟิลด์ที่จำเป็นต่อการเลือก
 * เท่านั้น ไม่มี email/upn/username_ad/notes ซึ่งเป็นข้อมูลของทะเบียนพนักงานเต็ม (ต้องใช้ employee.manage)
 * ใช้ Admin Client เพราะ RLS ของ employees จำกัดไว้ที่ employee.manage แล้ว — ตรวจสิทธิ์ที่ middleware ด้านบน
 */
employeesRoute.get(
  '/options',
  // เฉพาะสิทธิ์ของหน้าที่เรียกใช้จริงเท่านั้น (ยืม/คืน Asset, CMDB, PM, เบิกจ่ายทรัพย์สินพนักงาน)
  requireAnyPermission(['employee.manage', 'asset.view', 'cmdb.view', 'maintenance.view']),
  async (c) => {
    const reqId = c.get('requestId');
    const { data, error } = await createAdminClient(c.env)
      .from('employees')
      .select('id, employee_code, prefix_th, first_name_th, last_name_th, nickname, department_id, position_id, manager_employee_id, status')
      .eq('status', 'active')
      .order('first_name_th', { ascending: true })
      .limit(5000);

    if (error) return c.json(fail(reqId, 'EMPLOYEE_OPTIONS_FAILED', 'ดึงรายชื่อพนักงานไม่สำเร็จ'), 400);
    return c.json(ok(reqId, data ?? []));
  },
);

/** ส่วนของ query builder ที่ตัวกรองทะเบียนพนักงานต้องใช้ */
interface EmployeeFilterableQuery {
  eq(column: string, value: unknown): EmployeeFilterableQuery;
  or(filters: string): EmployeeFilterableQuery;
  in(column: string, values: readonly unknown[]): EmployeeFilterableQuery;
  not(column: string, operator: string, value: unknown): EmployeeFilterableQuery;
}

interface EmployeeListFilters {
  search?: string;
  status?: string;
  departmentId?: string;
  ownership?: string;
}

/**
 * รายชื่อพนักงานที่กำลังถือครองทรัพย์สินอยู่ — ต้องหาแยกก่อน เพราะ PostgREST กรองข้ามตารางแบบนี้ไม่ได้
 * คืน null เมื่อไม่ได้ใช้ตัวกรองการครอบครอง จะได้ไม่ต้องยิง query ที่ไม่มีใครใช้
 */
async function loadAssignedEmployeeIds(
  supabase: SupabaseClient,
  ownership: string | undefined,
): Promise<{ ids: string[] | null; error?: string }> {
  if (!ownership) return { ids: null };
  const { data, error } = await supabase
    .from('employee_assignments')
    .select('employee_id')
    .in('status', ['ครอบครอง', 'ส่งซ่อม'])
    .limit(10000);
  if (error) return { ids: null, error: 'ดึงข้อมูลการครอบครองไม่สำเร็จ' };
  const rows = (data ?? []) as { employee_id: string }[];
  return { ids: [...new Set(rows.map((item) => item.employee_id))] };
}

/**
 * ตัวกรองของทะเบียนพนักงาน — ใช้ร่วมกันระหว่างการแสดงผลกับการส่งออก
 * ต้องเป็นตัวเดียวกันเท่านั้น ไม่งั้นไฟล์ที่ส่งออกจะมีคนไม่ตรงกับที่ผู้ใช้เห็นบนหน้าจอ
 */
function applyEmployeeListFilters<T>(
  query: T,
  { search, status, departmentId, ownership }: EmployeeListFilters,
  assignedEmployeeIds: string[] | null,
): T {
  // มอง builder เป็นโครงแคบ ๆ เพราะ generic เต็มของ supabase-js ซ้อนลึกจน TypeScript ยอมแพ้
  let next = query as unknown as EmployeeFilterableQuery;
  const safeSearch = search ? cleanSearch(search) : '';
  if (safeSearch) {
    next = next.or(
      `employee_code.ilike.%${safeSearch}%,first_name_th.ilike.%${safeSearch}%,last_name_th.ilike.%${safeSearch}%,nickname.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`,
    );
  }
  if (status) next = next.eq('status', status);
  if (departmentId) next = next.eq('department_id', departmentId);
  if (ownership === 'with' && assignedEmployeeIds) next = next.in('id', assignedEmployeeIds);
  if (ownership === 'without' && assignedEmployeeIds?.length) {
    next = next.not('id', 'in', `(${assignedEmployeeIds.join(',')})`);
  }
  return next as unknown as T;
}

type LifecycleTarget = 'user' | 'access' | 'asset' | 'license' | 'approval_group';
type LifecycleActionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
const LIFECYCLE_TARGETS: LifecycleTarget[] = ['user', 'access', 'asset', 'license', 'approval_group'];

interface LinkedAccount {
  id: string;
  email: string | null;
  full_name: string;
  status: string;
}

function lifecycleEmployeeName(employee: Record<string, unknown>): string {
  return [employee.prefix_th, employee.first_name_th, employee.last_name_th]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

function resultCount(value: unknown, key = 'count'): number {
  if (!value || typeof value !== 'object') return 0;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'number' ? raw : Number(raw ?? 0) || 0;
}

async function loadEmployeeAccounts(admin: SupabaseClient, employeeId: string, employeeCode: string): Promise<LinkedAccount[]> {
  const [linked, legacy] = await Promise.all([
    admin.from('profiles').select('id,email,full_name,status').eq('employee_id', employeeId),
    admin.from('profiles').select('id,email,full_name,status').eq('employee_code', employeeCode),
  ]);
  if (linked.error) throw linked.error;
  if (legacy.error) throw legacy.error;
  const byId = new Map<string, LinkedAccount>();
  for (const row of [...(linked.data ?? []), ...(legacy.data ?? [])]) byId.set(row.id, row as LinkedAccount);
  return [...byId.values()];
}

async function saveLifecycleAction(
  admin: SupabaseClient,
  lifecycleEventId: string,
  targetType: LifecycleTarget,
  status: LifecycleActionStatus,
  affectedCount: number,
  detail: Record<string, unknown>,
  errorMessage?: string,
): Promise<void> {
  const { error } = await admin.from('employee_lifecycle_actions').upsert({
    lifecycle_event_id: lifecycleEventId,
    target_type: targetType,
    status,
    affected_count: affectedCount,
    detail,
    error_message: errorMessage ?? null,
    started_at: new Date().toISOString(),
    completed_at: status === 'PENDING' ? null : new Date().toISOString(),
  }, { onConflict: 'lifecycle_event_id,target_type' });
  if (error) throw error;
}

employeesRoute.get('/', requirePermission('employee.manage'), zValidator('query', listEmployeesQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, departmentId, ownership } = c.req.valid('query');

  const assigned = await loadAssignedEmployeeIds(supabase, ownership);
  if (assigned.error) return c.json(fail(reqId, 'EMPLOYEE_ASSIGNMENTS_LOAD_FAILED', assigned.error), 400);
  const assignedEmployeeIds = assigned.ids;
  if (ownership === 'with' && assignedEmployeeIds?.length === 0) {
    return c.json(ok(reqId, toPaginatedData([], 0, page, pageSize)));
  }

  let query = supabase
    .from('employees')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));

  query = applyEmployeeListFilters(query, { search, status, departmentId, ownership }, assignedEmployeeIds);

  const { data, count, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'EMPLOYEES_LIST_FAILED', 'ดึงรายชื่อพนักงานไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});

/** ตัวเลขสรุปและจำนวนทรัพย์สินต่อพนักงานสำหรับหน้าทะเบียนรวม */
employeesRoute.get('/overview', requirePermission('employee.manage'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');

  const [totalResult, activeResult, assignmentResult, lifecycleResult] = await Promise.all([
    supabase.from('employees').select('id', { count: 'exact', head: true }),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('employee_assignments').select('employee_id').in('status', ['ครอบครอง', 'ส่งซ่อม']).limit(10000),
    supabase.from('employee_lifecycle_events').select('id', { count: 'exact', head: true }).in('status', ['PENDING', 'PROCESSING']),
  ]);

  const error = totalResult.error || activeResult.error || assignmentResult.error;
  if (error) return c.json(fail(reqId, 'EMPLOYEES_OVERVIEW_FAILED', 'ดึงข้อมูลสรุปพนักงานไม่สำเร็จ'), 400);

  const assignmentCounts: Record<string, number> = {};
  for (const item of assignmentResult.data ?? []) {
    assignmentCounts[item.employee_id] = (assignmentCounts[item.employee_id] ?? 0) + 1;
  }

  return c.json(ok(reqId, {
    total: totalResult.count ?? 0,
    active: activeResult.count ?? 0,
    employeesWithAssignments: Object.keys(assignmentCounts).length,
    assignmentTotal: assignmentResult.data?.length ?? 0,
    pendingLifecycle: lifecycleResult.error ? 0 : (lifecycleResult.count ?? 0),
    assignmentCounts,
  }));
});

employeesRoute.post(
  '/',
  requirePermission('employee.manage'),
  zValidator('json', createEmployeeSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('employees')
      .insert({
        employee_code: body.employeeCode,
        prefix_th: body.prefixTh ?? null,
        first_name_th: body.firstNameTh,
        last_name_th: body.lastNameTh,
        nickname: body.nickname ?? null,
        prefix_en: body.prefixEn ?? null,
        first_name_en: body.firstNameEn ?? null,
        last_name_en: body.lastNameEn ?? null,
        department_id: body.departmentId ?? null,
        position_id: body.positionId ?? null,
        manager_employee_id: body.managerEmployeeId ?? null,
        start_date: body.startDate ?? null,
        end_date: body.endDate ?? null,
        employment_status: body.employmentStatus ?? (body.status === 'inactive' ? 'terminated' : 'active'),
        location: body.location ?? null,
        username_ad: body.usernameAd ?? null,
        upn: body.upn ?? null,
        email: body.email || null,
        status: body.status ?? 'active',
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return dbFailJson(c, 'EMPLOYEE_CREATE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'employee',
      targetTable: 'employees',
      targetId: data.id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

/** แถวดิบของพนักงานเท่าที่การส่งออกต้องใช้ */
interface EmployeeExportRow {
  employee_code: string | null;
  prefix_th: string | null;
  first_name_th: string | null;
  last_name_th: string | null;
  nickname: string | null;
  first_name_en: string | null;
  last_name_en: string | null;
  username_ad: string | null;
  upn: string | null;
  email: string | null;
  status: string | null;
  manager_employee_id: string | null;
  start_date: string | null;
  end_date: string | null;
  employment_status: string | null;
  location: string | null;
  department: { name_th: string | null } | null;
  position: { name_th: string | null } | null;
}

const EMPLOYEE_EXPORT_COLUMNS: ExportColumn<EmployeeExportRow>[] = [
  { label: 'รหัสพนักงาน', value: (row) => row.employee_code },
  { label: 'ชื่อ-นามสกุล', value: (row) => `${row.prefix_th ?? ''}${row.first_name_th ?? ''} ${row.last_name_th ?? ''}`.trim() },
  { label: 'ชื่อเล่น', value: (row) => row.nickname },
  { label: 'ชื่อภาษาอังกฤษ', value: (row) => `${row.first_name_en ?? ''} ${row.last_name_en ?? ''}`.trim() },
  { label: 'ตำแหน่ง', value: (row) => row.position?.name_th ?? '' },
  { label: 'Department', value: (row) => row.department?.name_th ?? '' },
  { label: 'บัญชี AD', value: (row) => row.username_ad },
  { label: 'UPN / Email', value: (row) => row.upn || row.email },
  { label: 'Manager Employee ID', value: (row) => row.manager_employee_id },
  { label: 'Start Date', value: (row) => row.start_date },
  { label: 'End Date', value: (row) => row.end_date },
  { label: 'Employment Status', value: (row) => row.employment_status },
  { label: 'Location', value: (row) => row.location },
  { label: 'สถานะ', value: (row) => row.status },
];

/**
 * ส่งออกทะเบียนพนักงานทั้งชุดตามตัวกรองที่ตั้งไว้ — ไม่ใช่แค่หน้าที่เปิดอยู่
 *
 * ไฟล์นี้มีบัญชี AD และอีเมลของทุกคนในองค์กร จึงต้องมีสิทธิ์ employee.manage เท่ากับหน้าทะเบียน
 * และเขียน audit log ทุกครั้ง — ดูรายคนบนหน้าจอกับดึงทั้งองค์กรออกไปเป็นคนละเรื่องกัน
 *
 * ต้องมาก่อน route '/:id' ไม่งั้น Hono จะจับ 'export' เป็น id
 */
employeesRoute.get(
  '/export',
  requirePermission('employee.manage'),
  zValidator('query', listEmployeesQuerySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const { search, status, departmentId, ownership } = c.req.valid('query');
    const filters = { search, status, departmentId, ownership };

    const assigned = await loadAssignedEmployeeIds(supabase, ownership);
    if (assigned.error) return c.json(fail(reqId, 'EMPLOYEE_ASSIGNMENTS_LOAD_FAILED', assigned.error), 400);

    // นับก่อน เพื่อไม่ต้องดึงของที่รู้อยู่แล้วว่าส่งออกไม่ได้
    const { count, error: countError } = await applyEmployeeListFilters(
      supabase.from('employees').select('id', { count: 'exact', head: true }),
      filters,
      assigned.ids,
    );
    if (countError) return c.json(fail(reqId, 'EMPLOYEES_EXPORT_FAILED', 'นับรายการเพื่อส่งออกไม่สำเร็จ'), 400);

    const tooLarge = checkExportSize(count);
    if (tooLarge) return c.json(fail(reqId, 'EXPORT_TOO_LARGE', tooLarge.message), 400);

    const query = applyEmployeeListFilters(
      supabase
        .from('employees')
        .select(
          'employee_code, prefix_th, first_name_th, last_name_th, nickname, first_name_en, last_name_en, ' +
          'username_ad, upn, email, status, manager_employee_id, start_date, end_date, employment_status, location, department:departments(name_th), position:positions(name_th)',
        )
        .order('first_name_th', { ascending: true })
        .range(0, LIST_EXPORT_MAX_ROWS - 1),
      filters,
      assigned.ids,
    );

    const { data, error } = await query;
    if (error) return c.json(fail(reqId, 'EMPLOYEES_EXPORT_FAILED', 'ดึงข้อมูลเพื่อส่งออกไม่สำเร็จ'), 400);

    const rows = (data ?? []) as unknown as EmployeeExportRow[];
    await writeAuditLog(c.env, {
      actorId: c.get('userId'),
      actorEmail: c.get('userEmail'),
      action: 'EXPORT',
      module: 'employee',
      targetTable: 'employees',
      detail: { filters, rowCount: rows.length },
      requestId: reqId,
    });

    return c.json(ok(reqId, {
      filename: exportFileName('employees'),
      csv: listCsv(EMPLOYEE_EXPORT_COLUMNS, rows),
      rowCount: rows.length,
    }));
  },
);

/**
 * แก้ไขพนักงานหลายคนพร้อมกัน — ย้ายแผนก หรือเปลี่ยนสถานะ active/inactive
 *
 * รองรับเฉพาะสองอย่างนี้เพราะเป็นงานที่เกิดกับคนหลายคนพร้อมกันจริง (ย้ายทั้งแผนก, ปิดสถานะ
 * ตามรอบพ้นสภาพ) ส่วนชื่อ รหัสพนักงาน บัญชี AD เป็นข้อมูลเฉพาะตัว ต้องแก้ทีละคนเสมอ
 *
 * เขียน audit log ทีละรายการ ไม่ใช่รายชุด — ทะเบียนพนักงานเป็นต้นทางของเจ้าของทรัพย์สิน
 * งาน ISMS จึงต้องตรวจย้อนได้ว่าใครย้ายใครไปแผนกไหนเมื่อไร
 *
 * ต้องมาก่อน route '/:id' ไม่งั้น Hono จะจับ 'bulk' เป็น id
 */
employeesRoute.patch(
  '/bulk',
  requirePermission('employee.manage'),
  zValidator('json', bulkUpdateEmployeesSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const { ids, status, departmentId } = c.req.valid('json');

    const { data: currentRows, error: loadError } = await supabase.from('employees').select('*').in('id', ids);
    if (loadError) return dbFailJson(c, 'EMPLOYEES_BULK_LOAD_FAILED', loadError);
    const byId = new Map((currentRows ?? []).map((row) => [String(row.id), row]));

    const result = await runBulk(ids, async (id) => {
      const current = byId.get(id);
      if (!current) throw new BulkItemError('EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานคนนี้ หรือท่านไม่มีสิทธิ์เข้าถึง');

      const patch: Record<string, unknown> = { updated_by: actorId };
      if (status !== undefined) {
        patch.status = status;
        patch.employment_status = status === 'inactive' ? 'terminated' : 'active';
      }
      if (departmentId !== undefined) patch.department_id = departmentId;

      const auditBefore = await loadAuditSnapshot(supabase, 'employees', id);
      const { data: updated, error } = await supabase.from('employees').update(patch).eq('id', id).select().single();
      if (error || !updated) {
        throw new BulkItemError('EMPLOYEE_UPDATE_FAILED', `${current.employee_code ?? id}: บันทึกไม่สำเร็จ`);
      }

      await writeAuditLog(c.env, {
        actorId,
        actorEmail: c.get('userEmail'),
        action: 'UPDATE',
        module: 'employee',
        targetTable: 'employees',
        targetId: id,
        detail: { status, departmentId, bulk: true },
        requestId: reqId,
        before: auditBefore,
        after: updated,
      });

      return { id, employeeCode: String(updated.employee_code ?? ''), status: String(updated.status) };
    });

    return c.json(ok(reqId, result));
  },
);

employeesRoute.patch(
  '/:id',
  requirePermission('employee.manage'),
  zValidator('json', updateEmployeeSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.employeeCode !== undefined) patch.employee_code = body.employeeCode;
    if (body.prefixTh !== undefined) patch.prefix_th = body.prefixTh;
    if (body.firstNameTh !== undefined) patch.first_name_th = body.firstNameTh;
    if (body.lastNameTh !== undefined) patch.last_name_th = body.lastNameTh;
    if (body.nickname !== undefined) patch.nickname = body.nickname;
    if (body.prefixEn !== undefined) patch.prefix_en = body.prefixEn;
    if (body.firstNameEn !== undefined) patch.first_name_en = body.firstNameEn;
    if (body.lastNameEn !== undefined) patch.last_name_en = body.lastNameEn;
    if (body.departmentId !== undefined) patch.department_id = body.departmentId;
    if (body.positionId !== undefined) patch.position_id = body.positionId;
    if (body.managerEmployeeId !== undefined) patch.manager_employee_id = body.managerEmployeeId;
    if (body.startDate !== undefined) patch.start_date = body.startDate;
    if (body.endDate !== undefined) patch.end_date = body.endDate;
    if (body.employmentStatus !== undefined) patch.employment_status = body.employmentStatus;
    if (body.location !== undefined) patch.location = body.location;
    if (body.usernameAd !== undefined) patch.username_ad = body.usernameAd;
    if (body.upn !== undefined) patch.upn = body.upn;
    if (body.email !== undefined) patch.email = body.email || null;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status !== undefined) {
      patch.status = body.status;
      if (body.employmentStatus === undefined) patch.employment_status = body.status === 'inactive' ? 'terminated' : 'active';
    }

    const auditBefore = await loadAuditSnapshot(supabase, 'employees', id);
    const { data, error } = await supabase.from('employees').update(patch).eq('id', id).select().single();
    if (error) {
      return dbFailJson(c, 'EMPLOYEE_UPDATE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'employee',
      targetTable: 'employees',
      targetId: id,
      detail: body,
      requestId: reqId,
          before: auditBefore,
      after: data,
});

    return c.json(ok(reqId, data));
  },
);

employeesRoute.get('/:id/lifecycle', requirePermission('employee.manage'), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const employeeId = c.req.param('id') ?? '';
  const events = await admin.from('employee_lifecycle_events').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(100);
  if (events.error) return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_LIST_FAILED', events.error);
  const eventIds = (events.data ?? []).map((item) => item.id);
  const actions = eventIds.length
    ? await admin.from('employee_lifecycle_actions').select('*').in('lifecycle_event_id', eventIds).order('created_at', { ascending: false }).limit(500)
    : { data: [], error: null };
  if (actions.error) return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_ACTIONS_LIST_FAILED', actions.error);
  return c.json(ok(reqId, { events: events.data ?? [], actions: actions.data ?? [] }));
});

employeesRoute.post(
  '/:id/lifecycle',
  requirePermission('employee.manage'),
  zValidator('json', employeeLifecycleSchema, zodValidationHook),
  async (c) => {
    const admin = createAdminClient(c.env);
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const actorEmail = c.get('userEmail');
    const employeeId = c.req.param('id') ?? '';
    const body = c.req.valid('json');

    if (body.managerEmployeeId === employeeId) {
      return c.json(fail(reqId, 'EMPLOYEE_MANAGER_SELF_INVALID', 'พนักงานไม่สามารถเป็น Manager ของตัวเองได้'), 400);
    }

    const { data: employee, error: employeeError } = await admin
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .maybeSingle();
    if (employeeError) return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_EMPLOYEE_LOAD_FAILED', employeeError);
    if (!employee) return c.json(fail(reqId, 'EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานที่ระบุ'), 404);

    const employeeWasActive = employee.status === 'active';

    const { data: duplicate, error: duplicateError } = await admin
      .from('employee_lifecycle_events')
      .select('id,lifecycle_code,status')
      .eq('employee_id', employeeId)
      .eq('event_type', body.eventType)
      .eq('effective_date', body.effectiveDate)
      .in('status', ['PENDING', 'PROCESSING'])
      .maybeSingle();
    if (duplicateError) return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_DUPLICATE_CHECK_FAILED', duplicateError);
    if (duplicate) return c.json(fail(reqId, 'EMPLOYEE_LIFECYCLE_ALREADY_RUNNING', 'มี lifecycle event ของพนักงานและวันที่นี้กำลังดำเนินการอยู่แล้ว'), 409);

    const [departmentResult, positionResult] = await Promise.all([
      body.newDepartmentId
        ? admin.from('departments').select('id,name_th').eq('id', body.newDepartmentId).maybeSingle()
        : body.newDepartment
          ? admin.from('departments').select('id,name_th').eq('name_th', body.newDepartment).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      body.newPositionId
        ? admin.from('positions').select('id,name_th').eq('id', body.newPositionId).maybeSingle()
        : body.newPosition
          ? admin.from('positions').select('id,name_th').eq('name_th', body.newPosition).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (departmentResult.error) return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_DEPARTMENT_LOAD_FAILED', departmentResult.error);
    if (positionResult.error) return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_POSITION_LOAD_FAILED', positionResult.error);
    if (body.newDepartmentId && !departmentResult.data) return c.json(fail(reqId, 'DEPARTMENT_NOT_FOUND', 'ไม่พบ Department ใหม่ที่ระบุ'), 400);
    if (body.newPositionId && !positionResult.data) return c.json(fail(reqId, 'POSITION_NOT_FOUND', 'ไม่พบ Position ใหม่ที่ระบุ'), 400);

    const lifecycleCode = `JML-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const { data: event, error: eventError } = await admin.from('employee_lifecycle_events').insert({
      lifecycle_code: lifecycleCode,
      employee_id: employeeId,
      employee_code: employee.employee_code,
      employee_name: lifecycleEmployeeName(employee),
      employee_email: employee.email ?? null,
      event_type: body.eventType,
      effective_date: body.effectiveDate,
      new_department: departmentResult.data?.name_th ?? body.newDepartment ?? null,
      new_position: positionResult.data?.name_th ?? body.newPosition ?? null,
      reason: body.reason,
      notes: body.notes ?? null,
      status: 'PROCESSING',
      requested_by_id: actorId,
      requested_by_email: actorEmail,
      created_by: actorId,
      updated_by: actorId,
    }).select('*').single();
    if (eventError || !event) return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_CREATE_FAILED', eventError);

    const { error: actionSeedError } = await admin.from('employee_lifecycle_actions').insert(
      LIFECYCLE_TARGETS.map((targetType) => ({ lifecycle_event_id: event.id, target_type: targetType, status: 'PENDING' })),
    );
    if (actionSeedError) {
      await admin.from('employee_lifecycle_events').update({ status: 'FAILED', result_detail: { error: actionSeedError.message } }).eq('id', event.id);
      return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_ACTIONS_CREATE_FAILED', actionSeedError);
    }

    const results: Record<string, Record<string, unknown>> = {};
    const mark = async (
      targetType: LifecycleTarget,
      status: LifecycleActionStatus,
      affectedCount: number,
      detail: Record<string, unknown>,
      errorMessage?: string,
    ) => {
      await saveLifecycleAction(admin, event.id, targetType, status, affectedCount, detail, errorMessage);
      results[targetType] = { status, affectedCount, ...detail, ...(errorMessage ? { error: errorMessage } : {}) };
    };

    const employeePatch: Record<string, unknown> = { updated_by: actorId };
    if (body.managerEmployeeId !== undefined) employeePatch.manager_employee_id = body.managerEmployeeId;
    if (body.eventType === 'JOINER') {
      employeePatch.status = 'active';
      employeePatch.employment_status = 'active';
      employeePatch.start_date = body.effectiveDate;
      employeePatch.end_date = null;
    } else if (body.eventType === 'MOVER') {
      if (body.newDepartmentId !== undefined) employeePatch.department_id = body.newDepartmentId;
      else if (departmentResult.data?.id) employeePatch.department_id = departmentResult.data.id;
      if (body.newPositionId !== undefined) employeePatch.position_id = body.newPositionId;
      else if (positionResult.data?.id) employeePatch.position_id = positionResult.data.id;
    } else {
      employeePatch.status = 'inactive';
      employeePatch.employment_status = 'terminated';
      employeePatch.end_date = body.effectiveDate;
    }

    const { error: employeeUpdateError } = await admin.from('employees').update(employeePatch).eq('id', employeeId);
    if (employeeUpdateError) {
      await admin.from('employee_lifecycle_events').update({ status: 'FAILED', result_detail: { error: employeeUpdateError.message }, updated_by: actorId }).eq('id', event.id);
      return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_EMPLOYEE_UPDATE_FAILED', employeeUpdateError);
    }

    let accounts: LinkedAccount[] = [];
    try {
      accounts = await loadEmployeeAccounts(admin, employeeId, employee.employee_code ?? '');
    } catch (error) {
      await mark('user', 'FAILED', 0, { message: 'โหลด Account ที่ผูกกับ Employee ไม่สำเร็จ' }, error instanceof Error ? error.message : String(error));
    }

    if (!results.user) {
      if (body.eventType === 'LEAVER') {
        let completed = 0;
        let suspendedCount = 0;
        const errors: string[] = [];
        for (const account of accounts) {
          const authResult = await admin.auth.admin.updateUserById(account.id, { ban_duration: '876000h' });
          if (authResult.error) {
            errors.push(`${account.id}: ${authResult.error.message}`);
            continue;
          }
          const { data: deactivation, error: deactivationError } = await admin.rpc('deactivate_user_access', {
            user_id_input: account.id,
            actor_id_input: actorId,
            actor_email_input: actorEmail,
            reason_input: body.reason,
            request_id_input: reqId,
          });
          if (deactivationError) {
            errors.push(`${account.id}: ${deactivationError.message}`);
            continue;
          }
          const { error: profileError } = await admin.from('profiles').update({
            employee_id: employeeId,
            employment_status: 'terminated',
            updated_by: actorId,
          }).eq('id', account.id);
          if (profileError) {
            errors.push(`${account.id}: ${profileError.message}`);
            continue;
          }
          completed += 1;
          suspendedCount += resultCount(deactivation, 'suspendedCount');
        }
        await mark('user', errors.length ? 'FAILED' : 'COMPLETED', completed, { accounts: accounts.length }, errors.join('; ') || undefined);
        await mark('access', errors.length ? 'FAILED' : 'COMPLETED', suspendedCount, { revokedByAccount: true }, errors.join('; ') || undefined);
      } else if (body.eventType === 'JOINER') {
        let reactivated = 0;
        const errors: string[] = [];
        for (const account of accounts) {
          const authResult = await admin.auth.admin.updateUserById(account.id, { ban_duration: 'none' });
          if (authResult.error) { errors.push(`${account.id}: ${authResult.error.message}`); continue; }
          const { error: profileError } = await admin.from('profiles').update({ employee_id: employeeId, status: 'active', employment_status: 'active', updated_by: actorId }).eq('id', account.id);
          if (profileError) { errors.push(`${account.id}: ${profileError.message}`); continue; }
          reactivated += 1;
        }
        await mark('user', errors.length ? 'FAILED' : accounts.length ? 'COMPLETED' : 'SKIPPED', reactivated, { accounts: accounts.length, message: accounts.length ? 'Account activated' : 'ยังไม่มี Account; รอการสร้างบัญชี' }, errors.join('; ') || undefined);
        await mark('access', 'PENDING', 0, { message: 'ต้องยื่น Access Request ตามสิทธิ์ของตำแหน่งงาน' });
      } else {
        await mark('user', 'COMPLETED', accounts.length, { accounts: accounts.length, message: 'Employee directory updated; account fields remain account-owned' });
        await mark('access', 'PENDING', 0, { message: 'ทบทวน Access เมื่อย้าย Department/Position' });
      }
    }

    if (body.eventType === 'LEAVER') {
      let assetReturn: unknown = null;
      let assetErrorMessage: string | undefined;
      if (employeeWasActive) {
        // The status update above invokes the existing offboarding trigger. Reuse
        // its batch so a single LEAVER event cannot create duplicate return batches.
        const batchResult = await admin.from('employee_assignment_batches')
          .select('id,total_count,detail')
          .eq('employee_id', employeeId)
          .eq('operation', 'offboarding')
          .eq('return_date', body.effectiveDate)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (batchResult.error) assetErrorMessage = batchResult.error.message;
        else if (!batchResult.data) assetErrorMessage = 'Offboarding asset return batch was not created';
        else {
          const detail = batchResult.data.detail && typeof batchResult.data.detail === 'object'
            ? batchResult.data.detail as Record<string, unknown>
            : {};
          assetReturn = { batchId: batchResult.data.id, assetCount: detail.assetCount ?? 0, count: batchResult.data.total_count ?? 0 };
        }
      } else {
        const returnResult = await admin.rpc('bulk_return_employee_assets', {
          p_employee_id: employeeId,
          p_return_date: body.effectiveDate,
          p_return_receiver_employee_id: null,
          p_reason: body.reason,
        });
        assetReturn = returnResult.data;
        assetErrorMessage = returnResult.error?.message;
      }
      await mark('asset', assetErrorMessage ? 'FAILED' : 'COMPLETED', resultCount(assetReturn, 'assetCount'), { returnBatchId: assetReturn && typeof assetReturn === 'object' ? (assetReturn as Record<string, unknown>).batchId : null }, assetErrorMessage);

      const { data: licenseReclaim, error: licenseError } = await admin.rpc('reclaim_software_licenses_for_employee', {
        p_employee_id: employeeId,
        p_actor_id: actorId,
        p_notes: body.reason,
      });
      await mark('license', licenseError ? 'FAILED' : 'COMPLETED', resultCount(licenseReclaim), { allocationIds: licenseReclaim && typeof licenseReclaim === 'object' ? (licenseReclaim as Record<string, unknown>).allocationIds : [] }, licenseError?.message);

      const accountIds = accounts.map((account) => account.id);
      let approvalGroupCount = 0;
      let approvalGroupError: string | undefined;
      if (accountIds.length) {
        const { data: disabledMemberships, error } = await admin.from('approval_group_members')
          .update({ status: 'inactive', updated_by: actorId, notes: `Employee lifecycle LEAVER: ${body.reason}` })
          .in('user_id', accountIds)
          .eq('status', 'active')
          .select('id');
        approvalGroupCount = disabledMemberships?.length ?? 0;
        approvalGroupError = error?.message;
      }
      await mark('approval_group', approvalGroupError ? 'FAILED' : 'COMPLETED', approvalGroupCount, { accountCount: accountIds.length, message: 'Inactive memberships preserved for audit' }, approvalGroupError);
    } else {
      await mark('asset', 'PENDING', 0, { message: body.eventType === 'JOINER' ? 'รอการมอบหมาย Asset' : 'ทบทวน Asset custody หลังย้าย' });
      await mark('license', 'PENDING', 0, { message: body.eventType === 'JOINER' ? 'รอการจัดสรร License' : 'ทบทวน License หลังย้าย' });
      await mark('approval_group', 'PENDING', 0, { message: 'ทบทวนสมาชิก Approval Group ตาม Department/Position ใหม่' });
    }

    const statuses = Object.values(results).map((result) => result.status);
    const lifecycleStatus = statuses.includes('FAILED') ? 'FAILED' : statuses.includes('PENDING') ? 'PROCESSING' : 'COMPLETED';
    const { data: updatedEvent, error: eventUpdateError } = await admin.from('employee_lifecycle_events').update({
      status: lifecycleStatus,
      completed_at: lifecycleStatus === 'PROCESSING' ? null : new Date().toISOString(),
      result_detail: { targets: results },
      updated_by: actorId,
    }).eq('id', event.id).select('*').single();
    if (eventUpdateError) return dbFailJson(c, 'EMPLOYEE_LIFECYCLE_FINALIZE_FAILED', eventUpdateError);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail,
      action: 'LIFECYCLE',
      module: 'employee',
      targetTable: 'employee_lifecycle_events',
      targetId: event.id,
      detail: { eventType: body.eventType, employeeId, status: lifecycleStatus, targets: results },
      requestId: reqId,
    });

    return c.json(ok(reqId, { event: updatedEvent, actions: results }), lifecycleStatus === 'FAILED' ? 207 : 201);
  },
);
