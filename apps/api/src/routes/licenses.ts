import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import { buildLicenseCostSummary, type LicenseCostRow } from '../services/licenseCostService';
import { buildLicenseInsights } from '../services/licenseInsights';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  createLicenseAllocationSchema,
  createLicenseSchema,
  listLicensesQuerySchema,
  reclaimLicenseAllocationSchema,
  renewalApprovalSchema,
  setLicenseStatusSchema,
  updateLicenseSchema,
} from '../validators/licenses';

/** Software License — ทะเบียนจำนวนสิทธิ์ การผูก Vendor/Contract และการเตือนวันหมดอายุ */
export const licensesRoute = new Hono<AppEnv>();
licensesRoute.use('*', requireAuth);

const LICENSE_SELECT = '*, vendor:vendors(id, vendor_code, name, status), contract:contracts(id, contract_number, name, status, end_date)';
const ALLOCATION_SELECT =
  'id, license_id, assignee_type, employee_id, asset_id, status, assigned_at, assigned_by, reclaimed_at, reclaimed_by, notes, created_at, updated_at, ' +
  'employee:employees!software_license_allocations_employee_id_fkey(id, employee_code, prefix_th, first_name_th, last_name_th, nickname), ' +
  'asset:assets!software_license_allocations_asset_id_fkey(id, asset_code, name, status)';

type AllocationCountRow = { license_id: string; status: 'assigned' | 'reclaimed' };
type LicenseRow = Record<string, unknown> & {
  id: string;
  total_qty: number | string | null;
  used_qty: number | string | null;
  unit_price: number | string | null;
  status: string;
  expire_date: string | null;
  expiry_notice_days: number | string | null;
};

async function enrichLicenseRows(
  supabase: SupabaseClient,
  rows: unknown[],
): Promise<{ data?: Record<string, unknown>[]; error?: unknown }> {
  const licenses = rows as LicenseRow[];
  const ids = licenses.map((row) => row.id);
  const counts = new Map<string, { records: number; assigned: number; reclaimed: number }>();
  if (ids.length) {
    const { data, error } = await supabase
      .from('software_license_allocations')
      .select('license_id, status')
      .in('license_id', ids)
      .limit(20_000);
    if (error) return { error };
    for (const row of (data ?? []) as AllocationCountRow[]) {
      const current = counts.get(row.license_id) ?? { records: 0, assigned: 0, reclaimed: 0 };
      current.records += 1;
      if (row.status === 'assigned') current.assigned += 1;
      if (row.status === 'reclaimed') current.reclaimed += 1;
      counts.set(row.license_id, current);
    }
  }

  return {
    data: licenses.map((row) => {
      const count = counts.get(row.id);
      const insights = buildLicenseInsights({
        totalQty: row.total_qty,
        usedQty: row.used_qty,
        activeAllocationCount: count?.records ? count.assigned : undefined,
        reclaimedAllocationCount: count?.reclaimed ?? 0,
        unitPrice: row.unit_price,
        status: row.status,
        expireDate: row.expire_date,
        expiryNoticeDays: row.expiry_notice_days,
      });
      return {
        ...row,
        assigned_qty: insights.assignedQty,
        available_qty: insights.availableQty,
        reclaimed_qty: insights.reclaimedQty,
        usage_pct: insights.usagePct,
        total_cost: insights.totalCost,
        cost_per_user: insights.costPerUser,
        reclaimable_cost: insights.reclaimableCost,
        under_utilized: insights.underUtilized,
        over_allocation: insights.overAllocation,
        compliance_risk: insights.complianceRisk,
        renewal_recommendation: insights.renewalRecommendation,
      };
    }),
  };
}

