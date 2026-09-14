import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv, Bindings } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { checkExportSize, exportFileName, listCsv, LIST_EXPORT_MAX_ROWS, type ExportColumn } from '../utils/listExport';
import { applySort } from '../utils/sort';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  closeIncidentSchema,
  createIncidentSchema,
  createRegulatoryNotificationSchema,
  escalateTicketSchema,
  listIncidentsQuerySchema,
  markDpoNotifiedSchema,
  notificationClockSchema,
  notificationTimelineEventSchema,
  regulatoryAssessmentSchema,
  updateIncidentSchema,
} from '../validators/incidents';

export const incidentsRoute = new Hono<AppEnv>();

incidentsRoute.use('*', requireAuth);
incidentsRoute.use('*', requirePermission('incident.view'));

const INCIDENT_SELECT =
  '*, reporter:profiles!incidents_reported_by_fkey(id, full_name, email), ' +
  'assignee:profiles!incidents_assignee_id_fkey(id, full_name, email), ' +
  'incident_commander:profiles!incidents_incident_commander_id_fkey(id, full_name, email), ' +
  'source_ticket:tickets!incidents_source_ticket_id_fkey(id, title, status)';

const RISK_RANGES: Record<string, [number, number]> = {
  ต่ำ: [1, 4],
  ปานกลาง: [5, 9],
  สูง: [10, 14],
  วิกฤต: [15, 25],
};

type IncidentRow = Record<string, unknown> & {
  id: string;
  incident_number: string;
  title: string;
  contains_personal_data: boolean;
  regulatory_assessment_status: string;
  pdpc_notify_required: string;
  data_subject_notify_required: string;
  ncsa_report_required: string;
  other_regulator_required: string;
  dpo_notified_at: string | null;
  risk_score: number | null;
  affected_ci_id: string | null;
  affected_system: string | null;
  severity: string | null;
  category: string;
  description: string;
  assignee_id: string | null;
  incident_commander_id: string | null;
  major_incident: boolean;
};

function generateIncidentNumber(): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `INC-${date}-${randomCodeSuffix()}`;
}

function riskLevel(score: number | null): string | null {
  if (!score) return null;
  if (score <= 4) return 'ต่ำ';
  if (score <= 9) return 'ปานกลาง';
  if (score <= 14) return 'สูง';
  return 'วิกฤต';
}

function mapIncident<T extends Record<string, unknown>>(row: T): T & { risk_level: string | null } {
  return { ...row, risk_level: riskLevel(Number(row.risk_score) || null) };
}

async function hasPerm(c: Context<AppEnv>, permissionKey: string): Promise<boolean> {
  const { data, error } = await c.get('supabase').rpc('has_permission', { permission_key_input: permissionKey });
  return !error && data === true;
}

async function loadIncident(client: SupabaseClient, id: string) {
  const result = await client.from('incidents').select(INCIDENT_SELECT).eq('id', id).maybeSingle();
  return result as unknown as { data: IncidentRow | null; error: { message: string } | null };
}

const INCIDENT_CI_SELECT =
  'id, ci_code, name, ci_type, environment, criticality, status, backup_required, backup_reference, ' +
  'owner:employees!configuration_items_owner_employee_id_fkey(id, employee_code, first_name_th, last_name_th, nickname), ' +
  'administrator:employees!configuration_items_administrator_employee_id_fkey(id, employee_code, first_name_th, last_name_th, nickname), ' +
  'vendor:vendors!configuration_items_vendor_id_fkey(id, vendor_code, name, status), ' +
  'contract:contracts!configuration_items_contract_id_fkey(id, contract_number, name, status, end_date)';

