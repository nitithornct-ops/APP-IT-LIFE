import { calculateVulnerabilityRisk, type VulnerabilityAssetCriticality, type VulnerabilityCriticalitySource } from '@itlife/shared';
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
  assignCampaignSchema,
  createPatchCampaignSchema,
  createVulnerabilityRetestSchema,
  createVulnerabilitySchema,
  decideExceptionSchema,
  importScannerSchema,
  listVulnerabilitiesQuerySchema,
  requestExceptionSchema,
  setVulnerabilityStatusSchema,
  updatePatchCampaignSchema,
  updateVulnerabilitySchema,
} from '../validators/vulnerabilities';

export const vulnerabilitiesRoute = new Hono<AppEnv>();
vulnerabilitiesRoute.use('*', requireAuth);
vulnerabilitiesRoute.use('*', requirePermission('vulnerability.view'));

const VULNERABILITY_SELECT =
  '*, asset:assets!vulnerability_findings_asset_id_fkey(id, asset_code, name, patch_status, patch_date, criticality), ' +
  'configuration_item:configuration_items!vulnerability_findings_configuration_item_id_fkey(id, ci_code, name, environment, criticality, status), ' +
  'owner:profiles!vulnerability_findings_owner_id_fkey(id, full_name, email), ' +
  'verifier:profiles!vulnerability_findings_verified_by_fkey(id, full_name, email), ' +
  'exception_owner:profiles!vulnerability_findings_exception_owner_id_fkey(id, full_name, email), ' +
  'change:change_requests!vulnerability_findings_change_id_fkey(id, change_number, title, status), ' +
  'incident:incidents!vulnerability_findings_incident_id_fkey(id, incident_number, title, status), ' +
  'problem:problems!vulnerability_findings_problem_id_fkey(id, problem_number, title, status), ' +
  'campaign:vulnerability_patch_campaigns!vulnerability_findings_campaign_id_fkey(id, campaign_code, name, status, target_date)';

type VulnerabilityRow = Record<string, unknown> & {
  id: string;
  vulnerability_code: string;
  title: string;
  owner_id: string;
  asset_id: string | null;
  configuration_item_id: string | null;
  cvss: number | null;
  epss_score: number | null;
  kev_listed: boolean;
  internet_facing: boolean;
  asset_criticality: VulnerabilityAssetCriticality | null;
  severity: string;
  detected_at: string;
  due_date: string | null;
  status: string;
  remediated_at: string | null;
  exception_status: string;
  exception_expiry: string | null;
};

const DEFAULT_SLA_DAYS: Record<string, number> = { ต่ำ: 90, ปานกลาง: 30, สูง: 14, วิกฤต: 7 };

function generateVulnerabilityCode(): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `VUL-${date}-${randomCodeSuffix()}`;
}

function generateCampaignCode(): string {
  const now = new Date();
  return `PC-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}-${randomCodeSuffix()}`;
}

function normalizeCve(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return normalized ? normalized : null;
}

function severityFromCvss(cvss: number | null | undefined): 'ต่ำ' | 'ปานกลาง' | 'สูง' | 'วิกฤต' {
  if (cvss == null) return 'ปานกลาง';
  if (cvss >= 9) return 'วิกฤต';
  if (cvss >= 7) return 'สูง';
  if (cvss >= 4) return 'ปานกลาง';
  return 'ต่ำ';
}

