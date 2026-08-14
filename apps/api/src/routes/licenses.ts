import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import { createLicenseSchema, listLicensesQuerySchema, setLicenseStatusSchema, updateLicenseSchema } from '../validators/licenses';

/** Software License — ทะเบียนจำนวนสิทธิ์ การผูก Vendor/Contract และการเตือนวันหมดอายุ */
export const licensesRoute = new Hono<AppEnv>();
licensesRoute.use('*', requireAuth);

const LICENSE_SELECT = '*, vendor:vendors(id, vendor_code, name, status), contract:contracts(id, contract_number, name, status, end_date)';

function generatedLicenseCode(): string {
  const now = new Date();
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `LIC-${month}-${randomCodeSuffix()}`;
}

async function normalizedVendorId(
  admin: ReturnType<typeof createAdminClient>,
  vendorId: string | undefined,
  contractId: string | undefined,
): Promise<{ vendorId: string | null; error?: 'CONTRACT_NOT_FOUND' | 'CONTRACT_VENDOR_MISMATCH' }> {
  if (!contractId) return { vendorId: vendorId || null };
  const { data: contract } = await admin.from('contracts').select('vendor_id').eq('id', contractId).maybeSingle();
  if (!contract) return { vendorId: null, error: 'CONTRACT_NOT_FOUND' };
  if (vendorId && contract.vendor_id !== vendorId) return { vendorId: null, error: 'CONTRACT_VENDOR_MISMATCH' };
  return { vendorId: vendorId || contract.vendor_id };
}

licensesRoute.get('/', requirePermission('license.view'), zValidator('query', listLicensesQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, search, status } = c.req.valid('query');

  let query = supabase
    .from('software_licenses')
    .select(LICENSE_SELECT, { count: 'exact' })
    .order('software_name', { ascending: true })
    .range(...paginationRange(page, pageSize));

  if (status) query = query.eq('status', status);
  if (search) {
    const safeSearch = cleanSearch(search);
    query = query.or(`license_code.ilike.%${safeSearch}%,software_name.ilike.%${safeSearch}%,license_type.ilike.%${safeSearch}%,vendor_name.ilike.%${safeSearch}%,assigned_to.ilike.%${safeSearch}%`);
  }

  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'LICENSES_LIST_FAILED', 'ดึงทะเบียน License ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

licensesRoute.get('/:id', requirePermission('license.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data, error } = await supabase.from('software_licenses').select(LICENSE_SELECT).eq('id', id).maybeSingle();
  if (error) return c.json(fail(reqId, 'LICENSE_LOAD_FAILED', 'ดึงข้อมูล License ไม่สำเร็จ'), 400);
  if (!data) return c.json(fail(reqId, 'LICENSE_NOT_FOUND', 'ไม่พบ License นี้'), 404);
  return c.json(ok(reqId, data));
});

licensesRoute.post('/', requirePermission('license.manage'), zValidator('json', createLicenseSchema, zodValidationHook), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const normalized = await normalizedVendorId(admin, body.vendorId, body.contractId);
  if (normalized.error === 'CONTRACT_NOT_FOUND') return c.json(fail(reqId, 'LICENSE_CONTRACT_NOT_FOUND', 'ไม่พบสัญญาที่เลือก'), 400);
  if (normalized.error === 'CONTRACT_VENDOR_MISMATCH') return c.json(fail(reqId, 'LICENSE_CONTRACT_VENDOR_MISMATCH', 'สัญญาไม่ได้อยู่ภายใต้ผู้จำหน่ายที่เลือก'), 400);

  const { data, error } = await admin
    .from('software_licenses')
    .insert({
      license_code: generatedLicenseCode(),
      software_name: body.softwareName,
      license_type: body.licenseType ?? null,
      total_qty: body.totalQty ?? 0,
      used_qty: body.usedQty ?? 0,
      start_date: body.startDate || null,
      expire_date: body.expireDate || null,
      vendor_name: body.vendorName ?? null,
      vendor_id: normalized.vendorId,
      contract_id: body.contractId || null,
      assigned_to: body.assignedTo ?? null,
      expiry_notice_days: body.expiryNoticeDays,
      notes: body.notes ?? null,
      created_by: actorId,
      updated_by: actorId,
    })
    .select(LICENSE_SELECT)
    .single();

  if (error) return dbFailJson(c, 'LICENSE_CREATE_FAILED', error);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'license',
    targetTable: 'software_licenses',
    targetId: data.id,
    detail: { licenseCode: data.license_code, softwareName: body.softwareName },
    requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

licensesRoute.patch('/:id', requirePermission('license.manage'), zValidator('json', updateLicenseSchema, zodValidationHook), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const { data: current, error: currentError } = await admin.from('software_licenses').select('*').eq('id', id).maybeSingle();
  if (currentError) return c.json(fail(reqId, 'LICENSE_LOAD_FAILED', 'ดึงข้อมูล License ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'LICENSE_NOT_FOUND', 'ไม่พบ License นี้'), 404);

  const mergedTotal = body.totalQty ?? current.total_qty;
  const mergedUsed = body.usedQty ?? current.used_qty;
  if (Number(mergedUsed) > Number(mergedTotal)) {
    return c.json(fail(reqId, 'VALIDATION_ERROR', 'จำนวนที่ใช้ต้องไม่เกินจำนวนทั้งหมด', [{ field: 'usedQty', message: 'เกินจำนวนทั้งหมด' }]), 400);
  }

  const normalized = await normalizedVendorId(
    admin,
    body.vendorId !== undefined ? body.vendorId : current.vendor_id,
    body.contractId !== undefined ? body.contractId : current.contract_id,
  );
  if (normalized.error === 'CONTRACT_NOT_FOUND') return c.json(fail(reqId, 'LICENSE_CONTRACT_NOT_FOUND', 'ไม่พบสัญญาที่เลือก'), 400);
  if (normalized.error === 'CONTRACT_VENDOR_MISMATCH') return c.json(fail(reqId, 'LICENSE_CONTRACT_VENDOR_MISMATCH', 'สัญญาไม่ได้อยู่ภายใต้ผู้จำหน่ายที่เลือก'), 400);

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.softwareName !== undefined) patch.software_name = body.softwareName;
  if (body.licenseType !== undefined) patch.license_type = body.licenseType;
  if (body.totalQty !== undefined) patch.total_qty = body.totalQty;
  if (body.usedQty !== undefined) patch.used_qty = body.usedQty;
  if (body.startDate !== undefined) patch.start_date = body.startDate || null;
  if (body.expireDate !== undefined) patch.expire_date = body.expireDate || null;
  if (body.vendorName !== undefined) patch.vendor_name = body.vendorName;
  if (body.vendorId !== undefined || body.contractId !== undefined) patch.vendor_id = normalized.vendorId;
  if (body.contractId !== undefined) patch.contract_id = body.contractId || null;
  if (body.assignedTo !== undefined) patch.assigned_to = body.assignedTo;
  if (body.expiryNoticeDays !== undefined) patch.expiry_notice_days = body.expiryNoticeDays;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.status !== undefined) patch.status = body.status;
  if (body.expireDate !== undefined) patch.expiry_notified_at = null;

  const auditBefore = await loadAuditSnapshot(admin, 'software_licenses', id);
  const { data, error } = await admin.from('software_licenses').update(patch).eq('id', id).select(LICENSE_SELECT).single();
  if (error) return dbFailJson(c, 'LICENSE_UPDATE_FAILED', error);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'license',
    targetTable: 'software_licenses',
    targetId: id,
    detail: body,
    requestId: reqId,
      before: auditBefore,
    after: data,
});

  return c.json(ok(reqId, data));
});

