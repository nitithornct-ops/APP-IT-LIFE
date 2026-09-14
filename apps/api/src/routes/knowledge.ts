import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { zodValidationHook } from '../utils/validation';
import {
  createArticleFromTicketSchema, createKnowledgeArticleSchema, listKnowledgeQuerySchema, publicKnowledgeQuerySchema,
  notHelpfulSchema, publicKnowledgeViewSchema, setKnowledgeStatusSchema, updateKnowledgeArticleSchema,
} from '../validators/knowledge';

export const knowledgeRoute = new Hono<AppEnv>();
export const publicKnowledgeRoute = new Hono<AppEnv>();
knowledgeRoute.use('*', requireAuth);

const ARTICLE_SELECT = '*,category:ticket_categories!knowledge_articles_category_id_fkey(id,name),taxonomy:knowledge_taxonomies!knowledge_articles_taxonomy_id_fkey(id,code,name,parent_id),author:profiles!knowledge_articles_author_id_fkey(id,full_name,email),article_owner:profiles!knowledge_articles_article_owner_id_fkey(id,full_name,email),reviewer:profiles!knowledge_articles_reviewer_id_fkey(id,full_name,email),article_incidents:knowledge_article_incidents(incident:incidents!knowledge_article_incidents_incident_id_fkey(id,incident_number,title,status)),article_problems:knowledge_article_problems(problem:problems!knowledge_article_problems_problem_id_fkey(id,problem_number,title,status)),article_known_errors:knowledge_article_known_errors(known_error:known_errors!knowledge_article_known_errors_known_error_id_fkey(id,known_error_number,title,status)),article_services:knowledge_article_services(service:service_catalog!knowledge_article_services_service_id_fkey(id,service_code,service_name,status))';

function articleCode(): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `KB-${date}-${randomCodeSuffix()}`;
}

async function hasPermission(c: Context<AppEnv>, key: string): Promise<boolean> {
  const { data, error } = await c.get('supabase').rpc('has_permission', { permission_key_input: key });
  return !error && data === true;
}

async function activeTaxonomyError(c: Context<AppEnv>, taxonomyId?: string): Promise<string | null> {
  if (!taxonomyId) return null;
  const admin = createAdminClient(c.env);
  const { data } = await admin.from('knowledge_taxonomies').select('id').eq('id', taxonomyId).eq('status', 'active').maybeSingle();
  return data ? null : 'ไม่พบ Knowledge Taxonomy ที่ใช้งานอยู่';
}

function matchesSearch(article: Record<string, unknown>, search?: string): boolean {
  if (!search) return true;
  const tags = Array.isArray(article.tags) ? article.tags.join(' ') : '';
  const synonyms = Array.isArray(article.synonyms) ? article.synonyms.join(' ') : '';
  const categoryRelation = Array.isArray(article.category) ? article.category[0] : article.category;
  const category = categoryRelation && typeof categoryRelation === 'object' && 'name' in categoryRelation ? String(categoryRelation.name ?? '') : '';
  const taxonomyRelation = Array.isArray(article.taxonomy) ? article.taxonomy[0] : article.taxonomy;
  const taxonomy = taxonomyRelation && typeof taxonomyRelation === 'object' && 'name' in taxonomyRelation ? String(taxonomyRelation.name ?? '') : '';
  return [article.title, article.symptom, article.solution, tags, synonyms, category, taxonomy].join(' ').toLocaleLowerCase('th').includes(search.toLocaleLowerCase('th'));
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function hashClientId(clientId: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientId));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function replaceArticleLinks(
  c: Context<AppEnv>, articleId: string, actorId: string,
  links: { incidentIds: string[]; problemIds: string[]; knownErrorIds: string[]; serviceIds: string[] },
): Promise<string | null> {
  const admin = createAdminClient(c.env);
  const { error } = await admin.rpc('replace_knowledge_article_links', {
    article_id_input: articleId,
    incident_ids_input: links.incidentIds,
    problem_ids_input: links.problemIds,
    known_error_ids_input: links.knownErrorIds,
    service_ids_input: links.serviceIds,
    actor_id_input: actorId,
  });
  return error?.message ?? null;
}

