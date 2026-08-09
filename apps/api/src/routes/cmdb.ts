import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  createCiRelationshipSchema,
  createConfigurationItemSchema,
  listCiRelationshipsQuerySchema,
  listConfigurationItemsQuerySchema,
  setCiRelationshipStatusSchema,
  setConfigurationItemStatusSchema,
  updateCiRelationshipSchema,
  updateConfigurationItemSchema,
  verifyCiRelationshipSchema,
  verifyConfigurationItemSchema,
} from '../validators/cmdb';

/**
 * CMDB — สืบทอดจาก Module_CMDB.gs (ConfigurationItems + CIRelationships) ดู comment เต็มใน
 * migration 20260815100000_cmdb.sql — คนละแนวคิดกับ Asset (Module 8): CI คือทะเบียนโครงสร้าง IT
 * เชิงบริการ (server/database/application ฯลฯ) เชื่อมกับ Asset แบบ soft-link ทางเดียวผ่าน asset_id
 * เท่านั้น ไม่ใช่ตารางเดียวกัน Relationship Map แบบ SVG graph เลื่อนไปทำทีหลัง (presentation layer
 * ไม่กระทบ business logic) — ตารางความสัมพันธ์ + relationships-for-this-CI ในหน้า detail ทดแทนได้
 */
export const configurationItemsRoute = new Hono<AppEnv>();
configurationItemsRoute.use('*', requireAuth);

export const ciRelationshipsRoute = new Hono<AppEnv>();
ciRelationshipsRoute.use('*', requireAuth);

const CI_SELECT =
  'id, ci_code, name, ci_type, environment, business_service, owner_employee_id, administrator_employee_id, ' +
  'criticality, ip_address, url, version, vendor_name, contract_ref, vendor_id, contract_id, asset_id, cloud_ref, data_classification, ' +
  'rpo_hours, rto_hours, backup_required, backup_reference, location, status, status_reason, last_verified_at, ' +
  'last_verified_by, notes, created_at, updated_at, ' +
  'owner:employees!configuration_items_owner_employee_id_fkey(id, employee_code, first_name_th, last_name_th, nickname), ' +
  'administrator:employees!configuration_items_administrator_employee_id_fkey(id, employee_code, first_name_th, last_name_th, nickname), ' +
  'asset:assets(id, asset_code, name), vendor:vendors(id, vendor_code, name, status), ' +
  'contract:contracts(id, contract_number, name, status, end_date)';

const REL_SELECT =
  'id, source_type, source_id, target_type, target_id, relationship_type, direction, impact_level, ' +
  'description, status, status_reason, valid_from, valid_until, last_verified_at, last_verified_by, notes, created_at, updated_at';

const ASSET_RETIRED_STATUSES = ['จำหน่าย/เลิกใช้', 'สูญหาย'];
const CYCLE_CHECK_TYPES = ['DEPENDS_ON', 'RUNS_ON'];
const REVERSE_DUP_CHECK_TYPES = ['CONNECTS_TO', 'LINKED_TO'];

function generateCiCode(): string {
  const now = new Date();
  const datePart = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `CI-GEN-${datePart}${rand}`;
}

async function loadCiOr404(supabase: SupabaseClient, id: string) {
  return supabase.from('configuration_items').select('*').eq('id', id).maybeSingle();
}

async function loadRelOr404(supabase: SupabaseClient, id: string) {
  return supabase.from('ci_relationships').select('*').eq('id', id).maybeSingle();
}

interface NodeStatus {
  exists: boolean;
  retired: boolean;
  name?: string;
  ciType?: string;
}

/** ตรวจการมีอยู่จริง + สถานะปลดระวางของ node — ทำได้จริงสำหรับ CI/Asset/Vendor/Contract/Incident/Change ส่วนอีก 2 ประเภท
 * (Cloud/Backup) ยังไม่มีตารางจริงในระบบใหม่ จึงเชื่อว่ามีอยู่จริงไปก่อน
 * (จะ validate ได้เมื่อโมดูลที่เกี่ยวข้องถูกย้ายตามคิว roadmap) — เดิม legacy validate ได้ครบ 8 ประเภทเพราะ
 * sheet ทั้งหมดมีอยู่แล้วตอนนั้น ไม่ใช่ข้อจำกัดถาวร แค่ลำดับการย้ายโมดูลยังไปไม่ถึง */