async function loadIncidentOperationalContext(env: Bindings, incidentId: string, affectedCiId: string | null) {
  const admin = createAdminClient(env);
  const [ciResult, sourceResult, targetResult, clocksResult, timelineResult, problemLinksResult, changesResult] = await Promise.all([
    affectedCiId ? admin.from('configuration_items').select(INCIDENT_CI_SELECT).eq('id', affectedCiId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    affectedCiId ? admin.from('ci_relationships').select('id, source_type, source_id, target_type, target_id, relationship_type, direction, impact_level, status').eq('source_type', 'CI').eq('source_id', affectedCiId).eq('status', 'Active').limit(200) : Promise.resolve({ data: [], error: null }),
    affectedCiId ? admin.from('ci_relationships').select('id, source_type, source_id, target_type, target_id, relationship_type, direction, impact_level, status').eq('target_type', 'CI').eq('target_id', affectedCiId).eq('status', 'Active').limit(200) : Promise.resolve({ data: [], error: null }),
    admin.from('incident_notification_clocks').select('*').eq('incident_id', incidentId).order('clock_type'),
    admin.from('incident_notification_timeline').select('*').eq('incident_id', incidentId).order('occurred_at', { ascending: false }),
    admin.from('problem_incidents').select('problem_id').eq('incident_id', incidentId),
    admin.from('change_requests').select('id, change_number, title, status, risk_level, source_incident_id').eq('source_incident_id', incidentId).order('created_at', { ascending: false }),
  ]);
  const relationshipRows = [...(sourceResult.data ?? []), ...(targetResult.data ?? [])] as Record<string, unknown>[];
  const relatedCiIds = [...new Set(relationshipRows.flatMap((row) => {
    const relatedType = row.source_type === 'CI' && row.source_id === affectedCiId ? row.target_type : row.source_type;
    const relatedId = row.source_type === 'CI' && row.source_id === affectedCiId ? row.target_id : row.source_id;
    return relatedType === 'CI' && relatedId !== affectedCiId ? [String(relatedId)] : [];
  }))];
  const relatedCiResult = relatedCiIds.length
    ? await admin.from('configuration_items').select('id, ci_code, name, criticality, status').in('id', relatedCiIds)
    : { data: [], error: null };
  const relatedCiById = new Map((relatedCiResult.data ?? []).map((row) => [row.id, row]));
  const ciRelationships = relationshipRows.map((row) => {
    const relatedId = row.source_type === 'CI' && row.source_id === affectedCiId ? row.target_id : row.source_id;
    return { ...row, related_ci: relatedCiById.get(String(relatedId)) ?? null };
  });
  const problemIds = [...new Set((problemLinksResult.data ?? []).map((row) => row.problem_id))];
  const followUpProblems = problemIds.length
    ? (await admin.from('problems').select('id, problem_number, title, status').in('id', problemIds)).data ?? []
    : [];
  return {
    affectedCi: ciResult.data ?? null,
    ciRelationships,
    notificationClocks: clocksResult.data ?? [],
    notificationTimeline: timelineResult.data ?? [],
    followUpProblems,
    emergencyChanges: changesResult.data ?? [],
  };
}

async function writeIncidentTimeline(env: Bindings, input: {
  incidentId: string;
  eventType: string;
  actorId: string;
  destination?: string | null;
  occurredAt?: string;
  note?: string | null;
  referenceNo?: string | null;
}): Promise<void> {
  await createAdminClient(env).from('incident_notification_timeline').insert({
    incident_id: input.incidentId,
    event_type: input.eventType,
    destination: input.destination ?? null,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    note: input.note ?? null,
    reference_no: input.referenceNo ?? null,
    created_by: input.actorId,
  });
}

const INCIDENT_TO_PROBLEM_PRIORITY: Record<string, string> = { ต่ำ: 'ต่ำ', ปานกลาง: 'ปานกลาง', สูง: 'สูง', วิกฤต: 'วิกฤต' };
const INCIDENT_TO_CHANGE_RISK: Record<string, string> = { ต่ำ: 'ต่ำ', ปานกลาง: 'กลาง', สูง: 'สูง', วิกฤต: 'สูง' };

async function upsertNotificationClock(client: SupabaseClient, incidentId: string, actorId: string, input: {
  clockType: string;
  startedAt?: string | null;
  deadlineAt?: string | null;
  status: string;
  notifiedAt?: string | null;
  referenceNo?: string | null;
  notes?: string | null;
}) {
  const { data: existing } = await client.from('incident_notification_clocks').select('*').eq('incident_id', incidentId).eq('clock_type', input.clockType).maybeSingle();
  const result = await client.from('incident_notification_clocks').upsert({
    incident_id: incidentId,
    clock_type: input.clockType,
    started_at: input.startedAt || existing?.started_at || new Date().toISOString(),
    deadline_at: input.deadlineAt === undefined ? existing?.deadline_at ?? null : input.deadlineAt || null,
    status: input.status,
    notified_at: input.status === 'NOTIFIED'
      ? (input.notifiedAt === undefined ? existing?.notified_at ?? null : input.notifiedAt || null)
      : null,
    reference_no: input.referenceNo === undefined ? existing?.reference_no ?? null : input.referenceNo || null,
    notes: input.notes === undefined ? existing?.notes ?? null : input.notes || null,
    created_by: existing?.created_by ?? actorId,
    updated_by: actorId,
  }, { onConflict: 'incident_id,clock_type' }).select('*').single();
  return { ...result, wasCreated: !existing };
}

async function notifyDpoUsers(env: Bindings, incidentId: string, title: string): Promise<void> {
  const admin = createAdminClient(env);
  const { data } = await admin
    .from('user_roles')
    .select('user_id, roles!inner(key), profiles!inner(status)')
    .eq('roles.key', 'dpo')
    .eq('profiles.status', 'active');
  const rows = (data ?? []) as unknown as { user_id: string }[];
  await Promise.all(
    [...new Set(rows.map((row) => row.user_id))].map((recipientId) =>
      sendNotification(env, {
        recipientId,
        type: 'incident_dpo_screening',
        title: `[PDPA] ต้องคัดกรอง Incident: ${title}`,
        link: `/incidents/${incidentId}`,
      }),
    ),
  );
}

function closureGaps(incident: IncidentRow, notifications: Record<string, unknown>[]): string[] {
  const gaps: string[] = [];
  if (incident.regulatory_assessment_status !== 'ประเมินแล้ว') {
    return ['ยังประเมินหน้าที่แจ้งภายนอกไม่ครบ'];
  }
  if (incident.contains_personal_data && !incident.dpo_notified_at) gaps.push('DPO ภายในยังไม่ได้รับทราบ');
  const decisions = [
    ['pdpc_notify_required', 'PDPC', 'สคส.'],
    ['data_subject_notify_required', 'DATA_SUBJECT', 'เจ้าของข้อมูล'],
    ['ncsa_report_required', 'NCSA', 'สกมช./ThaiCERT'],
    ['other_regulator_required', 'OTHER', 'หน่วยงานกำกับอื่น'],
  ] as const;
  for (const [field, destination, label] of decisions) {
    if (incident[field] === 'Pending') gaps.push(`ยังไม่ตัดสินใจเรื่อง ${label}`);
    if (
      incident[field] === 'Yes' &&
      !notifications.some((item) => item.destination === destination && item.required === true && item.status === 'แจ้งแล้ว')
    ) {
      gaps.push(`ยังไม่มีหลักฐานว่าแจ้ง ${label} แล้ว`);
    }
  }
  return gaps;
}

incidentsRoute.get('/matrix', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('incidents').select('likelihood, impact, status').is('archived_at', null).neq('status', 'ปิดเคส');
  if (error) return c.json(fail(reqId, 'INCIDENT_MATRIX_LOAD_FAILED', 'ดึง Risk Matrix ไม่สำเร็จ'), 400);
  const cells = Array.from({ length: 5 }, (_, likelihoodIndex) =>
    Array.from({ length: 5 }, (_, impactIndex) => ({
      likelihood: likelihoodIndex + 1,
      impact: impactIndex + 1,
      score: (likelihoodIndex + 1) * (impactIndex + 1),
      count: 0,
    })),
  ).flat();
  for (const row of data ?? []) {
    const cell = cells.find((item) => item.likelihood === row.likelihood && item.impact === row.impact);
    if (cell) cell.count += 1;
  }
  return c.json(ok(reqId, cells.map((cell) => ({ ...cell, riskLevel: riskLevel(cell.score) }))));
});

