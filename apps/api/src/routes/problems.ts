import { zValidator } from '@hono/zod-validator';
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
  createKnownErrorSchema,
  createProblemSchema,
  listKnownErrorsQuerySchema,
  listProblemsQuerySchema,
  updateKnownErrorSchema,
  updateProblemSchema,
} from '../validators/problems';

export const problemsRoute = new Hono<AppEnv>();
problemsRoute.use('*', requireAuth);
problemsRoute.use('*', requirePermission('problem.view'));

const PROBLEM_SELECT =
  '*, owner:profiles!problems_owner_id_fkey(id, full_name, email), ' +
  'problem_incidents(incident:incidents(id, incident_number, title, status)), ' +
  'problem_tickets(ticket:tickets(id, title, status))';

const KNOWN_ERROR_SELECT =
  '*, problem:problems!known_errors_problem_id_fkey(id, problem_number, title, status)';

function generateNumber(prefix: 'PRB' | 'KEDB'): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${date}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function cleanSearch(value: string): string {
  return value.replace(/[%(),]/g, ' ').trim();
}

async function replaceLinks(
  env: AppEnv['Bindings'],
  problemId: string,
  actorId: string,
  incidentIds?: string[],
  ticketIds?: string[],
): Promise<string | null> {
  const admin = createAdminClient(env);
  if (incidentIds !== undefined) {
    const uniqueIds = [...new Set(incidentIds)];
    if (uniqueIds.length) {
      const { count, error } = await admin.from('incidents').select('id', { count: 'exact', head: true }).in('id', uniqueIds);
      if (error || count !== uniqueIds.length) return 'มี Incident ที่อ้างอิงไม่ถูกต้อง';
    }
  }
  if (ticketIds !== undefined) {
    const uniqueIds = [...new Set(ticketIds)];
    if (uniqueIds.length) {
      const { count, error } = await admin.from('tickets').select('id', { count: 'exact', head: true }).in('id', uniqueIds);
      if (error || count !== uniqueIds.length) return 'มี Ticket ที่อ้างอิงไม่ถูกต้อง';
    }
  }
  if (incidentIds !== undefined) {
    const { error } = await admin.from('problem_incidents').delete().eq('problem_id', problemId);
    if (error) return error.message;
    const rows = [...new Set(incidentIds)].map((incidentId) => ({ problem_id: problemId, incident_id: incidentId, created_by: actorId }));
    if (rows.length) {
      const { error: insertError } = await admin.from('problem_incidents').insert(rows);
      if (insertError) return insertError.message;
    }
  }
  if (ticketIds !== undefined) {
    const { error } = await admin.from('problem_tickets').delete().eq('problem_id', problemId);
    if (error) return error.message;
    const rows = [...new Set(ticketIds)].map((ticketId) => ({ problem_id: problemId, ticket_id: ticketId, created_by: actorId }));
    if (rows.length) {
      const { error: insertError } = await admin.from('problem_tickets').insert(rows);
      if (insertError) return insertError.message;
    }
  }
  return null;
}