async function loadNodeStatus(supabase: SupabaseClient, type: string, id: string): Promise<NodeStatus> {
  if (type === 'CI') {
    const { data } = await supabase.from('configuration_items').select('id, name, status, ci_type').eq('id', id).maybeSingle();
    if (!data) return { exists: false, retired: false };
    return { exists: true, retired: data.status === 'Retired', name: data.name, ciType: data.ci_type };
  }
  if (type === 'Asset') {
    const { data } = await supabase.from('assets').select('id, name, status').eq('id', id).maybeSingle();
    if (!data) return { exists: false, retired: false };
    return { exists: true, retired: ASSET_RETIRED_STATUSES.includes(data.status), name: data.name };
  }
  if (type === 'Incident') {
    const { data } = await supabase.from('incidents').select('id, incident_number, title, status').eq('id', id).maybeSingle();
    if (!data) return { exists: false, retired: false };
    return { exists: true, retired: false, name: `${data.incident_number} — ${data.title}` };
  }
  if (type === 'Change') {
    const { data } = await supabase.from('change_requests').select('id, change_number, title, status').eq('id', id).maybeSingle();
    if (!data) return { exists: false, retired: false };
    return { exists: true, retired: false, name: `${data.change_number} — ${data.title}` };
  }
  if (type === 'Vendor') {
    const { data } = await supabase.from('vendors').select('id, name, status').eq('id', id).maybeSingle();
    if (!data) return { exists: false, retired: false };
    return { exists: true, retired: data.status === 'Inactive', name: data.name };
  }
  if (type === 'Contract') {
    const { data } = await supabase.from('contracts').select('id, contract_number, name, status').eq('id', id).maybeSingle();
    if (!data) return { exists: false, retired: false };
    return { exists: true, retired: ['Expired', 'Terminated', 'Renewed'].includes(data.status), name: `${data.contract_number} — ${data.name}` };
  }
  return { exists: true, retired: false };
}

interface RelLikeRow {
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  [key: string]: unknown;
}

/** รูปร่างแถวจริงของ ci_relationships ตาม REL_SELECT — supabase-js parse .select() string ตัวแปร (ไม่ใช่
 * literal) ไม่ได้ จึง infer เป็น GenericStringError ต้อง cast ผ่าน unknown เสมอ (บันทึกไว้ใน Module 8 แล้ว) */
