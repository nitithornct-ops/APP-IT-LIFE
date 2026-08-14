import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  createEmployeeAssignmentSchema,
  listEmployeeAssignmentsQuerySchema,
  setEmployeeAssignmentStatusSchema,
  updateEmployeeAssignmentSchema,
} from '../validators/employeeAssignments';

/**
 * Employee Assignments — เลื่อนมาจาก Module 3 (Module_Employee.gs) มาทำพร้อม Asset module ตามที่ระบุ
 * ไว้ล่วงหน้าใน 20260809100000_employees.sql เพราะซ้ำซ้อนกับตาราง assignment ของ Asset — หนึ่งแถวต่อ
 * หนึ่งรายการที่พนักงานถือครอง อาจผูกกับ assets.id (เมื่อเป็นทรัพย์สินที่ขึ้นทะเบียนกลาง) หรือเป็น
 * รายการอิสระก็ได้ (เช่น License ซอฟต์แวร์ที่ไม่ได้ขึ้นทะเบียน Asset)
 */
export const employeeAssignmentsRoute = new Hono<AppEnv>();
employeeAssignmentsRoute.use('*', requireAuth);

const ASSIGNMENT_SELECT =
  '*, employee:employees!employee_assignments_employee_id_fkey(id, employee_code, first_name_th, last_name_th, nickname), ' +
  'asset:assets(id, asset_code, name)';

const CURRENT_STATUSES = ['ครอบครอง', 'ส่งซ่อม'];

function isCurrentStatus(status: string): boolean {
  return CURRENT_STATUSES.includes(status);
}

async function syncAssignmentAsset(
  supabase: SupabaseClient,
  assetId: string | null | undefined,
  status: string,
  employeeId: string,
  employeeDepartmentId: string | null | undefined,
  actorId: string,
) {
  if (!assetId) return;
  const { data: asset } = await supabase.from('assets').select('id, owner_employee_id').eq('id', assetId).maybeSingle();
  if (!asset) return;

  const patch: Record<string, unknown> = {};
  if (isCurrentStatus(status) || status === 'สูญหาย') {
    patch.owner_employee_id = employeeId;
    patch.department_id = employeeDepartmentId ?? null;
    patch.status = status === 'ส่งซ่อม' ? 'ซ่อมบำรุง' : status === 'สูญหาย' ? 'สูญหาย' : 'ใช้งานอยู่';
  } else if (!asset.owner_employee_id || asset.owner_employee_id === employeeId) {
    patch.owner_employee_id = null;
    patch.department_id = null;
    patch.status = 'พร้อมใช้งาน';
  }
  if (Object.keys(patch).length) {
    patch.updated_by = actorId;
    await supabase.from('assets').update(patch).eq('id', assetId);
  }
}

employeeAssignmentsRoute.get(
  '/',
  requireAnyPermission(['employee.manage', 'asset.view']),
  zValidator('query', listEmployeeAssignmentsQuerySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const { page, pageSize, employeeId, status, search } = c.req.valid('query');

    let query = supabase
      .from('employee_assignments')
      .select(ASSIGNMENT_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(...paginationRange(page, pageSize));

    if (employeeId) query = query.eq('employee_id', employeeId);
    if (status) query = query.eq('status', status);
    const safeSearch = search ? cleanSearch(search) : '';
    if (safeSearch) query = query.or(`item_name.ilike.%${safeSearch}%,serial_number.ilike.%${safeSearch}%,asset_code.ilike.%${safeSearch}%`);

    const { data, count, error } = await query;
    if (error) return c.json(fail(reqId, 'ASSIGNMENTS_LIST_FAILED', 'ดึงรายการครอบครองไม่สำเร็จ'), 400);
    return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
  },
);

employeeAssignmentsRoute.get('/:id', requireAnyPermission(['employee.manage', 'asset.view']), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data, error } = await supabase.from('employee_assignments').select(ASSIGNMENT_SELECT).eq('id', id).maybeSingle();
  if (error) return c.json(fail(reqId, 'ASSIGNMENT_LOAD_FAILED', 'ดึงข้อมูลรายการครอบครองไม่สำเร็จ'), 400);
  if (!data) return c.json(fail(reqId, 'ASSIGNMENT_NOT_FOUND', 'ไม่พบรายการครอบครองนี้'), 404);
  return c.json(ok(reqId, data));
});

