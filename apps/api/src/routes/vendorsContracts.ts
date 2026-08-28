import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { hashVendorPassword } from '../lib/vendorPortalAuth';
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
import {
  assessVendorSchema,
  createContractSchema,
  createVendorSchema,
  listContractsQuerySchema,
  listVendorsQuerySchema,
  setContractStatusSchema,
  setVendorStatusSchema,
  updateContractSchema,
  updateVendorSchema,
} from '../validators/vendorsContracts';
import {
  createVendorPortalAccountSchema,
  resetVendorPortalPasswordSchema,
  setVendorPortalAccountStatusSchema,
} from '../validators/vendorPortal';

export const vendorsRoute = new Hono<AppEnv>();
vendorsRoute.use('*', requireAuth);
vendorsRoute.use('*', requirePermission('vendor.view'));

export const contractsRoute = new Hono<AppEnv>();
contractsRoute.use('*', requireAuth);
contractsRoute.use('*', requirePermission('contract.view'));

const VENDOR_SELECT =
  '*, owner:profiles!vendors_owner_id_fkey(id, full_name, email), ' +
  'contracts(id, contract_number, name, status, end_date)';
const CONTRACT_SELECT =
  '*, vendor:vendors!contracts_vendor_id_fkey(id, vendor_code, name, status), ' +
  'owner:profiles!contracts_owner_id_fkey(id, full_name, email)';

function generatedVendorCode(): string {
  const now = new Date();
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `VND-${month}-${randomCodeSuffix()}`;
}