interface CiRelationshipRow extends RelLikeRow {
  id: string;
  relationship_type: string;
  direction: string;
  impact_level: string;
  description: string | null;
  status: string;
  status_reason: string | null;
  valid_from: string | null;
  valid_until: string | null;
  last_verified_at: string | null;
  last_verified_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** เติมชื่อ/สถานะของ source/target (batch query ทีเดียวต่อประเภท ไม่ query ทีละแถว) — แทนที่ SourceName/
 * TargetName cache column เดิม (denormalized, เอกสารเดิมเองระบุว่า "ไม่ใช่ความจริงหลัก") ด้วยการ query สด */
async function enrichRelationshipNodes<T extends RelLikeRow>(supabase: SupabaseClient, rows: T[]) {
  const ciIds = new Set<string>();
  const assetIds = new Set<string>();
  const incidentIds = new Set<string>();
  const changeIds = new Set<string>();
  const vendorIds = new Set<string>();
  const contractIds = new Set<string>();
  for (const r of rows) {
    if (r.source_type === 'CI') ciIds.add(r.source_id);
    if (r.source_type === 'Asset') assetIds.add(r.source_id);
    if (r.source_type === 'Incident') incidentIds.add(r.source_id);
    if (r.source_type === 'Change') changeIds.add(r.source_id);
    if (r.source_type === 'Vendor') vendorIds.add(r.source_id);
    if (r.source_type === 'Contract') contractIds.add(r.source_id);
    if (r.target_type === 'CI') ciIds.add(r.target_id);
    if (r.target_type === 'Asset') assetIds.add(r.target_id);
    if (r.target_type === 'Incident') incidentIds.add(r.target_id);
    if (r.target_type === 'Change') changeIds.add(r.target_id);
    if (r.target_type === 'Vendor') vendorIds.add(r.target_id);
    if (r.target_type === 'Contract') contractIds.add(r.target_id);
  }
  const [{ data: cis }, { data: assets }, { data: incidents }, { data: changes }, { data: vendors }, { data: contracts }] = await Promise.all([
    ciIds.size ? supabase.from('configuration_items').select('id, name, status').in('id', [...ciIds]) : Promise.resolve({ data: [] as { id: string; name: string; status: string }[] }),
    assetIds.size ? supabase.from('assets').select('id, name, status').in('id', [...assetIds]) : Promise.resolve({ data: [] as { id: string; name: string; status: string }[] }),
    incidentIds.size ? supabase.from('incidents').select('id, incident_number, title, status').in('id', [...incidentIds]) : Promise.resolve({ data: [] as { id: string; incident_number: string; title: string; status: string }[] }),
    changeIds.size ? supabase.from('change_requests').select('id, change_number, title, status').in('id', [...changeIds]) : Promise.resolve({ data: [] as { id: string; change_number: string; title: string; status: string }[] }),
    vendorIds.size ? supabase.from('vendors').select('id, name, status').in('id', [...vendorIds]) : Promise.resolve({ data: [] as { id: string; name: string; status: string }[] }),
    contractIds.size ? supabase.from('contracts').select('id, contract_number, name, status').in('id', [...contractIds]) : Promise.resolve({ data: [] as { id: string; contract_number: string; name: string; status: string }[] }),
  ]);
  const ciMap = new Map((cis ?? []).map((row) => [row.id, row]));
  const assetMap = new Map((assets ?? []).map((row) => [row.id, row]));
  const incidentMap = new Map((incidents ?? []).map((row) => [row.id, { name: `${row.incident_number} — ${row.title}`, status: row.status }]));
  const changeMap = new Map((changes ?? []).map((row) => [row.id, { name: `${row.change_number} — ${row.title}`, status: row.status }]));
  const vendorMap = new Map((vendors ?? []).map((row) => [row.id, row]));
  const contractMap = new Map((contracts ?? []).map((row) => [row.id, { name: `${row.contract_number} — ${row.name}`, status: row.status }]));
  const resolve = (type: string, id: string) => (type === 'CI' ? ciMap.get(id) : type === 'Asset' ? assetMap.get(id) : type === 'Incident' ? incidentMap.get(id) : type === 'Change' ? changeMap.get(id) : type === 'Vendor' ? vendorMap.get(id) : type === 'Contract' ? contractMap.get(id) : undefined);

  return rows.map((r) => {
    const source = resolve(r.source_type, r.source_id);
    const target = resolve(r.target_type, r.target_id);
    return {
      ...r,
      sourceName: source?.name ?? null,
      sourceStatus: source?.status ?? null,
      targetName: target?.name ?? null,
      targetStatus: target?.status ?? null,
    };
  });
}

/** DFS ว่าเพิ่ม edge source->target แล้วจะเกิด cycle หรือไม่ (เฉพาะ DEPENDS_ON/RUNS_ON ที่ Active) —
 * ตรงกับ cmdbAssertNoDependencyCycle_ เดิม ย้ายมาเป็น business logic ชั้น API เหมือนเดิม (ไม่ใช่ DB trigger) */
async function wouldCreateCycle(supabase: SupabaseClient, sourceType: string, sourceId: string, targetType: string, targetId: string): Promise<boolean> {
  const { data: edges } = await supabase
    .from('ci_relationships')
    .select('source_type, source_id, target_type, target_id')
    .in('relationship_type', CYCLE_CHECK_TYPES)
    .eq('status', 'Active');

  const adjacency = new Map<string, string[]>();
  for (const e of edges ?? []) {
    const from = `${e.source_type}:${e.source_id}`;
    const to = `${e.target_type}:${e.target_id}`;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(to);
  }

  const goalKey = `${sourceType}:${sourceId}`;
  const visited = new Set<string>();
  const stack = [`${targetType}:${targetId}`];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === goalKey) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of adjacency.get(node) ?? []) stack.push(next);
  }
  return false;
}

// ===== Configuration Items =====

