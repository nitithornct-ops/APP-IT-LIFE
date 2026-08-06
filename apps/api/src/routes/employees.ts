import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { createEmployeeSchema, listEmployeesQuerySchema, updateEmployeeSchema } from '../validators/employees';

/**
 * ทะเบียนพนักงาน — สืบทอดจาก Employees เดิม (Module_Employee.gs) แยกจาก profiles (บัญชี login)
 * เพราะพนักงานบางคนไม่มีบัญชีในระบบ Ticket/Asset (Phase 6 ลำดับถัดไป) จะผูก "เจ้าของ" กับตารางนี้
 */
export const employeesRoute = new Hono<AppEnv>();
employeesRoute.use('*', requireAuth);

employeesRoute.get('/', zValidator('query', listEmployeesQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, search } = c.req.valid('query');

  let query = supabase
    .from('employees')
    .select('*', { count: 'exact' })
    .order('first_name_th', { ascending: true })
    .range(...paginationRange(page, pageSize));

  if (search) {
    query = query.or(
      `employee_code.ilike.%${search}%,first_name_th.ilike.%${search}%,last_name_th.ilike.%${search}%,nickname.ilike.%${search}%,email.ilike.%${search}%`,
    );
  }

  const { data, count, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'EMPLOYEES_LIST_FAILED', 'ดึงรายชื่อพนักงานไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
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
      return c.json(fail(reqId, 'EMPLOYEE_CREATE_FAILED', error.message), 400);
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

    const { data, error } = await supabase.from('employees').update(patch).eq('id', id).select().single();
    if (error) {
      return c.json(fail(reqId, 'EMPLOYEE_UPDATE_FAILED', error.message), 400);
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
    });

    return c.json(ok(reqId, data));
  },
);