function allocationDomainError(c: Parameters<typeof dbFailJson>[0], error: { message?: string; code?: string }, fallbackCode: string) {
  const message = error.message ?? '';
  const known: Record<string, { code: string; message: string; status: 400 | 404 | 409 }> = {
    ALLOCATION_TYPE_INVALID: { code: 'ALLOCATION_TYPE_INVALID', message: 'ประเภทผู้รับสิทธิ์ไม่ถูกต้อง', status: 400 },
    ALLOCATION_TARGET_INVALID: { code: 'ALLOCATION_TARGET_INVALID', message: 'ต้องเลือก User หรือ Device ให้ตรงกับประเภท allocation', status: 400 },
    LICENSE_NOT_FOUND: { code: 'LICENSE_NOT_FOUND', message: 'ไม่พบ Software License นี้', status: 404 },
    EMPLOYEE_NOT_FOUND: { code: 'EMPLOYEE_NOT_FOUND', message: 'ไม่พบ User ที่ยังปฏิบัติงานอยู่', status: 404 },
    ASSET_NOT_FOUND: { code: 'ASSET_NOT_FOUND', message: 'ไม่พบ Device นี้', status: 404 },
    ALLOCATION_NOT_FOUND_OR_ALREADY_RECLAIMED: { code: 'ALLOCATION_NOT_FOUND', message: 'ไม่พบ allocation หรือถูก reclaim ไปแล้ว', status: 409 },
  };
  const match = Object.keys(known).find((key) => message.includes(key));
  if (match) {
    const item = known[match];
    return c.json(fail(c.get('requestId'), item.code, item.message), item.status);
  }
  return dbFailJson(c, fallbackCode, error);
}

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
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));

  if (status) query = query.eq('status', status);
  if (search) {
    const safeSearch = cleanSearch(search);
    query = query.or(`license_code.ilike.%${safeSearch}%,software_name.ilike.%${safeSearch}%,license_type.ilike.%${safeSearch}%,vendor_name.ilike.%${safeSearch}%,assigned_to.ilike.%${safeSearch}%`);
  }

  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'LICENSES_LIST_FAILED', 'ดึงทะเบียน License ไม่สำเร็จ'), 400);
  const enriched = await enrichLicenseRows(supabase, data ?? []);
  if (enriched.error) return dbFailJson(c, 'LICENSE_ALLOCATIONS_LIST_FAILED', enriched.error);
  return c.json(ok(reqId, toPaginatedData(enriched.data ?? [], count, page, pageSize)));
});

/**
 * สรุปเงินที่เรียกคืนได้จากสิทธิ์ที่ไม่ได้ใช้ (design handoff 3e)
 *
 * ต้องเป็น endpoint แยกไม่ใช่แถมไปกับ GET / เพราะรายการหลักแบ่งหน้า ถ้าคำนวณจากหน้าที่โหลดมา
 * ตัวเลขจะเปลี่ยนไปเรื่อยตามหน้าที่เปิดอยู่ ซึ่งอ่านผิดได้ง่ายมากในหน้าที่ใช้ตัดสินใจเรื่องงบประมาณ
 *
 * ต้องอยู่ก่อน '/:id' ไม่งั้น Hono จะจับ 'summary' เป็น id แล้วตอบ 404
 */
licensesRoute.get('/summary', requirePermission('license.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');

  const { data, error } = await supabase
    .from('software_licenses')
    .select('id, software_name, total_qty, used_qty, unit_price, status, expire_date, expiry_notice_days')
    .eq('status', 'Active');

  if (error) return dbFailJson(c, 'LICENSE_SUMMARY_FAILED', error);
  const enriched = await enrichLicenseRows(supabase, data ?? []);
  if (enriched.error) return dbFailJson(c, 'LICENSE_ALLOCATIONS_LIST_FAILED', enriched.error);
  return c.json(ok(reqId, buildLicenseCostSummary((enriched.data ?? []) as unknown as LicenseCostRow[])));
});

