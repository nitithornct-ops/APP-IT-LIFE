import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono, type Context } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { renderAssetBorrowForm } from '../services/assetBorrowForm';
import { resolveFormModuleTemplate } from '../services/formModuleService';
import { requireAuth } from '../middleware/auth';
import { hasPermission, requireAnyPermission, requirePermission } from '../middleware/permission';
import {
  ASSET_DEFAULT_RETURN_LOCATION,
  buildAssignPatch,
  buildReturnPatch,
  isAssetRetired,
} from '../services/assetOwnership';
import { buildAssetFieldSummary, parseScannedAssetCode } from '../services/assetFieldService';
import {
  ASSET_LIFECYCLE_LABELS,
  allowedAssetLifecycleTransitions,
  canTransitionAssetLifecycle,
  isAssetLifecycleStatus,
  legacyStatusForLifecycle,
} from '../services/assetLifecycle';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { BulkItemError, runBulk } from '../utils/bulk';
import { checkExportSize, exportFileName, listCsv, LIST_EXPORT_MAX_ROWS, type ExportColumn } from '../utils/listExport';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { applySort } from '../utils/sort';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  assetBorrowOverviewQuerySchema,
  ASSET_AUDIT_RESULTS,
  FIELD_SCAN_RESULT_LABELS,
  assignAssetSchema,
  assetLoanCreateSchema,
  bulkUpdateAssetsSchema,
  createAssetModelSchema,
  createAssetSchema,
  listAssetsQuerySchema,
  returnAssetFromRepairSchema,
  returnAssetSchema,
  transitionAssetLifecycleSchema,
  sendAssetToRepairSchema,
  setAssetStatusSchema,
  transferAssetSchema,
  updateAssetPatchSchema,
  updateAssetSchema,
  verifyAssetSchema,
  fieldScanCampaignCreateSchema,
  fieldScanSyncSchema,
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

assetsRoute.get('/:id/borrow-form', requirePermission('asset.view'), async (c) => {
  const reqId = c.get('requestId');
  const supabase = c.get('supabase');
  const assetId = c.req.param('id');
  const [{ data: asset, error }, { data: loan, error: loanError }] = await Promise.all([
    supabase.from('assets')
      .select('asset_code, name, loan_date, loan_due_date, location, owner:employees(first_name_th, last_name_th, employee_code), department:departments(name_th)')
      .eq('id', assetId).maybeSingle(),
    supabase.from('asset_loans')
      .select('purpose, condition_before, companion_equipment, borrower_acknowledged, borrower_acknowledgement_name, returned_at, condition_after, return_outcome, approver:employees!asset_loans_approver_employee_id_fkey(first_name_th, last_name_th, employee_code)')
      .eq('asset_id', assetId).eq('status', 'active').maybeSingle(),
  ]);
  if (error) return dbFailJson(c, 'BORROW_FORM_LOAD_FAILED', error);
  if (loanError) return dbFailJson(c, 'BORROW_FORM_LOAN_LOAD_FAILED', loanError);
  if (!asset) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้ หรือไม่มีสิทธิ์เข้าถึง'), 404);
  const { data: template, error: templateError } = await resolveFormModuleTemplate<{ id: string; name: string; content_html: string; current_version: number }>(
    createAdminClient(c.env),
    'asset_borrow',
    'id, name, content_html, current_version',
    true,
  );
  if (templateError) return dbFailJson(c, 'BORROW_TEMPLATE_LOAD_FAILED', templateError);
  if (!template) return c.json(fail(reqId, 'BORROW_TEMPLATE_NOT_FOUND', 'ยังไม่มีแม่แบบขอยืมทรัพย์สินที่เผยแพร่ใน Form Studio'), 409);
  return c.json(ok(reqId, {
    templateId: template.id, title: template.name, version: template.current_version, assetCode: asset.asset_code,
    contentHtml: renderAssetBorrowForm(template.content_html, {
      ...asset,
      owner: Array.isArray(asset.owner) ? asset.owner[0] ?? null : asset.owner,
      department: Array.isArray(asset.department) ? asset.department[0] ?? null : asset.department,
      loan: loan ? {
        ...loan,
        approver: Array.isArray(loan.approver) ? loan.approver[0] ?? null : loan.approver,
      } : null,
    }),
  }));
});

const ASSET_SELECT =
  'id, asset_code, name, asset_type, category_id, brand, model, serial_number, vendor_name, vendor_id, contract_id, ' +
  'purchase_date, warranty_expire, purchase_order, invoice_number, price, useful_life_years, depreciation_method, depreciation_rate, cost_center, barcode, ' +
  'asset_model_catalog_id, parent_asset_id, physical_verification_status, physical_verified_at, physical_verified_by, disposed_at, disposal_reason, disposal_value, license_no, license_expiry, location, ' +
  'department_id, owner_employee_id, patch_status, patch_date, criticality, status, lifecycle_status, qr_code_url, ' +
  'last_audit_date, audit_status, loan_date, loan_due_date, notes, remark, created_at, updated_at, ' +
  'category:asset_categories(id, name, code_prefix), department:departments(id, name_th), ' +
  'vendor:vendors(id, vendor_code, name, status), contract:contracts(id, contract_number, name, status, end_date), ' +
  'owner:employees(id, employee_code, first_name_th, last_name_th, nickname), ' +
  'model_catalog:asset_model_catalog(id, model_code, name, asset_type, brand, model, default_useful_life_years, default_warranty_months, depreciation_method, default_cost_center, specs, status, notes)';

const FIELD_SCAN_ASSET_SELECT =
  'id, asset_code, name, asset_type, brand, model, serial_number, location, owner_employee_id, ' +
  'owner:employees!assets_owner_employee_id_fkey(id, employee_code, prefix_th, first_name_th, last_name_th), ' +
  'department:departments(id, name_th)';

const FIELD_SCAN_VERIFICATION_SELECT =
  'id, campaign_id, asset_id, client_ref, result, expected_location, actual_location, ' +
  'expected_custodian_employee_id, actual_custodian_employee_id, note, scanned_at, synced_at, created_at, updated_at, ' +
  `asset:assets!asset_verifications_asset_id_fkey(${FIELD_SCAN_ASSET_SELECT}), ` +
  'expected_custodian:employees!asset_verifications_expected_custodian_employee_id_fkey(id, employee_code, prefix_th, first_name_th, last_name_th), ' +
  'actual_custodian:employees!asset_verifications_actual_custodian_employee_id_fkey(id, employee_code, prefix_th, first_name_th, last_name_th)';

const ASSET_LOAN_SELECT =
  'id, asset_id, borrower_employee_id, approver_employee_id, borrowed_at, due_at, purpose, condition_before, companion_equipment, ' +
  'borrower_acknowledged, borrower_acknowledged_at, borrower_acknowledgement_name, reminder_recipient_id, reminder_days_before, status, ' +
  'returned_at, return_receiver_employee_id, condition_after, return_outcome, damage_notes, return_notes, created_by, created_at, updated_at, ' +
  'asset:assets!asset_loans_asset_id_fkey(id, asset_code, name, status, lifecycle_status), ' +
  'borrower:employees!asset_loans_borrower_employee_id_fkey(id, employee_code, first_name_th, last_name_th, nickname), ' +
  'approver:employees!asset_loans_approver_employee_id_fkey(id, employee_code, first_name_th, last_name_th, nickname), ' +
  'return_receiver:employees!asset_loans_return_receiver_employee_id_fkey(id, employee_code, first_name_th, last_name_th, nickname)';

const ASSET_LOAN_ERROR_MESSAGES: Record<string, { message: string; status: 400 | 403 | 404 | 409 }> = {
  ASSET_LOAN_PERMISSION_REQUIRED: { message: 'ท่านไม่มีสิทธิ์บันทึกการยืม/คืน Asset', status: 403 },
  ASSET_LOAN_DATE_RANGE_INVALID: { message: 'วันที่ต้องคืนต้องไม่ก่อนวันที่ยืม', status: 400 },
  ASSET_LOAN_PURPOSE_REQUIRED: { message: 'กรุณาระบุวัตถุประสงค์การยืม', status: 400 },
  ASSET_LOAN_CONDITION_BEFORE_REQUIRED: { message: 'กรุณาระบุสภาพก่อนยืม', status: 400 },
  ASSET_LOAN_COMPANION_EQUIPMENT_INVALID: { message: 'อุปกรณ์ประกอบมีรูปแบบไม่ถูกต้อง', status: 400 },
  ASSET_LOAN_REMINDER_INVALID: { message: 'จำนวนวันเตือนต้องอยู่ระหว่าง 0 ถึง 30 วัน', status: 400 },
  ASSET_LOAN_ACKNOWLEDGEMENT_REQUIRED: { message: 'กรุณายืนยัน acknowledgement ของผู้ยืม', status: 400 },
  ASSET_NOT_FOUND: { message: 'ไม่พบทรัพย์สินนี้', status: 404 },
  ASSET_NOT_AVAILABLE: { message: 'Asset นี้ไม่พร้อมให้ยืม หรือมีผู้ถือครองอยู่แล้ว', status: 409 },
  BORROWER_NOT_FOUND: { message: 'ไม่พบผู้ยืมที่ยังปฏิบัติงานอยู่', status: 400 },
  APPROVER_NOT_FOUND: { message: 'ไม่พบผู้อนุมัติที่ยังปฏิบัติงานอยู่', status: 400 },
  ASSET_LOAN_NOT_FOUND: { message: 'ไม่พบรายการยืม Asset นี้', status: 404 },
  ASSET_LOAN_ALREADY_RETURNED: { message: 'รายการยืมนี้ถูกรับคืนแล้ว', status: 409 },
  ASSET_LOAN_RETURN_DETAILS_REQUIRED: { message: 'กรุณาระบุวันที่คืนและสภาพหลังคืน', status: 400 },
  ASSET_LOAN_RETURN_OUTCOME_INVALID: { message: 'ผลการคืน Asset ไม่ถูกต้อง', status: 400 },
  ASSET_LOAN_DAMAGE_DETAILS_REQUIRED: { message: 'กรุณาระบุรายละเอียดความเสียหายหรือการสูญหาย', status: 400 },
  ASSET_LOAN_RETURN_DATE_INVALID: { message: 'วันที่คืนต้องไม่ก่อนวันที่ยืม', status: 400 },
  RETURN_RECEIVER_NOT_FOUND: { message: 'ไม่พบผู้รับคืนที่ยังปฏิบัติงานอยู่', status: 400 },
};