incidentsRoute.get('/assignees', requirePermission('incident.manage'), async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await createAdminClient(c.env).from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name');
  if (error) return c.json(fail(reqId, 'INCIDENT_ASSIGNEES_LOAD_FAILED', 'ดึงรายชื่อผู้รับผิดชอบไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data));
});

incidentsRoute.get('/references', requireAnyPermission(['incident.create', 'incident.manage']), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [ciResult, commandersResult] = await Promise.all([
    admin.from('configuration_items').select('id, ci_code, name, ci_type, criticality, status').neq('status', 'Retired').order('ci_code').limit(2000),
    admin.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name').limit(500),
  ]);
  if (ciResult.error || commandersResult.error) return c.json(fail(reqId, 'INCIDENT_REFERENCES_LOAD_FAILED', 'ดึงข้อมูลอ้างอิง Incident ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { configurationItems: ciResult.data ?? [], commanders: commandersResult.data ?? [] }));
});

/** risk_score เรียงได้เพราะเป็นตัวเลข ส่วน severity/risk_level เป็นข้อความไทยจึงไม่เปิดให้เรียง */
const INCIDENT_SORT_COLUMNS = ['incident_number', 'title', 'report_date', 'risk_score', 'created_at'] as const;

/** ส่วนของ query builder ที่ตัวกรองรายการ Incident ต้องใช้ */
interface IncidentFilterableQuery {
  eq(column: string, value: unknown): IncidentFilterableQuery;
  is(column: string, value: null): IncidentFilterableQuery;
  or(filters: string): IncidentFilterableQuery;
  gte(column: string, value: unknown): IncidentFilterableQuery;
  lte(column: string, value: unknown): IncidentFilterableQuery;
}

interface IncidentListFilters {
  search?: string;
  status?: string;
  severity?: string;
  category?: string;
  personalData?: string;
  riskLevel?: string;
  mine?: string;
}

/**
 * ตัวกรองของรายการ Incident — ใช้ร่วมกันระหว่างการแสดงผลกับการส่งออก
 * ต้องเป็นตัวเดียวกันเท่านั้น ไม่งั้นไฟล์ที่ส่งออกจะมีข้อมูลไม่ตรงกับที่ผู้ใช้เห็นบนหน้าจอ
 */
function applyIncidentListFilters<T>(
  query: T,
  { search, status, severity, category, personalData, riskLevel, mine }: IncidentListFilters,
  actorId: string,
): T {
  // มอง builder เป็นโครงแคบ ๆ เพราะ generic เต็มของ supabase-js ซ้อนลึกจน TypeScript ยอมแพ้
  let next = query as unknown as IncidentFilterableQuery;
  next = next.is('archived_at', null);
  if (search) {
    const safe = cleanSearch(search);
    next = next.or(`incident_number.ilike.%${safe}%,title.ilike.%${safe}%,affected_system.ilike.%${safe}%`);
  }
  if (status) next = next.eq('status', status);
  if (severity) next = next.eq('severity', severity);
  if (category) next = next.eq('category', category);
  if (personalData) next = next.eq('contains_personal_data', personalData === 'true');
  if (mine === 'true') next = next.or(`reported_by.eq.${actorId},assignee_id.eq.${actorId}`);
  if (riskLevel) {
    const [min, max] = RISK_RANGES[riskLevel];
    next = next.gte('risk_score', min).lte('risk_score', max);
  }
  return next as unknown as T;
}

incidentsRoute.get('/', zValidator('query', listIncidentsQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { page, pageSize, sort, order, search, status, severity, category, personalData, riskLevel: risk, mine } = c.req.valid('query');
  let query = c
    .get('supabase')
    .from('incidents')
    .select(INCIDENT_SELECT, { count: 'exact' })
    .range(...paginationRange(page, pageSize));
  query = applySort(query, { sort, order }, INCIDENT_SORT_COLUMNS, { column: 'report_date', ascending: false });
  query = applyIncidentListFilters(query, { search, status, severity, category, personalData, riskLevel: risk, mine }, actorId);
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'INCIDENTS_LIST_FAILED', 'ดึงรายการ Incident ไม่สำเร็จ'), 400);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return c.json(ok(reqId, toPaginatedData(rows.map((row) => mapIncident(row)), count, page, pageSize)));
});

/** แถวดิบของ Incident เท่าที่การส่งออกต้องใช้ */
interface IncidentExportRow {
  incident_number: string | null;
  title: string | null;
  category: string | null;
  severity: string | null;
  status: string | null;
  risk_score: number | null;
  contains_personal_data: boolean | null;
  major_incident: boolean | null;
  detection_source: string | null;
  report_date: string | null;
  reporter: { full_name: string | null } | null;
  assignee: { full_name: string | null } | null;
  incident_commander: { full_name: string | null } | null;
}

const INCIDENT_EXPORT_COLUMNS: ExportColumn<IncidentExportRow>[] = [
  { label: 'เลขที่', value: (row) => row.incident_number },
  { label: 'เรื่อง', value: (row) => row.title },
  { label: 'ประเภท', value: (row) => row.category },
  { label: 'ความรุนแรง', value: (row) => row.severity },
  { label: 'สถานะ', value: (row) => row.status },
  { label: 'คะแนนความเสี่ยง', value: (row) => row.risk_score },
  { label: 'มีข้อมูลส่วนบุคคล', value: (row) => (row.contains_personal_data ? 'ใช่' : 'ไม่ใช่') },
  { label: 'Major Incident', value: (row) => (row.major_incident ? 'ใช่' : 'ไม่ใช่') },
  { label: 'Detection Source', value: (row) => row.detection_source },
  { label: 'ผู้รายงาน', value: (row) => row.reporter?.full_name ?? '' },
  { label: 'ผู้รับผิดชอบ', value: (row) => row.assignee?.full_name ?? '' },
  { label: 'Incident Commander', value: (row) => row.incident_commander?.full_name ?? '' },
  { label: 'วันที่รายงาน', value: (row) => row.report_date },
];