/** dropdown แบบเบา ต้องอยู่ก่อน '/:id' */
configurationItemsRoute.get('/options', requirePermission('cmdb.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase.from('configuration_items').select('id, ci_code, name, ci_type, status').order('ci_code', { ascending: true }).limit(2000);
  if (error) return c.json(fail(reqId, 'CMDB_CI_OPTIONS_FAILED', 'ดึงรายการ CI ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data));
});

/** ภาพรวมคุณภาพข้อมูล (Data Quality) — นับพื้นฐานล้วน ไม่ใช่ analytics/chart ดู comment เรื่องขอบเขตใน
 * migration — ต้องอยู่ก่อน '/:id' */
configurationItemsRoute.get('/data-quality', requirePermission('cmdb.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');

  const [{ data: unverified }, { data: highCriticality }, { data: activeRels }] = await Promise.all([
    supabase.from('configuration_items').select('id, ci_code, name, status').is('last_verified_at', null).neq('status', 'Retired').order('created_at', { ascending: false }).limit(50),
    supabase
      .from('configuration_items')
      .select('id, ci_code, name, criticality, owner_employee_id, administrator_employee_id, rpo_hours, rto_hours, backup_required, backup_reference')
      .in('criticality', ['High', 'Critical'])
      .neq('status', 'Retired')
      .limit(200),
    supabase.from('ci_relationships').select(REL_SELECT).eq('status', 'Active').limit(500),
  ]);
  const activeRelRows = (activeRels ?? []) as unknown as CiRelationshipRow[];

  const incompleteRows = (highCriticality ?? []).filter(
    (row) => !row.owner_employee_id || !row.administrator_employee_id || row.rpo_hours === null || row.rto_hours === null || (row.backup_required && !row.backup_reference),
  );

  const today = new Date().toISOString().slice(0, 10);
  const expired = activeRelRows.filter((r) => r.valid_until && r.valid_until < today);

  const enrichedRels = await enrichRelationshipNodes(createAdminClient(c.env), activeRelRows);
  const orphans = enrichedRels.filter((r) => {
    const sourceCheckable = ['CI', 'Asset', 'Vendor', 'Contract', 'Incident', 'Change'].includes(r.source_type);
    const targetCheckable = ['CI', 'Asset', 'Vendor', 'Contract', 'Incident', 'Change'].includes(r.target_type);
    return (sourceCheckable && !r.sourceName) || (targetCheckable && !r.targetName);
  });

  return c.json(
    ok(reqId, {
      unverifiedCount: unverified?.length ?? 0,
      unverifiedSample: unverified ?? [],
      incompleteCount: incompleteRows.length,
      incompleteSample: incompleteRows.slice(0, 12),
      orphanCount: orphans.length,
      orphanSample: orphans.slice(0, 12),
      expiredCount: expired.length,
      expiredSample: expired.slice(0, 12),
    }),
  );
});

configurationItemsRoute.get(
  '/',
  requirePermission('cmdb.view'),
  zValidator('query', listConfigurationItemsQuerySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const { page, pageSize, search, ciType, environment, criticality, status } = c.req.valid('query');

    let query = supabase.from('configuration_items').select(CI_SELECT, { count: 'exact' }).order('ci_code', { ascending: true }).range(...paginationRange(page, pageSize));
    if (ciType) query = query.eq('ci_type', ciType);
    if (environment) query = query.eq('environment', environment);
    if (criticality) query = query.eq('criticality', criticality);
    if (status) query = query.eq('status', status);
    if (search) query = query.or(`name.ilike.%${search}%,ci_code.ilike.%${search}%,ip_address.ilike.%${search}%`);

    const { data, count, error } = await query;
    if (error) return c.json(fail(reqId, 'CMDB_CI_LIST_FAILED', 'ดึงรายการ CI ไม่สำเร็จ'), 400);
    return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
  },
);

configurationItemsRoute.get('/:id', requirePermission('cmdb.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data: ci, error } = await supabase.from('configuration_items').select(CI_SELECT).eq('id', id).maybeSingle();
  if (error) return c.json(fail(reqId, 'CMDB_CI_LOAD_FAILED', 'ดึงข้อมูล CI ไม่สำเร็จ'), 400);
  if (!ci) return c.json(fail(reqId, 'CMDB_CI_NOT_FOUND', 'ไม่พบ CI นี้'), 404);

  // แยก query source/target แทน .or() string-building (บทเรียนจาก Module 8: PostgREST list-filter
  // string เปราะบาง — ทำ logic exclusion/merge ฝั่ง JS แทน)
  const [{ data: asSource }, { data: asTarget }] = await Promise.all([
    supabase.from('ci_relationships').select(REL_SELECT).eq('source_type', 'CI').eq('source_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('ci_relationships').select(REL_SELECT).eq('target_type', 'CI').eq('target_id', id).order('created_at', { ascending: false }).limit(200),
  ]);
  const relRows = [...(asSource ?? []), ...(asTarget ?? [])] as unknown as CiRelationshipRow[];
  const relationships = await enrichRelationshipNodes(createAdminClient(c.env), relRows);

  return c.json(ok(reqId, { ci, relationships }));
});

configurationItemsRoute.post('/', requirePermission('cmdb.manage'), zValidator('json', createConfigurationItemSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const ciCode = generateCiCode();
  const { data, error } = await supabase
    .from('configuration_items')
    .insert({
      ci_code: ciCode,
      name: body.name,
      ci_type: body.ciType,
      environment: body.environment,
      business_service: body.businessService || null,
      owner_employee_id: body.ownerEmployeeId,
      administrator_employee_id: body.administratorEmployeeId,
      criticality: body.criticality ?? 'Medium',
      ip_address: body.ipAddress || null,
      url: body.url || null,
      version: body.version || null,
      vendor_name: body.vendorName || null,
      contract_ref: body.contractRef || null,
      vendor_id: body.vendorId || null,
      contract_id: body.contractId || null,
      asset_id: body.assetId || null,
      cloud_ref: body.cloudRef || null,
      data_classification: body.dataClassification ?? 'ไม่ลับ',
      rpo_hours: body.rpoHours ?? null,
      rto_hours: body.rtoHours ?? null,
      backup_required: body.backupRequired ?? false,
      backup_reference: body.backupReference || null,
      location: body.location || null,
      status: body.status ?? 'Draft',
      notes: body.notes || null,
      created_by: actorId,
    })
    .select(CI_SELECT)
    .single();

  if (error) return c.json(fail(reqId, 'CMDB_CI_CREATE_FAILED', error.message), 400);
  const createdId = (data as unknown as { id: string }).id;

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'cmdb',
    targetTable: 'configuration_items',
    targetId: createdId,
    detail: { name: body.name, ciCode },
    requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

configurationItemsRoute.patch('/:id', requirePermission('cmdb.manage'), zValidator('json', updateConfigurationItemSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const { data: current, error: currentError } = await loadCiOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'CMDB_CI_LOAD_FAILED', 'ดึงข้อมูล CI ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'CMDB_CI_NOT_FOUND', 'ไม่พบ CI นี้'), 404);

  // แก้ไขข้อมูลสาระสำคัญใด ๆ ล้างสถานะ verify ทิ้งเสมอ (ตรงกับ legacy rule #12 — ส่วนสถานะ ใช้ /:id/status
  // แยกต่างหาก ไม่ผ่าน endpoint นี้ จึงไม่ล้าง verify ตาม legacy ที่ "status-only updates do not")
  const patch: Record<string, unknown> = { updated_by: actorId, last_verified_at: null, last_verified_by: null };
  if (body.name !== undefined) patch.name = body.name;
  if (body.ciType !== undefined) patch.ci_type = body.ciType;
  if (body.environment !== undefined) patch.environment = body.environment;
  if (body.businessService !== undefined) patch.business_service = body.businessService || null;
  if (body.ownerEmployeeId !== undefined) patch.owner_employee_id = body.ownerEmployeeId;
  if (body.administratorEmployeeId !== undefined) patch.administrator_employee_id = body.administratorEmployeeId;
  if (body.criticality !== undefined) patch.criticality = body.criticality;
  if (body.ipAddress !== undefined) patch.ip_address = body.ipAddress || null;
  if (body.url !== undefined) patch.url = body.url || null;
  if (body.version !== undefined) patch.version = body.version || null;
  if (body.vendorName !== undefined) patch.vendor_name = body.vendorName || null;
  if (body.contractRef !== undefined) patch.contract_ref = body.contractRef || null;
  if (body.vendorId !== undefined) patch.vendor_id = body.vendorId || null;
  if (body.contractId !== undefined) patch.contract_id = body.contractId || null;
  if (body.assetId !== undefined) patch.asset_id = body.assetId || null;
  if (body.cloudRef !== undefined) patch.cloud_ref = body.cloudRef || null;
  if (body.dataClassification !== undefined) patch.data_classification = body.dataClassification;
  if (body.rpoHours !== undefined) patch.rpo_hours = body.rpoHours;
  if (body.rtoHours !== undefined) patch.rto_hours = body.rtoHours;
  if (body.backupRequired !== undefined) patch.backup_required = body.backupRequired;
  if (body.backupReference !== undefined) patch.backup_reference = body.backupReference || null;
  if (body.location !== undefined) patch.location = body.location || null;
  if (body.notes !== undefined) patch.notes = body.notes || null;

  const { data, error } = await supabase.from('configuration_items').update(patch).eq('id', id).select(CI_SELECT).single();
  if (error) return c.json(fail(reqId, 'CMDB_CI_UPDATE_FAILED', error.message), 400);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'cmdb',
    targetTable: 'configuration_items',
    targetId: id,
    detail: body,
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});

/** เปลี่ยนสถานะ CI — ห้าม Retire ถ้ายังมีความสัมพันธ์ Active อ้างถึงอยู่ (legacy rule #6) */
configurationItemsRoute.post('/:id/status', requirePermission('cmdb.manage'), zValidator('json', setConfigurationItemStatusSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { status, reason } = c.req.valid('json');

  const { data: current, error: currentError } = await loadCiOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'CMDB_CI_LOAD_FAILED', 'ดึงข้อมูล CI ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'CMDB_CI_NOT_FOUND', 'ไม่พบ CI นี้'), 404);

  if (status === 'Retired') {
    const [{ data: asSource }, { data: asTarget }] = await Promise.all([
      supabase.from('ci_relationships').select('id').eq('source_type', 'CI').eq('source_id', id).eq('status', 'Active').limit(1),
      supabase.from('ci_relationships').select('id').eq('target_type', 'CI').eq('target_id', id).eq('status', 'Active').limit(1),
    ]);
    if ((asSource?.length ?? 0) > 0 || (asTarget?.length ?? 0) > 0) {
      return c.json(fail(reqId, 'CMDB_CI_HAS_ACTIVE_RELATIONSHIPS', 'ไม่สามารถ Retire ได้ เนื่องจากยังมีความสัมพันธ์ที่ Active อยู่ กรุณาปิดความสัมพันธ์ก่อน'), 400);
    }
  }

  const { data, error } = await supabase
    .from('configuration_items')
    .update({ status, status_reason: reason ?? null, updated_by: actorId })
    .eq('id', id)
    .select(CI_SELECT)
    .single();
  if (error) return c.json(fail(reqId, 'CMDB_CI_STATUS_FAILED', error.message), 400);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE_STATUS',
    module: 'cmdb',
    targetTable: 'configuration_items',
    targetId: id,
    detail: { status, reason },
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});

configurationItemsRoute.post('/:id/verify', requirePermission('cmdb.manage'), zValidator('json', verifyConfigurationItemSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { note } = c.req.valid('json');

  const { data: current, error: currentError } = await loadCiOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'CMDB_CI_LOAD_FAILED', 'ดึงข้อมูล CI ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'CMDB_CI_NOT_FOUND', 'ไม่พบ CI นี้'), 404);

  const { data, error } = await supabase
    .from('configuration_items')
    .update({
      last_verified_at: new Date().toISOString(),
      last_verified_by: actorId,
      notes: note ? `${current.notes ? `${current.notes}\n` : ''}[Verify] ${note}` : current.notes,
      updated_by: actorId,
    })
    .eq('id', id)
    .select(CI_SELECT)
    .single();
  if (error) return c.json(fail(reqId, 'CMDB_CI_VERIFY_FAILED', error.message), 400);

  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'VERIFY', module: 'cmdb', targetTable: 'configuration_items', targetId: id, requestId: reqId });

  return c.json(ok(reqId, data));
});

// ===== CI Relationships =====

/** cross-module node catalog สำหรับฟอร์มสร้างความสัมพันธ์ — เปิด CI/Asset/Vendor/Contract/Incident/Change ตามโมดูลที่มีตารางจริง */
ciRelationshipsRoute.get('/node-options', requirePermission('cmdb.view'), async (c) => {
  const supabase = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const [{ data: cis }, { data: assets }, { data: incidents }, { data: changes }, { data: vendors }, { data: contracts }] = await Promise.all([
    supabase.from('configuration_items').select('id, ci_code, name, status').order('name', { ascending: true }).limit(2000),
    supabase.from('assets').select('id, asset_code, name, status').order('name', { ascending: true }).limit(2000),
    supabase.from('incidents').select('id, incident_number, title, status').order('report_date', { ascending: false }).limit(2000),
    supabase.from('change_requests').select('id, change_number, title, status').order('request_date', { ascending: false }).limit(2000),
    supabase.from('vendors').select('id, vendor_code, name, status').order('name').limit(2000),
    supabase.from('contracts').select('id, contract_number, name, status').order('contract_number').limit(2000),
  ]);
  const nodes = [
    ...(cis ?? []).map((row) => ({ type: 'CI' as const, id: row.id, label: `${row.ci_code} — ${row.name}`, status: row.status })),
    ...(assets ?? []).map((row) => ({ type: 'Asset' as const, id: row.id, label: `${row.asset_code} — ${row.name}`, status: row.status })),
    ...(incidents ?? []).map((row) => ({ type: 'Incident' as const, id: row.id, label: `${row.incident_number} — ${row.title}`, status: row.status })),
    ...(changes ?? []).map((row) => ({ type: 'Change' as const, id: row.id, label: `${row.change_number} — ${row.title}`, status: row.status })),
    ...(vendors ?? []).map((row) => ({ type: 'Vendor' as const, id: row.id, label: `${row.vendor_code} — ${row.name}`, status: row.status })),
    ...(contracts ?? []).map((row) => ({ type: 'Contract' as const, id: row.id, label: `${row.contract_number} — ${row.name}`, status: row.status })),
  ];
  return c.json(ok(reqId, nodes));
});

ciRelationshipsRoute.get('/', requirePermission('cmdb.view'), zValidator('query', listCiRelationshipsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, relationshipType, status } = c.req.valid('query');

  let query = supabase.from('ci_relationships').select(REL_SELECT, { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (relationshipType) query = query.eq('relationship_type', relationshipType);
  if (status) query = query.eq('status', status);

  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'CMDB_REL_LIST_FAILED', 'ดึงรายการความสัมพันธ์ไม่สำเร็จ'), 400);
  const enriched = await enrichRelationshipNodes(createAdminClient(c.env), (data ?? []) as unknown as CiRelationshipRow[]);
  return c.json(ok(reqId, toPaginatedData(enriched, count, page, pageSize)));
});

ciRelationshipsRoute.post('/', requirePermission('cmdb.manage'), zValidator('json', createCiRelationshipSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const direction = body.direction ?? 'Forward';
  const relationshipType = body.relationshipType;

  const admin = createAdminClient(c.env);
  const [sourceNode, targetNode] = await Promise.all([
    loadNodeStatus(admin, body.sourceType, body.sourceId),
    loadNodeStatus(admin, body.targetType, body.targetId),
  ]);
  if (!sourceNode.exists) return c.json(fail(reqId, 'CMDB_REL_SOURCE_NOT_FOUND', 'ไม่พบ node ต้นทางที่เลือก'), 400);
  if (!targetNode.exists) return c.json(fail(reqId, 'CMDB_REL_TARGET_NOT_FOUND', 'ไม่พบ node ปลายทางที่เลือก'), 400);
  if (sourceNode.retired || targetNode.retired) {
    return c.json(fail(reqId, 'CMDB_REL_ENDPOINT_RETIRED', 'ไม่สามารถสร้างความสัมพันธ์ Active ได้ เนื่องจาก node ต้นทาง/ปลายทางถูกปลดระวางแล้ว'), 400);
  }
  if (relationshipType === 'BACKED_UP_BY' && !(body.targetType === 'Backup' || (body.targetType === 'CI' && targetNode.ciType === 'Backup Job'))) {
    return c.json(fail(reqId, 'CMDB_REL_INVALID_TARGET_TYPE', 'BACKED_UP_BY ต้องชี้ไปที่ Backup หรือ CI ประเภท Backup Job เท่านั้น'), 400);
  }
  if (relationshipType === 'SUPPLIED_BY' && body.targetType !== 'Vendor') {
    return c.json(fail(reqId, 'CMDB_REL_INVALID_TARGET_TYPE', 'SUPPLIED_BY ต้องชี้ไปที่ Vendor เท่านั้น'), 400);
  }
  if (relationshipType === 'COVERED_BY_CONTRACT' && body.targetType !== 'Contract') {
    return c.json(fail(reqId, 'CMDB_REL_INVALID_TARGET_TYPE', 'COVERED_BY_CONTRACT ต้องชี้ไปที่ Contract เท่านั้น'), 400);
  }

  if (direction === 'Bidirectional' || REVERSE_DUP_CHECK_TYPES.includes(relationshipType)) {
    const { data: reverseDup } = await supabase
      .from('ci_relationships')
      .select('id')
      .eq('source_type', body.targetType)
      .eq('source_id', body.targetId)
      .eq('target_type', body.sourceType)
      .eq('target_id', body.sourceId)
      .eq('relationship_type', relationshipType)
      .maybeSingle();
    if (reverseDup) return c.json(fail(reqId, 'CMDB_REL_DUPLICATE', 'มีความสัมพันธ์นี้อยู่แล้ว (ทิศตรงข้าม)'), 400);
  }

  if (CYCLE_CHECK_TYPES.includes(relationshipType)) {
    const cyclic = await wouldCreateCycle(supabase, body.sourceType, body.sourceId, body.targetType, body.targetId);
    if (cyclic) return c.json(fail(reqId, 'CMDB_REL_CYCLE_DETECTED', 'ไม่สามารถสร้างความสัมพันธ์นี้ได้ เนื่องจากจะทำให้เกิดการพึ่งพาแบบวนลูป (cycle)'), 400);
  }

  const { data, error } = await supabase
    .from('ci_relationships')
    .insert({
      source_type: body.sourceType,
      source_id: body.sourceId,
      target_type: body.targetType,
      target_id: body.targetId,
      relationship_type: relationshipType,
      direction,
      impact_level: body.impactLevel ?? 'Medium',
      description: body.description || null,
      valid_from: body.validFrom || null,
      valid_until: body.validUntil || null,
      notes: body.notes || null,
      created_by: actorId,
    })
    .select(REL_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') return c.json(fail(reqId, 'CMDB_REL_DUPLICATE', 'มีความสัมพันธ์นี้อยู่แล้ว'), 400);
    return c.json(fail(reqId, 'CMDB_REL_CREATE_FAILED', error.message), 400);
  }
  const createdId = (data as unknown as { id: string }).id;

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'cmdb',
    targetTable: 'ci_relationships',
    targetId: createdId,
    detail: { sourceType: body.sourceType, sourceId: body.sourceId, targetType: body.targetType, targetId: body.targetId, relationshipType },
    requestId: reqId,
  });

  const [enriched] = await enrichRelationshipNodes(admin, [data as unknown as RelLikeRow]);
  return c.json(ok(reqId, enriched), 201);
});

