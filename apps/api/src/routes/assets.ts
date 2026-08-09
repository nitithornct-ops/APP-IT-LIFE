import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  assignAssetSchema,
  createAssetSchema,
  listAssetsQuerySchema,
  returnAssetFromRepairSchema,
  returnAssetSchema,
  sendAssetToRepairSchema,
  setAssetStatusSchema,
  transferAssetSchema,
  updateAssetPatchSchema,
  updateAssetSchema,
  verifyAssetSchema,
} from '../validators/assets';

/**
 * ทะเบียนทรัพย์สิน IT — สืบทอดจาก AssetRegister + Asset_History เดิม (Module_Asset.gs +
 * Module_AssetExtras.gs ส่วน stocktake) รวม Borrow/Return/Transfer/ส่งซ่อม-รับคืนจากซ่อมไว้ในไฟล์
 * เดียวกัน (Asset/Borrow ใช้ตารางเดียวกันในระบบเดิมอยู่แล้ว) — Analytics เต็มรูปแบบ (breakdown ตาม
 * หมวดหมู่/แผนก + trend 6 เดือน) เลื่อนไปทำที่ Report Center (roadmap ลำดับ 20) ดู comment เต็มใน
 * migration 20260814100000_assets.sql
 */
export const assetsRoute = new Hono<AppEnv>();
assetsRoute.use('*', requireAuth);

const ASSET_SELECT =
  'id, asset_code, name, asset_type, category_id, brand, model, serial_number, vendor_name, ' +
  'purchase_date, warranty_expire, price, useful_life_years, license_no, license_expiry, location, ' +
  'department_id, owner_employee_id, patch_status, patch_date, criticality, status, qr_code_url, ' +
  'last_audit_date, audit_status, loan_date, loan_due_date, notes, remark, created_at, updated_at, ' +
  'category:asset_categories(id, name, code_prefix), department:departments(id, name_th), ' +
  'owner:employees(id, employee_code, first_name_th, last_name_th, nickname)';

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function computeDepreciation(price: number | null, purchaseDate: string | null, usefulLifeYears: number | null) {
  const p = Number(price) || 0;
  const life = Number(usefulLifeYears) || 5;
  if (!p || !purchaseDate) return { ageYears: null, bookValue: p || null, depreciationPct: null };
  const pd = new Date(purchaseDate);
  if (Number.isNaN(pd.getTime())) return { ageYears: null, bookValue: p || null, depreciationPct: null };
  const ageYears = (Date.now() - pd.getTime()) / (365.25 * 86400000);
  const remain = Math.max(0, 1 - ageYears / life);
  return {
    ageYears: Math.round(ageYears * 10) / 10,
    bookValue: Math.round(p * remain),
    depreciationPct: Math.round((1 - remain) * 100),
  };
}

function buildAssetQrUrl(code: string, name: string): string {
  const data = encodeURIComponent(`${code}${name ? ` | ${name}` : ''}`);
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${data}`;
}

function generateAssetCode(categoryPrefix: string | null | undefined): string {
  const prefix = `AS-${categoryPrefix || 'GEN'}`;
  const now = new Date();
  const datePart = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${datePart}${rand}`;
}

function enrichAsset<T extends { price: number | null; purchase_date: string | null; useful_life_years: number | null; warranty_expire: string | null; license_expiry: string | null }>(
  row: T,
) {
  const dep = computeDepreciation(row.price, row.purchase_date, row.useful_life_years);
  return {
    ...row,
    ...dep,
    warrantyDaysLeft: daysUntil(row.warranty_expire),
    licenseDaysLeft: daysUntil(row.license_expiry),
  };
}

interface MovementInput {
  assetId: string;
  actionType: string;
  fromEmployeeId?: string | null;
  toEmployeeId?: string | null;
  vendorName?: string | null;
  departmentId?: string | null;
  location?: string | null;
  statusLabel?: string | null;
  notes?: string | null;
  dueDate?: string | null;
  condition?: string | null;
  createdBy: string;
}