function assetLoanRpcError(c: Context<AppEnv>, code: string, error: { message?: string; code?: string }, fallbackCode: string) {
  const domainCode = Object.keys(ASSET_LOAN_ERROR_MESSAGES).find((key) => error.message?.includes(key));
  if (domainCode) {
    const detail = ASSET_LOAN_ERROR_MESSAGES[domainCode];
    return c.json(fail(c.get('requestId'), domainCode, detail.message), detail.status);
  }
  return dbFailJson(c, fallbackCode, error);
}

function readLoanId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const loanId = (value as { loan_id?: unknown }).loan_id;
  return typeof loanId === 'string' ? loanId : null;
}

/** จำนวน Ticket สูงสุดที่ดึงมาสรุปประวัติซ่อมของเครื่องหนึ่งเครื่อง */
const ASSET_FIELD_TICKET_LIMIT = 100;

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function computeDepreciation(
  price: number | null,
  purchaseDate: string | null,
  usefulLifeYears: number | null,
  depreciationMethod?: string | null,
  depreciationRate?: number | null,
) {
  const p = Number(price) || 0;
  const life = Number(usefulLifeYears) || 5;
  if (!p || !purchaseDate) return { ageYears: null, bookValue: p || null, depreciationPct: null };
  const pd = new Date(purchaseDate);
  if (Number.isNaN(pd.getTime())) return { ageYears: null, bookValue: p || null, depreciationPct: null };
  const ageYears = Math.max(0, (Date.now() - pd.getTime()) / (365.25 * 86400000));
  const method = depreciationMethod ?? 'straight_line';
  const explicitRate = depreciationRate === null || depreciationRate === undefined ? null : Number(depreciationRate) / 100;
  const rate = explicitRate !== null && Number.isFinite(explicitRate) ? Math.min(1, Math.max(0, explicitRate)) : 1 / life;
  const remain = method === 'none'
    ? 1
    : method === 'declining_balance'
      ? Math.pow(Math.max(0, 1 - rate), ageYears)
      : Math.max(0, 1 - ageYears / life);
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
  const rand = randomCodeSuffix();
  return `${prefix}-${datePart}${rand}`;
}

function enrichAsset<T extends { price: number | null; purchase_date: string | null; useful_life_years: number | null; depreciation_method?: string | null; depreciation_rate?: number | null; warranty_expire: string | null; license_expiry: string | null }>(
  row: T,
) {
  const dep = computeDepreciation(row.price, row.purchase_date, row.useful_life_years, row.depreciation_method, row.depreciation_rate);
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
  vendorId?: string | null;
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
    vendor_id: m.vendorId ?? null,
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

type DuplicateAsset = { id: string; asset_code: string; name: string; serial_number?: string | null; barcode?: string | null };

async function findDuplicateAssetValue(
  supabase: SupabaseClient,
  field: 'serial_number' | 'barcode',
  value: string | undefined,
  excludeId?: string,
): Promise<DuplicateAsset | null> {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  let query = supabase.from('assets').select(`id, asset_code, name, ${field}`).neq('lifecycle_status', 'disposed').limit(100);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) return null;
  return ((data ?? []) as unknown as DuplicateAsset[]).find((row) => String(row[field] ?? '').trim().toLowerCase() === normalized) ?? null;
}

async function ensureAssetConfigurationItem(
  env: AppEnv['Bindings'],
  asset: { id: string; asset_code: string; name: string; asset_type: string; owner_employee_id?: string | null; location?: string | null },
) {
  if (asset.asset_type !== 'Server' && asset.asset_type !== 'Network Device') return null;
  const admin = createAdminClient(env);
  const { data: existing } = await admin.from('configuration_items').select('id, ci_code, name, ci_type, environment, status').eq('asset_id', asset.id).maybeSingle();
  if (existing) return existing;

  const { data, error } = await admin.from('configuration_items').insert({
    ci_code: `CI-${asset.asset_code}`.slice(0, 100),
    name: `${asset.name} (${asset.asset_code})`.slice(0, 150),
    ci_type: asset.asset_type,
    environment: 'Shared',
    owner_employee_id: asset.owner_employee_id ?? null,
    asset_id: asset.id,
    location: asset.location ?? null,
    status: 'Draft',
    notes: 'Auto-created from Asset Register',
  }).select('id, ci_code, name, ci_type, environment, status').single();
  if (error) {
    const { data: raced } = await admin.from('configuration_items').select('id, ci_code, name, ci_type, environment, status').eq('asset_id', asset.id).maybeSingle();
    return raced ?? null;
  }
  return data;
}

async function recordLifecycleEvent(
  supabase: SupabaseClient,
  input: { assetId: string; fromStatus: string | null; toStatus: string; notes?: string | null; relatedTicketId?: string | null; performedBy: string; eventDate?: string },
) {
  await supabase.from('asset_lifecycle_events').insert({
    asset_id: input.assetId,
    from_status: input.fromStatus,
    to_status: input.toStatus,
    notes: input.notes ?? null,
    related_ticket_id: input.relatedTicketId ?? null,
    performed_by: input.performedBy,
    event_date: input.eventDate ?? new Date().toISOString(),
  });
}

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

assetsRoute.get('/models', requirePermission('asset.view'), async (c) => {
  const { data, error } = await c.get('supabase').from('asset_model_catalog')
    .select('id, model_code, name, asset_type, brand, model, default_useful_life_years, default_warranty_months, depreciation_method, default_cost_center, specs, status, notes')
    .eq('status', 'active').order('name', { ascending: true }).limit(2000);
  if (error) return dbFailJson(c, 'ASSET_MODEL_LIST_FAILED', error);
  return c.json(ok(c.get('requestId'), data ?? []));
});

assetsRoute.post('/models', requirePermission('asset.update'), zValidator('json', createAssetModelSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const actorId = c.get('userId');
  const { data, error } = await c.get('supabase').from('asset_model_catalog').insert({
    model_code: body.modelCode,
    name: body.name,
    asset_type: body.assetType,
    brand: body.brand ?? null,
    model: body.model ?? null,
    default_useful_life_years: body.defaultUsefulLifeYears ?? null,
    default_warranty_months: body.defaultWarrantyMonths ?? null,
    depreciation_method: body.depreciationMethod ?? 'straight_line',
    default_cost_center: body.defaultCostCenter ?? null,
    specs: body.specs ?? {},
    notes: body.notes ?? null,
    created_by: actorId,
    updated_by: actorId,
  }).select('id, model_code, name, asset_type, brand, model, default_useful_life_years, default_warranty_months, depreciation_method, default_cost_center, specs, status, notes').single();
  if (error) return dbFailJson(c, 'ASSET_MODEL_CREATE_FAILED', error);
  return c.json(ok(c.get('requestId'), data), 201);
});

assetsRoute.get('/duplicates', requirePermission('asset.view'), async (c) => {
  const serialNumber = c.req.query('serialNumber');
  const barcode = c.req.query('barcode');
  const excludeId = c.req.query('excludeId');
  const [serial, code] = await Promise.all([
    findDuplicateAssetValue(c.get('supabase'), 'serial_number', serialNumber, excludeId),
    findDuplicateAssetValue(c.get('supabase'), 'barcode', barcode, excludeId),
  ]);
  return c.json(ok(c.get('requestId'), { serial, barcode: code }));
});

function fieldRelation(row: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function fieldPersonName(person: Record<string, unknown> | null): string | null {
  if (!person) return null;
  const name = [person.prefix_th, person.first_name_th, person.last_name_th].filter(Boolean).map(String).join(' ').trim();
  return name || null;
}

function fieldAssetPayload(row: Record<string, unknown>) {
  const owner = fieldRelation(row, 'owner');
  const department = fieldRelation(row, 'department');
  return {
    id: String(row.id),
    assetCode: String(row.asset_code ?? ''),
    name: String(row.name ?? ''),
    assetType: row.asset_type ? String(row.asset_type) : null,
    brand: row.brand ? String(row.brand) : null,
    model: row.model ? String(row.model) : null,
    serialNumber: row.serial_number ? String(row.serial_number) : null,
    location: row.location ? String(row.location) : null,
    ownerEmployeeId: row.owner_employee_id ? String(row.owner_employee_id) : null,
    ownerName: fieldPersonName(owner),
    departmentName: department?.name_th ? String(department.name_th) : null,
  };
}

function fieldVerificationPayload(row: Record<string, unknown>) {
  const asset = fieldRelation(row, 'asset');
  const expectedCustodian = fieldRelation(row, 'expected_custodian');
  const actualCustodian = fieldRelation(row, 'actual_custodian');
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    assetId: String(row.asset_id),
    clientRef: String(row.client_ref),
    asset: asset ? fieldAssetPayload(asset) : null,
    result: String(row.result),
    resultLabel: FIELD_SCAN_RESULT_LABELS[row.result as keyof typeof FIELD_SCAN_RESULT_LABELS] ?? String(row.result),
    expectedLocation: row.expected_location ? String(row.expected_location) : null,
    actualLocation: row.actual_location ? String(row.actual_location) : null,
    expectedCustodianEmployeeId: row.expected_custodian_employee_id ? String(row.expected_custodian_employee_id) : null,
    actualCustodianEmployeeId: row.actual_custodian_employee_id ? String(row.actual_custodian_employee_id) : null,
    expectedCustodianName: fieldPersonName(expectedCustodian),
    actualCustodianName: fieldPersonName(actualCustodian),
    note: row.note ? String(row.note) : null,
    scannedAt: String(row.scanned_at),
    syncedAt: String(row.synced_at),
  };
}