/**
 * ส่งออกรายการ Incident ทั้งชุดตามตัวกรองที่ตั้งไว้ — ไม่ใช่แค่หน้าที่เปิดอยู่
 * ต้องมาก่อน route '/:id' ไม่งั้น Hono จะจับ 'export' เป็น id
 */
incidentsRoute.get('/export', zValidator('query', listIncidentsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { sort, order, search, status, severity, category, personalData, riskLevel: risk, mine } = c.req.valid('query');
  const filters = { search, status, severity, category, personalData, riskLevel: risk, mine };

  // นับก่อน เพื่อไม่ต้องดึงของที่รู้อยู่แล้วว่าส่งออกไม่ได้
  const { count, error: countError } = await applyIncidentListFilters(
    supabase.from('incidents').select('id', { count: 'exact', head: true }),
    filters,
    actorId,
  );
  if (countError) return c.json(fail(reqId, 'INCIDENTS_EXPORT_FAILED', 'นับรายการเพื่อส่งออกไม่สำเร็จ'), 400);

  const tooLarge = checkExportSize(count);
  if (tooLarge) return c.json(fail(reqId, 'EXPORT_TOO_LARGE', tooLarge.message), 400);

  let query = supabase
    .from('incidents')
    .select(
      'incident_number, title, category, severity, status, risk_score, contains_personal_data, major_incident, detection_source, report_date, ' +
      'reporter:profiles!incidents_reported_by_fkey(full_name), assignee:profiles!incidents_assignee_id_fkey(full_name), ' +
      'incident_commander:profiles!incidents_incident_commander_id_fkey(full_name)',
    )
    .range(0, LIST_EXPORT_MAX_ROWS - 1);
  query = applySort(query, { sort, order }, INCIDENT_SORT_COLUMNS, { column: 'report_date', ascending: false });
  query = applyIncidentListFilters(query, filters, actorId);

  const { data, error } = await query;
  if (error) return c.json(fail(reqId, 'INCIDENTS_EXPORT_FAILED', 'ดึงข้อมูลเพื่อส่งออกไม่สำเร็จ'), 400);

  const rows = (data ?? []) as unknown as IncidentExportRow[];
  // ทะเบียน Incident มีรายละเอียดเหตุการณ์ด้านความมั่นคงปลอดภัย การดึงออกทั้งชุดจึงต้องตรวจย้อนได้
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'EXPORT',
    module: 'incident',
    targetTable: 'incidents',
    detail: { filters, rowCount: rows.length },
    requestId: reqId,
  });

  return c.json(ok(reqId, {
    filename: exportFileName('incidents'),
    csv: listCsv(INCIDENT_EXPORT_COLUMNS, rows),
    rowCount: rows.length,
  }));
});

incidentsRoute.get('/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const { data: incident, error } = await loadIncident(c.get('supabase'), id);
  if (error || !incident) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  const [notificationsResult, filesResult, context] = await Promise.all([
    c.get('supabase').from('regulatory_notifications').select('*').eq('incident_id', id).order('created_at', { ascending: false }),
    c.get('supabase').from('file_attachments').select('id, original_filename, mime_type, size_bytes, created_at').eq('module', 'incident').eq('target_table', 'incidents').eq('target_id', id),
    loadIncidentOperationalContext(c.env, id, incident.affected_ci_id ?? null),
  ]);
  if (notificationsResult.error) return c.json(fail(reqId, 'INCIDENT_NOTIFICATIONS_LOAD_FAILED', 'ดึงประวัติการแจ้งไม่สำเร็จ'), 400);
  return c.json(ok(reqId, {
    incident: { ...mapIncident(incident), affected_ci: context.affectedCi },
    regulatoryNotifications: notificationsResult.data ?? [],
    attachments: filesResult.data ?? [],
    notificationClocks: context.notificationClocks,
    notificationTimeline: context.notificationTimeline,
    ciRelationships: context.ciRelationships,
    followUpProblems: context.followUpProblems,
    emergencyChanges: context.emergencyChanges,
  }));
});

incidentsRoute.post('/', requirePermission('incident.create'), zValidator('json', createIncidentSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const now = Date.now();
  let affectedCiName: string | null = null;
  if (body.affectedCiId) {
    const { data: ci } = await createAdminClient(c.env).from('configuration_items').select('id, name').eq('id', body.affectedCiId).neq('status', 'Retired').maybeSingle();
    if (!ci) return c.json(fail(reqId, 'INCIDENT_CI_NOT_FOUND', 'ไม่พบ Configuration Item ที่เลือก หรือ CI ถูกเลิกใช้แล้ว'), 400);
    affectedCiName = ci.name;
  }
  const { data, error } = await c
    .get('supabase')
    .from('incidents')
    .insert({
      incident_number: generateIncidentNumber(),
      title: body.title,
      reported_by: actorId,
      category: body.category,
      description: body.description,
      affected_system: body.affectedSystem || affectedCiName,
      affected_ci_id: body.affectedCiId || null,
      detection_source: body.detectionSource || null,
      contains_personal_data: body.containsPersonalData ?? false,
      major_incident: body.majorIncident ?? false,
      incident_commander_id: body.incidentCommanderId || null,
      dpo_notify_deadline: body.containsPersonalData ? new Date(now + 4 * 3600_000).toISOString() : null,
      evidence_url: body.evidenceUrl || null,
      created_by: actorId,
      updated_by: actorId,
    })
    .select()
    .single();
  if (error) return dbFailJson(c, 'INCIDENT_CREATE_FAILED', error);
  await writeIncidentTimeline(c.env, { incidentId: data.id, eventType: 'REPORT_RECEIVED', actorId, occurredAt: data.report_date, note: 'สร้าง Incident' });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'REPORT', module: 'incident', targetTable: 'incidents', targetId: data.id, detail: { incidentNumber: data.incident_number, containsPersonalData: data.contains_personal_data }, requestId: reqId });
  if (data.contains_personal_data) await notifyDpoUsers(c.env, data.id, data.title);
  return c.json(ok(reqId, mapIncident(data)), 201);
});

