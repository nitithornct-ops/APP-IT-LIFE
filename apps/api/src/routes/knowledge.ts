import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { zodValidationHook } from '../utils/validation';
import {
  createKnowledgeArticleSchema, listKnowledgeQuerySchema, publicKnowledgeQuerySchema,
  publicKnowledgeViewSchema, setKnowledgeStatusSchema, updateKnowledgeArticleSchema,
} from '../validators/knowledge';

export const knowledgeRoute = new Hono<AppEnv>();
export const publicKnowledgeRoute = new Hono<AppEnv>();
knowledgeRoute.use('*', requireAuth);

const ARTICLE_SELECT = '*, category:ticket_categories!knowledge_articles_category_id_fkey(id,name), author:profiles!knowledge_articles_author_id_fkey(id,full_name,email)';

function articleCode(): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `KB-${date}-${randomCodeSuffix()}`;
}

async function hasPermission(c: Context<AppEnv>, key: string): Promise<boolean> {
  const { data, error } = await c.get('supabase').rpc('has_permission', { permission_key_input: key });
  return !error && data === true;
}

async function activeCategoryError(c: Context<AppEnv>, categoryId?: string): Promise<string | null> {
  if (!categoryId) return null;
  const admin = createAdminClient(c.env);
  const { data } = await admin.from('ticket_categories').select('id').eq('id', categoryId).eq('status', 'active').maybeSingle();
  return data ? null : 'ไม่พบหมวด Ticket ที่ใช้งานอยู่';
}

function matchesSearch(article: Record<string, unknown>, search?: string): boolean {
  if (!search) return true;
  const tags = Array.isArray(article.tags) ? article.tags.join(' ') : '';
  const categoryRelation = Array.isArray(article.category) ? article.category[0] : article.category;
  const category = categoryRelation && typeof categoryRelation === 'object' && 'name' in categoryRelation ? String(categoryRelation.name ?? '') : '';
  return [article.title, article.symptom, article.solution, tags, category].join(' ').toLocaleLowerCase('th').includes(search.toLocaleLowerCase('th'));
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function hashClientId(clientId: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientId));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

knowledgeRoute.get('/', requirePermission('knowledge.view'), zValidator('query', listKnowledgeQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const query = c.req.valid('query'); const client = c.get('supabase');
  const canManage = await hasPermission(c, 'knowledge.manage');
  let articleQuery = client.from('knowledge_articles').select(ARTICLE_SELECT).order('views_count', { ascending: false }).limit(500);
  if (query.categoryId) articleQuery = articleQuery.eq('category_id', query.categoryId);
  if (query.status) articleQuery = articleQuery.eq('status', query.status);
  const [articles, categories, feedback] = await Promise.all([
    articleQuery,
    client.from('ticket_categories').select('id,name').eq('status', 'active').order('name'),
    client.from('knowledge_article_feedback').select('article_id').eq('user_id', actorId).eq('helpful', true),
  ]);
  const error = articles.error ?? categories.error ?? feedback.error;
  if (error) return dbFailJson(c, 'KNOWLEDGE_LOAD_FAILED', error);
  const voted = new Set((feedback.data ?? []).map((item) => item.article_id));
  const filtered = (articles.data ?? []).filter((article) => matchesSearch(article, query.search)).map((article) => ({ ...article, has_voted: voted.has(article.id) }));
  return c.json(ok(reqId, { articles: filtered, categories: categories.data ?? [], canManage }));
});