licensesRoute.get('/options', requirePermission('license.view'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [employees, assets] = await Promise.all([
    admin.from('employees')
      .select('id, employee_code, prefix_th, first_name_th, last_name_th, nickname, status')
      .eq('status', 'active').order('first_name_th').limit(5000),
    admin.from('assets')
      .select('id, asset_code, name, status')
      .order('asset_code').limit(5000),
  ]);
  if (employees.error) return dbFailJson(c, 'LICENSE_EMPLOYEE_OPTIONS_FAILED', employees.error);
  if (assets.error) return dbFailJson(c, 'LICENSE_ASSET_OPTIONS_FAILED', assets.error);
  return c.json(ok(reqId, { employees: employees.data ?? [], assets: assets.data ?? [] }));
});

licensesRoute.get('/:id/allocations', requirePermission('license.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const [{ data: license, error: licenseError }, { data: allocations, error }] = await Promise.all([
    supabase.from('software_licenses').select('id').eq('id', id).maybeSingle(),
    supabase.from('software_license_allocations').select(ALLOCATION_SELECT).eq('license_id', id).order('assigned_at', { ascending: false }).limit(2000),
  ]);
  if (licenseError) return dbFailJson(c, 'LICENSE_LOAD_FAILED', licenseError);
  if (error) return dbFailJson(c, 'LICENSE_ALLOCATIONS_LIST_FAILED', error);
  if (!license) return c.json(fail(reqId, 'LICENSE_NOT_FOUND', 'ไม่พบ License นี้'), 404);
  return c.json(ok(reqId, allocations ?? []));
});

licensesRoute.post('/:id/allocations', requirePermission('license.manage'), zValidator('json', createLicenseAllocationSchema, zodValidationHook), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const licenseId = c.req.param('id')!;
  const body = c.req.valid('json');
  const { data: inserted, error } = await admin.rpc('assign_software_license', {
    p_license_id: licenseId,
    p_assignee_type: body.assigneeType,
    p_employee_id: body.employeeId || null,
    p_asset_id: body.assetId || null,
    p_notes: body.notes || null,
    p_actor_id: actorId,
  });
  if (error) return allocationDomainError(c, error, 'LICENSE_ALLOCATION_CREATE_FAILED');
  const allocationId = Array.isArray(inserted) ? (inserted[0] as { id?: string } | undefined)?.id : undefined;
  if (!allocationId) return c.json(fail(reqId, 'LICENSE_ALLOCATION_CREATE_FAILED', 'ไม่สามารถสร้าง allocation ได้'), 500);
  const { data, error: loadError } = await admin.from('software_license_allocations').select(ALLOCATION_SELECT).eq('id', allocationId).single();
  if (loadError) return dbFailJson(c, 'LICENSE_ALLOCATION_LOAD_FAILED', loadError);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'ASSIGN',
    module: 'license',
    targetTable: 'software_license_allocations',
    targetId: allocationId,
    detail: { licenseId, assigneeType: body.assigneeType, employeeId: body.employeeId, assetId: body.assetId },
    requestId: reqId,
  });
  return c.json(ok(reqId, data), 201);
});

licensesRoute.post('/:id/allocations/:allocationId/reclaim', requirePermission('license.manage'), zValidator('json', reclaimLicenseAllocationSchema, zodValidationHook), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const licenseId = c.req.param('id')!;
  const allocationId = c.req.param('allocationId')!;
  const body = c.req.valid('json');
  const { data: reclaimed, error } = await admin.rpc('reclaim_software_license', {
    p_license_id: licenseId,
    p_allocation_id: allocationId,
    p_notes: body.notes || null,
    p_actor_id: actorId,
  });
  if (error) return allocationDomainError(c, error, 'LICENSE_ALLOCATION_RECLAIM_FAILED');
  const data = Array.isArray(reclaimed) ? reclaimed[0] : reclaimed;
  if (!data) return c.json(fail(reqId, 'LICENSE_ALLOCATION_RECLAIM_FAILED', 'ไม่สามารถ reclaim allocation ได้'), 500);
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'RECLAIM',
    module: 'license',
    targetTable: 'software_license_allocations',
    targetId: allocationId,
    detail: { licenseId, notes: body.notes },
    requestId: reqId,
  });
  return c.json(ok(reqId, data));
});