knowledgeRoute.get('/', requirePermission('knowledge.view'), zValidator('query', listKnowledgeQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const query = c.req.valid('query'); const client = c.get('supabase');
  const canManage = await hasPermission(c, 'knowledge.manage');
  let articleQuery = client.from('knowledge_articles').select(ARTICLE_SELECT).order('search_rank', { ascending: false }).order('views_count', { ascending: false }).limit(500);
  if (query.taxonomyId) articleQuery = articleQuery.eq('taxonomy_id', query.taxonomyId);
  else if (query.categoryId) articleQuery = articleQuery.eq('category_id', query.categoryId);
  if (query.status) articleQuery = articleQuery.eq('status', query.status);
  const [articles, taxonomies, feedback] = await Promise.all([
    articleQuery,
    client.from('knowledge_taxonomies').select('id,code,name,parent_id').eq('status', 'active').order('sort_order').order('name'),
    client.from('knowledge_article_feedback').select('article_id').eq('user_id', actorId),
  ]);
  const error = articles.error ?? taxonomies.error ?? feedback.error;
  if (error) return dbFailJson(c, 'KNOWLEDGE_LOAD_FAILED', error);
  const voted = new Set((feedback.data ?? []).map((item) => item.article_id));
  const filtered = (articles.data ?? []).filter((article) => matchesSearch(article, query.search)).map((article) => ({ ...article, has_voted: voted.has(article.id) }));
  return c.json(ok(reqId, { articles: filtered, categories: taxonomies.data ?? [], taxonomies: taxonomies.data ?? [], canManage }));
});

knowledgeRoute.get('/references', requirePermission('knowledge.manage'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [people, taxonomies, incidents, problems, knownErrors, services] = await Promise.all([
    admin.from('profiles').select('id,full_name,email').eq('status', 'active').order('full_name').limit(500),
    admin.from('knowledge_taxonomies').select('id,code,name,parent_id').eq('status', 'active').order('sort_order').order('name').limit(500),
    admin.from('incidents').select('id,incident_number,title,status').order('report_date', { ascending: false }).limit(500),
    admin.from('problems').select('id,problem_number,title,status').order('created_at', { ascending: false }).limit(500),
    admin.from('known_errors').select('id,known_error_number,title,status').order('created_at', { ascending: false }).limit(500),
    admin.from('service_catalog').select('id,service_code,service_name,status').order('service_name').limit(500),
  ]);
  const error = people.error ?? taxonomies.error ?? incidents.error ?? problems.error ?? knownErrors.error ?? services.error;
  if (error) return dbFailJson(c, 'KNOWLEDGE_REFERENCES_LOAD_FAILED', error);
  return c.json(ok(reqId, {
    owners: people.data ?? [], reviewers: people.data ?? [], taxonomies: taxonomies.data ?? [],
    incidents: incidents.data ?? [], problems: problems.data ?? [], knownErrors: knownErrors.data ?? [], services: services.data ?? [],
  }));
});