knowledgeRoute.post('/articles', requirePermission('knowledge.manage'), zValidator('json', createKnowledgeArticleSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const categoryError = await activeCategoryError(c, body.categoryId); if (categoryError) return c.json(fail(reqId, 'KNOWLEDGE_CATEGORY_INVALID', categoryError), 400);
  const now = new Date().toISOString();
  const { data, error } = await admin.from('knowledge_articles').insert({
    article_code: articleCode(), title: body.title, category_id: body.categoryId ?? null,
    symptom: body.symptom ?? null, solution: body.solution, tags: body.tags, status: body.status,
    author_id: actorId, published_at: body.status === 'เผยแพร่' ? now : null,
    created_by: actorId, updated_by: actorId,
  }).select(ARTICLE_SELECT).single();
  if (error) return dbFailJson(c, 'KNOWLEDGE_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'knowledge', targetTable: 'knowledge_articles', targetId: data.id, detail: { articleCode: data.article_code, status: body.status }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

knowledgeRoute.patch('/articles/:id', requirePermission('knowledge.manage'), zValidator('json', updateKnowledgeArticleSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: current } = await admin.from('knowledge_articles').select('*').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความ'), 404);
  const categoryError = await activeCategoryError(c, body.categoryId); if (categoryError) return c.json(fail(reqId, 'KNOWLEDGE_CATEGORY_INVALID', categoryError), 400);
  const auditBefore = await loadAuditSnapshot(admin, 'knowledge_articles', id);
  const { data, error } = await admin.from('knowledge_articles').update({
    title: body.title, category_id: body.categoryId ?? null, symptom: body.symptom ?? null,
    solution: body.solution, tags: body.tags, status: body.status,
    published_at: body.status === 'เผยแพร่' ? current.published_at ?? new Date().toISOString() : null,
    updated_by: actorId,
  }).eq('id', id).select(ARTICLE_SELECT).single();
  if (error) return dbFailJson(c, 'KNOWLEDGE_UPDATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'knowledge', targetTable: 'knowledge_articles', targetId: id, detail: { status: body.status }, requestId: reqId , before: auditBefore, after: data });
  return c.json(ok(reqId, data));
});

knowledgeRoute.post('/articles/:id/status', requirePermission('knowledge.manage'), zValidator('json', setKnowledgeStatusSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const { status } = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: current } = await admin.from('knowledge_articles').select('id,published_at').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความ'), 404);
  const { data, error } = await admin.from('knowledge_articles').update({ status, published_at: status === 'เผยแพร่' ? current.published_at ?? new Date().toISOString() : null, updated_by: actorId }).eq('id', id).select(ARTICLE_SELECT).single();
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
  return c.json(ok(reqId, { ...data, has_voted: Boolean(feedback) }));
});

knowledgeRoute.post('/articles/:id/helpful', requirePermission('knowledge.feedback'), async (c) => {
  const reqId = c.get('requestId'); const id = c.req.param('id')!; const client = c.get('supabase');
  const { data, error } = await client.rpc('mark_knowledge_article_helpful', { article_id_input: id });
  if (error) return dbFailJson(c, 'KNOWLEDGE_FEEDBACK_FAILED', error);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความที่เผยแพร่'), 404);
  return c.json(ok(reqId, { helpfulCount: result.helpful_count, alreadyVoted: result.already_voted }));
});

knowledgeRoute.delete('/articles/:id', requirePermission('knowledge.manage'), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('knowledge_articles').delete().eq('id', id).select('id,article_code').maybeSingle();
  if (error) return dbFailJson(c, 'KNOWLEDGE_DELETE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความ'), 404);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'DELETE', module: 'knowledge', targetTable: 'knowledge_articles', targetId: id, detail: { articleCode: data.article_code }, requestId: reqId });
  return c.json(ok(reqId, { id }));
});

publicKnowledgeRoute.get('/', zValidator('query', publicKnowledgeQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const query = c.req.valid('query'); const admin = createAdminClient(c.env);
  let request = admin.from('knowledge_articles').select('id,article_code,title,symptom,solution,tags,views_count,helpful_count,category:ticket_categories!knowledge_articles_category_id_fkey(id,name)').eq('status', 'เผยแพร่').order('views_count', { ascending: false }).limit(100);
  if (query.categoryId) request = request.eq('category_id', query.categoryId);
  const [articles, categories] = await Promise.all([request, admin.from('ticket_categories').select('id,name').eq('status', 'active').order('name')]);
  const error = articles.error ?? categories.error; if (error) return dbFailJson(c, 'PUBLIC_KNOWLEDGE_LOAD_FAILED', error);
  const filtered = (articles.data ?? []).filter((article) => matchesSearch(article, query.search)).slice(0, 30).map((article) => ({ id: article.id, article_code: article.article_code, title: article.title, category: firstRelation(article.category)?.name ?? null, symptom: article.symptom, solution: article.solution, tags: article.tags, views: article.views_count, helpful: article.helpful_count }));
  return c.json(ok(reqId, { articles: filtered, categories: categories.data ?? [] }));
});

publicKnowledgeRoute.post('/:id/view', zValidator('json', publicKnowledgeViewSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const id = c.req.param('id')!; const { clientId } = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: article } = await admin.from('knowledge_articles').select('id').eq('id', id).eq('status', 'เผยแพร่').maybeSingle(); if (!article) return c.json(fail(reqId, 'KNOWLEDGE_NOT_FOUND', 'ไม่พบบทความที่เผยแพร่'), 404);
  const { error } = await admin.rpc('record_knowledge_article_view', { article_id_input: id, visitor_hash_input: await hashClientId(clientId) });
  if (error) return dbFailJson(c, 'PUBLIC_KNOWLEDGE_VIEW_FAILED', error);
  return c.json(ok(reqId, { recorded: true }));
});
