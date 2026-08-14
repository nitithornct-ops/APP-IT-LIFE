import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
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
import {
  createVulnerabilitySchema,
  listVulnerabilitiesQuerySchema,
  setVulnerabilityStatusSchema,
  updateVulnerabilitySchema,
} from '../validators/vulnerabilities';

export const vulnerabilitiesRoute = new Hono<AppEnv>();
vulnerabilitiesRoute.use('*', requireAuth);
vulnerabilitiesRoute.use('*', requirePermission('vulnerability.view'));

const VULNERABILITY_SELECT =
  '*, asset:assets!vulnerability_findings_asset_id_fkey(id, asset_code, name, patch_status, patch_date), ' +
  'configuration_item:configuration_items!vulnerability_findings_configuration_item_id_fkey(id, ci_code, name, environment, status), ' +
  'owner:profiles!vulnerability_findings_owner_id_fkey(id, full_name, email), ' +
  'verifier:profiles!vulnerability_findings_verified_by_fkey(id, full_name, email)';

function generateVulnerabilityCode(): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `VUL-${date}-${randomCodeSuffix()}`;
}

async function referenceError(
  admin: SupabaseClient,
  refs: { ownerId?: string; assetId?: string; configurationItemId?: string },
): Promise<string | null> {
  if (refs.ownerId) {
    const { data } = await admin.from('profiles').select('id').eq('id', refs.ownerId).eq('status', 'active').maybeSingle();
    if (!data) return 'ไม่พบ Owner ที่ใช้งานอยู่';
  }
  if (refs.assetId) {
    const { data } = await admin.from('assets').select('id').eq('id', refs.assetId).maybeSingle();
    if (!data) return 'ไม่พบ Asset ที่เลือก';
  }
  if (refs.configurationItemId) {
    const { data } = await admin.from('configuration_items').select('id').eq('id', refs.configurationItemId).maybeSingle();
    if (!data) return 'ไม่พบ Configuration Item ที่เลือก';
  }
  return null;
}

