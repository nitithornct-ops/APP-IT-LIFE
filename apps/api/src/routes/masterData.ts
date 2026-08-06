import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  createDepartmentSchema,
  createPositionSchema,
  updateDepartmentSchema,
  updatePositionSchema,
} from '../validators/masterData';

export const departmentsRoute = new Hono<AppEnv>();
departmentsRoute.use('*', requireAuth);

/** ทุกคนที่ login แล้วอ่านได้ (ใช้ทำ dropdown ทั่วระบบ) — RLS อนุญาตอยู่แล้วเช่นกัน */
departmentsRoute.get('/', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('departments').select('*').order('name_th', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'DEPARTMENTS_LIST_FAILED', 'ดึงรายชื่อหน่วยงานไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

departmentsRoute.post('/', requirePermission('department.manage'), zValidator('json', createDepartmentSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('departments')
    .insert({
      code: body.code,
      name_th: body.nameTh,
      name_en: body.nameEn ?? null,
      parent_department_id: body.parentDepartmentId ?? null,
      created_by: actorId,
    })
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'DEPARTMENT_CREATE_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'department',
    targetTable: 'departments',
    targetId: data.id,
    detail: body,
    requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

departmentsRoute.patch(
  '/:id',
  requirePermission('department.manage'),
  zValidator('json', updateDepartmentSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.code !== undefined) patch.code = body.code;
    if (body.nameTh !== undefined) patch.name_th = body.nameTh;
    if (body.nameEn !== undefined) patch.name_en = body.nameEn;
    if (body.parentDepartmentId !== undefined) patch.parent_department_id = body.parentDepartmentId;
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await supabase.from('departments').update(patch).eq('id', id).select().single();

    if (error) {
      return c.json(fail(reqId, 'DEPARTMENT_UPDATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'department',
      targetTable: 'departments',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

export const positionsRoute = new Hono<AppEnv>();
positionsRoute.use('*', requireAuth);

positionsRoute.get('/', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('positions').select('*').order('name_th', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'POSITIONS_LIST_FAILED', 'ดึงรายชื่อตำแหน่งไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

positionsRoute.post('/', requirePermission('position.manage'), zValidator('json', createPositionSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('positions')
    .insert({ code: body.code, name_th: body.nameTh, name_en: body.nameEn ?? null, created_by: actorId })
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'POSITION_CREATE_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'position',
    targetTable: 'positions',
    targetId: data.id,
    detail: body,
    requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

positionsRoute.patch('/:id', requirePermission('position.manage'), zValidator('json', updatePositionSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.code !== undefined) patch.code = body.code;
  if (body.nameTh !== undefined) patch.name_th = body.nameTh;
  if (body.nameEn !== undefined) patch.name_en = body.nameEn;
  if (body.status !== undefined) patch.status = body.status;

  const { data, error } = await supabase.from('positions').update(patch).eq('id', id).select().single();

  if (error) {
    return c.json(fail(reqId, 'POSITION_UPDATE_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'position',
    targetTable: 'positions',
    targetId: id,
    detail: body,
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});