async function recordMovement(supabase: SupabaseClient, m: MovementInput) {
  await supabase.from('asset_movements').insert({
    asset_id: m.assetId,
    action_type: m.actionType,
    from_employee_id: m.fromEmployeeId ?? null,
    to_employee_id: m.toEmployeeId ?? null,
    vendor_name: m.vendorName ?? null,
    department_id: m.departmentId ?? null,
    location: m.location ?? null,
    status_label: m.statusLabel ?? null,
    notes: m.notes ?? null,
    due_date: m.dueDate || null,
    condition: m.condition ?? null,
    created_by: m.createdBy,
  });
}

async function loadAssetOr404(supabase: SupabaseClient, id: string) {
  return supabase.from('assets').select('*').eq('id', id).maybeSingle();
}

const ASSET_RETIRED_STATUSES = ['จำหน่าย/เลิกใช้', 'สูญหาย'];

/** dropdown แบบเบา (สำหรับฟอร์ม PM/Employee Assignment ฯลฯ) — ต้องอยู่ก่อน '/:id' */
assetsRoute.get('/options', requirePermission('asset.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase
    .from('assets')
    .select('id, asset_code, name, status')
    .order('asset_code', { ascending: true })
    .limit(2000);
  if (error) return c.json(fail(reqId, 'ASSET_OPTIONS_LOAD_FAILED', 'ดึงรายการทรัพย์สินไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data));
});

assetsRoute.get('/', requirePermission('asset.view'), zValidator('query', listAssetsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, categoryId } = c.req.valid('query');

  let query = supabase
    .from('assets')
    .select(ASSET_SELECT, { count: 'exact' })
    .order('asset_code', { ascending: true })
    .range(...paginationRange(page, pageSize));

  if (status) query = query.eq('status', status);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (search) {
    query = query.or(`name.ilike.%${search}%,asset_code.ilike.%${search}%,serial_number.ilike.%${search}%`);
  }

  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'ASSETS_LIST_FAILED', 'ดึงทะเบียนทรัพย์สินไม่สำเร็จ'), 400);
  const items = (data ?? []).map((row) => enrichAsset(row as never));
  return c.json(ok(reqId, toPaginatedData(items, count, page, pageSize)));
});

assetsRoute.get('/:id', requirePermission('asset.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data: asset, error } = await supabase.from('assets').select(ASSET_SELECT).eq('id', id).maybeSingle();
  if (error) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!asset) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const [{ data: movements }, { data: pm }, { data: licenses }] = await Promise.all([
    supabase
      .from('asset_movements')
      .select(
        'id, action_type, from_employee:employees!asset_movements_from_employee_id_fkey(first_name_th, last_name_th), ' +
          'to_employee:employees!asset_movements_to_employee_id_fkey(first_name_th, last_name_th), vendor_name, ' +
          'department:departments(name_th), location, status_label, notes, due_date, condition, action_date',
      )
      .eq('asset_id', id)
      .order('action_date', { ascending: false })
      .limit(100),
    supabase
      .from('maintenance_plans')
      .select('id, plan_date, actual_date, status, result, recurrence')
      .eq('asset_id', id)
      .order('plan_date', { ascending: false })
      .limit(50),
    supabase.from('software_licenses').select('id, software_name, license_type, expire_date, status').ilike('assigned_to', `%${id}%`),
  ]);

  return c.json(ok(reqId, { asset: enrichAsset(asset as never), movements: movements ?? [], maintenance: pm ?? [], licenses: licenses ?? [] }));
});

