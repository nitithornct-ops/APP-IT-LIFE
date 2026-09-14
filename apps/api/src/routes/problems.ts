import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  createKnownErrorSchema,
  createProblemSchema,
  listKnownErrorsQuerySchema,
  listProblemsQuerySchema,
  createCorrectiveActionSchema,
  updateKnownErrorSchema,
  updateProblemSchema,
  updateCorrectiveActionSchema,
  verifyProblemAfterChangeSchema,
} from '../validators/problems';

export const problemsRoute = new Hono<AppEnv>();
problemsRoute.use('*', requireAuth);
problemsRoute.use('*', requirePermission('problem.view'));

const PROBLEM_SELECT =
  '*, owner:profiles!problems_owner_id_fkey(id, full_name, email), ' +
  'review_meeting_owner:profiles!problems_review_meeting_owner_id_fkey(id, full_name, email), ' +
  'change_verifier:profiles!problems_change_verified_by_fkey(id, full_name, email), ' +
  'problem_incidents(incident:incidents(id, incident_number, title, status)), ' +
  'problem_tickets(ticket:tickets(id, title, status)), ' +
  'problem_configuration_items(configuration_item:configuration_items!problem_configuration_items_ci_id_fkey(id, ci_code, name, ci_type, status)), ' +
  'problem_changes(change:change_requests!problem_changes_change_id_fkey(id, change_number, title, status, deploy_date, version)), ' +
  'corrective_actions:problem_corrective_actions(owner:profiles!problem_corrective_actions_owner_id_fkey(id, full_name, email))';

const KNOWN_ERROR_SELECT =
  '*, problem:problems!known_errors_problem_id_fkey(id, problem_number, title, status)';