incidentsRoute.post('/from-ticket/:ticketId', requireAnyPermission(['incident.manage', 'ticket.escalate']), zValidator('json', escalateTicketSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  if (!(await hasPerm(c, 'ticket.escalate'))) return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ยกระดับ Ticket เป็น Incident'), 403);
  const ticketId = c.req.param('ticketId')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: ticket, error: ticketError } = await admin.from('tickets').select('*, ticket_categories(name), requester:profiles!tickets_requester_id_fkey(full_name, email)').eq('id', ticketId).maybeSingle();
  if (ticketError || !ticket) return c.json(fail(reqId, 'TICKET_NOT_FOUND', 'ไม่พบ Ticket ที่ต้องการยกระดับ'), 404);
  if (ticket.incident_id) {
    const { data: existing } = await admin.from('incidents').select('*').eq('id', ticket.incident_id).maybeSingle();
    if (!existing || existing.source_ticket_id !== ticketId) return c.json(fail(reqId, 'INCIDENT_PROVENANCE_INVALID', 'ความสัมพันธ์ Ticket/Incident ไม่สอดคล้องกัน'), 409);
    return c.json(ok(reqId, { ...mapIncident(existing), duplicate: true }));
  }
  if (['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'].includes(ticket.status)) return c.json(fail(reqId, 'TICKET_TRANSITION_INVALID', 'Ticket นี้อยู่ในสถานะที่ยกระดับไม่ได้'), 400);
  const categoryName = (ticket.ticket_categories as { name?: string } | null)?.name ?? 'ไม่ระบุ';
  const description = `ยกระดับจาก Ticket ${ticket.ticket_no ?? ticketId}\n\nหัวข้อ: ${ticket.title}\nหมวด Ticket: ${categoryName}\n\n${ticket.description}${body.notes ? `\n\nหมายเหตุการยกระดับ: ${body.notes}` : ''}`;
  const { data: incident, error: insertError } = await admin
    .from('incidents')
    .insert({ incident_number: generateIncidentNumber(), title: `[Ticket] ${ticket.title}`.slice(0, 200), reported_by: ticket.requester_id ?? actorId, category: body.category, severity: body.severity, description: description.slice(0, 3000), affected_system: categoryName.slice(0, 150), detection_source: 'Ticket escalation', contains_personal_data: body.containsPersonalData ?? false, dpo_notify_deadline: body.containsPersonalData ? new Date(Date.now() + 4 * 3600_000).toISOString() : null, source_ticket_id: ticketId, notes: `SourceTicketID=${ticket.ticket_no ?? ticketId}`, created_by: actorId, updated_by: actorId })
    .select()
    .single();
  if (insertError) return dbFailJson(c, 'INCIDENT_CREATE_FAILED', insertError);
  const { error: updateError } = await admin.rpc('transition_ticket_with_worklog_service', {
    ticket_id_input: ticketId,
    expected_status_input: ticket.status,
    patch_input: { incident_id: incident.id, is_security: true, status: 'ยกระดับเป็น Incident' },
    action_input: 'ยกระดับเป็น Incident',
    detail_input: `Incident ${incident.incident_number}`,
    actor_id_input: actorId,
    minutes_spent_input: null,
  });
  if (updateError) {
    await admin.from('incidents').delete().eq('id', incident.id);
    return dbFailJson(c, 'TICKET_ESCALATION_FAILED', updateError);
  }
  await writeIncidentTimeline(c.env, { incidentId: incident.id, eventType: 'REPORT_RECEIVED', actorId, note: `ยกระดับจาก Ticket ${ticket.ticket_no ?? ticketId}` });
  await Promise.all([
    writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'ESCALATE_INCIDENT', module: 'ticket', targetTable: 'tickets', targetId: ticketId, detail: { incidentId: incident.id }, requestId: reqId }),
    writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE_FROM_TICKET', module: 'incident', targetTable: 'incidents', targetId: incident.id, detail: { ticketId }, requestId: reqId }),
    ...(ticket.requester_id ? [sendNotification(c.env, { recipientId: ticket.requester_id, type: 'ticket_escalated', title: `Ticket ถูกยกระดับเป็น Incident ${incident.incident_number}`, link: `/incidents/${incident.id}` })] : []),
  ]);
  if (incident.contains_personal_data) await notifyDpoUsers(c.env, incident.id, incident.title);
  return c.json(ok(reqId, mapIncident(incident)), 201);
});