assetsRoute.post('/', requirePermission('asset.create'), zValidator('json', createAssetSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  let categoryPrefix: string | null = null;
  if (body.categoryId) {
    const { data: category } = await supabase.from('asset_categories').select('code_prefix').eq('id', body.categoryId).maybeSingle();
    categoryPrefix = category?.code_prefix ?? null;
  }
  const assetCode = body.assetCode || generateAssetCode(categoryPrefix);

  const { data, error } = await supabase
    .from('assets')
    .insert({
      asset_code: assetCode,
      name: body.name,
      asset_type: body.assetType ?? 'อื่นๆ',
      category_id: body.categoryId ?? null,
      brand: body.brand ?? null,
      model: body.model ?? null,
      serial_number: body.serialNumber ?? null,
      vendor_name: body.vendorName ?? null,
      purchase_date: body.purchaseDate || null,
      warranty_expire: body.warrantyExpire || null,
      price: body.price ?? null,
      useful_life_years: body.usefulLifeYears ?? null,
      license_no: body.licenseNo ?? null,
      license_expiry: body.licenseExpiry || null,
      location: body.location ?? null,
      department_id: body.departmentId ?? null,
      owner_employee_id: body.ownerEmployeeId ?? null,
      patch_status: body.patchStatus ?? null,
      patch_date: body.patchDate || null,
      criticality: body.criticality ?? null,
      status: body.status ?? 'พร้อมใช้งาน',
      qr_code_url: buildAssetQrUrl(assetCode, body.name),
      notes: body.notes ?? null,
      remark: body.remark ?? null,
      created_by: actorId,
    })
    .select(ASSET_SELECT)
    .single();

  if (error) return c.json(fail(reqId, 'ASSET_CREATE_FAILED', error.message), 400);
  const createdId = (data as unknown as { id: string }).id;

  await recordMovement(supabase, {
    assetId: createdId,
    actionType: 'Create',
    statusLabel: 'บันทึก',
    notes: 'ลงทะเบียนทรัพย์สิน',
    createdBy: actorId,
  });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'asset',
    targetTable: 'assets',
    targetId: createdId,
    detail: { name: body.name, assetCode },
    requestId: reqId,
  });

  return c.json(ok(reqId, enrichAsset(data as never)), 201);
});

assetsRoute.patch('/:id', requirePermission('asset.update'), zValidator('json', updateAssetSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.name !== undefined) patch.name = body.name;
  if (body.assetCode !== undefined) patch.asset_code = body.assetCode;
  if (body.assetType !== undefined) patch.asset_type = body.assetType;
  if (body.categoryId !== undefined) patch.category_id = body.categoryId || null;
  if (body.brand !== undefined) patch.brand = body.brand;
  if (body.model !== undefined) patch.model = body.model;
  if (body.serialNumber !== undefined) patch.serial_number = body.serialNumber;
  if (body.vendorName !== undefined) patch.vendor_name = body.vendorName;
  if (body.purchaseDate !== undefined) patch.purchase_date = body.purchaseDate || null;
  if (body.warrantyExpire !== undefined) patch.warranty_expire = body.warrantyExpire || null;
  if (body.price !== undefined) patch.price = body.price;
  if (body.usefulLifeYears !== undefined) patch.useful_life_years = body.usefulLifeYears;
  if (body.licenseNo !== undefined) patch.license_no = body.licenseNo;
  if (body.licenseExpiry !== undefined) patch.license_expiry = body.licenseExpiry || null;
  if (body.location !== undefined) patch.location = body.location;
  if (body.departmentId !== undefined) patch.department_id = body.departmentId || null;
  if (body.ownerEmployeeId !== undefined) patch.owner_employee_id = body.ownerEmployeeId || null;
  if (body.patchStatus !== undefined) patch.patch_status = body.patchStatus;
  if (body.patchDate !== undefined) patch.patch_date = body.patchDate || null;
  if (body.criticality !== undefined) patch.criticality = body.criticality;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.remark !== undefined) patch.remark = body.remark;

  if (patch.asset_code || patch.name) {
    patch.qr_code_url = buildAssetQrUrl((patch.asset_code as string) || current.asset_code, (patch.name as string) || current.name);
  }

  const { data, error } = await supabase.from('assets').update(patch).eq('id', id).select(ASSET_SELECT).single();
  if (error) return c.json(fail(reqId, 'ASSET_UPDATE_FAILED', error.message), 400);

  await recordMovement(supabase, { assetId: id, actionType: 'Update', statusLabel: 'บันทึก', notes: 'แก้ไขข้อมูลทรัพย์สิน', createdBy: actorId });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    detail: body,
    requestId: reqId,
  });

  return c.json(ok(reqId, enrichAsset(data as never)));
});