function generateNumber(prefix: 'PRB' | 'KEDB'): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${date}-${randomCodeSuffix()}`;
}

async function replaceLinks(
  env: AppEnv['Bindings'],
  problemId: string,
  actorId: string,
  incidentIds?: string[],
  ticketIds?: string[],
  configurationItemIds?: string[],
  changeIds?: string[],
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
  if (configurationItemIds !== undefined) {
    const uniqueIds = [...new Set(configurationItemIds)];
    if (uniqueIds.length) {
      const { count, error } = await admin.from('configuration_items').select('id', { count: 'exact', head: true }).in('id', uniqueIds);
      if (error || count !== uniqueIds.length) return 'มี Configuration Item ที่อ้างอิงไม่ถูกต้อง';
    }
  }
  if (changeIds !== undefined) {
    const uniqueIds = [...new Set(changeIds)];
    if (uniqueIds.length) {
      const { count, error } = await admin.from('change_requests').select('id', { count: 'exact', head: true }).in('id', uniqueIds);
      if (error || count !== uniqueIds.length) return 'มี Change ที่อ้างอิงไม่ถูกต้อง';
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
  if (configurationItemIds !== undefined) {
    const { error } = await admin.from('problem_configuration_items').delete().eq('problem_id', problemId);
    if (error) return error.message;
    const rows = [...new Set(configurationItemIds)].map((ciId) => ({ problem_id: problemId, ci_id: ciId, created_by: actorId }));
    if (rows.length) {
      const { error: insertError } = await admin.from('problem_configuration_items').insert(rows);
      if (insertError) return insertError.message;
    }
  }
  if (changeIds !== undefined) {
    const { error } = await admin.from('problem_changes').delete().eq('problem_id', problemId);
    if (error) return error.message;
    const rows = [...new Set(changeIds)].map((changeId) => ({ problem_id: problemId, change_id: changeId, created_by: actorId }));
    if (rows.length) {
      const { error: insertError } = await admin.from('problem_changes').insert(rows);
      if (insertError) return insertError.message;
    }
  }
  return null;
}

function generateKnowledgeArticleCode(): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `KB-${date}-${randomCodeSuffix()}`;
}

async function knowledgeReferenceError(env: AppEnv['Bindings'], articleCode?: string): Promise<string | null> {
  if (!articleCode) return null;
  const { data } = await createAdminClient(env)
    .from('knowledge_articles')
    .select('id')
    .eq('article_code', articleCode)
    .eq('status', 'เผยแพร่')
    .maybeSingle();
  return data ? null : 'ไม่พบบทความฐานความรู้ที่เผยแพร่ตามรหัสอ้างอิง';
}

problemsRoute.get('/references', requirePermission('problem.manage'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [owners, incidents, tickets, problems, knowledgeArticles, configurationItems, changes] = await Promise.all([
    admin.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name').limit(500),
    admin.from('incidents').select('id, incident_number, title, status').order('report_date', { ascending: false }).limit(500),
    admin.from('tickets').select('id, title, status').order('created_at', { ascending: false }).limit(500),
    admin.from('problems').select('id, problem_number, title, status').order('created_at', { ascending: false }).limit(500),
    admin.from('knowledge_articles').select('id, article_code, title').eq('status', 'เผยแพร่').order('title').limit(500),
    admin.from('configuration_items').select('id, ci_code, name, ci_type, status').neq('status', 'Retired').order('ci_code').limit(2000),
    admin.from('change_requests').select('id, change_number, title, status, deploy_date, version').order('request_date', { ascending: false }).limit(500),
  ]);
  const error = owners.error ?? incidents.error ?? tickets.error ?? problems.error ?? knowledgeArticles.error ?? configurationItems.error ?? changes.error;
  if (error) return c.json(fail(reqId, 'PROBLEM_REFERENCES_LOAD_FAILED', 'ดึงข้อมูลอ้างอิงไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { owners: owners.data ?? [], incidents: incidents.data ?? [], tickets: tickets.data ?? [], problems: problems.data ?? [], knowledgeArticles: knowledgeArticles.data ?? [], configurationItems: configurationItems.data ?? [], changes: changes.data ?? [] }));
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
  const referenceError = await knowledgeReferenceError(c.env, body.knowledgeArticleRef);
  if (referenceError) return c.json(fail(reqId, 'KNOWN_ERROR_KNOWLEDGE_INVALID', referenceError), 400);
  const { data, error } = await admin.from('known_errors').insert({
    known_error_number: generateNumber('KEDB'), problem_id: body.problemId, title: body.title,
    symptoms: body.symptoms || null, root_cause: body.rootCause || null, workaround: body.workaround,
    affected_versions: body.affectedVersions || null, fixed_version: body.fixedVersion || null,
    knowledge_article_ref: body.knowledgeArticleRef || null, status: body.status,
    review_date: body.reviewDate || null, notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select(KNOWN_ERROR_SELECT).single();
  if (error) return dbFailJson(c, 'KNOWN_ERROR_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'problem', targetTable: 'known_errors', targetId: data.id, detail: { knownErrorNumber: data.known_error_number, problemId: body.problemId }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

problemsRoute.patch('/known-errors/:id', requirePermission('problem.manage'), zValidator('json', updateKnownErrorSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const referenceError = await knowledgeReferenceError(c.env, body.knowledgeArticleRef);
  if (referenceError) return c.json(fail(reqId, 'KNOWN_ERROR_KNOWLEDGE_INVALID', referenceError), 400);
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
  const auditBefore = await loadAuditSnapshot(createAdminClient(c.env), 'known_errors', c.req.param('id'));
  const { data, error } = await createAdminClient(c.env).from('known_errors').update(patch).eq('id', c.req.param('id')!).select(KNOWN_ERROR_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'KNOWN_ERROR_UPDATE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'KNOWN_ERROR_NOT_FOUND', 'ไม่พบ Known Error'), 404);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'problem', targetTable: 'known_errors', targetId: data.id, detail: body, requestId: reqId , before: auditBefore, after: data });
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

problemsRoute.post('/:id/verify-after-change', requirePermission('problem.manage'), zValidator('json', verifyProblemAfterChangeSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: problem } = await admin.from('problems').select('id, status').eq('id', id).maybeSingle();
  if (!problem) return c.json(fail(reqId, 'PROBLEM_NOT_FOUND', 'ไม่พบ Problem'), 404);
  const { data: deployedChanges, error: changeError } = await admin
    .from('problem_changes')
    .select('change:change_requests!problem_changes_change_id_fkey(id, change_number, status)')
    .eq('problem_id', id);
  if (changeError) return dbFailJson(c, 'PROBLEM_CHANGE_VERIFY_FAILED', changeError);
  const hasDeployedChange = (deployedChanges ?? []).some((row) => {
    const change = Array.isArray(row.change) ? row.change[0] : row.change;
    return change && (change as { status?: string }).status === 'ติดตั้งใช้งานแล้ว';
  });
  if (!hasDeployedChange) return c.json(fail(reqId, 'PROBLEM_DEPLOYED_CHANGE_REQUIRED', 'ต้องมี Change ที่ติดตั้งใช้งานแล้วก่อน Verify'), 409);
  const auditBefore = await loadAuditSnapshot(admin, 'problems', id);
  const { data, error } = await admin.from('problems').update({
    change_verified_at: new Date().toISOString(),
    change_verified_by: actorId,
    change_verification_notes: body.notes,
    updated_by: actorId,
  }).eq('id', id).select(PROBLEM_SELECT).single();
  if (error) return dbFailJson(c, 'PROBLEM_CHANGE_VERIFY_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'VERIFY_AFTER_CHANGE', module: 'problem', targetTable: 'problems', targetId: id, detail: { notes: body.notes }, requestId: reqId, before: auditBefore, after: data });
  return c.json(ok(reqId, data));
});

problemsRoute.post('/known-errors/:id/publish-to-kb', requirePermission('problem.manage'), requirePermission('knowledge.manage'), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const admin = createAdminClient(c.env);
  const { data: knownError, error: knownErrorError } = await admin.from('known_errors').select('*, problem:problems!known_errors_problem_id_fkey(problem_number, title, category)').eq('id', id).maybeSingle();
  if (knownErrorError) return dbFailJson(c, 'KNOWN_ERROR_KB_PUBLISH_FAILED', knownErrorError);
  if (!knownError) return c.json(fail(reqId, 'KNOWN_ERROR_NOT_FOUND', 'ไม่พบ Known Error'), 404);
  const existing = await admin.from('knowledge_articles').select('id, article_code').eq('source_known_error_id', id).maybeSingle();
  if (existing.data) {
    return c.json(ok(reqId, { knownError, article: existing.data, alreadyPublished: true }));
  }
  const workaround = String(knownError.workaround ?? '').trim();
  if (String(knownError.title ?? '').trim().length < 3) return c.json(fail(reqId, 'KNOWN_ERROR_KB_TITLE_REQUIRED', 'ชื่อ Known Error ต้องมีอย่างน้อย 3 ตัวอักษรก่อนเผยแพร่ไป Knowledge Base'), 409);
  if (workaround.length < 3) return c.json(fail(reqId, 'KNOWN_ERROR_KB_SOLUTION_REQUIRED', 'Workaround ต้องมีอย่างน้อย 3 ตัวอักษรก่อนเผยแพร่ไป Knowledge Base'), 409);
  const now = new Date().toISOString();
  const problem = Array.isArray(knownError.problem) ? knownError.problem[0] : knownError.problem;
  const articleCode = generateKnowledgeArticleCode();
  const solution = [workaround, knownError.fixed_version ? `Fixed version: ${knownError.fixed_version}` : ''].filter(Boolean).join('\n\n');
  const { data: article, error: articleError } = await admin.from('knowledge_articles').insert({
    article_code: articleCode,
    title: String(knownError.title).slice(0, 200),
    symptom: String(knownError.symptoms ?? '').trim().slice(0, 5000) || null,
    solution,
    tags: ['known-error', String(knownError.known_error_number).toLocaleLowerCase('th')],
    status: 'เผยแพร่',
    source_known_error_id: id,
    author_id: actorId,
    published_at: now,
    last_reviewed_at: knownError.review_date ? `${knownError.review_date}T00:00:00.000Z` : null,
    created_by: actorId,
    updated_by: actorId,
  }).select('id, article_code, title, status, published_at').single();
  if (articleError) return dbFailJson(c, 'KNOWN_ERROR_KB_PUBLISH_FAILED', articleError);
  const { data: updatedKnownError, error: updateError } = await admin.from('known_errors').update({ knowledge_article_ref: articleCode, status: 'เผยแพร่', updated_by: actorId }).eq('id', id).select(KNOWN_ERROR_SELECT).single();
  if (updateError) {
    await admin.from('knowledge_articles').delete().eq('id', article.id);
    return dbFailJson(c, 'KNOWN_ERROR_KB_PUBLISH_FAILED', updateError);
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'PUBLISH_TO_KB', module: 'problem', targetTable: 'known_errors', targetId: id, detail: { knownErrorNumber: knownError.known_error_number, articleCode, problem: problem?.title }, requestId: reqId, after: updatedKnownError });
  return c.json(ok(reqId, { knownError: updatedKnownError, article, alreadyPublished: false }));
});

problemsRoute.post('/:id/corrective-actions', requirePermission('problem.manage'), zValidator('json', createCorrectiveActionSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const problemId = c.req.param('id')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: problem } = await admin.from('problems').select('id').eq('id', problemId).maybeSingle();
  if (!problem) return c.json(fail(reqId, 'PROBLEM_NOT_FOUND', 'ไม่พบ Problem'), 404);
  const { data, error } = await admin.from('problem_corrective_actions').insert({
    problem_id: problemId, title: body.title, description: body.description || null,
    owner_id: body.ownerId || null, due_date: body.dueDate || null, status: body.status,
    completed_at: body.status === 'เสร็จสิ้น' ? new Date().toISOString() : null,
    verification_notes: body.verificationNotes || null, created_by: actorId, updated_by: actorId,
  }).select('*, owner:profiles!problem_corrective_actions_owner_id_fkey(id, full_name, email)').single();
  if (error) return dbFailJson(c, 'PROBLEM_CORRECTIVE_ACTION_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'problem', targetTable: 'problem_corrective_actions', targetId: data.id, detail: { problemId, title: data.title }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

problemsRoute.patch('/corrective-actions/:actionId', requirePermission('problem.manage'), zValidator('json', updateCorrectiveActionSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const actionId = c.req.param('actionId')!;
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: current } = await admin.from('problem_corrective_actions').select('*').eq('id', actionId).maybeSingle();
  if (!current) return c.json(fail(reqId, 'PROBLEM_CORRECTIVE_ACTION_NOT_FOUND', 'ไม่พบ Corrective Action'), 404);
  const patch: Record<string, unknown> = { updated_by: actorId };
  const fields = { title: 'title', description: 'description', ownerId: 'owner_id', dueDate: 'due_date', verificationNotes: 'verification_notes' } as const;
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : value;
  }
  if (body.status !== undefined) {
    patch.status = body.status;
    patch.completed_at = body.status === 'เสร็จสิ้น' ? (current.completed_at ?? new Date().toISOString()) : null;
  }
  const { data, error } = await admin.from('problem_corrective_actions').update(patch).eq('id', actionId).select('*, owner:profiles!problem_corrective_actions_owner_id_fkey(id, full_name, email)').single();
  if (error) return dbFailJson(c, 'PROBLEM_CORRECTIVE_ACTION_UPDATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'problem', targetTable: 'problem_corrective_actions', targetId: actionId, detail: body, requestId: reqId, before: current, after: data });
  return c.json(ok(reqId, data));
});

problemsRoute.post('/', requirePermission('problem.manage'), zValidator('json', createProblemSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  if (body.status === 'ปิด') return c.json(fail(reqId, 'PROBLEM_VERIFY_BEFORE_CLOSE', 'สร้าง Problem เป็นสถานะปิดไม่ได้ ต้องบันทึกและ Verify หลัง Change ก่อน'), 409);
  const { data, error } = await admin.from('problems').insert({
    problem_number: generateNumber('PRB'), title: body.title, category: body.category || null,
    affected_system: body.affectedSystem || null, impact: body.impact || null, root_cause: body.rootCause || null,
    workaround: body.workaround || null, permanent_fix: null, owner_id: body.ownerId || null,
    priority: body.priority, status: body.status, review_date: body.reviewDate || null,
    closed_at: null, evidence_url: body.evidenceUrl || null,
    notes: body.notes || null, rca_method: body.rcaMethod, five_why: body.fiveWhy, fishbone: body.fishbone,
    recurrence_count: body.recurrenceCount, review_meeting_at: body.reviewMeetingAt || null,
    review_meeting_owner_id: body.reviewMeetingOwnerId || null, review_meeting_notes: body.reviewMeetingNotes || null,
    created_by: actorId, updated_by: actorId,
  }).select().single();
  if (error) return dbFailJson(c, 'PROBLEM_CREATE_FAILED', error);
  const linkError = await replaceLinks(c.env, data.id, actorId, body.incidentIds, body.ticketIds, body.configurationItemIds, body.changeIds);
  if (linkError) {
    await admin.from('problems').delete().eq('id', data.id);
    return c.json(fail(reqId, 'PROBLEM_LINK_FAILED', linkError), 400);
  }
  if (body.permanentFix?.trim()) {
    const { error: fixError } = await admin.from('problems').update({ permanent_fix: body.permanentFix, updated_by: actorId }).eq('id', data.id);
    if (fixError) return dbFailJson(c, 'PROBLEM_CREATE_FAILED', fixError);
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
  const { data: current } = await admin.from('problems').select('*, problem_changes(change_id)').eq('id', id).maybeSingle();
  if (!current) return c.json(fail(reqId, 'PROBLEM_NOT_FOUND', 'ไม่พบ Problem'), 404);
  if (body.status === 'ปิด' && !current.change_verified_at) return c.json(fail(reqId, 'PROBLEM_VERIFY_BEFORE_CLOSE', 'ต้อง Verify หลัง Change สำเร็จก่อนปิด Problem'), 409);
  if (body.configurationItemIds !== undefined || body.changeIds !== undefined) {
    const linkError = await replaceLinks(c.env, id, actorId, undefined, undefined, body.configurationItemIds, body.changeIds);
    if (linkError) return c.json(fail(reqId, 'PROBLEM_LINK_FAILED', linkError), 400);
  }
  const patch: Record<string, unknown> = { updated_by: actorId };
  const fields = {
    title: 'title', category: 'category', affectedSystem: 'affected_system', impact: 'impact', rootCause: 'root_cause',
    workaround: 'workaround', permanentFix: 'permanent_fix', ownerId: 'owner_id', priority: 'priority',
    rcaMethod: 'rca_method', fiveWhy: 'five_why', fishbone: 'fishbone', recurrenceCount: 'recurrence_count',
    reviewDate: 'review_date', reviewMeetingAt: 'review_meeting_at', reviewMeetingOwnerId: 'review_meeting_owner_id',
    reviewMeetingNotes: 'review_meeting_notes', evidenceUrl: 'evidence_url', notes: 'notes',
  } as const;
  for (const [input, column] of Object.entries(fields)) {
    const value = body[input as keyof typeof body];
    if (value !== undefined) patch[column] = value === '' ? null : value;
  }
  if (body.status !== undefined) {
    patch.status = body.status;
    patch.closed_at = body.status === 'ปิด' ? new Date().toISOString() : null;
  }
  if (body.changeIds !== undefined) {
    const oldChangeIds = (current.problem_changes ?? []).map((row: { change_id: string }) => row.change_id).sort();
    const nextChangeIds = [...new Set(body.changeIds)].sort();
    if (oldChangeIds.join(',') !== nextChangeIds.join(',')) {
      patch.change_verified_at = null;
      patch.change_verified_by = null;
      patch.change_verification_notes = null;
    }
  }
  const auditBefore = await loadAuditSnapshot(admin, 'problems', id);
  const { data, error } = await admin.from('problems').update(patch).eq('id', id).select().maybeSingle();
  if (error) return dbFailJson(c, 'PROBLEM_UPDATE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'PROBLEM_NOT_FOUND', 'ไม่พบ Problem'), 404);
  const linkError = await replaceLinks(c.env, id, actorId, body.incidentIds, body.ticketIds, undefined, undefined);
  if (linkError) return c.json(fail(reqId, 'PROBLEM_LINK_FAILED', linkError), 400);
  const { data: result } = await admin.from('problems').select(PROBLEM_SELECT).eq('id', id).single();
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'problem', targetTable: 'problems', targetId: id, detail: body, requestId: reqId , before: auditBefore, after: data });
  return c.json(ok(reqId, result));
});
