import type { Context } from 'hono';
import { csvCell } from '@itlife/shared';
import { Hono } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { writeAuditLog } from '../services/auditService';
import { evaluateHealthSnapshot } from '../services/governanceHealth';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { governanceActionSchema, governanceCreateSchemas } from '../validators/governance';

type Row = Record<string, unknown>;
type EntityConfig = {
  entity: string;
  table: string;
  code: string;
  prefix: string;
  title: string;
  status: string;
  owner?: string;
  due?: string;
  score?: string;
};

type DomainConfig = {
  view: string;
  manage?: string;
  act?: string;
  /**
   * สิทธิ์ที่ใช้ตัดสินใจ approve/reject ของโดเมนนี้โดยเฉพาะ — ต้องประกาศแยกทุกโดเมน
   * ห้ามใช้ key ร่วมกันข้ามโดเมน มิฉะนั้นผู้ที่อนุมัติเรื่องหนึ่งได้จะอนุมัติทุกเรื่องได้
   * โดเมนที่ไม่ประกาศ = ไม่มีใครอนุมัติผ่าน endpoint นี้ได้ (fail-closed)
   */
  approve?: string;
  entities: EntityConfig[];
};

const DOMAINS: Record<string, DomainConfig> = {
  'data-classification': {
    view: 'data_class.view', manage: 'data_class.manage', act: 'data_class.approve', approve: 'data_class.approve',
    entities: [
      { entity: 'data-assets', table: 'governance_data_assets', code: 'data_code', prefix: 'DAT', title: 'data_name', status: 'status', owner: 'data_owner', due: 'next_review_date' },
      { entity: 'destruction-requests', table: 'data_destruction_requests', code: 'request_code', prefix: 'DST', title: 'data_name', status: 'status', owner: 'requester_email' },
    ],
  },
  compliance: {
    view: 'compliance.view', manage: 'compliance.manage',
    entities: [
      { entity: 'laws', table: 'legal_register', code: 'law_code', prefix: 'LAW', title: 'law_name', status: 'status', owner: 'owner', due: 'next_review_date' },
      { entity: 'obligations', table: 'compliance_obligations', code: 'obligation_code', prefix: 'OBL', title: 'requirement', status: 'status', owner: 'control_owner', due: 'due_date' },
      { entity: 'assessments', table: 'compliance_assessments', code: 'assessment_code', prefix: 'ASM', title: 'control_description', status: 'result', due: 'next_review_due' },
      { entity: 'corrective-actions', table: 'compliance_corrective_actions', code: 'action_code', prefix: 'CAP', title: 'title', status: 'status', owner: 'owner', due: 'due_date' },
    ],
  },
  privacy: {
    view: 'privacy.view', manage: 'privacy.manage',
    entities: [
      { entity: 'ropa', table: 'privacy_ropa', code: 'ropa_code', prefix: 'ROPA', title: 'process_name', status: 'status', owner: 'data_owner', due: 'review_date' },
      { entity: 'consents', table: 'privacy_consents', code: 'consent_code', prefix: 'CNS', title: 'purpose', status: 'status' },
      { entity: 'dsr', table: 'privacy_dsr', code: 'request_code', prefix: 'DSR', title: 'request_type', status: 'status', owner: 'owner', due: 'due_date' },
    ],
  },
  risk: {
    view: 'risk.view', manage: 'risk.manage',
    entities: [{ entity: 'risks', table: 'governance_risks', code: 'risk_code', prefix: 'RSK', title: 'title', status: 'status', owner: 'owner', due: 'due_date', score: 'risk_score' }],
  },
  'ai-cloud': {
    view: 'ai_cloud.view', manage: 'ai_cloud.manage',
    entities: [
      { entity: 'ai-tools', table: 'governance_ai_tools', code: 'tool_code', prefix: 'AIT', title: 'tool_name', status: 'status', owner: 'owner' },
      { entity: 'cloud-services', table: 'governance_cloud_services', code: 'service_code', prefix: 'CLD', title: 'service_name', status: 'status', owner: 'owner', due: 'contract_expiry' },
    ],
  },
  awareness: {
    view: 'awareness.view', manage: 'awareness.manage', act: 'awareness.participate',
    entities: [
      { entity: 'training-plans', table: 'governance_training_plans', code: 'plan_code', prefix: 'TRN', title: 'topic', status: 'status', owner: 'responsible', due: 'planned_date' },
      { entity: 'acknowledgements', table: 'policy_acknowledgements', code: 'ack_code', prefix: 'ACK', title: 'policy_name', status: 'status', owner: 'acknowledger_email' },
      { entity: 'training-records', table: 'governance_training_records', code: 'record_code', prefix: 'REC', title: 'course_title', status: 'status', owner: 'participant_email' },
    ],
  },
  evidence: {
    view: 'evidence.view', act: 'evidence.export',
    entities: [
      { entity: 'controls', table: 'governance_controls', code: 'control_code', prefix: 'CTL', title: 'title', status: 'status', owner: 'owner', due: 'next_review_date' },
      { entity: 'evidence-items', table: 'governance_evidence_items', code: 'evidence_code', prefix: 'EVD', title: 'title', status: 'status', owner: 'owner', due: 'expires_at' },
    ],
  },
  'audit-management': {
    view: 'audit_management.view', manage: 'audit_management.manage', act: 'audit_management.verify',
    entities: [
      { entity: 'audits', table: 'audit_engagements', code: 'audit_code', prefix: 'AUD', title: 'title', status: 'status', owner: 'lead_auditor', due: 'planned_end' },
      { entity: 'findings', table: 'audit_findings', code: 'finding_code', prefix: 'FND', title: 'title', status: 'status', owner: 'owner', due: 'due_date' },
    ],
  },
  documents: {
    view: 'governance_document.view', manage: 'governance_document.manage',
    entities: [{ entity: 'documents', table: 'governance_documents', code: 'document_code', prefix: 'DOC', title: 'title', status: 'status', owner: 'owner', due: 'review_date' }],
  },
  operations: {
    view: 'operations.view', manage: 'operations.manage',
    entities: [
      { entity: 'employee-lifecycle', table: 'employee_lifecycle_events', code: 'lifecycle_code', prefix: 'JML', title: 'employee_name', status: 'status', owner: 'requested_by_email', due: 'effective_date' },
      { entity: 'retention-runs', table: 'governance_retention_runs', code: 'run_code', prefix: 'RET', title: 'mode', status: 'status', owner: 'requested_by_email' },
      { entity: 'operational-checks', table: 'governance_operational_checks', code: 'check_code', prefix: 'OPS', title: 'check_name', status: 'status', owner: 'checked_by_email' },
    ],
  },
  integrations: {
    view: 'integration.view', manage: 'integration.manage',
    entities: [
      { entity: 'outbox', table: 'integration_outbox', code: 'integration_code', prefix: 'INT', title: 'event_type', status: 'status', owner: 'target_module', due: 'next_attempt_at' },
      { entity: 'record-links', table: 'record_links', code: 'link_code', prefix: 'LNK', title: 'link_type', status: 'status', owner: 'source_module' },
    ],
  },
};