assetsRoute.post('/:id/status', requirePermission('asset.update'), zValidator('json', setAssetStatusSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { status, remark } = c.req.valid('json');

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const { data, error } = await supabase.from('assets').update({ status, updated_by: actorId }).eq('id', id).select(ASSET_SELECT).single();
  if (error) return c.json(fail(reqId, 'ASSET_STATUS_UPDATE_FAILED', error.message), 400);

  await recordMovement(supabase, {
    assetId: id,
    actionType: 'Status',
    statusLabel: 'บันทึก',
    notes: `เปลี่ยนสถานะเป็น ${status}${remark ? ` (${remark})` : ''}`,
    createdBy: actorId,
  });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE_STATUS',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    detail: { status },
    requestId: reqId,
  });

  return c.json(ok(reqId, enrichAsset(data as never)));
});

assetsRoute.post('/:id/retire', requirePermission('asset.dispose'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const { data, error } = await supabase
    .from('assets')
    .update({ status: 'จำหน่าย/เลิกใช้', updated_by: actorId })
    .eq('id', id)
    .select(ASSET_SELECT)
    .single();
  if (error) return c.json(fail(reqId, 'ASSET_RETIRE_FAILED', error.message), 400);

  await recordMovement(supabase, { assetId: id, actionType: 'Retire', statusLabel: 'จำหน่าย/เลิกใช้', notes: 'จำหน่าย/เลิกใช้', createdBy: actorId });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'RETIRE',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    detail: { name: current.name },
    requestId: reqId,
  });

  return c.json(ok(reqId, enrichAsset(data as never)));
});

assetsRoute.post(
  '/:id/patch-status',
  requirePermission('asset.update'),
  zValidator('json', updateAssetPatchSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { patchStatus, patchDate } = c.req.valid('json');

    const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
    if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

    const { data, error } = await supabase
      .from('assets')
      .update({ patch_status: patchStatus, patch_date: patchDate || new Date().toISOString().slice(0, 10), updated_by: actorId })
      .eq('id', id)
      .select(ASSET_SELECT)
      .single();
    if (error) return c.json(fail(reqId, 'ASSET_PATCH_UPDATE_FAILED', error.message), 400);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'asset',
      targetTable: 'assets',
      targetId: id,
      detail: { patchStatus },
      requestId: reqId,
    });

    return c.json(ok(reqId, enrichAsset(data as never)));
  },
);

assetsRoute.post('/:id/qr', requirePermission('asset.update'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const url = buildAssetQrUrl(current.asset_code || current.id, current.name);
  const { data, error } = await supabase.from('assets').update({ qr_code_url: url, updated_by: actorId }).eq('id', id).select('id, qr_code_url').single();
  if (error) return c.json(fail(reqId, 'ASSET_QR_FAILED', error.message), 400);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'QR',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});

/** ตรวจนับทรัพย์สิน (Stocktake) — Module_AssetExtras.gs verifyAsset */
assetsRoute.post('/:id/verify', requirePermission('asset.update'), zValidator('json', verifyAssetSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { result, location, note } = c.req.valid('json');

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const patch: Record<string, unknown> = {
    last_audit_date: new Date().toISOString().slice(0, 10),
    last_audit_by: actorId,
    audit_status: result,
    updated_by: actorId,
  };
  if (result === 'พบ/ผิดตำแหน่ง' && location) patch.location = location;
  if (result === 'ไม่พบ/สูญหาย') patch.status = 'สูญหาย';

  const { data, error } = await supabase.from('assets').update(patch).eq('id', id).select(ASSET_SELECT).single();
  if (error) return c.json(fail(reqId, 'ASSET_VERIFY_FAILED', error.message), 400);

  await recordMovement(supabase, { assetId: id, actionType: 'Audit', statusLabel: result, notes: note ?? null, createdBy: actorId });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'VERIFY',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    detail: { result },
    requestId: reqId,
  });

  return c.json(ok(reqId, enrichAsset(data as never)));
});

