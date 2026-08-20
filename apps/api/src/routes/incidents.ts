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
  regulatoryAssessmentSchema,
  updateIncidentSchema,
} from '../validators/incidents';

export const incidentsRoute = new Hono<AppEnv>();

incidentsRoute.use('*', requireAuth);
incidentsRoute.use('*', requirePermission('incident.view'));

const INCIDENT_SELECT =
  '*, reporter:profiles!incidents_reported_by_fkey(id, full_name, email), ' +
  'assignee:profiles!incidents_assignee_id_fkey(id, full_name, email), ' +
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
  const { data, error } = await c.get('supabase').from('incidents').select('likelihood, impact, status').neq('status', 'ปิดเคส');
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

/** risk_score เรียงได้เพราะเป็นตัวเลข ส่วน severity/risk_level เป็นข้อความไทยจึงไม่เปิดให้เรียง */
const INCIDENT_SORT_COLUMNS = ['incident_number', 'title', 'report_date', 'risk_score', 'created_at'] as const;

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
  if (search) {
    const safe = cleanSearch(search);
    query = query.or(`incident_number.ilike.%${safe}%,title.ilike.%${safe}%`);
  }
  if (status) query = query.eq('status', status);
  if (severity) query = query.eq('severity', severity);
  if (category) query = query.eq('category', category);
  if (personalData) query = query.eq('contains_personal_data', personalData === 'true');
  if (mine === 'true') query = query.or(`reported_by.eq.${actorId},assignee_id.eq.${actorId}`);
  if (risk) {
    const [min, max] = RISK_RANGES[risk];
    query = query.gte('risk_score', min).lte('risk_score', max);
  }
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'INCIDENTS_LIST_FAILED', 'ดึงรายการ Incident ไม่สำเร็จ'), 400);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return c.json(ok(reqId, toPaginatedData(rows.map((row) => mapIncident(row)), count, page, pageSize)));
});

incidentsRoute.get('/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const { data: incident, error } = await loadIncident(c.get('supabase'), id);
  if (error || !incident) return c.json(fail(reqId, 'INCIDENT_NOT_FOUND', 'ไม่พบ Incident นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  const [notificationsResult, filesResult] = await Promise.all([
    c.get('supabase').from('regulatory_notifications').select('*').eq('incident_id', id).order('created_at', { ascending: false }),
    c.get('supabase').from('file_attachments').select('id, original_filename, mime_type, size_bytes, created_at').eq('module', 'incident').eq('target_table', 'incidents').eq('target_id', id),
  ]);
  if (notificationsResult.error) return c.json(fail(reqId, 'INCIDENT_NOTIFICATIONS_LOAD_FAILED', 'ดึงประวัติการแจ้งไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { incident: mapIncident(incident), regulatoryNotifications: notificationsResult.data ?? [], attachments: filesResult.data ?? [] }));
});

incidentsRoute.post('/', requirePermission('incident.create'), zValidator('json', createIncidentSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const now = Date.now();
  const { data, error } = await c
    .get('supabase')
    .from('incidents')
    .insert({
      incident_number: generateIncidentNumber(),
      title: body.title,
      reported_by: actorId,
      category: body.category,
      description: body.description,
      affected_system: body.affectedSystem || null,
      contains_personal_data: body.containsPersonalData ?? false,
      dpo_notify_deadline: body.containsPersonalData ? new Date(now + 4 * 3600_000).toISOString() : null,
      evidence_url: body.evidenceUrl || null,
      created_by: actorId,
      updated_by: actorId,
    })
    .select()
    .single();
  if (error) return dbFailJson(c, 'INCIDENT_CREATE_FAILED', error);
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
    .insert({ incident_number: generateIncidentNumber(), title: `[Ticket] ${ticket.title}`.slice(0, 200), reported_by: ticket.requester_id ?? actorId, category: body.category, severity: body.severity, description: description.slice(0, 3000), affected_system: categoryName.slice(0, 150), contains_personal_data: body.containsPersonalData ?? false, dpo_notify_deadline: body.containsPersonalData ? new Date(Date.now() + 4 * 3600_000).toISOString() : null, source_ticket_id: ticketId, notes: `SourceTicketID=${ticket.ticket_no ?? ticketId}`, created_by: actorId, updated_by: actorId })
    .select()
    .single();
  if (insertError) return dbFailJson(c, 'INCIDENT_CREATE_FAILED', insertError);
  const { error: updateError } = await admin.from('tickets').update({ incident_id: incident.id, is_security: true, status: 'ยกระดับเป็น Incident', updated_by: actorId }).eq('id', ticketId).is('incident_id', null);
  if (updateError) {
    await admin.from('incidents').delete().eq('id', incident.id);
    return dbFailJson(c, 'TICKET_ESCALATION_FAILED', updateError);
  }
  await admin.from('ticket_worklogs').insert({ ticket_id: ticketId, action: 'ยกระดับเป็น Incident', detail: `Incident ${incident.incident_number}`, status_from: ticket.status, status_to: 'ยกระดับเป็น Incident', is_public: true, actor_id: actorId });
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
  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.severity !== undefined) patch.severity = body.severity;
  if (body.likelihood !== undefined) patch.likelihood = body.likelihood;
  if (body.impact !== undefined) patch.impact = body.impact;
  if (body.assigneeId !== undefined) patch.assignee_id = body.assigneeId;
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
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'RECORD_REGULATORY_NOTIFICATION', module: 'incident', targetTable: 'regulatory_notifications', targetId: data.id, detail: { incidentId: id, destination: body.destination, status: body.status }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
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
