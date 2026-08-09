import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { createLicenseSchema, listLicensesQuerySchema, setLicenseStatusSchema, updateLicenseSchema } from '../validators/licenses';

/**
 * Software License — สืบทอดจาก SoftwareLicenses เดิม (Module_ITAssetExtras.gs) การส่งแจ้งเตือนหมดอายุ
 * ทาง Email/LINE (sendLicenseExpiryNotifications_) เลื่อนไว้ก่อน (ยังไม่มี Cron/Email/LINE infra) แต่
 * การคำนวณสถานะหมดอายุ (checkExpireLicenses_) ยังคงย้ายมาเป็น endpoint กดคำนวณเองได้
 */
export const licensesRoute = new Hono<AppEnv>();
licensesRoute.use('*', requireAuth);

licensesRoute.get('/', requirePermission('license.view'), zValidator('query', listLicensesQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, search, status } = c.req.valid('query');

  let query = supabase
    .from('software_licenses')
    .select('*', { count: 'exact' })
    .order('software_name', { ascending: true })
    .range(...paginationRange(page, pageSize));

  if (status) query = query.eq('status', status);
  if (search) query = query.or(`software_name.ilike.%${search}%,vendor_name.ilike.%${search}%,assigned_to.ilike.%${search}%`);

  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'LICENSES_LIST_FAILED', 'ดึงทะเบียน License ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

licensesRoute.get('/:id', requirePermission('license.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data, error } = await supabase.from('software_licenses').select('*').eq('id', id).maybeSingle();
  if (error) return c.json(fail(reqId, 'LICENSE_LOAD_FAILED', 'ดึงข้อมูล License ไม่สำเร็จ'), 400);
  if (!data) return c.json(fail(reqId, 'LICENSE_NOT_FOUND', 'ไม่พบ License นี้'), 404);
  return c.json(ok(reqId, data));
});

licensesRoute.post('/', requirePermission('license.manage'), zValidator('json', createLicenseSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('software_licenses')
    .insert({
      software_name: body.softwareName,
      license_type: body.licenseType ?? null,
      total_qty: body.totalQty ?? 0,
      used_qty: body.usedQty ?? 0,
      start_date: body.startDate || null,
      expire_date: body.expireDate || null,
      vendor_name: body.vendorName ?? null,
      assigned_to: body.assignedTo ?? null,
      notes: body.notes ?? null,
      created_by: actorId,
    })
    .select()
    .single();

  if (error) return c.json(fail(reqId, 'LICENSE_CREATE_FAILED', error.message), 400);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'license',
    targetTable: 'software_licenses',
    targetId: data.id,
    detail: { softwareName: body.softwareName },
    requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

licensesRoute.patch('/:id', requirePermission('license.manage'), zValidator('json', updateLicenseSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const { data: current, error: currentError } = await supabase.from('software_licenses').select('*').eq('id', id).maybeSingle();
  if (currentError) return c.json(fail(reqId, 'LICENSE_LOAD_FAILED', 'ดึงข้อมูล License ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'LICENSE_NOT_FOUND', 'ไม่พบ License นี้'), 404);

  const mergedTotal = body.totalQty ?? current.total_qty;
  const mergedUsed = body.usedQty ?? current.used_qty;
  if (Number(mergedUsed) > Number(mergedTotal)) {
    return c.json(fail(reqId, 'VALIDATION_ERROR', 'จำนวนที่ใช้ต้องไม่เกินจำนวนทั้งหมด', [{ field: 'usedQty', message: 'เกินจำนวนทั้งหมด' }]), 400);
  }

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.softwareName !== undefined) patch.software_name = body.softwareName;
  if (body.licenseType !== undefined) patch.license_type = body.licenseType;
  if (body.totalQty !== undefined) patch.total_qty = body.totalQty;
  if (body.usedQty !== undefined) patch.used_qty = body.usedQty;
  if (body.startDate !== undefined) patch.start_date = body.startDate || null;
  if (body.expireDate !== undefined) patch.expire_date = body.expireDate || null;
  if (body.vendorName !== undefined) patch.vendor_name = body.vendorName;
  if (body.assignedTo !== undefined) patch.assigned_to = body.assignedTo;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.status !== undefined) patch.status = body.status;

  const { data, error } = await supabase.from('software_licenses').update(patch).eq('id', id).select().single();
  if (error) return c.json(fail(reqId, 'LICENSE_UPDATE_FAILED', error.message), 400);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'license',
    targetTable: 'software_licenses',
    targetId: id,
    detail: body,
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});

licensesRoute.post('/:id/status', requirePermission('license.manage'), zValidator('json', setLicenseStatusSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { status } = c.req.valid('json');

  const { data, error } = await supabase.from('software_licenses').update({ status, updated_by: actorId }).eq('id', id).select().single();
  if (error) return c.json(fail(reqId, 'LICENSE_STATUS_FAILED', error.message), 400);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE_STATUS',
    module: 'license',
    targetTable: 'software_licenses',
    targetId: id,
    detail: { status },
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});

/** คำนวณสถานะหมดอายุใหม่ทั้งหมด (checkExpireLicenses_ เดิม) — กดเองได้ ยังไม่มีการแจ้งเตือนอัตโนมัติ */
licensesRoute.post('/check-expiry', requirePermission('license.manage'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');

  const today = new Date().toISOString().slice(0, 10);
  const { data: candidates, error: findError } = await supabase.from('software_licenses').select('id, status').lt('expire_date', today);
  if (findError) return c.json(fail(reqId, 'LICENSE_EXPIRY_CHECK_FAILED', findError.message), 400);

  const ids = (candidates ?? []).filter((row) => row.status !== 'Expired' && row.status !== 'Inactive').map((row) => row.id);
  if (ids.length) {
    const { error: updateError } = await supabase.from('software_licenses').update({ status: 'Expired', updated_by: actorId }).in('id', ids);
    if (updateError) return c.json(fail(reqId, 'LICENSE_EXPIRY_UPDATE_FAILED', updateError.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CHECK_EXPIRY',
    module: 'license',
    targetTable: 'software_licenses',
    detail: { updatedCount: ids.length },
    requestId: reqId,
  });

  return c.json(ok(reqId, { updatedCount: ids.length }));
});
