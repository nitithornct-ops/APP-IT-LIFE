import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  createAccessSystemSchema,
  createAssetCategorySchema,
  createDepartmentSchema,
  createPositionSchema,
  createTicketCategorySchema,
  updateAccessSystemSchema,
  updateAssetCategorySchema,
  updateDepartmentSchema,
  updatePositionSchema,
  updateTicketCategorySchema,
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

/** หมวดหมู่ Ticket + ค่า SLA ตั้งต้น — Master Data ที่ Help Desk/Ticket (Phase 6 ลำดับ 4) จะอ้างอิงต่อ */
export const ticketCategoriesRoute = new Hono<AppEnv>();
ticketCategoriesRoute.use('*', requireAuth);

ticketCategoriesRoute.get('/', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('ticket_categories').select('*').order('name', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'TICKET_CATEGORIES_LIST_FAILED', 'ดึงรายการหมวดหมู่ Ticket ไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

ticketCategoriesRoute.post(
  '/',
  requirePermission('ticket_category.manage'),
  zValidator('json', createTicketCategorySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('ticket_categories')
      .insert({
        name: body.name,
        default_priority: body.defaultPriority ?? undefined,
        response_sla_hours: body.responseSlaHours ?? null,
        resolution_sla_hours: body.resolutionSlaHours ?? null,
        sla_hours: body.slaHours ?? null,
        is_security_default: body.isSecurityDefault ?? false,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return c.json(fail(reqId, 'TICKET_CATEGORY_CREATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'ticket_category',
      targetTable: 'ticket_categories',
      targetId: data.id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

ticketCategoriesRoute.patch(
  '/:id',
  requirePermission('ticket_category.manage'),
  zValidator('json', updateTicketCategorySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.name !== undefined) patch.name = body.name;
    if (body.defaultPriority !== undefined) patch.default_priority = body.defaultPriority;
    if (body.responseSlaHours !== undefined) patch.response_sla_hours = body.responseSlaHours;
    if (body.resolutionSlaHours !== undefined) patch.resolution_sla_hours = body.resolutionSlaHours;
    if (body.slaHours !== undefined) patch.sla_hours = body.slaHours;
    if (body.isSecurityDefault !== undefined) patch.is_security_default = body.isSecurityDefault;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await supabase.from('ticket_categories').update(patch).eq('id', id).select().single();

    if (error) {
      return c.json(fail(reqId, 'TICKET_CATEGORY_UPDATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'ticket_category',
      targetTable: 'ticket_categories',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

/** หมวดหมู่ทรัพย์สิน — Master Data ที่ Asset Management (Phase 6 ลำดับ 8) จะอ้างอิงต่อ (code_prefix ใช้ auto-gen รหัสทรัพย์สิน) */
export const assetCategoriesRoute = new Hono<AppEnv>();
assetCategoriesRoute.use('*', requireAuth);

assetCategoriesRoute.get('/', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('asset_categories').select('*').order('name', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'ASSET_CATEGORIES_LIST_FAILED', 'ดึงรายการหมวดหมู่ทรัพย์สินไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

assetCategoriesRoute.post(
  '/',
  requirePermission('asset_category.manage'),
  zValidator('json', createAssetCategorySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('asset_categories')
      .insert({
        name: body.name,
        code_prefix: body.codePrefix,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return c.json(fail(reqId, 'ASSET_CATEGORY_CREATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'asset_category',
      targetTable: 'asset_categories',
      targetId: data.id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

assetCategoriesRoute.patch(
  '/:id',
  requirePermission('asset_category.manage'),
  zValidator('json', updateAssetCategorySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.name !== undefined) patch.name = body.name;
    if (body.codePrefix !== undefined) patch.code_prefix = body.codePrefix;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await supabase.from('asset_categories').update(patch).eq('id', id).select().single();

    if (error) {
      return c.json(fail(reqId, 'ASSET_CATEGORY_UPDATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'asset_category',
      targetTable: 'asset_categories',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

/** รายชื่อระบบงานที่ขอสิทธิ์ได้ — Master Data ที่คำขอสิทธิ์ระบบ (Phase 6 ลำดับ 6) จะอ้างอิงต่อ */
export const accessSystemsRoute = new Hono<AppEnv>();
accessSystemsRoute.use('*', requireAuth);

accessSystemsRoute.get('/', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('access_systems').select('*').order('name', { ascending: true });

  if (error) {
    return c.json(fail(reqId, 'ACCESS_SYSTEMS_LIST_FAILED', 'ดึงรายชื่อระบบงานไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

accessSystemsRoute.post(
  '/',
  requirePermission('access_system.manage'),
  zValidator('json', createAccessSystemSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('access_systems')
      .insert({ name: body.name, notes: body.notes ?? null, created_by: actorId })
      .select()
      .single();

    if (error) {
      return c.json(fail(reqId, 'ACCESS_SYSTEM_CREATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'access_system',
      targetTable: 'access_systems',
      targetId: data.id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

accessSystemsRoute.patch(
  '/:id',
  requirePermission('access_system.manage'),
  zValidator('json', updateAccessSystemSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.name !== undefined) patch.name = body.name;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await supabase.from('access_systems').update(patch).eq('id', id).select().single();

    if (error) {
      return c.json(fail(reqId, 'ACCESS_SYSTEM_UPDATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'access_system',
      targetTable: 'access_systems',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);