/** Lightweight asset lookup used by the batch field scanner; it stays separate from the repair-history lookup. */
assetsRoute.get('/field/resolve', requirePermission('asset.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const code = parseScannedAssetCode(c.req.query('code') ?? '');
  if (!code) return c.json(fail(reqId, 'ASSET_CODE_INVALID', 'อ่านรหัสทรัพย์สินไม่ได้ กรุณาลองใหม่หรือพิมพ์รหัสเอง'), 400);

  const { data: matches, error } = await supabase
    .from('assets')
    .select(FIELD_SCAN_ASSET_SELECT)
    .ilike('asset_code', code)
    .order('asset_code', { ascending: true })
    .limit(5);
  if (error) return dbFailJson(c, 'FIELD_ASSET_RESOLVE_FAILED', error, 'ค้นหาทรัพย์สินไม่สำเร็จ');
  const candidates = (matches ?? []) as unknown as Array<Record<string, unknown>>;
  const asset = candidates.find((row) => String(row.asset_code) === code) ?? (candidates.length === 1 ? candidates[0] : null);
  if (!asset) {
    if (candidates.length > 1) return c.json(fail(reqId, 'ASSET_CODE_AMBIGUOUS', `รหัส ${code} ตรงกับหลายรายการ กรุณาพิมพ์ให้ตรงตัวพิมพ์`), 409);
    return c.json(fail(reqId, 'ASSET_NOT_FOUND', `ไม่พบทรัพย์สินรหัส ${code} ในระบบ`), 404);
  }
  return c.json(ok(reqId, fieldAssetPayload(asset)));
});

/** Campaign ที่เตรียมไว้ก่อนลงพื้นที่ — โหลดได้แม้ยังไม่มีรายการตรวจ */
assetsRoute.get('/field/campaigns', requirePermission('asset.view'), async (c) => {
  const { data, error } = await c.get('supabase')
    .from('asset_verification_campaigns')
    .select('id, campaign_code, name, planned_date, location, status, completed_at, created_at, asset_verifications(count)')
    .order('planned_date', { ascending: false })
    .limit(50);
  if (error) return dbFailJson(c, 'FIELD_CAMPAIGNS_LOAD_FAILED', error, 'ดึง Campaign ตรวจนับไม่สำเร็จ');
  return c.json(ok(c.get('requestId'), (data ?? []).map((row) => {
    const rawCount = (row as unknown as { asset_verifications?: Array<{ count?: number }> }).asset_verifications?.[0]?.count ?? 0;
    const campaign = { ...(row as unknown as Record<string, unknown>) };
    delete campaign.asset_verifications;
    return { ...campaign, verificationCount: Number(rawCount) };
  })));
});

assetsRoute.post('/field/campaigns', requirePermission('asset.update'), zValidator('json', fieldScanCampaignCreateSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const actorId = c.get('userId');
  const reqId = c.get('requestId');
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { data, error } = await c.get('supabase').from('asset_verification_campaigns').insert({
    campaign_code: `FSC-${datePart}-${randomCodeSuffix()}`,
    name: body.name,
    planned_date: body.plannedDate ?? new Date().toISOString().slice(0, 10),
    location: body.location || null,
    status: 'active',
    created_by: actorId,
  }).select('id, campaign_code, name, planned_date, location, status, completed_at, created_at').single();
  if (error) return dbFailJson(c, 'FIELD_CAMPAIGN_CREATE_FAILED', error, 'สร้าง Campaign ตรวจนับไม่สำเร็จ');
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'FIELD_CAMPAIGN_CREATE', module: 'asset', targetTable: 'asset_verification_campaigns', targetId: data.id, detail: { campaignCode: data.campaign_code }, requestId: reqId });
  return c.json(ok(reqId, { ...data, verificationCount: 0 }), 201);
});

assetsRoute.get('/field/campaigns/:id', requirePermission('asset.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  const [{ data: campaign, error: campaignError }, { data: verifications, error: verificationError }] = await Promise.all([
    supabase.from('asset_verification_campaigns').select('id, campaign_code, name, planned_date, location, status, completed_at, created_at').eq('id', id).maybeSingle(),
    supabase.from('asset_verifications').select(FIELD_SCAN_VERIFICATION_SELECT).eq('campaign_id', id).order('updated_at', { ascending: false }).limit(2000),
  ]);
  if (campaignError) return dbFailJson(c, 'FIELD_CAMPAIGN_LOAD_FAILED', campaignError, 'ดึง Campaign ตรวจนับไม่สำเร็จ');
  if (verificationError) return dbFailJson(c, 'FIELD_VERIFICATIONS_LOAD_FAILED', verificationError, 'ดึงผลตรวจนับไม่สำเร็จ');
  if (!campaign) return c.json(fail(reqId, 'FIELD_CAMPAIGN_NOT_FOUND', 'ไม่พบ Campaign ตรวจนับนี้'), 404);
  return c.json(ok(reqId, { ...campaign, verificationCount: verifications?.length ?? 0, verifications: (verifications ?? []).map((row) => fieldVerificationPayload(row as unknown as Record<string, unknown>)) }));
});

/** รับผลตรวจจากออนไลน์หรือคิวออฟไลน์ — upsert ด้วย campaign + asset เพื่อ retry ได้โดยไม่สร้างแถวซ้ำ */
assetsRoute.post('/field/campaigns/:id/sync', requirePermission('asset.update'), zValidator('json', fieldScanSyncSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const campaignId = c.req.param('id');
  const { items } = c.req.valid('json');

  const { data: campaign, error: campaignError } = await supabase.from('asset_verification_campaigns').select('id, status').eq('id', campaignId).maybeSingle();
  if (campaignError) return dbFailJson(c, 'FIELD_CAMPAIGN_LOAD_FAILED', campaignError, 'ดึง Campaign ตรวจนับไม่สำเร็จ');
  if (!campaign) return c.json(fail(reqId, 'FIELD_CAMPAIGN_NOT_FOUND', 'ไม่พบ Campaign ตรวจนับนี้'), 404);
  if (campaign.status === 'completed') return c.json(fail(reqId, 'FIELD_CAMPAIGN_COMPLETED', 'Campaign นี้ปิดแล้ว ไม่สามารถซิงก์เพิ่มได้'), 409);

  const parsedItems = items.map((item) => ({ ...item, code: parseScannedAssetCode(item.assetCode) }));
  const invalidItem = parsedItems.find((item) => !item.code);
  if (invalidItem) return c.json(fail(reqId, 'FIELD_ASSET_CODE_INVALID', `รหัส ${invalidItem.assetCode} ไม่ถูกต้อง`), 400);
  const codes = [...new Set(parsedItems.map((item) => item.code!))];
  const { data: assets, error: assetsError } = await supabase
    .from('assets')
    .select(FIELD_SCAN_ASSET_SELECT)
    .or(codes.map((code) => `asset_code.ilike.${code}`).join(','))
    .limit(Math.max(2000, codes.length));
  if (assetsError) return dbFailJson(c, 'FIELD_ASSETS_RESOLVE_FAILED', assetsError, 'ยืนยันรายการทรัพย์สินไม่สำเร็จ');

  const assetByCode = new Map<string, Record<string, unknown>>();
  for (const row of (assets ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = String(row.asset_code).toLocaleLowerCase('en-US');
    if (assetByCode.has(key)) return c.json(fail(reqId, 'ASSET_CODE_AMBIGUOUS', `รหัส ${row.asset_code} ซ้ำต่างตัวพิมพ์เล็ก-ใหญ่ กรุณาแก้ทะเบียนก่อนตรวจนับ`), 409);
    assetByCode.set(key, row);
  }
  const missing = parsedItems.find((item) => !assetByCode.has(item.code!.toLocaleLowerCase('en-US')));
  if (missing) return c.json(fail(reqId, 'ASSET_NOT_FOUND', `ไม่พบทรัพย์สินรหัส ${missing.code} ในระบบ`), 404);

  const byAssetId = new Map<string, Record<string, unknown>>();
  for (const item of parsedItems) {
    const asset = assetByCode.get(item.code!.toLocaleLowerCase('en-US'))!;
    const assetPayload = fieldAssetPayload(asset);
    byAssetId.set(String(asset.id), {
      campaign_id: campaignId,
      asset_id: asset.id,
      client_ref: item.clientRef,
      result: item.result,
      expected_location: item.expectedLocation ?? assetPayload.location,
      actual_location: item.actualLocation ?? (item.result === 'found' ? assetPayload.location : null),
      expected_custodian_employee_id: item.expectedCustodianEmployeeId ?? assetPayload.ownerEmployeeId,
      actual_custodian_employee_id: item.actualCustodianEmployeeId ?? (item.result === 'found' ? assetPayload.ownerEmployeeId : null),
      note: item.note || null,
      scanned_at: item.scannedAt ?? new Date().toISOString(),
      synced_at: new Date().toISOString(),
      created_by: actorId,
    });
  }
  const rows = [...byAssetId.values()];
  const { data: saved, error: saveError } = await supabase
    .from('asset_verifications')
    .upsert(rows, { onConflict: 'campaign_id,asset_id' })
    .select(FIELD_SCAN_VERIFICATION_SELECT);
  if (saveError) return dbFailJson(c, 'FIELD_VERIFICATIONS_SAVE_FAILED', saveError, 'บันทึกผลตรวจนับไม่สำเร็จ');

  const savedByAssetId = new Map((saved ?? []).map((row) => [String((row as unknown as Record<string, unknown>).asset_id), row as unknown as Record<string, unknown>]));
  const auditAt = new Date().toISOString();
  const assetUpdateResults = await Promise.all(rows.map((row) => supabase.from('assets').update({
    last_audit_date: auditAt.slice(0, 10),
    last_audit_by: actorId,
    audit_status: FIELD_SCAN_RESULT_LABELS[row.result as keyof typeof FIELD_SCAN_RESULT_LABELS],
    physical_verification_status: row.result === 'found' ? 'verified' : 'exception',
    physical_verified_at: auditAt,
    physical_verified_by: actorId,
    updated_by: actorId,
  }).eq('id', row.asset_id)));
  const assetUpdateError = assetUpdateResults.find((result) => result.error)?.error;
  if (assetUpdateError) return dbFailJson(c, 'FIELD_ASSET_AUDIT_UPDATE_FAILED', assetUpdateError, 'อัปเดตสถานะตรวจนับของ Asset ไม่สำเร็จ');

  await supabase.from('asset_movements').insert(rows.map((row) => ({
    asset_id: row.asset_id,
    action_type: 'Audit',
    location: row.actual_location ?? row.expected_location ?? null,
    status_label: FIELD_SCAN_RESULT_LABELS[row.result as keyof typeof FIELD_SCAN_RESULT_LABELS],
    notes: row.note,
    created_by: actorId,
  })));
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'FIELD_VERIFICATION_SYNC', module: 'asset', targetTable: 'asset_verification_campaigns', targetId: campaignId, detail: { count: rows.length }, requestId: reqId });

  return c.json(ok(reqId, {
    savedCount: rows.length,
    verifications: [...savedByAssetId.values()].map((row) => fieldVerificationPayload(row)),
  }));
});