ciRelationshipsRoute.patch('/:id', requirePermission('cmdb.manage'), zValidator('json', updateCiRelationshipSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const { data: current, error: currentError } = await loadRelOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'CMDB_REL_LOAD_FAILED', 'ดึงข้อมูลความสัมพันธ์ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'CMDB_REL_NOT_FOUND', 'ไม่พบความสัมพันธ์นี้'), 404);

  if (body.validFrom !== undefined && body.validUntil !== undefined && body.validFrom && body.validUntil && body.validUntil < body.validFrom) {
    return c.json(fail(reqId, 'CMDB_REL_INVALID_RANGE', 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น'), 400);
  }

  const patch: Record<string, unknown> = { updated_by: actorId, last_verified_at: null, last_verified_by: null };
  if (body.relationshipType !== undefined) patch.relationship_type = body.relationshipType;
  if (body.direction !== undefined) patch.direction = body.direction;
  if (body.impactLevel !== undefined) patch.impact_level = body.impactLevel;
  if (body.description !== undefined) patch.description = body.description || null;
  if (body.validFrom !== undefined) patch.valid_from = body.validFrom || null;
  if (body.validUntil !== undefined) patch.valid_until = body.validUntil || null;
  if (body.notes !== undefined) patch.notes = body.notes || null;

  const { data, error } = await supabase.from('ci_relationships').update(patch).eq('id', id).select(REL_SELECT).single();
  if (error) return c.json(fail(reqId, 'CMDB_REL_UPDATE_FAILED', error.message), 400);

  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'cmdb', targetTable: 'ci_relationships', targetId: id, detail: body, requestId: reqId });

  const [enriched] = await enrichRelationshipNodes(createAdminClient(c.env), [data as unknown as RelLikeRow]);
  return c.json(ok(reqId, enriched));
});