employeeAssignmentsRoute.post(
  '/',
  requirePermission('employee.manage'),
  zValidator('json', createEmployeeAssignmentSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data: employee, error: employeeError } = await supabase.from('employees').select('id, department_id').eq('id', body.employeeId).maybeSingle();
    if (employeeError || !employee) return c.json(fail(reqId, 'EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงาน'), 400);

    let assetName: string | null = null;
    if (body.assetId) {
      const { data: asset, error: assetError } = await supabase.from('assets').select('*').eq('id', body.assetId).maybeSingle();
      if (assetError || !asset) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินที่เลือกใน Asset Register'), 400);
      assetName = asset.name;
      const status = body.status ?? 'ครอบครอง';
      if (isCurrentStatus(status) && asset.owner_employee_id && asset.owner_employee_id !== body.employeeId) {
        return c.json(fail(reqId, 'ASSET_OWNED_BY_OTHER', 'ทรัพย์สินนี้มีผู้ครอบครองอยู่แล้ว'), 400);
      }
      const { data: duplicate } = await supabase
        .from('employee_assignments')
        .select('id')
        .eq('asset_id', body.assetId)
        .in('status', CURRENT_STATUSES)
        .maybeSingle();
      if (duplicate && isCurrentStatus(status)) {
        return c.json(fail(reqId, 'ASSET_ASSIGNMENT_DUPLICATE', 'ทรัพย์สินนี้มีรายการครอบครองที่ยังไม่คืนแล้ว'), 400);
      }
    }

    const itemName = body.itemName || assetName || body.softwareName;
    if (!itemName) {
      return c.json(fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุชื่อรายการ', [{ field: 'itemName', message: 'จำเป็น' }]), 400);
    }

    const status = body.status ?? 'ครอบครอง';
    const returnedDate = status === 'คืนแล้ว' ? body.returnedDate || new Date().toISOString().slice(0, 10) : null;

    const { data, error } = await supabase
      .from('employee_assignments')
      .insert({
        employee_id: body.employeeId,
        category: body.category ?? 'อื่นๆ',
        item_name: itemName,
        asset_id: body.assetId ?? null,
        ip_address: body.ipAddress ?? null,
        producer: body.producer ?? null,
        model: body.model ?? null,
        mac_address: body.macAddress ?? null,
        asset_number: body.assetNumber ?? null,
        serial_number: body.serialNumber ?? null,
        os_system: body.osSystem ?? null,
        hardware_spec: body.hardwareSpec ?? null,
        software_name: body.softwareName ?? null,
        software_license: body.softwareLicense ?? null,
        phone_number: body.phoneNumber ?? null,
        scan_user: body.scanUser ?? null,
        scan_folder: body.scanFolder ?? null,
        status,
        assigned_date: body.assignedDate || null,
        returned_date: returnedDate,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select(ASSIGNMENT_SELECT)
      .single();

    if (error) return dbFailJson(c, 'ASSIGNMENT_CREATE_FAILED', error);
    const createdId = (data as unknown as { id: string }).id;

    await syncAssignmentAsset(supabase, body.assetId, status, body.employeeId, employee.department_id, actorId);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE_ASSIGNMENT',
      module: 'employee',
      targetTable: 'employee_assignments',
      targetId: createdId,
      detail: { employeeId: body.employeeId, category: body.category, itemName },
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

employeeAssignmentsRoute.patch(
  '/:id',
  requirePermission('employee.manage'),
  zValidator('json', updateEmployeeAssignmentSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const body = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('employee_assignments').select('*').eq('id', id).maybeSingle();
    if (currentError) return c.json(fail(reqId, 'ASSIGNMENT_LOAD_FAILED', 'ดึงข้อมูลรายการครอบครองไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'ASSIGNMENT_NOT_FOUND', 'ไม่พบรายการครอบครองนี้'), 404);

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, department_id')
      .eq('id', current.employee_id)
      .maybeSingle();
    if (employeeError || !employee) return c.json(fail(reqId, 'EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานของรายการนี้'), 400);

    const nextAssetId = body.assetId !== undefined ? body.assetId || null : current.asset_id;
    const nextStatus = body.status ?? current.status;

    let assetName: string | null = null;
    if (nextAssetId) {
      const { data: asset, error: assetError } = await supabase.from('assets').select('*').eq('id', nextAssetId).maybeSingle();
      if (assetError || !asset) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินที่เลือกใน Asset Register'), 400);
      assetName = asset.name;
      if (isCurrentStatus(nextStatus) && asset.owner_employee_id && asset.owner_employee_id !== current.employee_id) {
        return c.json(fail(reqId, 'ASSET_OWNED_BY_OTHER', 'ทรัพย์สินนี้มีผู้ครอบครองอยู่แล้ว'), 400);
      }
      const { data: duplicate } = await supabase
        .from('employee_assignments')
        .select('id')
        .eq('asset_id', nextAssetId)
        .neq('id', id)
        .in('status', CURRENT_STATUSES)
        .maybeSingle();
      if (duplicate && isCurrentStatus(nextStatus)) {
        return c.json(fail(reqId, 'ASSET_ASSIGNMENT_DUPLICATE', 'ทรัพย์สินนี้มีรายการครอบครองที่ยังไม่คืนแล้ว'), 400);
      }
    }

    const itemName = body.itemName ?? (assetName || current.item_name);
    const returnedDate =
      nextStatus === 'คืนแล้ว' ? body.returnedDate || current.returned_date || new Date().toISOString().slice(0, 10) : null;

    const patch: Record<string, unknown> = { updated_by: actorId, item_name: itemName, status: nextStatus, returned_date: returnedDate };
    if (body.category !== undefined) patch.category = body.category;
    if (body.assetId !== undefined) patch.asset_id = nextAssetId;
    if (body.ipAddress !== undefined) patch.ip_address = body.ipAddress;
    if (body.producer !== undefined) patch.producer = body.producer;
    if (body.model !== undefined) patch.model = body.model;
    if (body.macAddress !== undefined) patch.mac_address = body.macAddress;
    if (body.assetNumber !== undefined) patch.asset_number = body.assetNumber;
    if (body.serialNumber !== undefined) patch.serial_number = body.serialNumber;
    if (body.osSystem !== undefined) patch.os_system = body.osSystem;
    if (body.hardwareSpec !== undefined) patch.hardware_spec = body.hardwareSpec;
    if (body.softwareName !== undefined) patch.software_name = body.softwareName;
    if (body.softwareLicense !== undefined) patch.software_license = body.softwareLicense;
    if (body.phoneNumber !== undefined) patch.phone_number = body.phoneNumber;
    if (body.scanUser !== undefined) patch.scan_user = body.scanUser;
    if (body.scanFolder !== undefined) patch.scan_folder = body.scanFolder;
    if (body.assignedDate !== undefined) patch.assigned_date = body.assignedDate || null;
    if (body.notes !== undefined) patch.notes = body.notes;

    const { data, error } = await supabase.from('employee_assignments').update(patch).eq('id', id).select(ASSIGNMENT_SELECT).single();
    if (error) return dbFailJson(c, 'ASSIGNMENT_UPDATE_FAILED', error);

    // ถ้าเปลี่ยนไปคนละ Asset ต้องคืน Asset เก่าก่อน (ไม่งั้น Asset เก่าจะค้างสถานะ "มีเจ้าของ" ตลอดไป)
    if (current.asset_id && String(current.asset_id) !== String(nextAssetId || '')) {
      await syncAssignmentAsset(supabase, current.asset_id, 'คืนแล้ว', current.employee_id, employee.department_id, actorId);
    }
    await syncAssignmentAsset(supabase, nextAssetId, nextStatus, current.employee_id, employee.department_id, actorId);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE_ASSIGNMENT',
      module: 'employee',
      targetTable: 'employee_assignments',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

employeeAssignmentsRoute.post(
  '/:id/status',
  requirePermission('employee.manage'),
  zValidator('json', setEmployeeAssignmentStatusSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { status } = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('employee_assignments').select('*').eq('id', id).maybeSingle();
    if (currentError) return c.json(fail(reqId, 'ASSIGNMENT_LOAD_FAILED', 'ดึงข้อมูลรายการครอบครองไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'ASSIGNMENT_NOT_FOUND', 'ไม่พบรายการครอบครองนี้'), 404);

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, department_id')
      .eq('id', current.employee_id)
      .maybeSingle();
    if (employeeError || !employee) return c.json(fail(reqId, 'EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานของรายการนี้'), 400);

    const patch = {
      status,
      returned_date: status === 'คืนแล้ว' ? current.returned_date || new Date().toISOString().slice(0, 10) : null,
      updated_by: actorId,
    };

    const { data, error } = await supabase.from('employee_assignments').update(patch).eq('id', id).select(ASSIGNMENT_SELECT).single();
    if (error) return dbFailJson(c, 'ASSIGNMENT_STATUS_FAILED', error);

    await syncAssignmentAsset(supabase, current.asset_id, status, current.employee_id, employee.department_id, actorId);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE_ASSIGNMENT_STATUS',
      module: 'employee',
      targetTable: 'employee_assignments',
      targetId: id,
      detail: { status },
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);