assetsRoute.post('/field/campaigns/:id/complete', requirePermission('asset.update'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id');
  const { data, error } = await supabase.from('asset_verification_campaigns').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id).neq('status', 'completed').select('id, campaign_code, name, planned_date, location, status, completed_at, created_at').maybeSingle();
  if (error) return dbFailJson(c, 'FIELD_CAMPAIGN_COMPLETE_FAILED', error, 'ปิด Campaign ตรวจนับไม่สำเร็จ');
  if (!data) return c.json(fail(reqId, 'FIELD_CAMPAIGN_NOT_FOUND_OR_COMPLETED', 'ไม่พบ Campaign หรือ Campaign นี้ปิดไปแล้ว'), 409);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'FIELD_CAMPAIGN_COMPLETE', module: 'asset', targetTable: 'asset_verification_campaigns', targetId: id, requestId: reqId });
  return c.json(ok(reqId, data));
});

/**
 * ค้นเครื่องจากรหัสที่สแกนได้หน้างาน (mockup 3j จอ 1) — ต้องอยู่ก่อน '/:id'
 *
 * รับข้อความดิบจากกล้องได้เลย เพราะ QR ของระบบเก็บเป็น "{asset_code} | {name}" ไม่ใช่รหัสเปล่า
 * การแยกรหัสทำใน parseScannedAssetCode เพื่อให้ทดสอบได้โดยไม่ต้องมีกล้อง
 *
 * ประวัติซ่อมอ่านด้วย client ของผู้ใช้เสมอ ผู้ที่ไม่มี ticket.view_all จะเห็นเฉพาะใบที่ตนเกี่ยวข้อง
 * และ historyScope จะบอกหน้าจอตรง ๆ ว่าประวัติที่เห็นไม่ครบ แทนการทำให้ดูเหมือนเครื่องนี้ไม่เคยซ่อม
 */
assetsRoute.get('/lookup', requirePermission('asset.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const raw = c.req.query('code') ?? '';

  const code = parseScannedAssetCode(raw);
  if (!code) {
    return c.json(fail(reqId, 'ASSET_CODE_INVALID', 'อ่านรหัสทรัพย์สินจากรายการที่สแกนไม่ได้ กรุณาลองใหม่หรือพิมพ์รหัสเอง'), 400);
  }

  /*
   * ค้นแบบไม่แยกตัวพิมพ์ เพราะช่างที่พิมพ์รหัสเองมักพิมพ์ตัวเล็ก แต่ assets_asset_code_unique เป็น
   * unique แบบแยกตัวพิมพ์ ทะเบียนจึงมีทั้ง "AS-NB-001" และ "as-nb-001" พร้อมกันได้ตามกติกาของ schema
   * จึงห้ามใช้ maybeSingle() ตรง ๆ (จะ error เป็น 500 ทันทีที่เจอสองแถว) และห้ามหยิบแถวแรกมั่ว ๆ
   * เพราะการเปิดใบงานผิดเครื่องแก้ยากกว่าการให้ช่างพิมพ์รหัสใหม่ให้ตรงตัวพิมพ์
   */
  const { data: matches, error } = await supabase
    .from('assets')
    .select(ASSET_SELECT)
    .ilike('asset_code', code)
    .order('asset_code', { ascending: true })
    .limit(5);
  if (error) return dbFailJson(c, 'ASSET_LOOKUP_FAILED', error, 'ค้นหาทรัพย์สินไม่สำเร็จ');

  const candidates = (matches ?? []) as unknown as Array<Record<string, unknown>>;
  const asset = candidates.find((row) => String(row.asset_code) === code) ?? (candidates.length === 1 ? candidates[0] : null);
  if (!asset) {
    if (candidates.length > 1) {
      return c.json(
        fail(reqId, 'ASSET_CODE_AMBIGUOUS', `รหัส ${code} ตรงกับทรัพย์สินมากกว่าหนึ่งรายการที่ต่างกันเฉพาะตัวพิมพ์เล็ก-ใหญ่ กรุณาพิมพ์รหัสให้ตรงตัวพิมพ์`),
        409,
      );
    }
    return c.json(fail(reqId, 'ASSET_NOT_FOUND', `ไม่พบทรัพย์สินรหัส ${code} ในระบบ`), 404);
  }

  const assetRow = asset;
  const canSeeAllTickets = await hasPermission(c, 'ticket.view_all');
  const ticketResult = await supabase
    .from('tickets')
    .select(
      'id, ticket_no, title, status, priority, created_at, resolved_at, closed_at, due_at, assignee_name_snapshot, ' +
      'assignee:profiles!tickets_assignee_id_fkey(full_name)',
      { count: 'exact' },
    )
    .eq('asset_id', assetRow.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(ASSET_FIELD_TICKET_LIMIT);
  if (ticketResult.error) return dbFailJson(c, 'ASSET_TICKET_HISTORY_FAILED', ticketResult.error, 'ดึงประวัติงานซ่อมไม่สำเร็จ');

  return c.json(ok(reqId, buildAssetFieldSummary({
    asset: assetRow,
    tickets: (ticketResult.data ?? []) as unknown as Array<Record<string, unknown>>,
    historyScope: canSeeAllTickets ? 'organization' : 'personal',
    ticketTotal: ticketResult.count ?? undefined,
  })));
});

/** ภาพรวมยืม/คืนสำหรับหน้าปฏิบัติงานรวม — ต้องอยู่ก่อน '/:id' */
assetsRoute.get(
  '/borrow-overview',
  requirePermission('asset.view'),
  zValidator('query', assetBorrowOverviewQuerySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const { page, pageSize, view, search, departmentId } = c.req.valid('query');
    const today = new Date().toISOString().slice(0, 10);
    const dueSoonDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const [availableResult, activeResult, dueSoonResult, overdueResult] = await Promise.all([
      supabase.from('assets').select('id', { count: 'exact', head: true }).eq('status', 'พร้อมใช้งาน'),
      supabase.from('assets').select('id', { count: 'exact', head: true }).eq('status', 'ใช้งานอยู่'),
      supabase
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'ใช้งานอยู่')
        .gte('loan_due_date', today)
        .lte('loan_due_date', dueSoonDate),
      supabase
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'ใช้งานอยู่')
        .lt('loan_due_date', today),
    ]);
    const summaryError = availableResult.error || activeResult.error || dueSoonResult.error || overdueResult.error;
    if (summaryError) return c.json(fail(reqId, 'ASSET_BORROW_SUMMARY_FAILED', 'ดึงสรุปการยืม/คืนไม่สำเร็จ'), 400);

    const summary = {
      available: availableResult.count ?? 0,
      active: activeResult.count ?? 0,
      dueSoon: dueSoonResult.count ?? 0,
      overdue: overdueResult.count ?? 0,
    };

    if (view === 'history') {
      let matchingAssetIds: string[] | null = null;
      const safeSearch = search ? cleanSearch(search) : '';
      if (safeSearch) {
        const { data: matchedAssets, error: matchedAssetsError } = await supabase
          .from('assets')
          .select('id')
          .or(`name.ilike.%${safeSearch}%,asset_code.ilike.%${safeSearch}%`)
          .limit(2000);
        if (matchedAssetsError) return c.json(fail(reqId, 'ASSET_BORROW_HISTORY_FAILED', 'ค้นหาประวัติการยืม/คืนไม่สำเร็จ'), 400);
        matchingAssetIds = (matchedAssets ?? []).map((asset) => asset.id);
        if (matchingAssetIds.length === 0) {
          return c.json(ok(reqId, { summary, records: toPaginatedData([], 0, page, pageSize) }));
        }
      }

      let historyQuery = supabase
        .from('asset_movements')
        .select(
          'id, action_type, asset:assets!asset_movements_asset_id_fkey(id, asset_code, name), ' +
            'from_employee:employees!asset_movements_from_employee_id_fkey(first_name_th, last_name_th), ' +
            'to_employee:employees!asset_movements_to_employee_id_fkey(first_name_th, last_name_th), ' +
            'department:departments(name_th), location, status_label, notes, due_date, condition, action_date',
          { count: 'exact' },
        )
        .in('action_type', ['Assign', 'Return', 'Transfer'])
        .order('action_date', { ascending: false })
        .range(...paginationRange(page, pageSize));
      if (departmentId) historyQuery = historyQuery.eq('department_id', departmentId);
      if (matchingAssetIds) historyQuery = historyQuery.in('asset_id', matchingAssetIds);

      const { data, count, error } = await historyQuery;
      if (error) return c.json(fail(reqId, 'ASSET_BORROW_HISTORY_FAILED', 'ดึงประวัติการยืม/คืนไม่สำเร็จ'), 400);
      return c.json(ok(reqId, { summary, records: toPaginatedData(data ?? [], count, page, pageSize) }));
    }

    let activeQuery = supabase
      .from('assets')
      .select(
        'id, asset_code, name, status, location, loan_date, loan_due_date, ' +
          'owner:employees(id, employee_code, first_name_th, last_name_th, nickname), department:departments(id, name_th), ' +
          'loan:asset_loans!asset_loans_asset_id_fkey(id, status, borrowed_at, due_at, purpose, condition_before, companion_equipment, borrower_acknowledged, borrower_acknowledged_at, borrower_acknowledgement_name, approver_employee_id, return_outcome)',
        { count: 'exact' },
      )
      .eq('status', 'ใช้งานอยู่')
      // "ล่าสุดไปเก่าสุด" ของรายการยืมคือวันที่ยืม ไม่ใช่วันที่สร้างทะเบียนทรัพย์สิน
      .order('loan_date', { ascending: false, nullsFirst: false })
      .range(...paginationRange(page, pageSize));
    if (departmentId) activeQuery = activeQuery.eq('department_id', departmentId);
    const safeActiveSearch = search ? cleanSearch(search) : '';
    if (safeActiveSearch) activeQuery = activeQuery.or(`name.ilike.%${safeActiveSearch}%,asset_code.ilike.%${safeActiveSearch}%`);

    const { data, count, error } = await activeQuery;
    if (error) return c.json(fail(reqId, 'ASSET_BORROW_LIST_FAILED', 'ดึงรายการกำลังยืม/ถือครองไม่สำเร็จ'), 400);
    const normalized = (data ?? []).map((row) => {
      const candidate = row as unknown as { loan?: Array<{ status?: string }> | { status?: string } | null };
      const loans = Array.isArray(candidate.loan) ? candidate.loan : candidate.loan ? [candidate.loan] : [];
      return { ...(row as unknown as Record<string, unknown>), loan: loans.find((loan) => loan.status === 'active') ?? null };
    });
    return c.json(ok(reqId, { summary, records: toPaginatedData(normalized, count, page, pageSize) }));
  },
);