/** ยืม/มอบหมายทรัพย์สินให้พนักงาน → สถานะ "ใช้งานอยู่" */
assetsRoute.post('/:id/assign', requirePermission('asset.transfer'), zValidator('json', assignAssetSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { toEmployeeId, departmentId, location, dueDate, notes } = c.req.valid('json');

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);
  if (ASSET_RETIRED_STATUSES.includes(current.status)) {
    return c.json(fail(reqId, 'ASSET_RETIRED', 'ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว'), 400);
  }

  const { data: toEmployee, error: employeeError } = await supabase.from('employees').select('id, department_id').eq('id', toEmployeeId).maybeSingle();
  if (employeeError || !toEmployee) return c.json(fail(reqId, 'EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานที่เลือก'), 400);

  const { data, error } = await supabase
    .from('assets')
    .update({
      status: 'ใช้งานอยู่',
      owner_employee_id: toEmployeeId,
      department_id: departmentId || toEmployee.department_id,
      location: location || current.location,
      loan_date: new Date().toISOString().slice(0, 10),
      loan_due_date: dueDate || null,
      updated_by: actorId,
    })
    .eq('id', id)
    .select(ASSET_SELECT)
    .single();
  if (error) return c.json(fail(reqId, 'ASSET_ASSIGN_FAILED', error.message), 400);

  await recordMovement(supabase, {
    assetId: id,
    actionType: 'Assign',
    fromEmployeeId: current.owner_employee_id,
    toEmployeeId,
    departmentId: departmentId || null,
    location: location || null,
    statusLabel: 'ยืม/ใช้งาน',
    dueDate: dueDate || null,
    notes: notes ?? null,
    createdBy: actorId,
  });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'ASSIGN',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    detail: { toEmployeeId, dueDate },
    requestId: reqId,
  });

  return c.json(ok(reqId, enrichAsset(data as never)));
});

/** คืนทรัพย์สิน → สถานะ "พร้อมใช้งาน" + ล้างผู้ถือครอง */
assetsRoute.post('/:id/return', requirePermission('asset.transfer'), zValidator('json', returnAssetSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { location, condition, notes } = c.req.valid('json');

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const resolvedLocation = location || 'คลัง IT';
  const { data, error } = await supabase
    .from('assets')
    .update({
      status: 'พร้อมใช้งาน',
      owner_employee_id: null,
      department_id: null,
      location: resolvedLocation,
      loan_date: null,
      loan_due_date: null,
      updated_by: actorId,
    })
    .eq('id', id)
    .select(ASSET_SELECT)
    .single();
  if (error) return c.json(fail(reqId, 'ASSET_RETURN_FAILED', error.message), 400);

  await recordMovement(supabase, {
    assetId: id,
    actionType: 'Return',
    fromEmployeeId: current.owner_employee_id,
    location: resolvedLocation,
    statusLabel: 'คืนแล้ว',
    condition: condition ?? null,
    notes: notes ?? null,
    createdBy: actorId,
  });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'RETURN',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    detail: { condition },
    requestId: reqId,
  });

  return c.json(ok(reqId, enrichAsset(data as never)));
});