knowledgeRoute.post('/articles', requirePermission('knowledge.manage'), zValidator('json', createKnowledgeArticleSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const taxonomyError = await activeTaxonomyError(c, body.taxonomyId); if (taxonomyError) return c.json(fail(reqId, 'KNOWLEDGE_TAXONOMY_INVALID', taxonomyError), 400);
  const now = new Date().toISOString();
  const { data, error } = await admin.from('knowledge_articles').insert({
    article_code: articleCode(), title: body.title, category_id: body.categoryId ?? null, taxonomy_id: body.taxonomyId ?? null,
    symptom: body.symptom ?? null, solution: body.solution, tags: body.tags, status: body.status,
    synonyms: body.synonyms, article_owner_id: body.articleOwnerId ?? actorId, reviewer_id: body.reviewerId ?? null,
    review_due_date: body.reviewDueDate ?? null, expiry_date: body.expiryDate ?? null,
    is_deprecated: body.isDeprecated, deprecated_at: body.isDeprecated ? now : null,
    deprecated_reason: body.deprecatedReason ?? null, search_rank: body.searchRank,
    last_change_note: body.changeNote ?? 'Initial version',
    author_id: actorId, published_at: body.status === 'เผยแพร่' ? now : null,
    created_by: actorId, updated_by: actorId,
  }).select(ARTICLE_SELECT).single();
  if (error) return dbFailJson(c, 'KNOWLEDGE_CREATE_FAILED', error);
  const linkError = await replaceArticleLinks(c, data.id, actorId, body);
  if (linkError) {
    await admin.from('knowledge_articles').delete().eq('id', data.id);
    return dbFailJson(c, 'KNOWLEDGE_LINKS_CREATE_FAILED', { message: linkError });
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'knowledge', targetTable: 'knowledge_articles', targetId: data.id, detail: { articleCode: data.article_code, status: body.status }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

/**
 * สร้างบทความร่างจากใบงานที่แก้เสร็จแล้ว (design handoff 3j จอ 2 "ชิปสาเหตุ (สร้าง KB)")
 *
 * เนื้อหาคัดจากใบงานฝั่งนี้ทั้งหมด ผู้เรียกส่งมาได้แค่ ticketId — บทความที่อ้างว่ามาจากใบงานหนึ่ง
 * ต้องมีเนื้อหาตรงกับใบงานนั้นจริง ไม่งั้นการตามกลับไปตรวจว่ายังถูกต้องอยู่ไหมก็ไร้ความหมาย
 *
 * สร้างเป็น "ร่าง" เสมอ ไม่เผยแพร่ทันที เพราะบันทึกการแก้งานหนึ่งครั้งยังไม่ใช่บทความที่คนอื่นอ่านรู้เรื่อง
 * ต้องมีคนเรียบเรียงก่อน และใบงานมักมีชื่อผู้แจ้งหรือรายละเอียดภายในที่ไม่ควรเผยแพร่
 */
knowledgeRoute.post('/articles/from-ticket', requirePermission('knowledge.manage'), zValidator('json', createArticleFromTicketSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const { ticketId } = c.req.valid('json'); const admin = createAdminClient(c.env);

  const { data: ticket, error: ticketError } = await admin
    .from('tickets')
    .select('id, ticket_no, title, description, resolution, root_cause, category_id, status, cause_code:ticket_cause_codes!tickets_cause_code_id_fkey(code, name)')
    .eq('id', ticketId)
    .maybeSingle();
  if (ticketError) return dbFailJson(c, 'KNOWLEDGE_FROM_TICKET_FAILED', ticketError);
  if (!ticket) return c.json(fail(reqId, 'TICKET_NOT_FOUND', 'ไม่พบใบงานที่ระบุ'), 404);

  // ต้องมีวิธีแก้บันทึกไว้แล้ว ไม่งั้นบทความจะว่างเปล่าและไม่ช่วยใครเลย
  const solution = String(ticket.resolution ?? '').trim();
  if (!solution) {
    return c.json(fail(reqId, 'TICKET_RESOLUTION_REQUIRED', 'ใบงานนี้ยังไม่มีบันทึกวิธีแก้ไข จึงยังสร้างบทความไม่ได้'), 409);
  }

  // กันสร้างซ้ำ และบอกรหัสบทความเดิมไปด้วย ผู้ใช้จะได้ไปแก้ของเดิมแทนที่จะงงว่าทำไมกดไม่ได้
  const { data: existing } = await admin.from('knowledge_articles').select('article_code').eq('source_ticket_id', ticketId).maybeSingle();
  if (existing) {
    const code = (existing as unknown as { article_code: string }).article_code;
    return c.json(fail(reqId, 'KNOWLEDGE_ALREADY_EXISTS', `ใบงานนี้ถูกใช้สร้างบทความ ${code} ไปแล้ว`), 409);
  }

  // PostgREST คืนความสัมพันธ์แบบ embed เป็น array เมื่ออนุมานทิศทางไม่ได้ จึงต้องรับทั้งสองรูป
  const rawCause = (ticket as unknown as { cause_code: unknown }).cause_code;
  const causeCode = (Array.isArray(rawCause) ? rawCause[0] : rawCause) as { code: string; name: string } | null | undefined;
  const symptomParts = [String(ticket.description ?? '').trim(), ticket.root_cause ? `สาเหตุที่พบ: ${String(ticket.root_cause).trim()}` : ''];

  const { data, error } = await admin.from('knowledge_articles').insert({
    article_code: articleCode(),
    title: String(ticket.title).slice(0, 200),
    category_id: ticket.category_id ?? null,
    symptom: symptomParts.filter(Boolean).join('\n\n').slice(0, 5000) || null,
    solution: solution.slice(0, 10000),
    // รหัสสาเหตุกลายเป็น tag เพื่อให้ค้นบทความที่แก้ปัญหาชนิดเดียวกันเจอพร้อมกันทั้งหมด
    tags: causeCode ? [causeCode.code.toLocaleLowerCase('th')] : [],
    status: 'ร่าง',
    source_ticket_id: ticketId,
    author_id: actorId,
    published_at: null,
    created_by: actorId,
    updated_by: actorId,
  }).select(ARTICLE_SELECT).single();
  if (error) return dbFailJson(c, 'KNOWLEDGE_FROM_TICKET_FAILED', error);

  await writeAuditLog(c.env, {
    actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'knowledge',
    targetTable: 'knowledge_articles', targetId: data.id,
    detail: { articleCode: data.article_code, sourceTicketNo: ticket.ticket_no }, requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

knowledgeRoute.patch('/articles/:id', requirePermission('knowledge.manage'), zValidator('json', updateKnowledgeArticleSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: current } = await admin.from('knowledge_articles').select('*').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความ'), 404);
  const taxonomyError = await activeTaxonomyError(c, body.taxonomyId); if (taxonomyError) return c.json(fail(reqId, 'KNOWLEDGE_TAXONOMY_INVALID', taxonomyError), 400);
  const auditBefore = await loadAuditSnapshot(admin, 'knowledge_articles', id);
  const { data, error } = await admin.from('knowledge_articles').update({
    title: body.title, category_id: body.categoryId ?? null, taxonomy_id: body.taxonomyId ?? null, symptom: body.symptom ?? null,
    solution: body.solution, tags: body.tags, synonyms: body.synonyms, status: body.status,
    article_owner_id: body.articleOwnerId ?? null, reviewer_id: body.reviewerId ?? null,
    review_due_date: body.reviewDueDate ?? null, expiry_date: body.expiryDate ?? null,
    is_deprecated: body.isDeprecated, deprecated_at: body.isDeprecated ? current.deprecated_at ?? new Date().toISOString() : null,
    deprecated_reason: body.deprecatedReason ?? null, search_rank: body.searchRank,
    last_change_note: body.changeNote ?? null,
    published_at: body.status === 'เผยแพร่' ? current.published_at ?? new Date().toISOString() : null,
    updated_by: actorId,
  }).eq('id', id).select(ARTICLE_SELECT).single();
  if (error) return dbFailJson(c, 'KNOWLEDGE_UPDATE_FAILED', error);
  const linkError = await replaceArticleLinks(c, id, actorId, body);
  if (linkError) return dbFailJson(c, 'KNOWLEDGE_LINKS_UPDATE_FAILED', { message: linkError });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'knowledge', targetTable: 'knowledge_articles', targetId: id, detail: { status: body.status }, requestId: reqId , before: auditBefore, after: data });
  return c.json(ok(reqId, data));
});

knowledgeRoute.post('/articles/:id/status', requirePermission('knowledge.manage'), zValidator('json', setKnowledgeStatusSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const { status } = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: current } = await admin.from('knowledge_articles').select('id,published_at,is_deprecated,expiry_date').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความ'), 404);
  if (status === 'เผยแพร่' && current.is_deprecated) return c.json(fail(reqId, 'KNOWLEDGE_DEPRECATED', 'บทความ Deprecated ต้องแก้ไขและยกเลิกสถานะ Deprecated ก่อนเผยแพร่'), 409);
  if (status === 'เผยแพร่' && current.expiry_date && current.expiry_date < new Date().toISOString().slice(0, 10)) return c.json(fail(reqId, 'KNOWLEDGE_EXPIRED', 'บทความหมดอายุแล้ว กรุณาปรับ Expiry ก่อนเผยแพร่'), 409);
  const { data, error } = await admin.from('knowledge_articles').update({ status, published_at: status === 'เผยแพร่' ? current.published_at ?? new Date().toISOString() : null, updated_by: actorId, last_change_note: status === 'เผยแพร่' ? 'Published article' : 'Returned to draft' }).eq('id', id).select(ARTICLE_SELECT).single();
  if (error) return dbFailJson(c, 'KNOWLEDGE_STATUS_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'SET_STATUS', module: 'knowledge', targetTable: 'knowledge_articles', targetId: id, detail: { status }, requestId: reqId });
  return c.json(ok(reqId, data));
});

knowledgeRoute.post('/articles/:id/view', requirePermission('knowledge.view'), async (c) => {
  const reqId = c.get('requestId'); const id = c.req.param('id')!; const client = c.get('supabase'); const canManage = await hasPermission(c, 'knowledge.manage');
  const { data: visible } = await client.from('knowledge_articles').select('id').eq('id', id).maybeSingle(); if (!visible) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความหรือยังไม่ได้เผยแพร่'), 404);
  if (!canManage) {
    const { error: viewError } = await client.rpc('record_knowledge_article_view', { article_id_input: id, visitor_hash_input: null });
    if (viewError) return dbFailJson(c, 'KNOWLEDGE_VIEW_FAILED', viewError);
  }
  const { data, error } = await client.from('knowledge_articles').select(ARTICLE_SELECT).eq('id', id).single();
  if (error) return dbFailJson(c, 'KNOWLEDGE_VIEW_FAILED', error);
  const { data: feedback } = await client.from('knowledge_article_feedback').select('id').eq('article_id', id).eq('user_id', c.get('userId')).maybeSingle();
  const versions = canManage
    ? await client.from('knowledge_article_versions').select('*').eq('article_id', id).order('version_number', { ascending: false })
    : { data: [], error: null };
  if (versions.error) return dbFailJson(c, 'KNOWLEDGE_HISTORY_FAILED', versions.error);
  return c.json(ok(reqId, { ...data, has_voted: Boolean(feedback), versions: versions.data ?? [] }));
});

knowledgeRoute.post('/articles/:id/helpful', requirePermission('knowledge.feedback'), async (c) => {
  const reqId = c.get('requestId'); const id = c.req.param('id')!; const client = c.get('supabase');
  const { data, error } = await client.rpc('mark_knowledge_article_helpful', { article_id_input: id });
  if (error) return dbFailJson(c, 'KNOWLEDGE_FEEDBACK_FAILED', error);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความที่เผยแพร่'), 404);
  return c.json(ok(reqId, { helpfulCount: result.helpful_count, alreadyVoted: result.already_voted }));
});

knowledgeRoute.post('/articles/:id/not-helpful', requirePermission('knowledge.feedback'), zValidator('json', notHelpfulSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const id = c.req.param('id')!; const body = c.req.valid('json'); const client = c.get('supabase');
  const { data, error } = await client.rpc('mark_knowledge_article_not_helpful', { article_id_input: id, reason_input: body.reason });
  if (error) return dbFailJson(c, 'KNOWLEDGE_NOT_HELPFUL_FAILED', error);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความที่เผยแพร่'), 404);
  return c.json(ok(reqId, { notHelpfulCount: result.not_helpful_count, alreadyVoted: result.already_voted }));
});

knowledgeRoute.delete('/articles/:id', requirePermission('knowledge.manage'), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('knowledge_articles').delete().eq('id', id).select('id,article_code').maybeSingle();
  if (error) return dbFailJson(c, 'KNOWLEDGE_DELETE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความ'), 404);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'DELETE', module: 'knowledge', targetTable: 'knowledge_articles', targetId: id, detail: { articleCode: data.article_code }, requestId: reqId });
  return c.json(ok(reqId, { id }));
});