licensesRoute.post('/:id/status', requirePermission('license.manage'), zValidator('json', setLicenseStatusSchema, zodValidationHook), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { status } = c.req.valid('json');

  const { data, error } = await admin.from('software_licenses').update({ status, updated_by: actorId, ...(status === 'Active' ? { expiry_notified_at: null } : {}) }).eq('id', id).select(LICENSE_SELECT).single();
  if (error) return dbFailJson(c, 'LICENSE_STATUS_FAILED', error);

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

/** คำนวณสถานะหมดอายุและสร้าง in-app notification แบบ idempotent ให้ผู้ดูแลระบบ */
licensesRoute.post('/check-expiry', requirePermission('license.manage'), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');

  const today = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const { data: candidates, error: findError } = await admin
    .from('software_licenses')
    .select('id, license_code, software_name, expire_date, expiry_notice_days, expiry_notified_at, status')
    .not('expire_date', 'is', null)
    .neq('status', 'Inactive');
  if (findError) return dbFailJson(c, 'LICENSE_EXPIRY_CHECK_FAILED', findError);

  const expiredIds = (candidates ?? []).filter((row) => row.status === 'Active' && row.expire_date! < today).map((row) => row.id);
  if (expiredIds.length) {
    const { error: updateError } = await admin.from('software_licenses').update({ status: 'Expired', updated_by: actorId }).in('id', expiredIds);
    if (updateError) return dbFailJson(c, 'LICENSE_EXPIRY_UPDATE_FAILED', updateError);
  }

  const notifyRows = (candidates ?? []).filter((row) => {
    if (row.expiry_notified_at || !row.expire_date) return false;
    const days = Math.ceil((Date.parse(`${row.expire_date}T00:00:00Z`) - todayMs) / 86_400_000);
    return days <= row.expiry_notice_days;
  });
  const { data: adminRoles } = await admin
    .from('user_roles')
    .select('user_id, roles!inner(key), profiles!inner(status)')
    .in('roles.key', ['super_admin', 'it_admin'])
    .eq('profiles.status', 'active');
  const recipientIds = [...new Set((adminRoles ?? []).map((row) => row.user_id))];
  const notifiedCount = recipientIds.length ? notifyRows.length : 0;
  if (notifyRows.length && recipientIds.length) {
    await Promise.all(notifyRows.flatMap((row) => recipientIds.map((recipientId) => sendNotification(c.env, {
      recipientId,
      type: 'license_expiry',
      title: row.expire_date! < today ? `License ${row.license_code} หมดอายุแล้ว` : `License ${row.license_code} ใกล้หมดอายุ`,
      body: `${row.software_name} · สิ้นสุด ${row.expire_date}`,
      link: '/licenses',
    }))));
    await admin.from('software_licenses').update({ expiry_notified_at: new Date().toISOString(), updated_by: actorId }).in('id', notifyRows.map((row) => row.id));
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CHECK_EXPIRY',
    module: 'license',
    targetTable: 'software_licenses',
    detail: { updatedCount: expiredIds.length, notifiedCount, recipientCount: recipientIds.length },
    requestId: reqId,
  });

  return c.json(ok(reqId, { updatedCount: expiredIds.length, notifiedCount }));
});