/** โอนย้ายทรัพย์สินไปผู้ใช้/แผนก/สถานที่ใหม่ (สถานะคงเป็นใช้งานอยู่) */
assetsRoute.post('/:id/transfer', requirePermission('asset.transfer'), zValidator('json', transferAssetSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { toEmployeeId, departmentId, location, dueDate, notes } = c.req.valid('json');

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);
  if (ASSET_RETIRED_STATUSES.includes(current.status)) {
    return c.json(fail(reqId, 'ASSET_RETIRED', 'ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว'), 400);
  }

  const patch: Record<string, unknown> = { status: 'ใช้งานอยู่', loan_date: new Date().toISOString().slice(0, 10), updated_by: actorId };
  if (toEmployeeId) patch.owner_employee_id = toEmployeeId;
  if (departmentId) patch.department_id = departmentId;
  if (location) patch.location = location;
  if (dueDate !== undefined) patch.loan_due_date = dueDate || null;

  const { data, error } = await supabase.from('assets').update(patch).eq('id', id).select(ASSET_SELECT).single();
  if (error) return c.json(fail(reqId, 'ASSET_TRANSFER_FAILED', error.message), 400);

  await recordMovement(supabase, {
    assetId: id,
    actionType: 'Transfer',
    fromEmployeeId: current.owner_employee_id,
    toEmployeeId: toEmployeeId || current.owner_employee_id,
    departmentId: departmentId || null,
    location: location || null,
    statusLabel: 'โอนย้าย',
    dueDate: dueDate || null,
    notes: notes ?? null,
    createdBy: actorId,
  });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'TRANSFER',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    detail: { toEmployeeId, departmentId, location },
    requestId: reqId,
  });

  return c.json(ok(reqId, enrichAsset(data as never)));
});

/** ส่งทรัพย์สินเข้าซ่อม → สถานะ "ซ่อมบำรุง" */
assetsRoute.post(
  '/:id/send-to-repair',
  requirePermission('asset.transfer'),
  zValidator('json', sendAssetToRepairSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { vendorName, location, notes } = c.req.valid('json');

    const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
    if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);
    if (ASSET_RETIRED_STATUSES.includes(current.status)) {
      return c.json(fail(reqId, 'ASSET_RETIRED', 'ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว'), 400);
    }

    const { data, error } = await supabase
      .from('assets')
      .update({ status: 'ซ่อมบำรุง', loan_date: null, loan_due_date: null, updated_by: actorId })
      .eq('id', id)
      .select(ASSET_SELECT)
      .single();
    if (error) return c.json(fail(reqId, 'ASSET_REPAIR_SEND_FAILED', error.message), 400);

    await recordMovement(supabase, {
      assetId: id,
      actionType: 'ส่งซ่อม',
      fromEmployeeId: current.owner_employee_id,
      vendorName: vendorName ?? null,
      location: location ?? null,
      statusLabel: 'ส่งซ่อม',
      notes: notes ?? null,
      createdBy: actorId,
    });
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'REPAIR_SEND',
      module: 'asset',
      targetTable: 'assets',
      targetId: id,
      detail: { vendorName },
      requestId: reqId,
    });

    return c.json(ok(reqId, enrichAsset(data as never)));
  },
);

/** รับทรัพย์สินคืนจากซ่อม → สถานะ "พร้อมใช้งาน" */
assetsRoute.post(
  '/:id/return-from-repair',
  requirePermission('asset.transfer'),
  zValidator('json', returnAssetFromRepairSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { location, condition, notes } = c.req.valid('json');

    const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
    if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

    const resolvedLocation = location || 'คลัง IT';
    const { data, error } = await supabase
      .from('assets')
      .update({ status: 'พร้อมใช้งาน', location: resolvedLocation, updated_by: actorId })
      .eq('id', id)
      .select(ASSET_SELECT)
      .single();
    if (error) return c.json(fail(reqId, 'ASSET_REPAIR_RETURN_FAILED', error.message), 400);

    await recordMovement(supabase, {
      assetId: id,
      actionType: 'รับคืนจากซ่อม',
      location: resolvedLocation,
      statusLabel: 'ซ่อมเสร็จ',
      condition: condition ?? null,
      notes: notes ?? null,
      createdBy: actorId,
    });
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'REPAIR_RETURN',
      module: 'asset',
      targetTable: 'assets',
      targetId: id,
      requestId: reqId,
    });

    return c.json(ok(reqId, enrichAsset(data as never)));
  },
);