ciRelationshipsRoute.post('/:id/status', requirePermission('cmdb.manage'), zValidator('json', setCiRelationshipStatusSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { status, reason } = c.req.valid('json');

  const { data: current, error: currentError } = await loadRelOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'CMDB_REL_LOAD_FAILED', 'ดึงข้อมูลความสัมพันธ์ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'CMDB_REL_NOT_FOUND', 'ไม่พบความสัมพันธ์นี้'), 404);

  if (status === 'Active' && current.status !== 'Active') {
    const admin = createAdminClient(c.env);
    const [sourceNode, targetNode] = await Promise.all([
      loadNodeStatus(admin, current.source_type, current.source_id),
      loadNodeStatus(admin, current.target_type, current.target_id),
    ]);
    if (sourceNode.retired || targetNode.retired) {
      return c.json(fail(reqId, 'CMDB_REL_ENDPOINT_RETIRED', 'ไม่สามารถเปิดใช้งานความสัมพันธ์นี้ได้ เนื่องจาก node ต้นทาง/ปลายทางถูกปลดระวางแล้ว'), 400);
    }
  }

  const { data, error } = await supabase
    .from('ci_relationships')
    .update({ status, status_reason: reason ?? null, updated_by: actorId })
    .eq('id', id)
    .select(REL_SELECT)
    .single();
  if (error) return c.json(fail(reqId, 'CMDB_REL_STATUS_FAILED', error.message), 400);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE_STATUS',
    module: 'cmdb',
    targetTable: 'ci_relationships',
    targetId: id,
    detail: { status, reason },
    requestId: reqId,
  });

  const [enriched] = await enrichRelationshipNodes(createAdminClient(c.env), [data as unknown as RelLikeRow]);
  return c.json(ok(reqId, enriched));
});