problemsRoute.get('/references', requirePermission('problem.manage'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [owners, incidents, tickets, problems] = await Promise.all([
    admin.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name').limit(500),
    admin.from('incidents').select('id, incident_number, title, status').order('report_date', { ascending: false }).limit(500),
    admin.from('tickets').select('id, title, status').order('created_at', { ascending: false }).limit(500),
    admin.from('problems').select('id, problem_number, title, status').order('created_at', { ascending: false }).limit(500),
  ]);
  const error = owners.error ?? incidents.error ?? tickets.error ?? problems.error;
  if (error) return c.json(fail(reqId, 'PROBLEM_REFERENCES_LOAD_FAILED', 'ดึงข้อมูลอ้างอิงไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { owners: owners.data ?? [], incidents: incidents.data ?? [], tickets: tickets.data ?? [], problems: problems.data ?? [] }));
});

problemsRoute.get('/known-errors', zValidator('query', listKnownErrorsQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, problemId } = c.req.valid('query');
  let query = c.get('supabase').from('known_errors').select(KNOWN_ERROR_SELECT, { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (search) {
    const safe = cleanSearch(search);
    query = query.or(`known_error_number.ilike.%${safe}%,title.ilike.%${safe}%,symptoms.ilike.%${safe}%,workaround.ilike.%${safe}%`);
  }
  if (status) query = query.eq('status', status);
  if (problemId) query = query.eq('problem_id', problemId);
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'KNOWN_ERRORS_LIST_FAILED', 'ดึง Known Error ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

problemsRoute.post('/known-errors', requirePermission('problem.manage'), zValidator('json', createKnownErrorSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('known_errors').insert({
    known_error_number: generateNumber('KEDB'), problem_id: body.problemId, title: body.title,
    symptoms: body.symptoms || null, root_cause: body.rootCause || null, workaround: body.workaround,
    affected_versions: body.affectedVersions || null, fixed_version: body.fixedVersion || null,
    knowledge_article_ref: body.knowledgeArticleRef || null, status: body.status,
    review_date: body.reviewDate || null, notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select(KNOWN_ERROR_SELECT).single();
  if (error) return c.json(fail(reqId, 'KNOWN_ERROR_CREATE_FAILED', error.message), 400);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'problem', targetTable: 'known_errors', targetId: data.id, detail: { knownErrorNumber: data.known_error_number, problemId: body.problemId }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

problemsRoute.patch('/known-errors/:id', requirePermission('problem.manage'), zValidator('json', updateKnownErrorSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const patch: Record<string, unknown> = { updated_by: actorId };
  const fields = {
    problemId: 'problem_id', title: 'title', symptoms: 'symptoms', rootCause: 'root_cause', workaround: 'workaround',
    affectedVersions: 'affected_versions', fixedVersion: 'fixed_version', knowledgeArticleRef: 'knowledge_article_ref',
    status: 'status', reviewDate: 'review_date', notes: 'notes',
  } as const;
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : value;
  }
  const { data, error } = await createAdminClient(c.env).from('known_errors').update(patch).eq('id', c.req.param('id')!).select(KNOWN_ERROR_SELECT).maybeSingle();
  if (error) return c.json(fail(reqId, 'KNOWN_ERROR_UPDATE_FAILED', error.message), 400);
  if (!data) return c.json(fail(reqId, 'KNOWN_ERROR_NOT_FOUND', 'ไม่พบ Known Error'), 404);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'problem', targetTable: 'known_errors', targetId: data.id, detail: body, requestId: reqId });
  return c.json(ok(reqId, data));
});

problemsRoute.get('/', zValidator('query', listProblemsQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, priority, ownerId } = c.req.valid('query');
  let query = c.get('supabase').from('problems').select(PROBLEM_SELECT, { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (search) {
    const safe = cleanSearch(search);
    query = query.or(`problem_number.ilike.%${safe}%,title.ilike.%${safe}%,affected_system.ilike.%${safe}%`);
  }
  if (status) query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);
  if (ownerId) query = query.eq('owner_id', ownerId);
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'PROBLEMS_LIST_FAILED', 'ดึงรายการ Problem ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

problemsRoute.get('/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const [problemResult, knownErrorsResult, filesResult] = await Promise.all([
    c.get('supabase').from('problems').select(PROBLEM_SELECT).eq('id', id).maybeSingle(),
    c.get('supabase').from('known_errors').select(KNOWN_ERROR_SELECT).eq('problem_id', id).order('created_at', { ascending: false }),
    c.get('supabase').from('file_attachments').select('id, original_filename, mime_type, size_bytes, created_at').eq('module', 'problem').eq('target_table', 'problems').eq('target_id', id),
  ]);
  if (problemResult.error || !problemResult.data) return c.json(fail(reqId, 'PROBLEM_NOT_FOUND', 'ไม่พบ Problem นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  if (knownErrorsResult.error) return c.json(fail(reqId, 'KNOWN_ERRORS_LIST_FAILED', 'ดึง Known Error ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { problem: problemResult.data, knownErrors: knownErrorsResult.data ?? [], attachments: filesResult.data ?? [] }));
});

problemsRoute.post('/', requirePermission('problem.manage'), zValidator('json', createProblemSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('problems').insert({
    problem_number: generateNumber('PRB'), title: body.title, category: body.category || null,
    affected_system: body.affectedSystem || null, impact: body.impact || null, root_cause: body.rootCause || null,
    workaround: body.workaround || null, permanent_fix: body.permanentFix || null, owner_id: body.ownerId || null,
    priority: body.priority, status: body.status, review_date: body.reviewDate || null,
    closed_at: body.status === 'ปิด' ? new Date().toISOString() : null, evidence_url: body.evidenceUrl || null,
    notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select().single();
  if (error) return c.json(fail(reqId, 'PROBLEM_CREATE_FAILED', error.message), 400);
  const linkError = await replaceLinks(c.env, data.id, actorId, body.incidentIds, body.ticketIds);
  if (linkError) {
    await admin.from('problems').delete().eq('id', data.id);
    return c.json(fail(reqId, 'PROBLEM_LINK_FAILED', linkError), 400);
  }
  const { data: result } = await admin.from('problems').select(PROBLEM_SELECT).eq('id', data.id).single();
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'problem', targetTable: 'problems', targetId: data.id, detail: { problemNumber: data.problem_number, incidentIds: body.incidentIds, ticketIds: body.ticketIds }, requestId: reqId });
  return c.json(ok(reqId, result), 201);
});

problemsRoute.patch('/:id', requirePermission('problem.manage'), zValidator('json', updateProblemSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const patch: Record<string, unknown> = { updated_by: actorId };
  const fields = {
    title: 'title', category: 'category', affectedSystem: 'affected_system', impact: 'impact', rootCause: 'root_cause',
    workaround: 'workaround', permanentFix: 'permanent_fix', ownerId: 'owner_id', priority: 'priority',
    reviewDate: 'review_date', evidenceUrl: 'evidence_url', notes: 'notes',
  } as const;
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : value;
  }
  if (body.status !== undefined) {
    patch.status = body.status;
    patch.closed_at = body.status === 'ปิด' ? new Date().toISOString() : null;
  }
  const { data, error } = await admin.from('problems').update(patch).eq('id', id).select().maybeSingle();
  if (error) return c.json(fail(reqId, 'PROBLEM_UPDATE_FAILED', error.message), 400);
  if (!data) return c.json(fail(reqId, 'PROBLEM_NOT_FOUND', 'ไม่พบ Problem'), 404);
  const linkError = await replaceLinks(c.env, id, actorId, body.incidentIds, body.ticketIds);
  if (linkError) return c.json(fail(reqId, 'PROBLEM_LINK_FAILED', linkError), 400);
  const { data: result } = await admin.from('problems').select(PROBLEM_SELECT).eq('id', id).single();
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'problem', targetTable: 'problems', targetId: id, detail: body, requestId: reqId });
  return c.json(ok(reqId, result));
});