publicKnowledgeRoute.get(
  '/',
  edgeRateLimit({ keyFn: (c) => `public_knowledge_read:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 120, keyFn: (c) => `public_knowledge_read:${clientIp(c)}` }),
  zValidator('query', publicKnowledgeQuerySchema, zodValidationHook),
  async (c) => {
  const reqId = c.get('requestId'); const query = c.req.valid('query'); const admin = createAdminClient(c.env);
  let request = admin.from('knowledge_articles').select('id,article_code,title,symptom,solution,tags,synonyms,views_count,helpful_count,not_helpful_count,search_rank,is_deprecated,expiry_date,taxonomy_id,taxonomy:knowledge_taxonomies!knowledge_articles_taxonomy_id_fkey(id,name)').eq('status', 'เผยแพร่').order('search_rank', { ascending: false }).order('views_count', { ascending: false }).limit(100);
  if (query.taxonomyId) request = request.eq('taxonomy_id', query.taxonomyId);
  else if (query.categoryId) request = request.eq('category_id', query.categoryId);
  const [articles, taxonomies] = await Promise.all([request, admin.from('knowledge_taxonomies').select('id,code,name,parent_id').eq('status', 'active').order('sort_order').order('name')]);
  const error = articles.error ?? taxonomies.error; if (error) return dbFailJson(c, 'PUBLIC_KNOWLEDGE_LOAD_FAILED', error);
  const today = new Date().toISOString().slice(0, 10);
  const filtered = (articles.data ?? []).filter((article) => !article.is_deprecated && (!article.expiry_date || article.expiry_date >= today)).filter((article) => matchesSearch(article, query.search)).slice(0, 30).map((article) => ({ id: article.id, article_code: article.article_code, title: article.title, category: firstRelation(article.taxonomy)?.name ?? null, symptom: article.symptom, solution: article.solution, tags: article.tags, synonyms: article.synonyms, views: article.views_count, helpful: article.helpful_count, notHelpful: article.not_helpful_count, searchRank: article.search_rank }));
  return c.json(ok(reqId, { articles: filtered, categories: taxonomies.data ?? [], taxonomies: taxonomies.data ?? [] }));
  },
);

publicKnowledgeRoute.post(
  '/:id/view',
  edgeRateLimit({ keyFn: (c) => `public_knowledge_view:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 30, keyFn: (c) => `public_knowledge_view:${clientIp(c)}` }),
  zValidator('json', publicKnowledgeViewSchema, zodValidationHook),
  async (c) => {
  const reqId = c.get('requestId'); const id = c.req.param('id')!; const { clientId } = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: article } = await admin.from('knowledge_articles').select('id').eq('id', id).eq('status', 'เผยแพร่').maybeSingle(); if (!article) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความที่เผยแพร่'), 404);
  const { error } = await admin.rpc('record_knowledge_article_view', { article_id_input: id, visitor_hash_input: await hashClientId(clientId) });
  if (error) return dbFailJson(c, 'PUBLIC_KNOWLEDGE_VIEW_FAILED', error);
  return c.json(ok(reqId, { recorded: true }));
  },
);