ciRelationshipsRoute.post('/:id/verify', requirePermission('cmdb.manage'), zValidator('json', verifyCiRelationshipSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { note } = c.req.valid('json');

  const { data: current, error: currentError } = await loadRelOr404(supabase, id);
  if (currentError) return c.json(fail(reqId, 'CMDB_REL_LOAD_FAILED', 'ดึงข้อมูลความสัมพันธ์ไม่สำเร็จ'), 400);
  if (!current) return c.json(fail(reqId, 'CMDB_REL_NOT_FOUND', 'ไม่พบความสัมพันธ์นี้'), 404);

  const { data, error } = await supabase
    .from('ci_relationships')
    .update({
      last_verified_at: new Date().toISOString(),
      last_verified_by: actorId,
      notes: note ? `${current.notes ? `${current.notes}\n` : ''}[Verify] ${note}` : current.notes,
      updated_by: actorId,
    })
    .eq('id', id)
    .select(REL_SELECT)
    .single();
  if (error) return c.json(fail(reqId, 'CMDB_REL_VERIFY_FAILED', error.message), 400);

  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'VERIFY', module: 'cmdb', targetTable: 'ci_relationships', targetId: id, requestId: reqId });

  const [enriched] = await enrichRelationshipNodes(createAdminClient(c.env), [data as unknown as RelLikeRow]);
  return c.json(ok(reqId, enriched));
});