assetsRoute.get('/loans/:id', requirePermission('asset.view'), async (c) => {
  const supabase = c.get('supabase');
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const [{ data: loan, error }, { data: attachments, error: attachmentError }] = await Promise.all([
    supabase.from('asset_loans').select(ASSET_LOAN_SELECT).eq('id', id).maybeSingle(),
    admin.from('file_attachments')
      .select('id, original_filename, mime_type, size_bytes, asset_loan_stage, created_at')
      .eq('module', 'asset_loan').eq('target_table', 'asset_loans').eq('target_id', id)
      .order('created_at', { ascending: true }).limit(100),
  ]);
  if (error) return dbFailJson(c, 'ASSET_LOAN_LOAD_FAILED', error);
  if (attachmentError) return dbFailJson(c, 'ASSET_LOAN_ATTACHMENTS_LOAD_FAILED', attachmentError);
  if (!loan) return c.json(fail(reqId, 'ASSET_LOAN_NOT_FOUND', 'ไม่พบรายการยืม Asset นี้'), 404);
  return c.json(ok(reqId, { ...(loan as unknown as Record<string, unknown>), attachments: attachments ?? [] }));
});

assetsRoute.post('/loans', requirePermission('asset.transfer'), zValidator('json', assetLoanCreateSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const body = c.req.valid('json');
  const { data, error } = await supabase.rpc('create_asset_loan', {
    p_asset_id: body.assetId,
    p_borrower_employee_id: body.borrowerEmployeeId,
    p_approver_employee_id: body.approverEmployeeId,
    p_borrowed_at: body.borrowedAt,
    p_due_at: body.dueAt,
    p_purpose: body.purpose,
    p_condition_before: body.conditionBefore,
    p_companion_equipment: body.companionEquipment,
    p_reminder_days_before: body.reminderDaysBefore,
    p_borrower_acknowledged: body.borrowerAcknowledged,
    p_borrower_acknowledgement_name: body.borrowerAcknowledgementName,
    p_department_id: body.departmentId ?? null,
    p_location: body.location ?? null,
  });
  if (error) return assetLoanRpcError(c, 'ASSET_LOAN_CREATE_FAILED', error, 'ASSET_LOAN_CREATE_FAILED');
  const loanId = readLoanId(data);
  if (!loanId) return c.json(fail(reqId, 'ASSET_LOAN_CREATE_FAILED', 'ระบบไม่คืนรหัสรายการยืม กรุณาลองใหม่'), 500);
  const { data: loan, error: loadError } = await supabase.from('asset_loans').select(ASSET_LOAN_SELECT).eq('id', loanId).single();
  if (loadError) return dbFailJson(c, 'ASSET_LOAN_LOAD_FAILED', loadError);
  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'CREATE_ASSET_LOAN', module: 'asset',
    targetTable: 'asset_loans', targetId: loanId,
    detail: { assetId: body.assetId, borrowerEmployeeId: body.borrowerEmployeeId, dueAt: body.dueAt }, requestId: reqId,
  });
  return c.json(ok(reqId, { loanId, loan }), 201);
});

/** ไม่รวม status/criticality เพราะเก็บเป็นข้อความไทย เรียงแล้วได้ลำดับตัวอักษร ไม่ใช่ลำดับที่สื่อความหมาย */
const ASSET_SORT_COLUMNS = ['asset_code', 'name', 'location', 'purchase_date', 'warranty_expire', 'created_at'] as const;

/** ส่วนของ query builder ที่ตัวกรองทะเบียนทรัพย์สินต้องใช้ */
interface AssetFilterableQuery {
  eq(column: string, value: unknown): AssetFilterableQuery;
  or(filters: string): AssetFilterableQuery;
}

interface AssetListFilters {
  status?: string;
  categoryId?: string;
  search?: string;
}

/**
 * ตัวกรองของทะเบียนทรัพย์สิน — ใช้ร่วมกันระหว่างการแสดงผลกับการส่งออก
 * ต้องเป็นตัวเดียวกันเท่านั้น ไม่งั้นไฟล์ที่ส่งออกจะมีของไม่ตรงกับที่ผู้ใช้เห็นบนหน้าจอ
 */
function applyAssetListFilters<T>(query: T, { status, categoryId, search }: AssetListFilters): T {
  // มอง builder เป็นโครงแคบ ๆ เพราะ generic เต็มของ supabase-js ซ้อนลึกจน TypeScript ยอมแพ้
  let next = query as unknown as AssetFilterableQuery;
  if (status) next = next.eq('status', status);
  if (categoryId) next = next.eq('category_id', categoryId);
  const safeSearch = search ? cleanSearch(search) : '';
  if (safeSearch) {
    next = next.or(`name.ilike.%${safeSearch}%,asset_code.ilike.%${safeSearch}%,serial_number.ilike.%${safeSearch}%`);
  }
  return next as unknown as T;
}

assetsRoute.get('/', requirePermission('asset.view'), zValidator('query', listAssetsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, sort, order, search, status, categoryId } = c.req.valid('query');

  let query = supabase
    .from('assets')
    .select(ASSET_SELECT, { count: 'exact' })
    .range(...paginationRange(page, pageSize));
  query = applySort(query, { sort, order }, ASSET_SORT_COLUMNS, { column: 'created_at', ascending: false });

  query = applyAssetListFilters(query, { status, categoryId, search });

  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'ASSETS_LIST_FAILED', 'ดึงทะเบียนทรัพย์สินไม่สำเร็จ'), 400);
  const items = (data ?? []).map((row) => enrichAsset(row as never));
  return c.json(ok(reqId, toPaginatedData(items, count, page, pageSize)));
});

assetsRoute.post('/:id/lifecycle', requirePermission('asset.update'), zValidator('json', transitionAssetLifecycleSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { toStatus: rawToStatus, notes, relatedTicketId, eventDate } = c.req.valid('json');
  if (!isAssetLifecycleStatus(rawToStatus)) return c.json(fail(reqId, 'ASSET_LIFECYCLE_INVALID', 'ขั้นตอน Lifecycle ไม่ถูกต้อง'), 400);
  const toStatus = rawToStatus as import('../services/assetLifecycle').AssetLifecycleStatus;
  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return dbFailJson(c, 'ASSET_LIFECYCLE_LOAD_FAILED', currentError);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const fromStatus = isAssetLifecycleStatus(current.lifecycle_status) ? current.lifecycle_status : 'ready';
  if (toStatus === 'disposed' && !(await hasPermission(c, 'asset.dispose'))) {
    return c.json(fail(reqId, 'PERMISSION_DENIED', 'ต้องมีสิทธิ์จำหน่ายทรัพย์สิน'), 403);
  }
  if (fromStatus === toStatus) {
    return c.json(fail(reqId, 'ASSET_LIFECYCLE_NOOP', 'ทรัพย์สินอยู่ในขั้นตอนนี้อยู่แล้ว'), 409);
  }
  if (!canTransitionAssetLifecycle(fromStatus, toStatus)) {
    const allowed = allowedAssetLifecycleTransitions(fromStatus).map((status) => ASSET_LIFECYCLE_LABELS[status]).join(', ') || 'ไม่มี';
    return c.json(fail(reqId, 'ASSET_LIFECYCLE_INVALID', `ไม่สามารถเปลี่ยนจาก ${ASSET_LIFECYCLE_LABELS[fromStatus]} ไป ${ASSET_LIFECYCLE_LABELS[toStatus]} ได้ (ถัดไป: ${allowed})`), 409);
  }

  const patch: Record<string, unknown> = { lifecycle_status: toStatus, updated_by: actorId };
  const legacyStatus = legacyStatusForLifecycle(toStatus);
  if (legacyStatus) patch.status = legacyStatus;
  if (toStatus === 'disposed') patch.disposed_at = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from('assets').update(patch).eq('id', id).select(ASSET_SELECT).single();
  if (error) return dbFailJson(c, 'ASSET_LIFECYCLE_UPDATE_FAILED', error);

  await recordLifecycleEvent(supabase, { assetId: id, fromStatus, toStatus, notes, relatedTicketId, performedBy: actorId, eventDate });
  await recordMovement(supabase, { assetId: id, actionType: 'Status', statusLabel: ASSET_LIFECYCLE_LABELS[toStatus], notes: notes ?? null, createdBy: actorId });
  const updatedRow = data as unknown as Record<string, unknown>;
  const configurationItem = await ensureAssetConfigurationItem(c.env, {
    id,
    asset_code: String(updatedRow.asset_code ?? current.asset_code),
    name: String(updatedRow.name ?? current.name),
    asset_type: String(updatedRow.asset_type ?? current.asset_type),
    owner_employee_id: (updatedRow.owner_employee_id as string | null | undefined) ?? current.owner_employee_id ?? null,
    location: (updatedRow.location as string | null | undefined) ?? current.location ?? null,
  });
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'LIFECYCLE_TRANSITION',
    module: 'asset',
    targetTable: 'assets',
    targetId: id,
    detail: { fromStatus, toStatus, relatedTicketId },
    requestId: reqId,
  });
  const enriched = enrichAsset(data as never) as unknown as Record<string, unknown>;
  return c.json(ok(reqId, { ...enriched, configurationItem }));
});