incidentsRoute.patch('/:id', requirePermission('incident.manage'), zValidator('json', updateIncidentSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  let affectedCiName: string | null = null;
  if (body.affectedCiId) {
    const { data: ci } = await createAdminClient(c.env).from('configuration_items').select('id, name').eq('id', body.affectedCiId).neq('status', 'Retired').maybeSingle();
    if (!ci) return c.json(fail(reqId, 'INCIDENT_CI_NOT_FOUND', 'ไม่พบ Configuration Item ที่เลือก หรือ CI ถูกเลิกใช้แล้ว'), 400);
    affectedCiName = ci.name;
  }
  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.severity !== undefined) patch.severity = body.severity;
  if (body.likelihood !== undefined) patch.likelihood = body.likelihood;
  if (body.impact !== undefined) patch.impact = body.impact;
  if (body.assigneeId !== undefined) patch.assignee_id = body.assigneeId;
  if (body.affectedCiId !== undefined) {
    patch.affected_ci_id = body.affectedCiId || null;
    if (affectedCiName) patch.affected_system = affectedCiName;
  }
  if (body.detectionSource !== undefined) patch.detection_source = body.detectionSource || null;
  if (body.containment !== undefined) patch.containment = body.containment || null;
  if (body.eradication !== undefined) patch.eradication = body.eradication || null;
  if (body.recovery !== undefined) patch.recovery = body.recovery || null;
  if (body.majorIncident !== undefined) patch.major_incident = body.majorIncident;
  if (body.incidentCommanderId !== undefined) patch.incident_commander_id = body.incidentCommanderId || null;
  if (body.status !== undefined) patch.status = body.status;
  if (body.notes !== undefined) patch.notes = body.notes || null;
  if (body.evidenceUrl !== undefined) patch.evidence_url = body.evidenceUrl || null;
  const auditBefore = await loadAuditSnapshot(c.get('supabase'), 'incidents', id);
  const { data, error } = await c.get('supabase').from('incidents').update(patch).eq('id', id).select().maybeSingle();
  if (error || !data) return dbFailJson(c, 'INCIDENT_UPDATE_FAILED', error, 'ไม่พบ Incident');
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'incident', targetTable: 'incidents', targetId: id, detail: body, requestId: reqId , before: auditBefore, after: data });
  if (body.assigneeId) await sendNotification(c.env, { recipientId: body.assigneeId, type: 'incident_assigned', title: `ท่านได้รับมอบหมาย Incident ${data.incident_number}`, link: `/incidents/${id}` });
  return c.json(ok(reqId, mapIncident(data)));
});

incidentsRoute.post('/:id/dpo-notified', requireAnyPermission(['incident.manage', 'incident.regulatory']), zValidator('json', markDpoNotifiedSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: current } = await loadIncident(admin, id);
  if (!current || (!current.contains_personal_data && !(await hasPerm(c, 'incident.manage')))) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident ที่ดำเนินการได้'), 404);
  const { data, error } = await admin.from('incidents').update({ dpo_notified_at: new Date().toISOString(), dpo_notified_by: actorId, dpo_notify_note: body.note, updated_by: actorId }).eq('id', id).select().single();
  if (error) return dbFailJson(c, 'INCIDENT_DPO_UPDATE_FAILED', error);
  await writeIncidentTimeline(c.env, { incidentId: id, eventType: 'DPO_ACKNOWLEDGED', actorId, note: body.note, occurredAt: data.dpo_notified_at });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'DPO_NOTIFIED', module: 'incident', targetTable: 'incidents', targetId: id, detail: { note: body.note }, requestId: reqId });
  return c.json(ok(reqId, mapIncident(data)));
});

incidentsRoute.post('/:id/regulatory-assessment', requireAnyPermission(['incident.manage', 'incident.regulatory']), zValidator('json', regulatoryAssessmentSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: current } = await loadIncident(admin, id);
  if (!current || (!current.contains_personal_data && !(await hasPerm(c, 'incident.manage')))) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident ที่ดำเนินการได้'), 404);
  const pending = [body.pdpcRequired, body.dataSubjectRequired, body.ncsaRequired, body.otherRegulatorRequired].includes('Pending');
  const { data, error } = await admin.from('incidents').update({ regulatory_assessment_status: pending ? 'รอตัดสินใจ' : 'ประเมินแล้ว', breach_risk_level: body.breachRiskLevel ?? null, pdpc_notify_required: body.pdpcRequired, data_subject_notify_required: body.dataSubjectRequired, ncsa_report_required: body.ncsaRequired, other_regulator_required: body.otherRegulatorRequired, regulatory_assessment: body.assessment, regulatory_assessed_at: new Date().toISOString(), regulatory_assessed_by: actorId, updated_by: actorId }).eq('id', id).select().single();
  if (error) return dbFailJson(c, 'INCIDENT_ASSESSMENT_FAILED', error);
  const clockDecisions = [
    { clockType: 'PDPA', decision: body.pdpcRequired, deadlineAt: body.pdpaDeadline },
    { clockType: 'CYBER', decision: body.ncsaRequired, deadlineAt: body.cyberDeadline },
  ] as const;
  for (const clock of clockDecisions) {
    if (clock.decision === 'Pending') continue;
    const clockResult = await upsertNotificationClock(admin, id, actorId, {
      clockType: clock.clockType,
      deadlineAt: clock.decision === 'Yes' ? clock.deadlineAt : null,
      status: clock.decision === 'Yes' ? 'RUNNING' : 'NOT_REQUIRED',
      notes: clock.decision === 'No' ? 'ผลประเมินระบุว่าไม่ต้องแจ้ง' : undefined,
    });
    if (clockResult.error || !clockResult.data) return dbFailJson(c, 'INCIDENT_CLOCK_UPDATE_FAILED', clockResult.error);
    if (clock.decision === 'Yes' && clockResult.wasCreated) {
      await writeIncidentTimeline(c.env, { incidentId: id, eventType: `${clock.clockType}_CLOCK_STARTED`, actorId, note: `เริ่มนับ clock ${clock.clockType}`, occurredAt: clockResult.data.started_at });
    }
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'ASSESS_REGULATORY_NOTIFICATION', module: 'incident', targetTable: 'incidents', targetId: id, detail: body, requestId: reqId });
  return c.json(ok(reqId, mapIncident(data)));
});