vulnerabilitiesRoute.get('/options', requirePermission('vulnerability.manage'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [assets, configurationItems, users] = await Promise.all([
    admin.from('assets').select('id, asset_code, name, status').order('asset_code').limit(2000),
    admin.from('configuration_items').select('id, ci_code, name, environment, status').neq('status', 'Retired').order('ci_code').limit(2000),
    admin.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name').limit(1000),
  ]);
  const error = assets.error ?? configurationItems.error ?? users.error;
  if (error) return c.json(fail(reqId, 'VULNERABILITY_OPTIONS_FAILED', 'โหลด Asset, CI และ Owner ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { assets: assets.data ?? [], configurationItems: configurationItems.data ?? [], users: users.data ?? [] }));
});

vulnerabilitiesRoute.get('/', zValidator('query', listVulnerabilitiesQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, severity, ownerId, assetId } = c.req.valid('query');
  let query = c.get('supabase')
    .from('vulnerability_findings')
    .select(VULNERABILITY_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));
  if (search) {
    const safe = cleanSearch(search);
    const admin = createAdminClient(c.env);
    const [owners, assets, configurationItems] = await Promise.all([
      admin.from('profiles').select('id').or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`).limit(500),
      admin.from('assets').select('id').or(`asset_code.ilike.%${safe}%,name.ilike.%${safe}%`).limit(500),
      admin.from('configuration_items').select('id').or(`ci_code.ilike.%${safe}%,name.ilike.%${safe}%`).limit(500),
    ]);
    const searchParts = [
      `vulnerability_code.ilike.%${safe}%`,
      `title.ilike.%${safe}%`,
      `cve.ilike.%${safe}%`,
      `affected_system.ilike.%${safe}%`,
      `source.ilike.%${safe}%`,
    ];
    if (owners.data?.length) searchParts.push(`owner_id.in.(${owners.data.map((row) => row.id).join(',')})`);
    if (assets.data?.length) searchParts.push(`asset_id.in.(${assets.data.map((row) => row.id).join(',')})`);
    if (configurationItems.data?.length) searchParts.push(`configuration_item_id.in.(${configurationItems.data.map((row) => row.id).join(',')})`);
    query = query.or(searchParts.join(','));
  }
  if (status) query = query.eq('status', status);
  if (severity) query = query.eq('severity', severity);
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (assetId) query = query.eq('asset_id', assetId);
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'VULNERABILITIES_LIST_FAILED', 'โหลดทะเบียนช่องโหว่ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

vulnerabilitiesRoute.get('/:id', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('vulnerability_findings').select(VULNERABILITY_SELECT).eq('id', c.req.param('id')!).maybeSingle();
  if (error) return c.json(fail(reqId, 'VULNERABILITY_LOAD_FAILED', 'โหลดข้อมูลช่องโหว่ไม่สำเร็จ'), 400);
  if (!data) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  return c.json(ok(reqId, data));
});

vulnerabilitiesRoute.post('/', requirePermission('vulnerability.manage'), zValidator('json', createVulnerabilitySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const ownerId = body.ownerId || actorId;
  const invalidReference = await referenceError(admin, {
    ownerId,
    assetId: body.assetId || undefined,
    configurationItemId: body.configurationItemId || undefined,
  });
  if (invalidReference) return c.json(fail(reqId, 'VULNERABILITY_REFERENCE_INVALID', invalidReference), 400);
  const { data, error } = await admin.from('vulnerability_findings').insert({
    vulnerability_code: generateVulnerabilityCode(),
    title: body.title,
    asset_id: body.assetId || null,
    configuration_item_id: body.configurationItemId || null,
    affected_system: body.affectedSystem || null,
    source: body.source || null,
    cve: body.cve ? body.cve.toUpperCase() : null,
    cvss: body.cvss ?? null,
    severity: body.severity,
    description: body.description || null,
    detected_at: body.detectedAt || new Date().toISOString().slice(0, 10),
    owner_id: ownerId,
    remediation_plan: body.remediationPlan || null,
    patch_reference: body.patchReference || null,
    due_date: body.dueDate || null,
    status: body.status,
    exception_reason: body.exceptionReason || null,
    exception_expiry: body.exceptionExpiry || null,
    evidence_link: body.evidenceLink || null,
    created_by: actorId,
    updated_by: actorId,
    notes: body.notes || null,
  }).select(VULNERABILITY_SELECT).single();
  if (error) return dbFailJson(c, 'VULNERABILITY_CREATE_FAILED', error);
  const created = data as unknown as { id: string; vulnerability_code: string; title: string; severity: string };
  if (ownerId !== actorId) await sendNotification(c.env, { recipientId: ownerId, type: 'vulnerability_assigned', title: `ได้รับมอบหมาย ${created.vulnerability_code}`, body: created.title, link: '/vulnerabilities' });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'vulnerability', targetTable: 'vulnerability_findings', targetId: created.id, detail: { vulnerabilityCode: created.vulnerability_code, severity: created.severity, ownerId }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

vulnerabilitiesRoute.patch('/:id', requirePermission('vulnerability.manage'), zValidator('json', updateVulnerabilitySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: current, error: currentError } = await admin.from('vulnerability_findings').select('*').eq('id', id).maybeSingle();
  if (currentError) return c.json(fail(reqId, 'VULNERABILITY_LOAD_FAILED', 'โหลดข้อมูลช่องโหว่ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  const mergedDetectedAt = body.detectedAt ?? current.detected_at;
  const mergedDueDate = body.dueDate !== undefined ? body.dueDate : current.due_date;
  if (mergedDueDate && mergedDetectedAt && mergedDueDate < mergedDetectedAt) return c.json(fail(reqId, 'VALIDATION_ERROR', 'วันครบกำหนดต้องไม่ก่อนวันที่ตรวจพบ'), 400);
  const ownerId = body.ownerId ?? current.owner_id;
  const invalidReference = await referenceError(admin, {
    ownerId,
    assetId: body.assetId || undefined,
    configurationItemId: body.configurationItemId || undefined,
  });
  if (invalidReference) return c.json(fail(reqId, 'VULNERABILITY_REFERENCE_INVALID', invalidReference), 400);
  const fields = {
    title: 'title', assetId: 'asset_id', configurationItemId: 'configuration_item_id', affectedSystem: 'affected_system',
    source: 'source', cve: 'cve', cvss: 'cvss', severity: 'severity', description: 'description', detectedAt: 'detected_at',
    ownerId: 'owner_id', remediationPlan: 'remediation_plan', patchReference: 'patch_reference', dueDate: 'due_date',
    status: 'status', exceptionReason: 'exception_reason', exceptionExpiry: 'exception_expiry', evidenceLink: 'evidence_link', notes: 'notes',
  } as const;
  const patch: Record<string, unknown> = { updated_by: actorId };
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : input === 'cve' && typeof value === 'string' ? value.toUpperCase() : value;
  }
  if (body.status !== undefined && body.status !== 'ปิด') {
    patch.verified_at = null;
    patch.verified_by = null;
  }
  if (body.status === 'รอตรวจยืนยัน' && !current.remediated_at) patch.remediated_at = new Date().toISOString();
  const auditBefore = await loadAuditSnapshot(admin, 'vulnerability_findings', id);
  const { data, error } = await admin.from('vulnerability_findings').update(patch).eq('id', id).select(VULNERABILITY_SELECT).single();
  if (error) return dbFailJson(c, 'VULNERABILITY_UPDATE_FAILED', error);
  const updated = data as unknown as { vulnerability_code: string; title: string };
  if (body.ownerId && body.ownerId !== current.owner_id && body.ownerId !== actorId) await sendNotification(c.env, { recipientId: body.ownerId, type: 'vulnerability_assigned', title: `ได้รับมอบหมาย ${updated.vulnerability_code}`, body: updated.title, link: '/vulnerabilities' });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'vulnerability', targetTable: 'vulnerability_findings', targetId: id, detail: body, requestId: reqId, before: auditBefore, after: data });
  return c.json(ok(reqId, data));
});

vulnerabilitiesRoute.post('/:id/status', requirePermission('vulnerability.manage'), zValidator('json', setVulnerabilityStatusSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { status, evidenceLink } = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: current, error: currentError } = await admin.from('vulnerability_findings').select('*').eq('id', id).maybeSingle();
  if (currentError) return c.json(fail(reqId, 'VULNERABILITY_LOAD_FAILED', 'โหลดข้อมูลช่องโหว่ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  if (status === 'ปิด' && current.status !== 'รอตรวจยืนยัน') return c.json(fail(reqId, 'VULNERABILITY_NOT_READY', 'ต้องเปลี่ยนสถานะเป็นรอตรวจยืนยันก่อนปิดรายการ'), 409);
  if (status === 'ปิด' && current.owner_id === actorId) return c.json(fail(reqId, 'VULNERABILITY_SOD_VIOLATION', 'Owner ผู้แก้ไขห้ามตรวจยืนยันปิดรายการของตนเอง'), 403);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_by: actorId };
  if (evidenceLink !== undefined) patch.evidence_link = evidenceLink || null;
  if (status === 'รอตรวจยืนยัน') patch.remediated_at = current.remediated_at || now;
  if (status === 'ปิด') {
    patch.remediated_at = current.remediated_at || now;
    patch.verified_at = now;
    patch.verified_by = actorId;
  } else if (current.status === 'ปิด') {
    patch.verified_at = null;
    patch.verified_by = null;
  }
  const { data, error } = await admin.from('vulnerability_findings').update(patch).eq('id', id).select(VULNERABILITY_SELECT).single();
  if (error) return dbFailJson(c, 'VULNERABILITY_STATUS_FAILED', error);
  if (status === 'ปิด' && current.asset_id) {
    await admin.from('assets').update({ patch_status: 'อัปเดตแล้ว', patch_date: new Date().toISOString().slice(0, 10), updated_by: actorId }).eq('id', current.asset_id);
  }
  if (current.owner_id !== actorId) await sendNotification(c.env, { recipientId: current.owner_id, type: 'vulnerability_status', title: `${current.vulnerability_code} · ${status}`, body: current.title, link: '/vulnerabilities' });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: status === 'ปิด' ? 'VERIFY_CLOSE' : 'UPDATE_STATUS', module: 'vulnerability', targetTable: 'vulnerability_findings', targetId: id, detail: { status, evidenceLink: evidenceLink || null, assetPatchUpdated: status === 'ปิด' && Boolean(current.asset_id) }, requestId: reqId });
  return c.json(ok(reqId, data));
});