const DETAIL_LABELS: Record<string, string> = {
  classification: 'ชั้นข้อมูล', system_name: 'ระบบ', retention_period: 'ระยะเก็บรักษา', law_name: 'กฎหมาย',
  category: 'หมวด', lawful_basis: 'ฐานกฎหมาย', request_type: 'ประเภทคำขอ', likelihood: 'โอกาส', impact: 'ผลกระทบ',
  residual_score: 'คะแนนคงเหลือ', vendor: 'ผู้ให้บริการ', provider: 'ผู้ให้บริการ', year: 'ปี', quarter: 'ไตรมาส',
  policy_version: 'เวอร์ชัน', audit_type: 'ประเภท Audit', finding_type: 'ประเภทข้อค้นพบ', version: 'เวอร์ชัน',
  event_type: 'เหตุการณ์', effective_date: 'วันที่มีผล', mode: 'โหมด', attempt_count: 'จำนวนครั้ง', source_module: 'โมดูลต้นทาง',
};

const IGNORED_DETAILS = new Set([
  'id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'legacy_id', 'payload',
  'result_payload', 'metadata', 'design_schema', 'verified_by', 'approved_by_id', 'requested_by_id',
]);

export const governanceRoute = new Hono<AppEnv>();
governanceRoute.use('*', requireAuth);

async function hasPermission(c: Context<AppEnv>, key?: string): Promise<boolean> {
  if (!key) return false;
  const { data, error } = await c.get('supabase').rpc('has_permission', { permission_key_input: key });
  return !error && data === true;
}