incidentsRoute.post('/:id/regulatory-notifications', requireAnyPermission(['incident.manage', 'incident.regulatory']), zValidator('json', createRegulatoryNotificationSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: incident } = await loadIncident(admin, id);
  if (!incident || (!incident.contains_personal_data && !(await hasPerm(c, 'incident.manage')))) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident ที่ดำเนินการได้'), 404);
  const { data, error } = await admin.from('regulatory_notifications').insert({ incident_id: id, destination: body.destination, agency: body.agency, notification_type: body.notificationType, required: body.required, legal_basis: body.legalBasis || null, deadline: body.deadline || null, status: body.status, notified_at: body.status === 'แจ้งแล้ว' ? body.notifiedAt || new Date().toISOString() : null, reference_no: body.referenceNo || null, approved_by: actorId, evidence_url: body.evidenceUrl || null, reason_not_required: body.reasonNotRequired || null, notes: body.notes || null, created_by: actorId, updated_by: actorId }).select().single();
  if (error) return dbFailJson(c, 'REGULATORY_NOTIFICATION_CREATE_FAILED', error);
  const eventType = body.status === 'แจ้งแล้ว'
    ? ({ PDPC: 'PDPA_NOTIFIED', NCSA: 'CYBER_NOTIFIED', DATA_SUBJECT: 'DATA_SUBJECT_NOTIFIED', OTHER: 'OTHER_REGULATOR_NOTIFIED' } as Record<string, string>)[body.destination]
    : 'NOTIFICATION_RECORDED';
  if (body.status === 'แจ้งแล้ว' && (body.destination === 'PDPC' || body.destination === 'NCSA')) {
    const clockResult = await upsertNotificationClock(admin, id, actorId, {
      clockType: body.destination === 'PDPC' ? 'PDPA' : 'CYBER',
      deadlineAt: body.deadline,
      status: 'NOTIFIED',
      notifiedAt: data.notified_at,
      referenceNo: body.referenceNo,
      notes: body.notes,
    });
    if (clockResult.error || !clockResult.data) return dbFailJson(c, 'INCIDENT_CLOCK_UPDATE_FAILED', clockResult.error);
  }
  await writeIncidentTimeline(c.env, { incidentId: id, eventType, actorId, destination: body.destination, occurredAt: data.notified_at ?? undefined, note: `${body.agency} · ${body.notificationType}`, referenceNo: body.referenceNo });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'RECORD_REGULATORY_NOTIFICATION', module: 'incident', targetTable: 'regulatory_notifications', targetId: data.id, detail: { incidentId: id, destination: body.destination, status: body.status }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

incidentsRoute.post('/:id/notification-clocks', requireAnyPermission(['incident.manage', 'incident.regulatory']), zValidator('json', notificationClockSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: incident } = await loadIncident(admin, id);
  if (!incident || (!incident.contains_personal_data && !(await hasPerm(c, 'incident.manage')))) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident ที่ดำเนินการได้'), 404);
  const clockResult = await upsertNotificationClock(admin, id, actorId, {
    clockType: body.clockType,
    startedAt: body.startedAt,
    deadlineAt: body.deadlineAt,
    status: body.status,
    notifiedAt: body.notifiedAt,
    referenceNo: body.referenceNo,
    notes: body.notes,
  });
  if (clockResult.error || !clockResult.data) return dbFailJson(c, 'INCIDENT_CLOCK_UPDATE_FAILED', clockResult.error);
  if (body.status === 'NOTIFIED') {
    await writeIncidentTimeline(c.env, { incidentId: id, eventType: `${body.clockType}_NOTIFIED`, actorId, occurredAt: clockResult.data.notified_at ?? undefined, note: body.notes, referenceNo: body.referenceNo });
  } else if (body.status === 'RUNNING' && clockResult.wasCreated) {
    await writeIncidentTimeline(c.env, { incidentId: id, eventType: `${body.clockType}_CLOCK_STARTED`, actorId, occurredAt: clockResult.data.started_at, note: body.notes });
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE_NOTIFICATION_CLOCK', module: 'incident', targetTable: 'incident_notification_clocks', targetId: clockResult.data.id, detail: { incidentId: id, clockType: body.clockType, status: body.status }, requestId: reqId });
  return c.json(ok(reqId, clockResult.data));
});

incidentsRoute.post('/:id/notification-timeline', requireAnyPermission(['incident.manage', 'incident.regulatory']), zValidator('json', notificationTimelineEventSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: incident } = await loadIncident(admin, id);
  if (!incident || (!incident.contains_personal_data && !(await hasPerm(c, 'incident.manage')))) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident ที่ดำเนินการได้'), 404);
  const { data, error } = await admin.from('incident_notification_timeline').insert({
    incident_id: id,
    event_type: body.eventType,
    destination: body.destination ?? null,
    occurred_at: body.occurredAt || new Date().toISOString(),
    note: body.note,
    reference_no: body.referenceNo || null,
    created_by: actorId,
  }).select('*').single();
  if (error) return dbFailJson(c, 'INCIDENT_TIMELINE_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'ADD_NOTIFICATION_TIMELINE', module: 'incident', targetTable: 'incident_notification_timeline', targetId: data.id, detail: { incidentId: id, eventType: body.eventType }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

incidentsRoute.post('/:id/create-problem', requirePermission('problem.manage'), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const admin = createAdminClient(c.env);
  const { data: incident } = await loadIncident(admin, id);
  if (!incident) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident'), 404);
  const { data: existingLink } = await admin.from('problem_incidents').select('problem_id').eq('incident_id', id).limit(1).maybeSingle();
  if (existingLink) {
    const { data: existingProblem } = await admin.from('problems').select('*').eq('id', existingLink.problem_id).maybeSingle();
    if (existingProblem) return c.json(ok(reqId, { problem: existingProblem, duplicate: true }));
  }
  const incidentRecord = incident as IncidentRow & { affected_ci_id: string | null; affected_system: string | null; incident_commander_id: string | null; assignee_id: string | null; severity: string | null; category: string; description: string };
  const { data: ci } = incidentRecord.affected_ci_id
    ? await admin.from('configuration_items').select('name, ci_code').eq('id', incidentRecord.affected_ci_id).maybeSingle()
    : { data: null };
  const systemName = ci?.name ?? incidentRecord.affected_system ?? 'ไม่ระบุระบบ';
  const { data: problem, error } = await admin.from('problems').insert({
    problem_number: `PRB-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomCodeSuffix()}`,
    title: `[Incident] ${incidentRecord.title}`.slice(0, 200),
    category: incidentRecord.category,
    affected_system: systemName.slice(0, 200),
    impact: `สร้างจาก ${incidentRecord.incident_number}: ${incidentRecord.description}`.slice(0, 1000),
    owner_id: incidentRecord.incident_commander_id ?? incidentRecord.assignee_id,
    priority: INCIDENT_TO_PROBLEM_PRIORITY[incidentRecord.severity ?? 'ปานกลาง'] ?? 'ปานกลาง',
    status: 'เปิด',
    notes: `CreatedFromIncident=${incidentRecord.incident_number}`,
    created_by: actorId,
    updated_by: actorId,
  }).select('*').single();
  if (error || !problem) return dbFailJson(c, 'INCIDENT_PROBLEM_CREATE_FAILED', error);
  const { error: linkError } = await admin.from('problem_incidents').insert({ problem_id: problem.id, incident_id: id, created_by: actorId });
  if (linkError) {
    await admin.from('problems').delete().eq('id', problem.id);
    return dbFailJson(c, 'INCIDENT_PROBLEM_LINK_FAILED', linkError);
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE_PROBLEM_FROM_INCIDENT', module: 'incident', targetTable: 'incidents', targetId: id, detail: { problemId: problem.id }, requestId: reqId });
  return c.json(ok(reqId, { problem, duplicate: false }), 201);
});

incidentsRoute.post('/:id/create-emergency-change', requirePermission('change.create'), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const admin = createAdminClient(c.env);
  const { data: incident } = await loadIncident(admin, id);
  if (!incident) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident'), 404);
  const { data: existingChange } = await admin.from('change_requests').select('*').eq('source_incident_id', id).limit(1).maybeSingle();
  if (existingChange) return c.json(ok(reqId, { change: existingChange, duplicate: true }));
  const incidentRecord = incident as IncidentRow & { affected_ci_id: string | null; affected_system: string | null; severity: string | null; description: string; major_incident: boolean };
  const { data: ci } = incidentRecord.affected_ci_id
    ? await admin.from('configuration_items').select('name, ci_code').eq('id', incidentRecord.affected_ci_id).maybeSingle()
    : { data: null };
  const systemName = ci?.name ?? incidentRecord.affected_system ?? 'ไม่ระบุระบบ';
  const { data: change, error } = await admin.from('change_requests').insert({
    change_number: `CHG-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomCodeSuffix()}`,
    title: `[Emergency][${incidentRecord.incident_number}] ${incidentRecord.title}`.slice(0, 200),
    system_affected: systemName.slice(0, 150),
    change_type: 'Emergency',
    description: `Emergency Change จาก Incident ${incidentRecord.incident_number}\n\n${incidentRecord.description}`.slice(0, 3000),
    requester_id: actorId,
    impact_assessment: `เร่งด่วนเพื่อควบคุม/กู้คืน Incident ${incidentRecord.incident_number}${incidentRecord.major_incident ? ' (Major Incident)' : ''}`.slice(0, 2000),
    risk_level: INCIDENT_TO_CHANGE_RISK[incidentRecord.severity ?? 'ปานกลาง'] ?? 'กลาง',
    rollback_plan: 'ต้องจัดทำและทบทวนแผนย้อนกลับก่อนติดตั้งใช้งาน',
    source_incident_id: id,
    notes: `CreatedFromIncident=${incidentRecord.incident_number}`,
    created_by: actorId,
    updated_by: actorId,
  }).select('*').single();
  if (error || !change) return dbFailJson(c, 'INCIDENT_CHANGE_CREATE_FAILED', error);
  await admin.from('ci_relationships').insert({
    source_type: 'Incident', source_id: id, target_type: 'Change', target_id: change.id,
    relationship_type: 'LINKED_TO', direction: 'Bidirectional', impact_level: incidentRecord.severity === 'วิกฤต' ? 'Critical' : 'High',
    description: 'Emergency Change ที่สร้างจาก Incident', created_by: actorId, updated_by: actorId,
  });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE_EMERGENCY_CHANGE_FROM_INCIDENT', module: 'incident', targetTable: 'incidents', targetId: id, detail: { changeId: change.id }, requestId: reqId });
  return c.json(ok(reqId, { change, duplicate: false }), 201);
});

incidentsRoute.post('/:id/close', requirePermission('incident.manage'), zValidator('json', closeIncidentSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const [{ data: incident }, { data: notifications }] = await Promise.all([
    loadIncident(admin, id),
    admin.from('regulatory_notifications').select('destination, required, status').eq('incident_id', id),
  ]);
  if (!incident) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident'), 404);
  const gaps = closureGaps(incident as unknown as IncidentRow, (notifications ?? []) as Record<string, unknown>[]);
  if (gaps.length) return c.json(fail(reqId, 'INCIDENT_CLOSURE_BLOCKED', `ยังปิด Incident ไม่ได้: ${gaps.join(' · ')}`), 409);
  const { data, error } = await c.get('supabase').from('incidents').update({ root_cause: body.rootCause, resolution: body.resolution, lessons_learned: body.lessonsLearned || null, status: 'ปิดเคส', closed_at: new Date().toISOString(), updated_by: actorId }).eq('id', id).select().single();
  if (error) return dbFailJson(c, 'INCIDENT_CLOSE_FAILED', error);
  await Promise.all([
    writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CLOSE', module: 'incident', targetTable: 'incidents', targetId: id, requestId: reqId }),
    sendNotification(c.env, { recipientId: data.reported_by, type: 'incident_closed', title: `Incident ${data.incident_number} ปิดเคสแล้ว`, link: `/incidents/${id}` }),
  ]);
  return c.json(ok(reqId, mapIncident(data)));
});