licensesRoute.get('/:id', requirePermission('license.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data, error } = await supabase.from('software_licenses').select(LICENSE_SELECT).eq('id', id).maybeSingle();
  if (error) return c.json(fail(reqId, 'LICENSE_LOAD_FAILED', 'ดึงข้อมูล License ไม่สำเร็จ'), 400);
  if (!data) return c.json(fail(reqId, 'LICENSE_NOT_FOUND', 'ไม่พบ License นี้'), 404);
  const enriched = await enrichLicenseRows(supabase, [data]);
  if (enriched.error) return dbFailJson(c, 'LICENSE_ALLOCATIONS_LIST_FAILED', enriched.error);
  return c.json(ok(reqId, enriched.data?.[0] ?? data));
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
      product_name: body.productName?.trim() || body.softwareName,
      software_name: body.softwareName,
      edition: body.edition ?? null,
      version: body.version ?? null,
      publisher: body.publisher ?? null,
      license_model: body.licenseModel,
      license_type: body.licenseType ?? null,
      total_qty: body.totalQty ?? 0,
      used_qty: body.usedQty ?? 0,
      start_date: body.startDate || null,
      expire_date: body.expireDate || null,
      vendor_name: body.vendorName ?? null,
      vendor_id: normalized.vendorId,
      contract_id: body.contractId || null,
      assigned_to: body.assignedTo ?? null,
      unit_price: body.unitPrice ?? null,
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
  if (body.softwareName !== undefined) {
    patch.software_name = body.softwareName;
    if (body.productName === undefined) patch.product_name = body.softwareName;
  }
  if (body.productName !== undefined) patch.product_name = body.productName.trim() || (body.softwareName ?? current.software_name);
  if (body.edition !== undefined) patch.edition = body.edition || null;
  if (body.version !== undefined) patch.version = body.version || null;
  if (body.publisher !== undefined) patch.publisher = body.publisher || null;
  if (body.licenseModel !== undefined) patch.license_model = body.licenseModel;
  if (body.licenseType !== undefined) patch.license_type = body.licenseType;
  if (body.totalQty !== undefined) patch.total_qty = body.totalQty;
  if (body.usedQty !== undefined) patch.used_qty = body.usedQty;
  if (body.startDate !== undefined) patch.start_date = body.startDate || null;
  if (body.expireDate !== undefined) patch.expire_date = body.expireDate || null;
  if (body.vendorName !== undefined) patch.vendor_name = body.vendorName;
  if (body.vendorId !== undefined || body.contractId !== undefined) patch.vendor_id = normalized.vendorId;
  if (body.contractId !== undefined) patch.contract_id = body.contractId || null;
  if (body.assignedTo !== undefined) patch.assigned_to = body.assignedTo;
  if (body.unitPrice !== undefined) patch.unit_price = body.unitPrice;
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

licensesRoute.post('/:id/renewal-approval', requirePermission('license.manage'), zValidator('json', renewalApprovalSchema, zodValidationHook), async (c) => {
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const { data, error } = await admin.from('software_licenses').update({
    renewal_approval_status: body.status,
    renewal_approved_by: body.status === 'approved' ? actorId : null,
    renewal_approved_at: body.status === 'approved' ? new Date().toISOString() : null,
    renewal_approval_notes: body.notes || null,
    updated_by: actorId,
  }).eq('id', id).select(LICENSE_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'LICENSE_RENEWAL_APPROVAL_FAILED', error);
  if (!data) return c.json(fail(reqId, 'LICENSE_NOT_FOUND', 'ไม่พบ License นี้'), 404);
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'RENEWAL_APPROVAL',
    module: 'license',
    targetTable: 'software_licenses',
    targetId: id,
    detail: { status: body.status, notes: body.notes },
    requestId: reqId,
  });
  const enriched = await enrichLicenseRows(admin, [data]);
  if (enriched.error) return dbFailJson(c, 'LICENSE_ALLOCATIONS_LIST_FAILED', enriched.error);
  return c.json(ok(reqId, enriched.data?.[0] ?? data));
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
      link: '/software-licenses',
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