function code(prefix: string): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${date}-${randomCodeSuffix()}`;
}

function camelToSnake(value: string): string { return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`); }
function snakeBody(body: Row): Row { return Object.fromEntries(Object.entries(body).map(([key, value]) => [camelToSnake(key), value === '' ? null : value])); }
function textValue(value: unknown, fallback = '—'): string { return value === null || value === undefined || value === '' ? fallback : String(value); }

function actionsFor(domain: string, entity: string, row: Row, canManage: boolean, canAct: boolean, actorEmail: string): string[] {
  const status = textValue(row.status, '').toLocaleLowerCase('th');
  const actions: string[] = [];
  if (domain === 'data-classification' && entity === 'data-assets' && canManage && !/ยกเลิก|ทำลาย/.test(status)) actions.push('request-destruction');
  if (domain === 'data-classification' && entity === 'destruction-requests') {
    if (status === 'รออนุมัติ' && canAct) actions.push('approve', 'reject');
    if (status === 'อนุมัติแล้ว รอดำเนินการ' && canManage) actions.push('confirm-destroyed');
  }
  if (domain === 'privacy' && entity === 'consents' && canManage && status === 'ใช้งาน') actions.push('withdraw');
  if (domain === 'privacy' && entity === 'dsr' && canManage && !/เสร็จสิ้น|ปฏิเสธ/.test(status)) actions.push('complete');
  if (domain === 'awareness' && entity === 'training-plans' && canManage && !/เสร็จสิ้น|ยกเลิก/.test(status)) actions.push('complete');
  if (domain === 'compliance' && entity === 'corrective-actions' && canManage && status === 'รอตรวจสอบ' && String(row.owner ?? '').toLowerCase() !== actorEmail.toLowerCase()) actions.push('verify');
  if (domain === 'audit-management' && entity === 'findings' && canAct && status === 'รอตรวจยืนยัน' && String(row.owner ?? '').toLowerCase() !== actorEmail.toLowerCase()) actions.push('verify');
  if (domain === 'integrations' && entity === 'outbox' && canManage) {
    if (/error|dead/.test(status)) actions.push('retry');
    if (/pending|error/.test(status) && !row.result_record_id) actions.push('cancel');
  }
  if (domain === 'operations' && entity === 'operational-checks' && canManage) actions.push('health-check');
  if (domain === 'operations' && entity === 'retention-runs' && canManage) actions.push('retention-preview');
  if (domain === 'operations' && entity === 'retention-runs' && canManage && row.mode === 'PREVIEW' && row.status === 'COMPLETED') actions.push('retention-apply');
  return actions;
}

function normalize(entity: EntityConfig, row: Row, domain: string, canManage: boolean, canAct: boolean, actorEmail: string): Row {
  const structural = new Set([entity.code, entity.title, entity.status, entity.owner ?? '', entity.due ?? '', entity.score ?? '']);
  const details = Object.entries(row)
    .filter(([key, value]) => !IGNORED_DETAILS.has(key) && !structural.has(key) && value !== null && typeof value !== 'object')
    .slice(0, 8)
    .map(([key, value]) => ({ label: DETAIL_LABELS[key] ?? key.replaceAll('_', ' '), value }));
  return {
    id: String(row.id), entity: entity.entity, code: textValue(row[entity.code], entity.prefix),
    title: textValue(row[entity.title]), subtitle: row.notes ? String(row.notes) : null,
    status: textValue(row[entity.status], 'ไม่ระบุ'), owner: entity.owner ? textValue(row[entity.owner], '') || null : null,
    due_date: entity.due && row[entity.due] ? String(row[entity.due]) : null,
    score: entity.score && row[entity.score] !== null && row[entity.score] !== undefined ? Number(row[entity.score]) : null,
    details, actions: actionsFor(domain, entity.entity, row, canManage, canAct, actorEmail),
  };
}

