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
import { bulkUpdateEmployeesSchema, createEmployeeSchema, listEmployeesQuerySchema, updateEmployeeSchema } from '../validators/employees';

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
      .select('id, employee_code, prefix_th, first_name_th, last_name_th, nickname, department_id, position_id, status')
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
        username_ad: body.usernameAd ?? null,
        upn: body.upn ?? null,
        email: body.email || null,
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
          'username_ad, upn, email, status, department:departments(name_th), position:positions(name_th)',
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
      if (status !== undefined) patch.status = status;
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
    if (body.usernameAd !== undefined) patch.username_ad = body.usernameAd;
    if (body.upn !== undefined) patch.upn = body.upn;
    if (body.email !== undefined) patch.email = body.email || null;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status !== undefined) patch.status = body.status;

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