assetsRoute.get('/:id', requirePermission('asset.view'), async (c) => {
  const supabase = c.get('supabase');
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data: asset, error } = await supabase.from('assets').select(ASSET_SELECT).eq('id', id).maybeSingle();
  if (error) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!asset) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  const [{ data: movements }, { data: pm }, { data: licenses }, { data: lifecycleEvents }, { data: children }, { data: configurationItem }, { data: attachments }] = await Promise.all([
    supabase
      .from('asset_movements')
      .select(
        'id, action_type, from_employee:employees!asset_movements_from_employee_id_fkey(first_name_th, last_name_th), ' +
          'to_employee:employees!asset_movements_to_employee_id_fkey(first_name_th, last_name_th), vendor_name, vendor_id, vendor:vendors(id, vendor_code, name, status), ' +
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
    supabase.from('asset_lifecycle_events').select('id, from_status, to_status, event_date, notes, related_ticket_id, performed_by').eq('asset_id', id).order('event_date', { ascending: false }).limit(100),
    supabase.from('assets').select('id, asset_code, name, status').eq('parent_asset_id', id).order('asset_code', { ascending: true }).limit(100),
    admin.from('configuration_items').select('id, ci_code, name, ci_type, environment, status').eq('asset_id', id).maybeSingle(),
    admin.from('file_attachments').select('id, original_filename, mime_type, size_bytes, created_at').eq('module', 'asset').eq('target_table', 'assets').eq('target_id', id).order('created_at', { ascending: false }).limit(100),
  ]);

  return c.json(ok(reqId, { asset: enrichAsset(asset as never), movements: movements ?? [], maintenance: pm ?? [], licenses: licenses ?? [], lifecycleEvents: lifecycleEvents ?? [], children: children ?? [], configurationItem: configurationItem ?? null, attachments: attachments ?? [] }));
});

assetsRoute.post('/', requirePermission('asset.create'), zValidator('json', createAssetSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const duplicateSerial = await findDuplicateAssetValue(supabase, 'serial_number', body.serialNumber);
  if (duplicateSerial) {
    return c.json(fail(reqId, 'DUPLICATE_SERIAL', `Serial ซ้ำกับ ${duplicateSerial.asset_code} — ${duplicateSerial.name}`), 409);
  }
  const duplicateBarcode = await findDuplicateAssetValue(supabase, 'barcode', body.barcode);
  if (duplicateBarcode) {
    return c.json(fail(reqId, 'DUPLICATE_BARCODE', `Barcode ซ้ำกับ ${duplicateBarcode.asset_code} — ${duplicateBarcode.name}`), 409);
  }
  if (body.parentAssetId) {
    const { data: parent, error: parentError } = await supabase.from('assets').select('id, lifecycle_status').eq('id', body.parentAssetId).maybeSingle();
    if (parentError) return dbFailJson(c, 'PARENT_ASSET_LOOKUP_FAILED', parentError);
    if (!parent) return c.json(fail(reqId, 'PARENT_ASSET_NOT_FOUND', 'ไม่พบ Parent Asset ที่เลือก'), 400);
  }

  type AssetModelDefaults = {
    asset_type: string;
    brand: string | null;
    model: string | null;
    default_useful_life_years: number | null;
    depreciation_method: 'straight_line' | 'declining_balance' | 'none';
    default_cost_center: string | null;
  };
  let modelDefaults: AssetModelDefaults | null = null;
  if (body.assetModelCatalogId) {
    const { data: catalog, error: catalogError } = await supabase
      .from('asset_model_catalog')
      .select('asset_type, brand, model, default_useful_life_years, depreciation_method, default_cost_center, status')
      .eq('id', body.assetModelCatalogId)
      .maybeSingle();
    if (catalogError) return dbFailJson(c, 'ASSET_MODEL_LOOKUP_FAILED', catalogError);
    if (!catalog || catalog.status !== 'active') return c.json(fail(reqId, 'ASSET_MODEL_NOT_FOUND', 'ไม่พบ Asset Model Catalog ที่ใช้งานอยู่'), 400);
    modelDefaults = catalog as AssetModelDefaults;
  }

  const resolvedAssetType = body.assetType ?? modelDefaults?.asset_type ?? 'อื่นๆ';
  const initialLifecycle = body.lifecycleStatus ?? 'ordered';
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
      asset_type: resolvedAssetType,
      category_id: body.categoryId ?? null,
      brand: body.brand ?? modelDefaults?.brand ?? null,
      model: body.model ?? modelDefaults?.model ?? null,
      serial_number: body.serialNumber ?? null,
      vendor_name: body.vendorName ?? null,
      vendor_id: body.vendorId || null,
      contract_id: body.contractId || null,
      lifecycle_status: initialLifecycle,
      purchase_order: body.purchaseOrder ?? null,
      invoice_number: body.invoiceNumber ?? null,
      purchase_date: body.purchaseDate || null,
      warranty_expire: body.warrantyExpire || null,
      price: body.price ?? null,
      useful_life_years: body.usefulLifeYears ?? modelDefaults?.default_useful_life_years ?? null,
      depreciation_method: body.depreciationMethod ?? modelDefaults?.depreciation_method ?? 'straight_line',
      depreciation_rate: body.depreciationRate ?? null,
      cost_center: body.costCenter ?? modelDefaults?.default_cost_center ?? null,
      barcode: body.barcode ?? null,
      asset_model_catalog_id: body.assetModelCatalogId || null,
      parent_asset_id: body.parentAssetId || null,
      license_no: body.licenseNo ?? null,
      license_expiry: body.licenseExpiry || null,
      location: body.location ?? null,
      department_id: body.departmentId ?? null,
      owner_employee_id: body.ownerEmployeeId ?? null,
      patch_status: body.patchStatus ?? null,
      patch_date: body.patchDate || null,
      criticality: body.criticality ?? null,
      status: body.status ?? legacyStatusForLifecycle(initialLifecycle) ?? 'พร้อมใช้งาน',
      qr_code_url: buildAssetQrUrl(assetCode, body.name),
      notes: body.notes ?? null,
      remark: body.remark ?? null,
      created_by: actorId,
    })
    .select(ASSET_SELECT)
    .single();

  if (error) return dbFailJson(c, 'ASSET_CREATE_FAILED', error);
  const createdId = (data as unknown as { id: string }).id;

  await recordMovement(supabase, {
    assetId: createdId,
    actionType: 'Create',
    statusLabel: 'บันทึก',
    notes: 'ลงทะเบียนทรัพย์สิน',
    createdBy: actorId,
  });
  await recordLifecycleEvent(supabase, { assetId: createdId, fromStatus: null, toStatus: initialLifecycle, performedBy: actorId });
  const configurationItem = await ensureAssetConfigurationItem(c.env, {
    id: createdId,
    asset_code: assetCode,
    name: body.name,
    asset_type: resolvedAssetType,
    owner_employee_id: body.ownerEmployeeId ?? null,
    location: body.location ?? null,
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

  const enriched = enrichAsset(data as never) as unknown as Record<string, unknown>;
  return c.json(ok(reqId, { ...enriched, configurationItem }), 201);
});

/** แถวดิบของทรัพย์สินเท่าที่การส่งออกต้องใช้ */
interface AssetExportRow {
  asset_code: string | null;
  name: string | null;
  asset_type: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  status: string | null;
  criticality: string | null;
  purchase_date: string | null;
  warranty_expire: string | null;
  price: number | null;
  category: { name: string | null } | null;
  department: { name_th: string | null } | null;
  owner: { first_name_th: string | null; last_name_th: string | null } | null;
}

const ASSET_EXPORT_COLUMNS: ExportColumn<AssetExportRow>[] = [
  { label: 'รหัสทรัพย์สิน', value: (row) => row.asset_code },
  { label: 'ชื่อทรัพย์สิน', value: (row) => row.name },
  { label: 'ประเภท', value: (row) => row.asset_type },
  { label: 'หมวดหมู่', value: (row) => row.category?.name ?? '' },
  { label: 'ยี่ห้อ', value: (row) => row.brand },
  { label: 'รุ่น', value: (row) => row.model },
  { label: 'Serial Number', value: (row) => row.serial_number },
  { label: 'ผู้ถือครอง', value: (row) => (row.owner ? `${row.owner.first_name_th ?? ''} ${row.owner.last_name_th ?? ''}`.trim() : '') },
  { label: 'แผนก', value: (row) => row.department?.name_th ?? '' },
  { label: 'สถานที่', value: (row) => row.location },
  { label: 'สถานะ', value: (row) => row.status },
  { label: 'ความสำคัญ', value: (row) => row.criticality },
  { label: 'วันที่ซื้อ', value: (row) => row.purchase_date },
  { label: 'หมดประกัน', value: (row) => row.warranty_expire },
  { label: 'ราคา', value: (row) => row.price },
];

/**
 * ส่งออกทะเบียนทรัพย์สินทั้งชุดตามตัวกรองที่ตั้งไว้ — ไม่ใช่แค่หน้าที่เปิดอยู่
 * ต้องมาก่อน route '/:id' ไม่งั้น Hono จะจับ 'export' เป็น id
 */
assetsRoute.get('/export', requirePermission('asset.view'), zValidator('query', listAssetsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { sort, order, search, status, categoryId } = c.req.valid('query');
  const filters = { status, categoryId, search };

  // นับก่อน เพื่อไม่ต้องดึงของที่รู้อยู่แล้วว่าส่งออกไม่ได้
  const { count, error: countError } = await applyAssetListFilters(
    supabase.from('assets').select('id', { count: 'exact', head: true }),
    filters,
  );
  if (countError) return c.json(fail(reqId, 'ASSETS_EXPORT_FAILED', 'นับรายการเพื่อส่งออกไม่สำเร็จ'), 400);

  const tooLarge = checkExportSize(count);
  if (tooLarge) return c.json(fail(reqId, 'EXPORT_TOO_LARGE', tooLarge.message), 400);

  let query = supabase
    .from('assets')
    .select(
      'asset_code, name, asset_type, brand, model, serial_number, location, status, criticality, purchase_date, warranty_expire, price, ' +
      'category:asset_categories(name), department:departments(name_th), owner:employees(first_name_th, last_name_th)',
    )
    .range(0, LIST_EXPORT_MAX_ROWS - 1);
  query = applySort(query, { sort, order }, ASSET_SORT_COLUMNS, { column: 'created_at', ascending: false });
  query = applyAssetListFilters(query, filters);

  const { data, error } = await query;
  if (error) return c.json(fail(reqId, 'ASSETS_EXPORT_FAILED', 'ดึงข้อมูลเพื่อส่งออกไม่สำเร็จ'), 400);

  const rows = (data ?? []) as unknown as AssetExportRow[];
  // การดึงทะเบียนทั้งชุดออกจากระบบเป็นเหตุการณ์ที่งาน ISMS ต้องตรวจย้อนได้ ไม่ใช่แค่การอ่านหน้าจอ
  await writeAuditLog(c.env, {
    actorId: c.get('userId'),
    actorEmail: c.get('userEmail'),
    action: 'EXPORT',
    module: 'asset',
    targetTable: 'assets',
    detail: { filters, rowCount: rows.length },
    requestId: reqId,
  });

  return c.json(ok(reqId, {
    filename: exportFileName('assets'),
    csv: listCsv(ASSET_EXPORT_COLUMNS, rows),
    rowCount: rows.length,
  }));
});