vendorsRoute.get('/options', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('vendors').select('id, vendor_code, name, service_type, status').order('name').limit(2000);
  if (error) return c.json(fail(reqId, 'VENDOR_OPTIONS_FAILED', 'ดึงรายชื่อผู้ให้บริการไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

vendorsRoute.get('/references', requirePermission('vendor.manage'), async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await createAdminClient(c.env).from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name').limit(1000);
  if (error) return c.json(fail(reqId, 'VENDOR_REFERENCES_FAILED', 'ดึงข้อมูลผู้รับผิดชอบไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { owners: data ?? [] }));
});

const VENDOR_PORTAL_ACCOUNT_SELECT =
  'id, vendor_id, email, full_name, position, status, failed_login_count, locked_until, last_login_at, created_at, updated_at';

vendorsRoute.get('/:id/portal-accounts', requirePermission('vendor.manage'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const { data: vendor } = await admin.from('vendors').select('id').eq('id', c.req.param('id')).maybeSingle();
  if (!vendor) return c.json(fail(reqId, 'VENDOR_NOT_FOUND', 'ไม่พบผู้ให้บริการ'), 404);
  const { data, error } = await admin.from('vendor_portal_accounts').select(VENDOR_PORTAL_ACCOUNT_SELECT).eq('vendor_id', vendor.id).order('created_at');
  if (error) return dbFailJson(c, 'VENDOR_PORTAL_ACCOUNT_LIST_FAILED', error, 'โหลดบัญชีบริษัทไม่สำเร็จ');
  return c.json(ok(reqId, data ?? []));
});

vendorsRoute.post('/:id/portal-accounts', requirePermission('vendor.manage'), zValidator('json', createVendorPortalAccountSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: vendor } = await admin.from('vendors').select('id, vendor_code, name, status').eq('id', c.req.param('id')).maybeSingle();
  if (!vendor) return c.json(fail(reqId, 'VENDOR_NOT_FOUND', 'ไม่พบผู้ให้บริการ'), 404);
  if (vendor.status !== 'Active') return c.json(fail(reqId, 'VENDOR_INACTIVE', 'ต้องเปิดใช้งานบริษัทก่อนสร้างบัญชี Portal'), 409);
  const { data, error } = await admin.from('vendor_portal_accounts').insert({
    vendor_id: vendor.id,
    email: body.email,
    full_name: body.fullName,
    position: body.position || null,
    password_hash: await hashVendorPassword(body.password),
    created_by: actorId,
    updated_by: actorId,
  }).select(VENDOR_PORTAL_ACCOUNT_SELECT).single();
  if (error || !data) return dbFailJson(c, 'VENDOR_PORTAL_ACCOUNT_CREATE_FAILED', error, error?.code === '23505' ? 'อีเมลนี้มีบัญชีของบริษัทแล้ว' : 'สร้างบัญชีบริษัทไม่สำเร็จ');
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'vendor_portal', targetTable: 'vendor_portal_accounts', targetId: data.id, detail: { vendorId: vendor.id, vendorCode: vendor.vendor_code, email: body.email }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

vendorsRoute.post('/:id/portal-accounts/:accountId/status', requirePermission('vendor.manage'), zValidator('json', setVendorPortalAccountStatusSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('vendor_portal_accounts').update({
    status: body.status,
    failed_login_count: 0,
    locked_until: null,
    updated_by: actorId,
  }).eq('id', c.req.param('accountId')).eq('vendor_id', c.req.param('id')).select(VENDOR_PORTAL_ACCOUNT_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'VENDOR_PORTAL_ACCOUNT_STATUS_FAILED', error, 'เปลี่ยนสถานะบัญชีไม่สำเร็จ');
  if (!data) return c.json(fail(reqId, 'VENDOR_PORTAL_ACCOUNT_NOT_FOUND', 'ไม่พบบัญชีบริษัท'), 404);
  if (body.status === 'Inactive') {
    const { data: sessions } = await admin.from('vendor_portal_sessions').select('id').eq('account_id', data.id).is('revoked_at', null);
    if (sessions?.length) await admin.from('vendor_portal_sessions').update({ revoked_at: new Date().toISOString() }).in('id', sessions.map((session) => session.id));
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE_STATUS', module: 'vendor_portal', targetTable: 'vendor_portal_accounts', targetId: data.id, detail: { status: body.status }, requestId: reqId });
  return c.json(ok(reqId, data));
});

vendorsRoute.post('/:id/portal-accounts/:accountId/reset-password', requirePermission('vendor.manage'), zValidator('json', resetVendorPortalPasswordSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('vendor_portal_accounts').update({
    password_hash: await hashVendorPassword(c.req.valid('json').password),
    failed_login_count: 0,
    locked_until: null,
    updated_by: actorId,
  }).eq('id', c.req.param('accountId')).eq('vendor_id', c.req.param('id')).select(VENDOR_PORTAL_ACCOUNT_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'VENDOR_PORTAL_PASSWORD_RESET_FAILED', error, 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ');
  if (!data) return c.json(fail(reqId, 'VENDOR_PORTAL_ACCOUNT_NOT_FOUND', 'ไม่พบบัญชีบริษัท'), 404);
  const { data: sessions } = await admin.from('vendor_portal_sessions').select('id').eq('account_id', data.id).is('revoked_at', null);
  if (sessions?.length) await admin.from('vendor_portal_sessions').update({ revoked_at: new Date().toISOString() }).in('id', sessions.map((session) => session.id));
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'RESET_PASSWORD', module: 'vendor_portal', targetTable: 'vendor_portal_accounts', targetId: data.id, detail: { vendorId: c.req.param('id') }, requestId: reqId });
  return c.json(ok(reqId, data));
});

vendorsRoute.get('/', zValidator('query', listVendorsQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, serviceType } = c.req.valid('query');
  let query = c.get('supabase').from('vendors').select(VENDOR_SELECT, { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (status) query = query.eq('status', status);
  if (serviceType) query = query.eq('service_type', serviceType);
  if (search) {
    const safe = cleanSearch(search);
    query = query.or(`vendor_code.ilike.%${safe}%,name.ilike.%${safe}%,contact_person.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'VENDOR_LIST_FAILED', 'ดึงทะเบียนผู้ให้บริการไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

vendorsRoute.post('/', requirePermission('vendor.manage'), zValidator('json', createVendorSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: vendor, error } = await admin.from('vendors').insert({
    vendor_code: generatedVendorCode(), name: body.name, service_type: body.serviceType,
    service_scope: body.serviceScope || null, contact_person: body.contactPerson || null,
    phone: body.phone || null, email: body.email || null, contact_info: body.contactInfo || null,
    owner_id: body.ownerId ?? actorId, notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select(VENDOR_SELECT).single();
  if (error) {
    return dbFailJson(c, 'VENDOR_CREATE_FAILED', error, error.code === '23505' ? 'มีชื่อหรือรหัสผู้ให้บริการนี้อยู่แล้ว' : undefined);
  }
  const vendorRow = vendor as unknown as { id: string; vendor_code: string };

  if (body.initialContract) {
    const initial = body.initialContract;
    const { error: contractError } = await admin.from('contracts').insert({
      contract_number: initial.contractNumber, name: initial.name || `สัญญา ${initial.contractNumber}`,
      vendor_id: vendorRow.id, start_date: initial.startDate || null, end_date: initial.endDate || null,
      status: 'Active', owner_id: body.ownerId ?? actorId, legacy_source: 'VendorRegister',
      created_by: actorId, updated_by: actorId,
    });
    if (contractError) {
      await admin.from('vendors').delete().eq('id', vendorRow.id);
      return dbFailJson(c, 'VENDOR_INITIAL_CONTRACT_FAILED', contractError, contractError.code === '23505' ? 'เลขที่สัญญานี้มีอยู่แล้ว' : undefined);
    }
  }

  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'vendor', targetTable: 'vendors', targetId: vendorRow.id, detail: { vendorCode: vendorRow.vendor_code, initialContract: body.initialContract?.contractNumber }, requestId: reqId });
  return c.json(ok(reqId, vendor), 201);
});

vendorsRoute.patch('/:id', requirePermission('vendor.manage'), zValidator('json', updateVendorSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const patch: Record<string, unknown> = { updated_by: actorId };
  const fields = { name: 'name', serviceType: 'service_type', serviceScope: 'service_scope', contactPerson: 'contact_person', phone: 'phone', email: 'email', contactInfo: 'contact_info', ownerId: 'owner_id', notes: 'notes' } as const;
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : value;
  }
  const auditBefore = await loadAuditSnapshot(createAdminClient(c.env), 'vendors', c.req.param('id'));
  const { data, error } = await createAdminClient(c.env).from('vendors').update(patch).eq('id', c.req.param('id')!).select(VENDOR_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'VENDOR_UPDATE_FAILED', error, error.code === '23505' ? 'มีชื่อผู้ให้บริการนี้อยู่แล้ว' : undefined);
  if (!data) return c.json(fail(reqId, 'VENDOR_NOT_FOUND', 'ไม่พบผู้ให้บริการ'), 404);
  const dataRow = data as unknown as { id: string };
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'vendor', targetTable: 'vendors', targetId: dataRow.id, detail: body, requestId: reqId , before: auditBefore, after: data });
  return c.json(ok(reqId, data));
});

vendorsRoute.post('/:id/status', requirePermission('vendor.manage'), zValidator('json', setVendorStatusSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { status } = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).from('vendors').update({ status, updated_by: actorId }).eq('id', c.req.param('id')!).select(VENDOR_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'VENDOR_STATUS_FAILED', error);
  if (!data) return c.json(fail(reqId, 'VENDOR_NOT_FOUND', 'ไม่พบผู้ให้บริการ'), 404);
  const dataRow = data as unknown as { id: string };
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE_STATUS', module: 'vendor', targetTable: 'vendors', targetId: dataRow.id, detail: { status }, requestId: reqId });
  return c.json(ok(reqId, data));
});

vendorsRoute.post('/:id/assessment', requirePermission('vendor.manage'), zValidator('json', assessVendorSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { result } = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).from('vendors').update({ assessment_result: result, assessment_date: new Date().toISOString().slice(0, 10), updated_by: actorId }).eq('id', c.req.param('id')!).select(VENDOR_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'VENDOR_ASSESSMENT_FAILED', error);
  if (!data) return c.json(fail(reqId, 'VENDOR_NOT_FOUND', 'ไม่พบผู้ให้บริการ'), 404);
  const dataRow = data as unknown as { id: string };
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'ASSESS', module: 'vendor', targetTable: 'vendors', targetId: dataRow.id, detail: { result }, requestId: reqId });
  return c.json(ok(reqId, data));
});

contractsRoute.get('/options', async (c) => {
  const reqId = c.get('requestId');
  const vendorId = c.req.query('vendorId');
  let query = c.get('supabase').from('contracts').select('id, contract_number, name, vendor_id, status, end_date').order('contract_number').limit(2000);
  if (vendorId) query = query.eq('vendor_id', vendorId);
  const { data, error } = await query;
  if (error) return c.json(fail(reqId, 'CONTRACT_OPTIONS_FAILED', 'ดึงรายชื่อสัญญาไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

contractsRoute.get('/references', requirePermission('contract.manage'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [vendors, owners] = await Promise.all([
    admin.from('vendors').select('id, vendor_code, name, status').order('name').limit(2000),
    admin.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name').limit(1000),
  ]);
  const error = vendors.error ?? owners.error;
  if (error) return c.json(fail(reqId, 'CONTRACT_REFERENCES_FAILED', 'ดึงข้อมูลอ้างอิงไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { vendors: vendors.data ?? [], owners: owners.data ?? [] }));
});

contractsRoute.post('/check-expiry', requirePermission('contract.manage'), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const admin = createAdminClient(c.env);
  const today = new Date().toISOString().slice(0, 10);
  const { data: candidates, error } = await admin.from('contracts').select('id, contract_number, name, owner_id, end_date, renewal_notice_days, expiry_notified_at, status').eq('status', 'Active').not('end_date', 'is', null);
  if (error) return dbFailJson(c, 'CONTRACT_EXPIRY_CHECK_FAILED', error);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const expiredIds = (candidates ?? []).filter((row) => row.end_date! < today).map((row) => row.id);
  const notifyRows = (candidates ?? []).filter((row) => {
    if (row.expiry_notified_at || !row.end_date || !row.owner_id) return false;
    const days = Math.ceil((Date.parse(`${row.end_date}T00:00:00Z`) - todayMs) / 86_400_000);
    return days <= row.renewal_notice_days;
  });
  if (expiredIds.length) {
    const { error: updateError } = await admin.from('contracts').update({ status: 'Expired', updated_by: actorId }).in('id', expiredIds);
    if (updateError) return dbFailJson(c, 'CONTRACT_EXPIRY_UPDATE_FAILED', updateError);
  }
  if (notifyRows.length) {
    await Promise.all(notifyRows.map((row) => sendNotification(c.env, {
      recipientId: row.owner_id!, type: 'contract_expiry',
      title: row.end_date! < today ? `สัญญา ${row.contract_number} หมดอายุแล้ว` : `สัญญา ${row.contract_number} ใกล้หมดอายุ`,
      body: `${row.name} · สิ้นสุด ${row.end_date}`, link: '/vendors-contracts',
    })));
    await admin.from('contracts').update({ expiry_notified_at: new Date().toISOString(), updated_by: actorId }).in('id', notifyRows.map((row) => row.id));
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CHECK_EXPIRY', module: 'contract', targetTable: 'contracts', detail: { updatedCount: expiredIds.length, notifiedCount: notifyRows.length }, requestId: reqId });
  return c.json(ok(reqId, { updatedCount: expiredIds.length, notifiedCount: notifyRows.length }));
});

contractsRoute.get('/', zValidator('query', listContractsQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, contractType, vendorId, expiringWithinDays } = c.req.valid('query');
  let query = c.get('supabase').from('contracts').select(CONTRACT_SELECT, { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (status) query = query.eq('status', status);
  if (contractType) query = query.eq('contract_type', contractType);
  if (vendorId) query = query.eq('vendor_id', vendorId);
  if (expiringWithinDays !== undefined) {
    const end = new Date();
    end.setUTCDate(end.getUTCDate() + expiringWithinDays);
    query = query.eq('status', 'Active').gte('end_date', new Date().toISOString().slice(0, 10)).lte('end_date', end.toISOString().slice(0, 10));
  }
  if (search) {
    const safe = cleanSearch(search);
    query = query.or(`contract_number.ilike.%${safe}%,name.ilike.%${safe}%,service_scope.ilike.%${safe}%`);
  }
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'CONTRACT_LIST_FAILED', 'ดึงทะเบียนสัญญาไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

contractsRoute.post('/', requirePermission('contract.manage'), zValidator('json', createContractSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).from('contracts').insert({
    contract_number: body.contractNumber, name: body.name, vendor_id: body.vendorId,
    contract_type: body.contractType, service_scope: body.serviceScope || null, key_terms: body.keyTerms || null,
    start_date: body.startDate || null, end_date: body.endDate || null, contract_value: body.contractValue ?? null,
    currency: body.currency, owner_id: body.ownerId ?? actorId, renewal_notice_days: body.renewalNoticeDays,
    status: body.status, notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select(CONTRACT_SELECT).single();
  if (error) return dbFailJson(c, 'CONTRACT_CREATE_FAILED', error, error.code === '23505' ? 'เลขที่สัญญานี้มีอยู่แล้ว' : undefined);
  const dataRow = data as unknown as { id: string; contract_number: string };
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'contract', targetTable: 'contracts', targetId: dataRow.id, detail: { contractNumber: dataRow.contract_number, vendorId: body.vendorId }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

contractsRoute.patch('/:id', requirePermission('contract.manage'), zValidator('json', updateContractSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const patch: Record<string, unknown> = { updated_by: actorId };
  const fields = { contractNumber: 'contract_number', name: 'name', vendorId: 'vendor_id', contractType: 'contract_type', serviceScope: 'service_scope', keyTerms: 'key_terms', startDate: 'start_date', endDate: 'end_date', contractValue: 'contract_value', currency: 'currency', ownerId: 'owner_id', renewalNoticeDays: 'renewal_notice_days', status: 'status', notes: 'notes' } as const;
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : value;
  }
  if (body.endDate !== undefined) patch.expiry_notified_at = null;
  const auditBefore = await loadAuditSnapshot(createAdminClient(c.env), 'contracts', c.req.param('id'));
  const { data, error } = await createAdminClient(c.env).from('contracts').update(patch).eq('id', c.req.param('id')!).select(CONTRACT_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'CONTRACT_UPDATE_FAILED', error, error.code === '23505' ? 'เลขที่สัญญานี้มีอยู่แล้ว' : undefined);
  if (!data) return c.json(fail(reqId, 'CONTRACT_NOT_FOUND', 'ไม่พบสัญญา'), 404);
  const dataRow = data as unknown as { id: string };
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'contract', targetTable: 'contracts', targetId: dataRow.id, detail: body, requestId: reqId , before: auditBefore, after: data });
  return c.json(ok(reqId, data));
});

contractsRoute.post('/:id/status', requirePermission('contract.manage'), zValidator('json', setContractStatusSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { status } = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).from('contracts').update({ status, updated_by: actorId }).eq('id', c.req.param('id')!).select(CONTRACT_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'CONTRACT_STATUS_FAILED', error);
  if (!data) return c.json(fail(reqId, 'CONTRACT_NOT_FOUND', 'ไม่พบสัญญา'), 404);
  const dataRow = data as unknown as { id: string };
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE_STATUS', module: 'contract', targetTable: 'contracts', targetId: dataRow.id, detail: { status }, requestId: reqId });
  return c.json(ok(reqId, data));
});