async function loadDomain(client: SupabaseClient, domain: string, config: DomainConfig, canManage: boolean, canAct: boolean, actorEmail: string) {
  const results = await Promise.all(config.entities.map(async (entity) => {
    const response = await client.from(entity.table).select('*').order('created_at', { ascending: false }).limit(300);
    return { entity, ...response };
  }));
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  const rows = results.flatMap((result) => (result.data ?? []).map((row) => normalize(result.entity, row as Row, domain, canManage, canAct, actorEmail)));
  const today = Date.now();
  const terminal = /ปิด|เสร็จสิ้น|ยกเลิก|ปฏิเสธ|ทำลายแล้ว|ใช้งาน|compliant|completed|cancelled/i;
  const open = rows.filter((row) => !terminal.test(String(row.status))).length;
  const overdue = rows.filter((row) => row.due_date && new Date(String(row.due_date)).getTime() < today && !terminal.test(String(row.status))).length;
  const highRisk = rows.filter((row) => Number(row.score ?? 0) >= 16).length;
  return {
    records: rows,
    metrics: [
      { label: 'รายการทั้งหมด', value: rows.length, tone: 'primary' },
      { label: 'รายการที่ต้องติดตาม', value: open, tone: open ? 'amber' : 'teal' },
      { label: 'เกินกำหนด', value: overdue, tone: overdue ? 'danger' : 'gray' },
      { label: domain === 'risk' ? 'ความเสี่ยงสูง/วิกฤต' : 'พร้อมตรวจสอบ', value: domain === 'risk' ? highRisk : rows.length - open, tone: highRisk ? 'danger' : 'teal' },
    ],
  };
}

function domainOrNull(value: string): DomainConfig | null { return Object.prototype.hasOwnProperty.call(DOMAINS, value) ? DOMAINS[value] : null; }
function entityOrNull(config: DomainConfig, value: string): EntityConfig | null { return config.entities.find((item) => item.entity === value) ?? null; }

governanceRoute.get('/:domain', async (c) => {
  const requestId = c.get('requestId'); const domain = c.req.param('domain'); const config = domainOrNull(domain);
  if (!config) return c.json(fail(requestId, 'GOVERNANCE_DOMAIN_NOT_FOUND', 'ไม่พบโมดูล Governance ที่ระบุ'), 404);
  if (!(await hasPermission(c, config.view))) return c.json(fail(requestId, 'FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงโมดูลนี้'), 403);
  const [canManage, canAct] = await Promise.all([hasPermission(c, config.manage), hasPermission(c, config.act)]);
  try {
    const result = await loadDomain(c.get('supabase'), domain, config, canManage, canAct, c.get('userEmail'));
    return c.json(ok(requestId, { domain, ...result, canManage, canAct, generatedAt: new Date().toISOString() }));
  } catch (error) {
    return dbFailJson(c, 'GOVERNANCE_LOAD_FAILED', error instanceof Error ? error : { message: String(error) }, 'โหลดข้อมูลโมดูลนี้ไม่สำเร็จ');
  }
});