function mapAssetCriticality(value: string | null | undefined): VulnerabilityAssetCriticality {
  if (value === 'Critical' || value === 'High' || value === 'Medium' || value === 'Low') return value;
  if (value === 'สูง') return 'High';
  if (value === 'กลาง') return 'Medium';
  if (value === 'ต่ำ') return 'Low';
  return 'Unknown';
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

async function referenceError(
  admin: SupabaseClient,
  refs: { ownerId?: string; exceptionOwnerId?: string; assetId?: string; configurationItemId?: string; campaignId?: string; changeId?: string; incidentId?: string; problemId?: string },
): Promise<string | null> {
  const checks: Array<Promise<{ data: unknown }>> = [];
  if (refs.ownerId) checks.push(Promise.resolve(admin.from('profiles').select('id').eq('id', refs.ownerId).eq('status', 'active').maybeSingle() as unknown as Promise<{ data: unknown }>));
  if (refs.exceptionOwnerId) checks.push(Promise.resolve(admin.from('profiles').select('id').eq('id', refs.exceptionOwnerId).eq('status', 'active').maybeSingle() as unknown as Promise<{ data: unknown }>));
  if (refs.assetId) checks.push(Promise.resolve(admin.from('assets').select('id').eq('id', refs.assetId).maybeSingle() as unknown as Promise<{ data: unknown }>));
  if (refs.configurationItemId) checks.push(Promise.resolve(admin.from('configuration_items').select('id').eq('id', refs.configurationItemId).maybeSingle() as unknown as Promise<{ data: unknown }>));
  if (refs.campaignId) checks.push(Promise.resolve(admin.from('vulnerability_patch_campaigns').select('id').eq('id', refs.campaignId).maybeSingle() as unknown as Promise<{ data: unknown }>));
  if (refs.changeId) checks.push(Promise.resolve(admin.from('change_requests').select('id').eq('id', refs.changeId).maybeSingle() as unknown as Promise<{ data: unknown }>));
  if (refs.incidentId) checks.push(Promise.resolve(admin.from('incidents').select('id').eq('id', refs.incidentId).maybeSingle() as unknown as Promise<{ data: unknown }>));
  if (refs.problemId) checks.push(Promise.resolve(admin.from('problems').select('id').eq('id', refs.problemId).maybeSingle() as unknown as Promise<{ data: unknown }>));
  const rows = await Promise.all(checks);
  if (refs.ownerId && !rows.shift()?.data) return 'ไม่พบ Owner ที่ใช้งานอยู่';
  if (refs.exceptionOwnerId && !rows.shift()?.data) return 'ไม่พบ Exception Owner ที่ใช้งานอยู่';
  if (refs.assetId && !rows.shift()?.data) return 'ไม่พบ Asset ที่เลือก';
  if (refs.configurationItemId && !rows.shift()?.data) return 'ไม่พบ Configuration Item ที่เลือก';
  if (refs.campaignId && !rows.shift()?.data) return 'ไม่พบ Patch Campaign ที่เลือก';
  if (refs.changeId && !rows.shift()?.data) return 'ไม่พบ Change ที่เลือก';
  if (refs.incidentId && !rows.shift()?.data) return 'ไม่พบ Incident ที่เลือก';
  if (refs.problemId && !rows.shift()?.data) return 'ไม่พบ Problem ที่เลือก';
  return null;
}

async function loadRiskContext(admin: SupabaseClient, assetId: string | null, configurationItemId: string | null): Promise<{ criticality: VulnerabilityAssetCriticality; source: VulnerabilityCriticalitySource }> {
  const [assetResult, ciResult] = await Promise.all([
    assetId ? admin.from('assets').select('criticality').eq('id', assetId).maybeSingle() : Promise.resolve({ data: null }),
    configurationItemId ? admin.from('configuration_items').select('criticality').eq('id', configurationItemId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const ciCriticality = mapAssetCriticality((ciResult.data as { criticality?: string | null } | null)?.criticality);
  if (ciResult.data && ciCriticality !== 'Unknown') return { criticality: ciCriticality, source: 'CMDB' };
  const assetCriticality = mapAssetCriticality((assetResult.data as { criticality?: string | null } | null)?.criticality);
  if (assetResult.data && assetCriticality !== 'Unknown') return { criticality: assetCriticality, source: 'Asset' };
  return { criticality: 'Unknown', source: 'Unknown' };
}

async function loadSlaDays(admin: SupabaseClient, severity: string): Promise<number> {
  const { data } = await admin.from('vulnerability_sla_policies').select('resolution_days').eq('severity', severity).maybeSingle();
  return Number((data as { resolution_days?: number } | null)?.resolution_days ?? DEFAULT_SLA_DAYS[severity] ?? 30);
}

function riskFields(input: { cvss: number | null | undefined; epssScore: number | null | undefined; kevListed: boolean | null | undefined; internetFacing: boolean | null | undefined }, context: { criticality: VulnerabilityAssetCriticality; source: VulnerabilityCriticalitySource }) {
  const risk = calculateVulnerabilityRisk({ ...input, assetCriticality: context.criticality, criticalitySource: context.source });
  return {
    asset_criticality: context.criticality,
    criticality_source: context.source,
    risk_score: risk.score,
    risk_priority: risk.priority,
    risk_factors: risk.factors,
    risk_calculated_at: new Date().toISOString(),
  };
}

async function loadFinding(admin: SupabaseClient, id: string): Promise<VulnerabilityRow | null> {
  const { data } = await admin.from('vulnerability_findings').select('*').eq('id', id).maybeSingle();
  return data as VulnerabilityRow | null;
}

vulnerabilitiesRoute.get('/options', requirePermission('vulnerability.manage'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [assets, configurationItems, users, campaigns, changes, incidents, problems] = await Promise.all([
    admin.from('assets').select('id, asset_code, name, status, criticality').order('asset_code').limit(2000),
    admin.from('configuration_items').select('id, ci_code, name, environment, criticality, status').neq('status', 'Retired').order('ci_code').limit(2000),
    admin.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name').limit(1000),
    admin.from('vulnerability_patch_campaigns').select('id, campaign_code, name, status, target_date').in('status', ['Draft', 'Planned', 'In Progress']).order('target_date').limit(500),
    admin.from('change_requests').select('id, change_number, title, status').neq('status', 'ปฏิเสธ').order('request_date', { ascending: false }).limit(500),
    admin.from('incidents').select('id, incident_number, title, status').neq('status', 'ปิดเคส').order('report_date', { ascending: false }).limit(500),
    admin.from('problems').select('id, problem_number, title, status').neq('status', 'ปิด').order('created_at', { ascending: false }).limit(500),
  ]);
  const error = assets.error ?? configurationItems.error ?? users.error ?? campaigns.error ?? changes.error ?? incidents.error ?? problems.error;
  if (error) return c.json(fail(reqId, 'VULNERABILITY_OPTIONS_FAILED', 'โหลดตัวเลือกสำหรับ Vulnerability ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, {
    assets: assets.data ?? [], configurationItems: configurationItems.data ?? [], users: users.data ?? [], campaigns: campaigns.data ?? [],
    changes: changes.data ?? [], incidents: incidents.data ?? [], problems: problems.data ?? [],
  }));
});

vulnerabilitiesRoute.get('/campaigns', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('vulnerability_patch_campaigns')
    .select('*, owner:profiles!vulnerability_patch_campaigns_owner_id_fkey(id, full_name, email), vulnerability_findings(id, status, risk_priority)')
    .order('created_at', { ascending: false });
  if (error) return dbFailJson(c, 'VULNERABILITY_CAMPAIGNS_LIST_FAILED', error);
  return c.json(ok(reqId, data ?? []));
});

vulnerabilitiesRoute.post('/campaigns', requirePermission('vulnerability.manage'), zValidator('json', createPatchCampaignSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const ownerId = body.ownerId || actorId;
  const admin = createAdminClient(c.env);
  const invalidReference = await referenceError(admin, { ownerId });
  if (invalidReference) return c.json(fail(reqId, 'VULNERABILITY_CAMPAIGN_REFERENCE_INVALID', invalidReference), 400);
  const { data, error } = await admin.from('vulnerability_patch_campaigns').insert({
    campaign_code: generateCampaignCode(), name: body.name, objective: body.objective || null, owner_id: ownerId,
    target_date: body.targetDate || null, status: body.status, notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select('*, owner:profiles!vulnerability_patch_campaigns_owner_id_fkey(id, full_name, email)').single();
  if (error) return dbFailJson(c, 'VULNERABILITY_CAMPAIGN_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'vulnerability', targetTable: 'vulnerability_patch_campaigns', targetId: data.id, detail: { campaignCode: data.campaign_code }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

vulnerabilitiesRoute.patch('/campaigns/:id', requirePermission('vulnerability.manage'), zValidator('json', updatePatchCampaignSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  if (body.ownerId) {
    const invalidReference = await referenceError(admin, { ownerId: body.ownerId });
    if (invalidReference) return c.json(fail(reqId, 'VULNERABILITY_CAMPAIGN_REFERENCE_INVALID', invalidReference), 400);
  }
  const patch: Record<string, unknown> = { updated_by: actorId };
  const fields = { name: 'name', objective: 'objective', ownerId: 'owner_id', targetDate: 'target_date', status: 'status', notes: 'notes' } as const;
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : value;
  }
  const { data, error } = await admin.from('vulnerability_patch_campaigns').update(patch).eq('id', id).select('*, owner:profiles!vulnerability_patch_campaigns_owner_id_fkey(id, full_name, email)').maybeSingle();
  if (error) return dbFailJson(c, 'VULNERABILITY_CAMPAIGN_UPDATE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'VULNERABILITY_CAMPAIGN_NOT_FOUND', 'ไม่พบ Patch Campaign'), 404);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'vulnerability', targetTable: 'vulnerability_patch_campaigns', targetId: id, detail: body, requestId: reqId });
  return c.json(ok(reqId, data));
});

vulnerabilitiesRoute.post('/campaigns/:id/assign', requirePermission('vulnerability.manage'), zValidator('json', assignCampaignSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const campaignId = c.req.param('id');
  const { vulnerabilityIds } = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: campaign } = await admin.from('vulnerability_patch_campaigns').select('id').eq('id', campaignId).maybeSingle();
  if (!campaign) return c.json(fail(reqId, 'VULNERABILITY_CAMPAIGN_NOT_FOUND', 'ไม่พบ Patch Campaign'), 404);
  const clearResult = await admin.from('vulnerability_findings').update({ campaign_id: null, updated_by: actorId }).eq('campaign_id', campaignId);
  if (clearResult.error) return dbFailJson(c, 'VULNERABILITY_CAMPAIGN_ASSIGN_FAILED', clearResult.error);
  if (vulnerabilityIds.length) {
    const { error } = await admin.from('vulnerability_findings').update({ campaign_id: campaignId, updated_by: actorId }).in('id', vulnerabilityIds);
    if (error) return dbFailJson(c, 'VULNERABILITY_CAMPAIGN_ASSIGN_FAILED', error);
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'ASSIGN_CAMPAIGN', module: 'vulnerability', targetTable: 'vulnerability_patch_campaigns', targetId: campaignId, detail: { vulnerabilityIds }, requestId: reqId });
  return c.json(ok(reqId, { campaignId, assigned: vulnerabilityIds.length }));
});

vulnerabilitiesRoute.post('/import', requirePermission('vulnerability.manage'), zValidator('json', importScannerSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const ownerId = body.ownerId || actorId;
  const invalidOwner = await referenceError(admin, { ownerId });
  if (invalidOwner) return c.json(fail(reqId, 'VULNERABILITY_IMPORT_REFERENCE_INVALID', invalidOwner), 400);
  const [assetsResult, cisResult, slaRows] = await Promise.all([
    admin.from('assets').select('id, asset_code, criticality').limit(5000),
    admin.from('configuration_items').select('id, ci_code, criticality').limit(5000),
    admin.from('vulnerability_sla_policies').select('severity, resolution_days'),
  ]);
  if (assetsResult.error || cisResult.error || slaRows.error) return c.json(fail(reqId, 'VULNERABILITY_IMPORT_OPTIONS_FAILED', 'โหลดข้อมูลอ้างอิงสำหรับ Import ไม่สำเร็จ'), 400);
  const assetByCode = new Map((assetsResult.data ?? []).map((row) => [String(row.asset_code).toUpperCase(), row]));
  const ciByCode = new Map((cisResult.data ?? []).map((row) => [String(row.ci_code).toUpperCase(), row]));
  const slaBySeverity = new Map((slaRows.data ?? []).map((row) => [String(row.severity), Number(row.resolution_days)]));
  const result = { created: 0, updated: 0, skipped: 0, errors: [] as Array<{ row: number; message: string }> };

  for (const [index, row] of body.rows.entries()) {
    const asset = row.assetCode ? assetByCode.get(row.assetCode.toUpperCase()) : undefined;
    const ci = row.ciCode ? ciByCode.get(row.ciCode.toUpperCase()) : undefined;
    if (row.assetCode && !asset) { result.errors.push({ row: index + 1, message: `ไม่พบ Asset ${row.assetCode}` }); continue; }
    if (row.ciCode && !ci) { result.errors.push({ row: index + 1, message: `ไม่พบ CI ${row.ciCode}` }); continue; }
    const cve = normalizeCve(row.cve);
    const dedupKey = cve
      ? `${cve}|${asset?.id ?? ''}|${ci?.id ?? ''}`
      : row.externalId ? `SCANNER|${body.scannerName.toUpperCase()}|${row.externalId.trim()}` : null;
    if (!dedupKey) { result.skipped += 1; continue; }
    const { data: existing } = await admin.from('vulnerability_findings').select('id, detected_at').eq('dedup_key', dedupKey).maybeSingle();
    const context = ci ? { criticality: mapAssetCriticality(ci.criticality), source: 'CMDB' as const } : asset ? { criticality: mapAssetCriticality(asset.criticality), source: 'Asset' as const } : { criticality: 'Unknown' as const, source: 'Unknown' as const };
    const severity = severityFromCvss(row.cvss);
    const slaDays = slaBySeverity.get(severity) ?? DEFAULT_SLA_DAYS[severity];
    const risk = riskFields({ cvss: row.cvss, epssScore: row.epssScore, kevListed: row.kevListed, internetFacing: row.internetFacing }, context);
    const detectedAt = row.detectedAt || (existing?.detected_at ? String(existing.detected_at).slice(0, 10) : new Date().toISOString().slice(0, 10));
    const fields = {
      title: row.title || cve || row.externalId || `Scanner finding ${index + 1}`,
      asset_id: asset?.id ?? null, configuration_item_id: ci?.id ?? null, affected_system: row.affectedSystem || null,
      source: body.scannerName, scanner_name: body.scannerName, scanner_finding_id: row.externalId || null,
      last_seen_at: row.lastSeenAt || new Date().toISOString(), cve, cve_normalized: cve, dedup_key: dedupKey,
      cvss: row.cvss ?? null, epss_score: row.epssScore ?? null, epss_percentile: row.epssPercentile ?? null,
      kev_listed: row.kevListed ?? false, internet_facing: row.internetFacing ?? false, severity, detected_at: detectedAt,
      owner_id: ownerId, sla_policy_days: slaDays, sla_due_date: addDays(detectedAt, slaDays),
      ...risk, description: row.description || null, updated_by: actorId,
    };
    const write = existing
      ? await admin.from('vulnerability_findings').update(fields).eq('id', existing.id).select(VULNERABILITY_SELECT).single()
      : await admin.from('vulnerability_findings').insert({ ...fields, vulnerability_code: generateVulnerabilityCode(), status: 'เปิด', created_by: actorId }).select(VULNERABILITY_SELECT).single();
    if (write.error) { result.errors.push({ row: index + 1, message: 'บันทึกข้อมูลแถวนี้ไม่สำเร็จ' }); continue; }
    if (existing) result.updated += 1; else result.created += 1;
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'SCANNER_IMPORT', module: 'vulnerability', targetTable: 'vulnerability_findings', detail: { scannerName: body.scannerName, rows: body.rows.length, created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length }, requestId: reqId });
  return c.json(ok(reqId, result));
});

vulnerabilitiesRoute.get('/', zValidator('query', listVulnerabilitiesQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, severity, riskPriority, kevListed, ownerId, assetId } = c.req.valid('query');
  let query = c.get('supabase').from('vulnerability_findings').select(VULNERABILITY_SELECT, { count: 'exact' })
    .order('risk_score', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (search) {
    const safe = cleanSearch(search);
    const admin = createAdminClient(c.env);
    const [owners, assets, configurationItems] = await Promise.all([
      admin.from('profiles').select('id').or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`).limit(500),
      admin.from('assets').select('id').or(`asset_code.ilike.%${safe}%,name.ilike.%${safe}%`).limit(500),
      admin.from('configuration_items').select('id').or(`ci_code.ilike.%${safe}%,name.ilike.%${safe}%`).limit(500),
    ]);
    const searchParts = [`vulnerability_code.ilike.%${safe}%`, `title.ilike.%${safe}%`, `cve.ilike.%${safe}%`, `cve_normalized.ilike.%${safe}%`, `affected_system.ilike.%${safe}%`, `source.ilike.%${safe}%`, `scanner_name.ilike.%${safe}%`];
    if (owners.data?.length) searchParts.push(`owner_id.in.(${owners.data.map((row) => row.id).join(',')})`);
    if (assets.data?.length) searchParts.push(`asset_id.in.(${assets.data.map((row) => row.id).join(',')})`);
    if (configurationItems.data?.length) searchParts.push(`configuration_item_id.in.(${configurationItems.data.map((row) => row.id).join(',')})`);
    query = query.or(searchParts.join(','));
  }
  if (status) query = query.eq('status', status);
  if (severity) query = query.eq('severity', severity);
  if (riskPriority) query = query.eq('risk_priority', riskPriority);
  if (kevListed) query = query.eq('kev_listed', kevListed === 'true');
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (assetId) query = query.eq('asset_id', assetId);
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'VULNERABILITIES_LIST_FAILED', 'โหลดทะเบียนช่องโหว่ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

vulnerabilitiesRoute.get('/:id/retests', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const finding = await loadFinding(createAdminClient(c.env), id);
  if (!finding) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  const { data, error } = await c.get('supabase').from('vulnerability_retests').select('*, tester:profiles!vulnerability_retests_tested_by_fkey(id, full_name, email)').eq('vulnerability_id', id).order('attempt_no', { ascending: false });
  if (error) return dbFailJson(c, 'VULNERABILITY_RETESTS_LIST_FAILED', error);
  return c.json(ok(reqId, data ?? []));
});

vulnerabilitiesRoute.post('/:id/retests', requirePermission('vulnerability.manage'), zValidator('json', createVulnerabilityRetestSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const current = await loadFinding(admin, id);
  if (!current) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  const { data: last } = await admin.from('vulnerability_retests').select('attempt_no').eq('vulnerability_id', id).order('attempt_no', { ascending: false }).limit(1).maybeSingle();
  const attemptNo = Number((last as { attempt_no?: number } | null)?.attempt_no ?? 0) + 1;
  const { data, error } = await admin.from('vulnerability_retests').insert({
    vulnerability_id: id, attempt_no: attemptNo, status: body.status, tested_at: body.testedAt || new Date().toISOString(), tested_by: actorId,
    method: body.method, result: body.result || null, evidence_link: body.evidenceLink || null, next_retest_at: body.nextRetestAt || null,
    notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select('*, tester:profiles!vulnerability_retests_tested_by_fkey(id, full_name, email)').single();
  if (error) return dbFailJson(c, 'VULNERABILITY_RETEST_CREATE_FAILED', error);
  const nextStatus = body.status === 'passed' ? 'รอตรวจยืนยัน' : body.status === 'failed' ? 'กำลังแก้ไข' : current.status;
  if (nextStatus !== current.status && current.status !== 'ปิด') await admin.from('vulnerability_findings').update({ status: nextStatus, updated_by: actorId }).eq('id', id);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'RETEST', module: 'vulnerability', targetTable: 'vulnerability_retests', targetId: data.id, detail: { vulnerabilityId: id, attemptNo, status: body.status }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

vulnerabilitiesRoute.get('/:id/exceptions', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const { data, error } = await c.get('supabase').from('vulnerability_exception_approvals')
    .select('*, requester:profiles!vulnerability_exception_approvals_requested_by_fkey(id, full_name, email), exception_owner:profiles!vulnerability_exception_approvals_exception_owner_id_fkey(id, full_name, email), approver:profiles!vulnerability_exception_approvals_approved_by_fkey(id, full_name, email)')
    .eq('vulnerability_id', id).order('created_at', { ascending: false });
  if (error) return dbFailJson(c, 'VULNERABILITY_EXCEPTIONS_LIST_FAILED', error);
  return c.json(ok(reqId, data ?? []));
});

vulnerabilitiesRoute.post('/:id/exceptions', requirePermission('vulnerability.manage'), zValidator('json', requestExceptionSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const current = await loadFinding(admin, id);
  if (!current) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  if (body.exceptionOwnerId === current.owner_id) return c.json(fail(reqId, 'VULNERABILITY_EXCEPTION_SOD_VIOLATION', 'Exception Owner ต้องไม่ใช่ Vulnerability Owner เดียวกัน'), 403);
  if (body.expiresOn < new Date().toISOString().slice(0, 10)) return c.json(fail(reqId, 'VULNERABILITY_EXCEPTION_EXPIRED', 'วันหมดอายุข้อยกเว้นต้องอยู่ในอนาคต'), 409);
  const invalidReference = await referenceError(admin, { exceptionOwnerId: body.exceptionOwnerId });
  if (invalidReference) return c.json(fail(reqId, 'VULNERABILITY_EXCEPTION_REFERENCE_INVALID', invalidReference), 400);
  const { data: pending } = await admin.from('vulnerability_exception_approvals').select('id').eq('vulnerability_id', id).eq('status', 'pending').maybeSingle();
  if (pending) return c.json(fail(reqId, 'VULNERABILITY_EXCEPTION_PENDING', 'รายการนี้มีคำขอข้อยกเว้นที่รออนุมัติอยู่แล้ว'), 409);
  const { data, error } = await admin.from('vulnerability_exception_approvals').insert({
    vulnerability_id: id, requested_by: actorId, exception_owner_id: body.exceptionOwnerId, reason: body.reason,
    expires_on: body.expiresOn, evidence_link: body.evidenceLink || null, status: 'pending',
  }).select('*, requester:profiles!vulnerability_exception_approvals_requested_by_fkey(id, full_name, email), exception_owner:profiles!vulnerability_exception_approvals_exception_owner_id_fkey(id, full_name, email)').single();
  if (error) return dbFailJson(c, 'VULNERABILITY_EXCEPTION_REQUEST_FAILED', error);
  await admin.from('vulnerability_findings').update({ exception_reason: body.reason, exception_expiry: body.expiresOn, exception_owner_id: body.exceptionOwnerId, exception_requested_by: actorId, exception_status: 'pending', updated_by: actorId }).eq('id', id);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'REQUEST_EXCEPTION', module: 'vulnerability', targetTable: 'vulnerability_exception_approvals', targetId: data.id, detail: { vulnerabilityId: id, expiresOn: body.expiresOn, exceptionOwnerId: body.exceptionOwnerId }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

vulnerabilitiesRoute.post('/:id/exception-approval', requirePermission('risk.manage'), zValidator('json', decideExceptionSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const current = await loadFinding(admin, id);
  if (!current) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  const { data: request } = await admin.from('vulnerability_exception_approvals').select('*').eq('vulnerability_id', id).eq('status', 'pending').maybeSingle();
  if (!request) return c.json(fail(reqId, 'VULNERABILITY_EXCEPTION_NOT_PENDING', 'ไม่พบคำขอข้อยกเว้นที่รออนุมัติ'), 409);
  if ([current.owner_id, request.requested_by, request.exception_owner_id].includes(actorId)) return c.json(fail(reqId, 'VULNERABILITY_EXCEPTION_SOD_VIOLATION', 'ผู้ขอ, Vulnerability Owner และ Exception Owner ห้ามอนุมัติคำขอเดียวกัน'), 403);
  if (body.approve && request.expires_on < new Date().toISOString().slice(0, 10)) return c.json(fail(reqId, 'VULNERABILITY_EXCEPTION_EXPIRED', 'วันหมดอายุข้อยกเว้นต้องอยู่ในอนาคต'), 409);
  const now = new Date().toISOString();
  const status = body.approve ? 'approved' : 'rejected';
  const { data, error } = await admin.from('vulnerability_exception_approvals').update({ status, approved_by: actorId, approved_at: now, approval_comment: body.comment || null, evidence_link: body.evidenceLink || request.evidence_link, updated_at: now }).eq('id', request.id).select('*, approver:profiles!vulnerability_exception_approvals_approved_by_fkey(id, full_name, email)').single();
  if (error) return dbFailJson(c, 'VULNERABILITY_EXCEPTION_APPROVAL_FAILED', error);
  await admin.from('vulnerability_findings').update({ exception_status: status, exception_approved_by: actorId, exception_approved_at: now, updated_by: actorId }).eq('id', id);
  await Promise.all([
    sendNotification(c.env, { recipientId: request.requested_by, type: 'vulnerability_exception', title: `${current.vulnerability_code} ${body.approve ? 'ได้รับอนุมัติ' : 'ถูกปฏิเสธ'}ข้อยกเว้น`, body: current.title, link: '/vulnerabilities' }),
    writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: body.approve ? 'APPROVE_EXCEPTION' : 'REJECT_EXCEPTION', module: 'vulnerability', targetTable: 'vulnerability_exception_approvals', targetId: request.id, detail: { vulnerabilityId: id, comment: body.comment }, requestId: reqId }),
  ]);
  return c.json(ok(reqId, data));
});

vulnerabilitiesRoute.get('/:id', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('vulnerability_findings').select(VULNERABILITY_SELECT).eq('id', c.req.param('id')).maybeSingle();
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
  const invalidReference = await referenceError(admin, { ownerId, exceptionOwnerId: body.exceptionOwnerId || undefined, assetId: body.assetId || undefined, configurationItemId: body.configurationItemId || undefined, campaignId: body.campaignId || undefined, changeId: body.changeId || undefined, incidentId: body.incidentId || undefined, problemId: body.problemId || undefined });
  if (invalidReference) return c.json(fail(reqId, 'VULNERABILITY_REFERENCE_INVALID', invalidReference), 400);
  const context = await loadRiskContext(admin, body.assetId || null, body.configurationItemId || null);
  const slaDays = await loadSlaDays(admin, body.severity);
  const detectedAt = body.detectedAt || new Date().toISOString().slice(0, 10);
  const { data, error } = await admin.from('vulnerability_findings').insert({
    vulnerability_code: generateVulnerabilityCode(), title: body.title, asset_id: body.assetId || null, configuration_item_id: body.configurationItemId || null,
    affected_system: body.affectedSystem || null, source: body.source || null, scanner_name: body.scannerName || null, scanner_finding_id: body.scannerFindingId || null,
    last_seen_at: body.lastSeenAt || null, cve: normalizeCve(body.cve), cve_normalized: normalizeCve(body.cve), cvss: body.cvss ?? null,
    epss_score: body.epssScore ?? null, epss_percentile: body.epssPercentile ?? null, kev_listed: body.kevListed ?? false, internet_facing: body.internetFacing ?? false,
    severity: body.severity, description: body.description || null, detected_at: detectedAt, owner_id: ownerId, remediation_plan: body.remediationPlan || null,
    patch_reference: body.patchReference || null, due_date: body.dueDate || null, sla_policy_days: slaDays, sla_due_date: addDays(detectedAt, slaDays), status: body.status,
    exception_reason: body.exceptionReason || null, exception_expiry: body.exceptionExpiry || null, exception_owner_id: body.exceptionOwnerId || null,
    exception_status: body.exceptionExpiry ? 'pending' : 'not_requested', evidence_link: body.evidenceLink || null, campaign_id: body.campaignId || null,
    change_id: body.changeId || null, incident_id: body.incidentId || null, problem_id: body.problemId || null,
    ...riskFields({ cvss: body.cvss, epssScore: body.epssScore, kevListed: body.kevListed, internetFacing: body.internetFacing }, context),
    created_by: actorId, updated_by: actorId, notes: body.notes || null,
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
  const current = await loadFinding(admin, id);
  if (!current) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  const mergedDetectedAt = body.detectedAt ?? current.detected_at;
  const mergedDueDate = body.dueDate !== undefined ? body.dueDate : current.due_date;
  if (mergedDueDate && mergedDetectedAt && mergedDueDate < mergedDetectedAt) return c.json(fail(reqId, 'VALIDATION_ERROR', 'วันครบกำหนดต้องไม่ก่อนวันที่ตรวจพบ'), 400);
  const ownerId = body.ownerId ?? current.owner_id;
  const assetId = body.assetId !== undefined ? body.assetId || null : current.asset_id;
  const configurationItemId = body.configurationItemId !== undefined ? body.configurationItemId || null : current.configuration_item_id;
  const invalidReference = await referenceError(admin, { ownerId, exceptionOwnerId: body.exceptionOwnerId || undefined, assetId: assetId || undefined, configurationItemId: configurationItemId || undefined, campaignId: body.campaignId || undefined, changeId: body.changeId || undefined, incidentId: body.incidentId || undefined, problemId: body.problemId || undefined });
  if (invalidReference) return c.json(fail(reqId, 'VULNERABILITY_REFERENCE_INVALID', invalidReference), 400);
  const patch: Record<string, unknown> = { updated_by: actorId };
  const fields = {
    title: 'title', assetId: 'asset_id', configurationItemId: 'configuration_item_id', affectedSystem: 'affected_system', source: 'source', scannerName: 'scanner_name', scannerFindingId: 'scanner_finding_id', lastSeenAt: 'last_seen_at',
    cve: 'cve', cvss: 'cvss', epssScore: 'epss_score', epssPercentile: 'epss_percentile', kevListed: 'kev_listed', internetFacing: 'internet_facing', severity: 'severity', description: 'description', detectedAt: 'detected_at', ownerId: 'owner_id', remediationPlan: 'remediation_plan', patchReference: 'patch_reference', dueDate: 'due_date', status: 'status', exceptionReason: 'exception_reason', exceptionExpiry: 'exception_expiry', exceptionOwnerId: 'exception_owner_id', campaignId: 'campaign_id', changeId: 'change_id', incidentId: 'incident_id', problemId: 'problem_id', evidenceLink: 'evidence_link', notes: 'notes',
  } as const;
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : input === 'cve' && typeof value === 'string' ? normalizeCve(value) : value;
  }
  if (body.status !== undefined && body.status !== 'ปิด') { patch.verified_at = null; patch.verified_by = null; }
  if (body.status === 'รอตรวจยืนยัน' && !current.remediated_at) patch.remediated_at = new Date().toISOString();
  if (body.exceptionReason !== undefined || body.exceptionExpiry !== undefined || body.exceptionOwnerId !== undefined) patch.exception_status = body.exceptionExpiry ? 'pending' : 'not_requested';
  const selectedSeverity = body.severity ?? current.severity;
  const context = await loadRiskContext(admin, assetId, configurationItemId);
  patch.sla_policy_days = await loadSlaDays(admin, selectedSeverity);
  patch.sla_due_date = addDays(mergedDetectedAt, Number(patch.sla_policy_days));
  patch.last_seen_at = body.lastSeenAt ?? current.last_seen_at ?? null;
  Object.assign(patch, riskFields({ cvss: body.cvss ?? current.cvss, epssScore: body.epssScore ?? current.epss_score, kevListed: body.kevListed ?? current.kev_listed, internetFacing: body.internetFacing ?? current.internet_facing }, context));
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
  const current = await loadFinding(admin, id);
  if (!current) return c.json(fail(reqId, 'VULNERABILITY_NOT_FOUND', 'ไม่พบช่องโหว่นี้'), 404);
  const today = new Date().toISOString().slice(0, 10);
  if (current.exception_status === 'approved' && current.exception_expiry && current.exception_expiry < today) {
    await admin.from('vulnerability_findings').update({ exception_status: 'expired', updated_by: actorId }).eq('id', id);
    current.exception_status = 'expired';
  }
  if (status === 'ปิด' && current.status !== 'รอตรวจยืนยัน') return c.json(fail(reqId, 'VULNERABILITY_NOT_READY', 'ต้องเปลี่ยนสถานะเป็นรอตรวจยืนยันก่อนปิดรายการ'), 409);
  if (status === 'ปิด' && current.owner_id === actorId) return c.json(fail(reqId, 'VULNERABILITY_SOD_VIOLATION', 'Owner ผู้แก้ไขห้ามตรวจยืนยันปิดรายการของตนเอง'), 403);
  if (status === 'ปิด' && current.exception_status === 'pending') return c.json(fail(reqId, 'VULNERABILITY_EXCEPTION_NOT_APPROVED', 'ต้องให้คำขอข้อยกเว้นได้รับการตัดสินใจก่อน'), 409);
  if (status === 'ปิด') {
    const { data: latestRetest } = await admin.from('vulnerability_retests').select('status').eq('vulnerability_id', id).order('attempt_no', { ascending: false }).limit(1).maybeSingle();
    if (!latestRetest || latestRetest.status !== 'passed') return c.json(fail(reqId, 'VULNERABILITY_RETEST_REQUIRED', 'ต้องมี Retest ล่าสุดที่ผ่านและมีหลักฐานก่อนปิดรายการ'), 409);
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_by: actorId };
  if (evidenceLink !== undefined) patch.evidence_link = evidenceLink || null;
  if (status === 'รอตรวจยืนยัน') patch.remediated_at = current.remediated_at || now;
  if (status === 'ปิด') { patch.remediated_at = current.remediated_at || now; patch.verified_at = now; patch.verified_by = actorId; }
  else if (current.status === 'ปิด') { patch.verified_at = null; patch.verified_by = null; }
  if (current.sla_due_date && current.sla_due_date < now.slice(0, 10) && !current.sla_breached_at) patch.sla_breached_at = now;
  const { data, error } = await admin.from('vulnerability_findings').update(patch).eq('id', id).select(VULNERABILITY_SELECT).single();
  if (error) return dbFailJson(c, 'VULNERABILITY_STATUS_FAILED', error);
  if (status === 'ปิด' && current.asset_id) await admin.from('assets').update({ patch_status: 'อัปเดตแล้ว', patch_date: now.slice(0, 10), updated_by: actorId }).eq('id', current.asset_id);
  if (current.owner_id !== actorId) await sendNotification(c.env, { recipientId: current.owner_id, type: 'vulnerability_status', title: `${current.vulnerability_code} · ${status}`, body: current.title, link: '/vulnerabilities' });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: status === 'ปิด' ? 'VERIFY_CLOSE' : 'UPDATE_STATUS', module: 'vulnerability', targetTable: 'vulnerability_findings', targetId: id, detail: { status, evidenceLink: evidenceLink || null, retestRequired: status === 'ปิด' }, requestId: reqId });
  return c.json(ok(reqId, data));
});