/**
 * แก้ไขทรัพย์สินหลายชิ้นพร้อมกัน — เปลี่ยนสถานะ ย้ายสถานที่ หรือมอบหมาย/คืนผู้ถือครอง
 *
 * ตรวจ "รายชิ้น" แล้วคืนผลแยกต่อ id เหมือน /tickets/bulk — เลือก 30 ชิ้นแล้วล้มทั้งชุดเพราะ
 * ชิ้นเดียวถูกจำหน่ายไปแล้ว บังคับให้ผู้ใช้มานั่งไล่หาเองว่าชิ้นไหนพัง
 *
 * ฟิลด์ที่ต้องเขียนตอนมอบหมาย/คืน มาจาก services/assetOwnership ตัวเดียวกับที่ endpoint
 * ทีละชิ้นใช้ สองเส้นทางจึงเขียนฟิลด์เหมือนกันเสมอ
 *
 * ต้องมาก่อน route '/:id' ไม่งั้น Hono จะจับ 'bulk' เป็น id
 */
assetsRoute.patch(
  '/bulk',
  requireAnyPermission(['asset.update', 'asset.transfer']),
  zValidator('json', bulkUpdateAssetsSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const { ids, status, location, ownerEmployeeId, notes } = c.req.valid('json');

    // สิทธิ์แยกกันตามสิ่งที่ขอเปลี่ยน — การย้ายผู้ถือครองไม่ใช่เรื่องเดียวกับการแก้สถานะ
    const changesOwner = ownerEmployeeId !== undefined;
    const changesFields = status !== undefined || location !== undefined;
    if (changesOwner && !(await hasPermission(c, 'asset.transfer'))) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์มอบหมาย/รับคืนทรัพย์สิน'), 403);
    }
    if (changesFields && !(await hasPermission(c, 'asset.update'))) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์แก้ไขทรัพย์สิน'), 403);
    }

    // ผู้รับคนเดียวกันทั้งชุด จึงหาแค่ครั้งเดียว ไม่ต้องถามฐานข้อมูลซ้ำทุกชิ้น
    let toEmployee: { id: string; department_id: string | null } | null = null;
    if (ownerEmployeeId) {
      const { data, error } = await supabase.from('employees').select('id, department_id').eq('id', ownerEmployeeId).maybeSingle();
      if (error || !data) return c.json(fail(reqId, 'EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานที่เลือก'), 400);
      toEmployee = data as { id: string; department_id: string | null };
    }

    // RLS กรองชิ้นที่ผู้ใช้ไม่มีสิทธิ์เห็นออกไปเอง ชิ้นที่หายไปจะถูกรายงานว่าไม่พบ
    const { data: currentRows, error: loadError } = await supabase.from('assets').select('*').in('id', ids);
    if (loadError) return dbFailJson(c, 'ASSETS_BULK_LOAD_FAILED', loadError);
    const byId = new Map((currentRows ?? []).map((row) => [String(row.id), row]));

    const now = new Date();
    const result = await runBulk(ids, async (id) => {
      const current = byId.get(id);
      if (!current) throw new BulkItemError('ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้ หรือท่านไม่มีสิทธิ์เข้าถึง');
      if (isAssetRetired(current.status)) {
        throw new BulkItemError('ASSET_RETIRED', `${current.asset_code ?? current.name}: ถูกจำหน่าย/สูญหายแล้ว`);
      }

      const patch: Record<string, unknown> = { updated_by: actorId };
      if (toEmployee) {
        Object.assign(patch, buildAssignPatch({
          toEmployeeId: toEmployee.id,
          employeeDepartmentId: toEmployee.department_id,
          location,
          currentLocation: current.location,
          actorId,
          now,
        }));
      } else if (ownerEmployeeId === null) {
        Object.assign(patch, buildReturnPatch({ location, actorId }));
      } else if (location !== undefined) {
        patch.location = location;
      }
      // สถานะที่ระบุมาตรง ๆ ชนะสถานะที่ตกทอดมาจากการมอบหมาย/คืน
      if (status !== undefined) patch.status = status;

      const auditBefore = await loadAuditSnapshot(supabase, 'assets', id);
      const { data: updated, error } = await supabase.from('assets').update(patch).eq('id', id).select('id, asset_code, status').single();
      if (error || !updated) throw new BulkItemError('ASSET_UPDATE_FAILED', `${current.asset_code ?? current.name}: บันทึกไม่สำเร็จ`);

      const action = toEmployee ? 'Assign' : ownerEmployeeId === null ? 'Return' : location !== undefined ? 'Transfer' : 'Status';
      await recordMovement(supabase, {
        assetId: id,
        actionType: action,
        fromEmployeeId: current.owner_employee_id,
        toEmployeeId: toEmployee?.id ?? null,
        departmentId: (patch.department_id as string | null) ?? null,
        location: (patch.location as string | null) ?? null,
        statusLabel: String(patch.status ?? current.status),
        notes: notes ?? null,
        createdBy: actorId,
      });
      if (patch.lifecycle_status === 'checked_out' || patch.lifecycle_status === 'returned') {
        await recordLifecycleEvent(supabase, {
          assetId: id,
          fromStatus: isAssetLifecycleStatus(current.lifecycle_status) ? current.lifecycle_status : 'ready',
          toStatus: patch.lifecycle_status,
          notes: notes ?? null,
          performedBy: actorId,
        });
      }
      await writeAuditLog(c.env, {
        actorId,
        actorEmail: c.get('userEmail'),
        action: action === 'Status' ? 'UPDATE_STATUS' : action.toUpperCase(),
        module: 'asset',
        targetTable: 'assets',
        targetId: id,
        detail: { status, location, ownerEmployeeId, notes, bulk: true },
        requestId: reqId,
        before: auditBefore,
        after: updated,
      });

      return { id, assetCode: String(updated.asset_code ?? ''), status: String(updated.status) };
    });

    return c.json(ok(reqId, result));
  },
);

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
  if (body.vendorId !== undefined) patch.vendor_id = body.vendorId || null;
  if (body.contractId !== undefined) patch.contract_id = body.contractId || null;
  if (body.purchaseOrder !== undefined) patch.purchase_order = body.purchaseOrder;
  if (body.invoiceNumber !== undefined) patch.invoice_number = body.invoiceNumber;
  if (body.purchaseDate !== undefined) patch.purchase_date = body.purchaseDate || null;
  if (body.warrantyExpire !== undefined) patch.warranty_expire = body.warrantyExpire || null;
  if (body.price !== undefined) patch.price = body.price;
  if (body.usefulLifeYears !== undefined) patch.useful_life_years = body.usefulLifeYears;
  if (body.depreciationMethod !== undefined) patch.depreciation_method = body.depreciationMethod;
  if (body.depreciationRate !== undefined) patch.depreciation_rate = body.depreciationRate;
  if (body.costCenter !== undefined) patch.cost_center = body.costCenter;
  if (body.barcode !== undefined) patch.barcode = body.barcode;
  if (body.assetModelCatalogId !== undefined) patch.asset_model_catalog_id = body.assetModelCatalogId || null;
  if (body.parentAssetId !== undefined) patch.parent_asset_id = body.parentAssetId || null;
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

  if (body.lifecycleStatus && body.lifecycleStatus !== current.lifecycle_status) {
    return c.json(fail(reqId, 'USE_LIFECYCLE_ENDPOINT', 'กรุณาเปลี่ยนขั้นตอนผ่าน Asset Lifecycle โดยตรง'), 409);
  }
  const duplicateSerial = await findDuplicateAssetValue(supabase, 'serial_number', body.serialNumber, id);
  if (duplicateSerial) return c.json(fail(reqId, 'DUPLICATE_SERIAL', `Serial ซ้ำกับ ${duplicateSerial.asset_code} — ${duplicateSerial.name}`), 409);
  const duplicateBarcode = await findDuplicateAssetValue(supabase, 'barcode', body.barcode, id);
  if (duplicateBarcode) return c.json(fail(reqId, 'DUPLICATE_BARCODE', `Barcode ซ้ำกับ ${duplicateBarcode.asset_code} — ${duplicateBarcode.name}`), 409);
  if (body.parentAssetId === id) return c.json(fail(reqId, 'PARENT_ASSET_INVALID', 'Asset ไม่สามารถเป็น Parent ของตัวเองได้'), 400);

  if (body.parentAssetId) {
    const { data: parent, error: parentError } = await supabase.from('assets').select('id').eq('id', body.parentAssetId).maybeSingle();
    if (parentError) return dbFailJson(c, 'PARENT_ASSET_LOOKUP_FAILED', parentError);
    if (!parent) return c.json(fail(reqId, 'PARENT_ASSET_NOT_FOUND', 'ไม่พบ Parent Asset ที่ระบุ'), 400);
  }

  if (patch.asset_code || patch.name) {
    patch.qr_code_url = buildAssetQrUrl((patch.asset_code as string) || current.asset_code, (patch.name as string) || current.name);
  }

  const auditBefore = await loadAuditSnapshot(supabase, 'assets', id);
  const { data, error } = await supabase.from('assets').update(patch).eq('id', id).select(ASSET_SELECT).single();
  if (error) return dbFailJson(c, 'ASSET_UPDATE_FAILED', error);

  const updatedRow = data as unknown as Record<string, unknown>;
  await ensureAssetConfigurationItem(c.env, {
    id,
    asset_code: String(updatedRow.asset_code ?? current.asset_code),
    name: String(updatedRow.name ?? current.name),
    asset_type: String(updatedRow.asset_type ?? current.asset_type),
    owner_employee_id: (updatedRow.owner_employee_id as string | null | undefined) ?? current.owner_employee_id ?? null,
    location: (updatedRow.location as string | null | undefined) ?? current.location ?? null,
  });

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
      before: auditBefore,
    after: data,
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
  if (error) return dbFailJson(c, 'ASSET_STATUS_UPDATE_FAILED', error);

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
    .update({ status: 'จำหน่าย/เลิกใช้', lifecycle_status: 'disposed', disposed_at: new Date().toISOString().slice(0, 10), updated_by: actorId })
    .eq('id', id)
    .select(ASSET_SELECT)
    .single();
  if (error) return dbFailJson(c, 'ASSET_RETIRE_FAILED', error);

  await recordLifecycleEvent(supabase, {
    assetId: id,
    fromStatus: isAssetLifecycleStatus(current.lifecycle_status) ? current.lifecycle_status : 'ready',
    toStatus: 'disposed',
    performedBy: actorId,
  });

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

    const auditBefore = await loadAuditSnapshot(supabase, 'assets', id);
    const { data, error } = await supabase
      .from('assets')
      .update({ patch_status: patchStatus, patch_date: patchDate || new Date().toISOString().slice(0, 10), updated_by: actorId })
      .eq('id', id)
      .select(ASSET_SELECT)
      .single();
    if (error) return dbFailJson(c, 'ASSET_PATCH_UPDATE_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'asset',
      targetTable: 'assets',
      targetId: id,
      detail: { patchStatus },
      requestId: reqId,
          before: auditBefore,
      after: data,
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
  if (error) return dbFailJson(c, 'ASSET_QR_FAILED', error);

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
    physical_verification_status: result === ASSET_AUDIT_RESULTS[0] ? 'verified' : 'exception',
    physical_verified_at: new Date().toISOString(),
    physical_verified_by: actorId,
    updated_by: actorId,
  };
  if (result === 'พบ/ผิดตำแหน่ง' && location) patch.location = location;
  if (result === 'ไม่พบ/สูญหาย') patch.status = 'สูญหาย';

  const { data, error } = await supabase.from('assets').update(patch).eq('id', id).select(ASSET_SELECT).single();
  if (error) return dbFailJson(c, 'ASSET_VERIFY_FAILED', error);

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
  if (isAssetRetired(current.status)) {
    return c.json(fail(reqId, 'ASSET_RETIRED', 'ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว'), 400);
  }

  const { data: toEmployee, error: employeeError } = await supabase.from('employees').select('id, department_id').eq('id', toEmployeeId).maybeSingle();
  if (employeeError || !toEmployee) return c.json(fail(reqId, 'EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานที่เลือก'), 400);

  const { data, error } = await supabase
    .from('assets')
    .update(buildAssignPatch({
      toEmployeeId,
      employeeDepartmentId: toEmployee.department_id,
      departmentId,
      location,
      currentLocation: current.location,
      dueDate,
      actorId,
      now: new Date(),
    }))
    .eq('id', id)
    .select(ASSET_SELECT)
    .single();
  if (error) return dbFailJson(c, 'ASSET_ASSIGN_FAILED', error);

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
  await recordLifecycleEvent(supabase, {
    assetId: id,
    fromStatus: isAssetLifecycleStatus(current.lifecycle_status) ? current.lifecycle_status : 'ready',
    toStatus: 'checked_out',
    notes: notes ?? null,
    performedBy: actorId,
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
  const {
    location, condition, notes, assetLoanId, returnedAt, returnReceiverEmployeeId,
    conditionAfter, returnOutcome, damageNotes, returnNotes,
  } = c.req.valid('json');

  const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);

  // New complete loan records are returned through the transaction-backed RPC.
  // A lookup by asset keeps the existing /:id/return URL compatible for callers
  // that do not yet know the loan id.
  let loanId = assetLoanId ?? null;
  if (!loanId) {
    const { data: activeLoan, error: activeLoanError } = await supabase
      .from('asset_loans').select('id').eq('asset_id', id).eq('status', 'active').maybeSingle();
    if (activeLoanError) return dbFailJson(c, 'ASSET_LOAN_LOOKUP_FAILED', activeLoanError);
    loanId = activeLoan?.id ?? null;
  }
  if (loanId) {
    const { data: linkedLoan, error: linkedLoanError } = await supabase
      .from('asset_loans').select('id').eq('id', loanId).eq('asset_id', id).maybeSingle();
    if (linkedLoanError) return dbFailJson(c, 'ASSET_LOAN_LOOKUP_FAILED', linkedLoanError);
    if (!linkedLoan) return c.json(fail(reqId, 'ASSET_LOAN_NOT_FOUND', 'ไม่พบรายการยืมของ Asset นี้'), 404);
    if (!returnedAt || !returnReceiverEmployeeId || !conditionAfter || !returnOutcome) {
      return c.json(fail(reqId, 'ASSET_LOAN_RETURN_DETAILS_REQUIRED', 'กรุณาระบุวันที่คืน ผู้รับคืน สภาพหลังคืน และผลการคืนให้ครบ'), 400);
    }
    const { data: rpcResult, error: rpcError } = await supabase.rpc('return_asset_loan', {
      p_loan_id: loanId,
      p_returned_at: returnedAt,
      p_return_receiver_employee_id: returnReceiverEmployeeId,
      p_condition_after: conditionAfter,
      p_return_outcome: returnOutcome,
      p_damage_notes: damageNotes ?? null,
      p_return_notes: returnNotes ?? notes ?? null,
      p_location: location ?? null,
    });
    if (rpcError) return assetLoanRpcError(c, 'ASSET_LOAN_RETURN_FAILED', rpcError, 'ASSET_LOAN_RETURN_FAILED');
    const { data: returnedAsset, error: returnedAssetError } = await loadAssetOr404(supabase, id);
    if (returnedAssetError) return dbFailJson(c, 'ASSET_RETURN_FAILED', returnedAssetError);
    await writeAuditLog(c.env, {
      actorId, actorEmail: c.get('userEmail'), action: 'RETURN_ASSET_LOAN', module: 'asset',
      targetTable: 'asset_loans', targetId: loanId,
      detail: { assetId: id, returnOutcome, returnReceiverEmployeeId }, requestId: reqId,
    });
    const enrichedReturnedAsset = enrichAsset(returnedAsset as never) as unknown as Record<string, unknown>;
    return c.json(ok(reqId, { ...enrichedReturnedAsset, loanId, returnResult: rpcResult }));
  }

  const resolvedLocation = location || ASSET_DEFAULT_RETURN_LOCATION;
  const { data, error } = await supabase
    .from('assets')
    .update(buildReturnPatch({ location: resolvedLocation, actorId }))
    .eq('id', id)
    .select(ASSET_SELECT)
    .single();
  if (error) return dbFailJson(c, 'ASSET_RETURN_FAILED', error);

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
  await recordLifecycleEvent(supabase, {
    assetId: id,
    fromStatus: isAssetLifecycleStatus(current.lifecycle_status) ? current.lifecycle_status : 'checked_out',
    toStatus: 'returned',
    notes: notes ?? null,
    performedBy: actorId,
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
  if (isAssetRetired(current.status)) {
    return c.json(fail(reqId, 'ASSET_RETIRED', 'ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว'), 400);
  }

  const patch: Record<string, unknown> = { status: 'ใช้งานอยู่', loan_date: new Date().toISOString().slice(0, 10), updated_by: actorId };
  if (toEmployeeId) patch.owner_employee_id = toEmployeeId;
  patch.lifecycle_status = 'checked_out';
  if (departmentId) patch.department_id = departmentId;
  if (location) patch.location = location;
  if (dueDate !== undefined) patch.loan_due_date = dueDate || null;

  const { data, error } = await supabase.from('assets').update(patch).eq('id', id).select(ASSET_SELECT).single();
  if (error) return dbFailJson(c, 'ASSET_TRANSFER_FAILED', error);

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
  await recordLifecycleEvent(supabase, {
    assetId: id,
    fromStatus: isAssetLifecycleStatus(current.lifecycle_status) ? current.lifecycle_status : 'ready',
    toStatus: 'checked_out',
    notes: notes ?? null,
    performedBy: actorId,
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
    const { vendorName, vendorId, location, notes } = c.req.valid('json');
    let resolvedVendorName = vendorName;
    if (vendorId) {
      const { data: vendor } = await supabase.from('vendors').select('name, status').eq('id', vendorId).maybeSingle();
      if (!vendor) return c.json(fail(reqId, 'VENDOR_NOT_FOUND', 'ไม่พบผู้ให้บริการซ่อมที่เลือก'), 400);
      if (vendor.status !== 'Active') return c.json(fail(reqId, 'VENDOR_INACTIVE', 'ผู้ให้บริการซ่อมที่เลือกถูกปิดใช้งาน'), 400);
      resolvedVendorName = vendor.name;
    }

    const { data: current, error: currentError } = await loadAssetOr404(supabase, id);
    if (currentError) return c.json(fail(reqId, 'ASSET_LOAD_FAILED', 'ดึงข้อมูลทรัพย์สินไม่สำเร็จ'), 400);
    if (!current) return c.json(fail(reqId, 'ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินนี้'), 404);
    if (isAssetRetired(current.status)) {
      return c.json(fail(reqId, 'ASSET_RETIRED', 'ทรัพย์สินนี้ถูกจำหน่าย/สูญหายแล้ว'), 400);
    }

    const { data, error } = await supabase
      .from('assets')
      .update({ status: 'ซ่อมบำรุง', lifecycle_status: 'repair', loan_date: null, loan_due_date: null, updated_by: actorId })
      .eq('id', id)
      .select(ASSET_SELECT)
      .single();
    if (error) return dbFailJson(c, 'ASSET_REPAIR_SEND_FAILED', error);
    await recordLifecycleEvent(supabase, { assetId: id, fromStatus: isAssetLifecycleStatus(current.lifecycle_status) ? current.lifecycle_status : 'checked_out', toStatus: 'repair', notes, performedBy: actorId });

    await recordMovement(supabase, {
      assetId: id,
      actionType: 'ส่งซ่อม',
      fromEmployeeId: current.owner_employee_id,
      vendorName: resolvedVendorName ?? null,
      vendorId: vendorId ?? null,
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
      .update({ status: 'พร้อมใช้งาน', lifecycle_status: 'returned', location: resolvedLocation, updated_by: actorId })
      .eq('id', id)
      .select(ASSET_SELECT)
      .single();
    if (error) return dbFailJson(c, 'ASSET_REPAIR_RETURN_FAILED', error);
    await recordLifecycleEvent(supabase, { assetId: id, fromStatus: isAssetLifecycleStatus(current.lifecycle_status) ? current.lifecycle_status : 'repair', toStatus: 'returned', notes, performedBy: actorId });

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