governanceRoute.post('/:domain/exports/csv', async (c) => {
  const requestId = c.get('requestId'); const domain = c.req.param('domain'); const config = domainOrNull(domain);
  if (!config) return c.json(fail(requestId, 'GOVERNANCE_DOMAIN_NOT_FOUND', 'ไม่พบโมดูล Governance ที่ระบุ'), 404);
  if (!(await hasPermission(c, 'evidence.export'))) return c.json(fail(requestId, 'FORBIDDEN', 'ไม่มีสิทธิ์ Export Evidence'), 403);
  try {
    const result = await loadDomain(c.get('supabase'), domain, config, false, false, c.get('userEmail'));
    const lines = ['domain,entity,code,title,status,owner,due_date,score'];
    for (const record of result.records) lines.push([domain, record.entity, record.code, record.title, record.status, record.owner, record.due_date, record.score].map(csvCell).join(','));
    await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'EXPORT_CSV', module: 'governance', detail: { domain, rows: result.records.length }, requestId });
    return c.json(ok(requestId, { filename: `governance-${domain}-${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join('\r\n') }));
  } catch (error) {
    return dbFailJson(c, 'GOVERNANCE_EXPORT_FAILED', error instanceof Error ? error : { message: String(error) }, 'Export ข้อมูลไม่สำเร็จ');
  }
});

governanceRoute.post('/:domain/:entity', async (c) => {
  const requestId = c.get('requestId'); const actorId = c.get('userId'); const actorEmail = c.get('userEmail');
  const domain = c.req.param('domain'); const entityName = c.req.param('entity'); const config = domainOrNull(domain); const entity = config ? entityOrNull(config, entityName) : null;
  if (!config || !entity) return c.json(fail(requestId, 'GOVERNANCE_ENTITY_NOT_FOUND', 'ไม่พบประเภทรายการ Governance ที่ระบุ'), 404);
  const requiredPermission = domain === 'awareness' && entityName === 'acknowledgements' ? 'awareness.participate' : config.manage;
  if (!(await hasPermission(c, requiredPermission))) return c.json(fail(requestId, 'FORBIDDEN', 'ไม่มีสิทธิ์เพิ่มรายการนี้'), 403);
  const schema = governanceCreateSchemas[`${domain}/${entityName}`];
  if (!schema) return c.json(fail(requestId, 'GOVERNANCE_CREATE_DISABLED', 'รายการประเภทนี้สร้างผ่าน workflow ของระบบเท่านั้น'), 405);
  let json: unknown;
  try { json = await c.req.json(); } catch { return c.json(fail(requestId, 'VALIDATION_ERROR', 'JSON ไม่ถูกต้อง'), 400); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return c.json(fail(requestId, 'VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', parsed.error.issues), 400);
  const admin = createAdminClient(c.env); const body = snakeBody(parsed.data as Row); const now = new Date().toISOString();
  const insert: Row = { ...body, [entity.code]: entity.code === 'document_code' ? body.document_code : code(entity.prefix), created_by: actorId, updated_by: actorId };
  if (domain === 'risk') {
    insert.risk_score = Number(insert.likelihood) * Number(insert.impact);
    insert.residual_score = insert.residual_likelihood && insert.residual_impact ? Number(insert.residual_likelihood) * Number(insert.residual_impact) : null;
    insert.identified_date = now.slice(0, 10);
  }
  if (domain === 'privacy' && entityName === 'consents') insert.status = 'ใช้งาน';
  if (domain === 'privacy' && entityName === 'dsr') { insert.received_at = now; insert.due_date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10); }
  if (domain === 'awareness' && entityName === 'acknowledgements') {
    insert.acknowledger_id = actorId; insert.acknowledger_email = actorEmail; insert.acknowledger_name = insert.signature_name;
    insert.acknowledged_at = now; insert.status = 'รับทราบแล้ว';
  }
  if (domain === 'compliance' && entityName === 'assessments') { insert.assessor_id = actorId; insert.assessor_email = actorEmail; }
  if (domain === 'data-classification' && entityName === 'destruction-requests') {
    const { data: asset } = await admin.from('governance_data_assets').select('id,data_name,classification').eq('id', insert.data_asset_id).maybeSingle();
    if (!asset) return c.json(fail(requestId, 'DATA_ASSET_NOT_FOUND', 'ไม่พบชุดข้อมูลที่ขอทำลาย'), 404);
    insert.data_name = asset.data_name; insert.classification = asset.classification; insert.requester_id = actorId; insert.requester_email = actorEmail; insert.requested_at = now; insert.status = 'รออนุมัติ';
  }
  if (domain === 'operations' && entityName === 'employee-lifecycle') {
    const { data: employee } = await admin.from('employees').select('id,employee_code,first_name_th,last_name_th,email').eq('id', insert.employee_id).maybeSingle();
    if (!employee) return c.json(fail(requestId, 'EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานที่ระบุ'), 404);
    insert.employee_code = employee.employee_code; insert.employee_name = `${employee.first_name_th} ${employee.last_name_th}`.trim(); insert.employee_email = employee.email;
    insert.requested_by_id = actorId; insert.requested_by_email = actorEmail; insert.status = 'PENDING';
  }
  const { data, error } = await admin.from(entity.table).insert(insert).select('*').single();
  if (error) return dbFailJson(c, 'GOVERNANCE_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail, action: 'CREATE', module: `governance.${domain}`, targetTable: entity.table, targetId: data.id, detail: { entity: entityName, code: data[entity.code] }, requestId });
  const [canManage, canAct] = await Promise.all([hasPermission(c, config.manage), hasPermission(c, config.act)]);
  return c.json(ok(requestId, normalize(entity, data as Row, domain, canManage, canAct, actorEmail)), 201);
});

governanceRoute.post('/:domain/:entity/:id/actions/:action', async (c) => {
  const requestId = c.get('requestId'); const actorId = c.get('userId'); const actorEmail = c.get('userEmail');
  const domain = c.req.param('domain'); const entityName = c.req.param('entity'); const id = c.req.param('id'); const action = c.req.param('action');
  const config = domainOrNull(domain); const entity = config ? entityOrNull(config, entityName) : null;
  if (!config || !entity) return c.json(fail(requestId, 'GOVERNANCE_ENTITY_NOT_FOUND', 'ไม่พบประเภทรายการ Governance ที่ระบุ'), 404);
  // สิทธิ์ต้องมาจากโดเมนที่กำลังทำรายการเสมอ — ห้าม hard-code key ของโดเมนใดโดเมนหนึ่ง
  const actionPermission =
    action === 'approve' || action === 'reject'
      ? config.approve
      : action === 'verify' && domain === 'audit-management'
        ? 'audit_management.verify'
        : config.manage;
  if (!(await hasPermission(c, actionPermission))) return c.json(fail(requestId, 'FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้'), 403);
  let json: unknown = {};
  try { json = await c.req.json(); } catch { /* an empty body is valid for parameterless actions */ }
  const parsed = governanceActionSchema.safeParse(json);
  if (!parsed.success) return c.json(fail(requestId, 'VALIDATION_ERROR', 'ข้อมูล action ไม่ถูกต้อง', parsed.error.issues), 400);
  const admin = createAdminClient(c.env); const { data: current } = await admin.from(entity.table).select('*').eq('id', id).maybeSingle();
  if (!current) return c.json(fail(requestId, 'GOVERNANCE_RECORD_NOT_FOUND', 'ไม่พบรายการที่ระบุ'), 404);
  const body = parsed.data; const update: Row = { updated_by: actorId }; const now = new Date().toISOString();
  if (action === 'request-destruction' && domain === 'data-classification' && entityName === 'data-assets') {
    const requestEntity = config.entities.find((item) => item.entity === 'destruction-requests')!;
    const requestInsert = { request_code: code('DST'), data_asset_id: id, data_name: current.data_name, classification: current.classification, reason: 'คำขอจากหน้า Data Classification', requester_id: actorId, requester_email: actorEmail, requested_at: now, status: 'รออนุมัติ', created_by: actorId, updated_by: actorId };
    const { data, error } = await admin.from(requestEntity.table).insert(requestInsert).select('*').single();
    if (error) return dbFailJson(c, 'DESTRUCTION_REQUEST_FAILED', error);
    await writeAuditLog(c.env, { actorId, actorEmail, action: 'REQUEST_DESTRUCTION', module: 'governance.data-classification', targetTable: requestEntity.table, targetId: data.id, detail: { dataAssetId: id }, requestId });
    return c.json(ok(requestId, normalize(requestEntity, data as Row, domain, true, false, actorEmail)), 201);
  }
  if (action === 'approve' && current.status === 'รออนุมัติ') Object.assign(update, { status: 'อนุมัติแล้ว รอดำเนินการ', approved_by_id: actorId, approved_by_email: actorEmail, approved_at: now });
  else if (action === 'reject' && current.status === 'รออนุมัติ') {
    if (!body.comment?.trim()) return c.json(fail(requestId, 'REJECTION_REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ปฏิเสธ'), 400);
    Object.assign(update, { status: 'ปฏิเสธ', approval_comment: body.comment, approved_by_id: actorId, approved_by_email: actorEmail, approved_at: now });
  } else if (action === 'confirm-destroyed' && current.status === 'อนุมัติแล้ว รอดำเนินการ') {
    if (!body.method?.trim() || !body.evidenceUrl) return c.json(fail(requestId, 'DESTRUCTION_EVIDENCE_REQUIRED', 'กรุณาระบุวิธีทำลายและ Evidence URL แบบ HTTPS'), 400);
    Object.assign(update, { status: 'ทำลายแล้ว', destruction_method: body.method, evidence_url: body.evidenceUrl, destroyed_by_id: actorId, destroyed_by_email: actorEmail, destroyed_at: now });
    await admin.from('governance_data_assets').update({ status: 'ทำลายแล้ว', updated_by: actorId }).eq('id', current.data_asset_id);
  } else if (action === 'withdraw' && current.status === 'ใช้งาน') Object.assign(update, { status: 'ถอนแล้ว', withdrawn_at: now, withdrawn_by_id: actorId });
  else if (action === 'complete' && domain === 'privacy') Object.assign(update, { status: 'เสร็จสิ้น', completed_at: now });
  else if (action === 'complete' && domain === 'awareness') Object.assign(update, { status: 'เสร็จสิ้น', completed_at: now });
  else if (action === 'verify' && ['รอตรวจสอบ', 'รอตรวจยืนยัน'].includes(String(current.status))) {
    if (current.created_by === actorId || String(current.owner ?? '').toLowerCase() === actorEmail.toLowerCase()) return c.json(fail(requestId, 'SEGREGATION_OF_DUTIES', 'ผู้สร้างหรือเจ้าของรายการไม่สามารถตรวจยืนยันงานของตนเองได้'), 409);
    Object.assign(update, { status: domain === 'audit-management' ? 'ปิด' : 'เสร็จสิ้น', verified_by: actorId, verified_by_email: actorEmail, verified_at: now, verification_evidence_url: body.evidenceUrl || null });
  } else if (action === 'retry' && ['ERROR', 'DEAD'].includes(String(current.status))) Object.assign(update, { status: 'PENDING', next_attempt_at: now, last_error: null });
  else if (action === 'cancel' && ['PENDING', 'ERROR'].includes(String(current.status)) && !current.result_record_id) Object.assign(update, { status: 'CANCELLED', cancelled_at: now, cancelled_by: actorId });
  else if (action === 'health-check' && domain === 'operations') {
    // ผลการตรวจต้องมาจากการอ่านสถานะจริงเสมอ ห้ามบันทึก PASS ตายตัว — แถวในตารางนี้ถูกใช้เป็น
    // หลักฐานการควบคุมให้ผู้ตรวจสอบภายนอก การแต่งผลขึ้นมาจึงเป็นการสร้างหลักฐานเท็จ
    const snapshot = await c.get('supabase').rpc('governance_health_snapshot');
    const detail = evaluateHealthSnapshot(snapshot.data, snapshot.error?.message);
    const { data, error } = await admin.from('governance_operational_checks').insert({
      check_code: code('OPS'),
      check_name: 'Database and governance controls',
      check_type: 'AUTOMATED',
      status: detail.status,
      detail: detail.evidence,
      checked_by_id: actorId,
      checked_by_email: actorEmail,
      checked_at: now,
      created_by: actorId,
      updated_by: actorId,
    }).select('*').single();
    if (error) return dbFailJson(c, 'HEALTH_CHECK_FAILED', error);
    return c.json(ok(requestId, data));
  } else if (action === 'retention-preview' && domain === 'operations') {
    const { data, error } = await admin.rpc('run_governance_retention', { apply_changes: false, preview_run_id_input: null, requested_by_input: actorId, requested_by_email_input: actorEmail });
    if (error) return dbFailJson(c, 'RETENTION_PREVIEW_FAILED', error);
    return c.json(ok(requestId, data));
  } else if (action === 'retention-apply' && domain === 'operations') {
    if (current.mode !== 'PREVIEW' || current.status !== 'COMPLETED') return c.json(fail(requestId, 'RETENTION_PREVIEW_REQUIRED', 'ต้องเลือก Preview ที่เสร็จสมบูรณ์ก่อน Run Retention'), 409);
    const { data, error } = await admin.rpc('run_governance_retention', { apply_changes: true, preview_run_id_input: id, requested_by_input: actorId, requested_by_email_input: actorEmail });
    if (error) return dbFailJson(c, 'RETENTION_APPLY_FAILED', error);
    return c.json(ok(requestId, data));
  } else return c.json(fail(requestId, 'INVALID_STATE_TRANSITION', 'สถานะปัจจุบันไม่รองรับ action นี้'), 409);
  const { data, error } = await admin.from(entity.table).update(update).eq('id', id).select('*').single();
  if (error) return dbFailJson(c, 'GOVERNANCE_ACTION_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail, action: action.toUpperCase().replaceAll('-', '_'), module: `governance.${domain}`, targetTable: entity.table, targetId: id, detail: { from: current.status, to: data[entity.status] }, requestId });
  const [canManage, canAct] = await Promise.all([hasPermission(c, config.manage), hasPermission(c, config.act)]);
  return c.json(ok(requestId, normalize(entity, data as Row, domain, canManage, canAct, actorEmail)));
});
