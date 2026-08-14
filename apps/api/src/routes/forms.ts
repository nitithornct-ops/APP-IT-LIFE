import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { randomToken } from '../lib/lineAuth';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { sanitizeFormHtml } from '../utils/formHtml';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { zodValidationHook } from '../utils/validation';
import {
  createFormTemplateSchema,
  createIssueFormSchema,
  publishFormTemplateSchema,
  sendIssueFormToVendorSchema,
  submitVendorFormSchema,
  updateFormTemplateSchema,
  updateIssueFormSchema,
  vendorTokenParamSchema,
} from '../validators/forms';

export const formsRoute = new Hono<AppEnv>();
formsRoute.use('*', requireAuth);
formsRoute.use('*', requirePermission('form.view'));

export const publicFormsRoute = new Hono<AppEnv>();

const TEMPLATE_SELECT =
  '*, creator:profiles!form_templates_created_by_fkey(id, full_name), updater:profiles!form_templates_updated_by_fkey(id, full_name)';
const ISSUE_SELECT =
  '*, template:form_templates(id, template_code, name), vendor:vendors(id, vendor_code, name, email, contact_person), ticket:tickets(id, ticket_no, title), creator:profiles!issue_forms_created_by_fkey(id, full_name)';

async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function generatedTemplateCode(): string {
  const now = new Date();
  return `FORM-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}-${randomCodeSuffix()}`;
}

async function addActivity(
  env: AppEnv['Bindings'],
  issueFormId: string,
  action: string,
  actorId: string | null,
  detail: Record<string, unknown> = {},
  actorType: 'internal' | 'vendor' | 'system' = 'internal',
) {
  await createAdminClient(env).from('issue_form_activities').insert({
    issue_form_id: issueFormId,
    actor_id: actorId,
    actor_type: actorType,
    action,
    detail,
  });
}

formsRoute.get('/templates', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('form_templates').select(TEMPLATE_SELECT).order('updated_at', { ascending: false });
  if (error) return c.json(fail(reqId, 'FORM_TEMPLATE_LIST_FAILED', 'ดึงคลังแบบฟอร์มไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

formsRoute.get('/templates/:id/versions', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('form_template_versions').select('*').eq('template_id', c.req.param('id')!).order('version', { ascending: false });
  if (error) return c.json(fail(reqId, 'FORM_TEMPLATE_VERSION_LIST_FAILED', 'ดึงประวัติเวอร์ชันไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

formsRoute.post('/templates', requirePermission('form.manage'), zValidator('json', createFormTemplateSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const payload = {
    template_code: generatedTemplateCode(),
    name: body.name,
    description: body.description || null,
    category: body.category,
    content_html: sanitizeFormHtml(body.contentHtml),
    page_settings: body.pageSettings,
    created_by: actorId,
    updated_by: actorId,
  };
  const { data, error } = await admin.from('form_templates').insert(payload).select(TEMPLATE_SELECT).single();
  if (error || !data) return dbFailJson(c, 'FORM_TEMPLATE_CREATE_FAILED', error, 'สร้างแบบฟอร์มไม่สำเร็จ');
  await admin.from('form_template_versions').insert({
    template_id: data.id, version: 1, name: data.name, description: data.description,
    content_html: data.content_html, page_settings: data.page_settings, change_note: 'สร้างแบบฟอร์ม', created_by: actorId,
  });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'form', targetTable: 'form_templates', targetId: data.id, detail: { templateCode: data.template_code }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

formsRoute.patch('/templates/:id', requirePermission('form.manage'), zValidator('json', updateFormTemplateSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description || null;
  if (body.category !== undefined) patch.category = body.category;
  if (body.contentHtml !== undefined) patch.content_html = sanitizeFormHtml(body.contentHtml);
  if (body.pageSettings !== undefined) patch.page_settings = body.pageSettings;
  const auditBefore = await loadAuditSnapshot(createAdminClient(c.env), 'form_templates', c.req.param('id'));
  const { data, error } = await createAdminClient(c.env).from('form_templates').update(patch).eq('id', c.req.param('id')!).select(TEMPLATE_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'FORM_TEMPLATE_UPDATE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'FORM_TEMPLATE_NOT_FOUND', 'ไม่พบ Template นี้'), 404);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'form', targetTable: 'form_templates', targetId: data.id, detail: { fields: Object.keys(body) }, requestId: reqId , before: auditBefore, after: data });
  return c.json(ok(reqId, data));
});

formsRoute.post('/templates/:id/publish', requirePermission('form.manage'), zValidator('json', publishFormTemplateSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const admin = createAdminClient(c.env);
  const id = c.req.param('id')!;
  const { data: current } = await admin.from('form_templates').select('*').eq('id', id).maybeSingle();
  if (!current) return c.json(fail(reqId, 'FORM_TEMPLATE_NOT_FOUND', 'ไม่พบ Template นี้'), 404);
  const nextVersion = current.current_version + 1;
  const { error: versionError } = await admin.from('form_template_versions').insert({
    template_id: id, version: nextVersion, name: current.name, description: current.description,
    content_html: current.content_html, page_settings: current.page_settings,
    change_note: c.req.valid('json').changeNote || 'เผยแพร่เวอร์ชันใหม่', created_by: actorId,
  });
  if (versionError) return dbFailJson(c, 'FORM_TEMPLATE_PUBLISH_FAILED', versionError);
  const { data, error } = await admin.from('form_templates').update({
    status: 'Published', current_version: nextVersion, published_at: new Date().toISOString(), updated_by: actorId,
  }).eq('id', id).select(TEMPLATE_SELECT).single();
  if (error) return dbFailJson(c, 'FORM_TEMPLATE_PUBLISH_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'PUBLISH', module: 'form', targetTable: 'form_templates', targetId: id, detail: { version: nextVersion }, requestId: reqId });
  return c.json(ok(reqId, data));
});

formsRoute.get('/references', async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [vendors, tickets] = await Promise.all([
    admin.from('vendors').select('id, vendor_code, name, email, contact_person, status').eq('status', 'Active').order('name').limit(2000),
    admin.from('tickets').select('id, ticket_no, title, status').order('created_at', { ascending: false }).limit(500),
  ]);
  const error = vendors.error ?? tickets.error;
  if (error) return c.json(fail(reqId, 'FORM_REFERENCES_FAILED', 'ดึงข้อมูล Ticket/Vendor ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { vendors: vendors.data ?? [], tickets: tickets.data ?? [] }));
});

formsRoute.get('/issues', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('issue_forms').select(ISSUE_SELECT).order('updated_at', { ascending: false }).limit(1000);
  if (error) return c.json(fail(reqId, 'ISSUE_FORM_LIST_FAILED', 'ดึงรายการแบบฟอร์มงานไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

formsRoute.get('/issues/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const [issue, activities] = await Promise.all([
    c.get('supabase').from('issue_forms').select(ISSUE_SELECT).eq('id', id).maybeSingle(),
    c.get('supabase').from('issue_form_activities').select('*, actor:profiles(id, full_name)').eq('issue_form_id', id).order('created_at'),
  ]);
  if (issue.error ?? activities.error) return c.json(fail(reqId, 'ISSUE_FORM_LOAD_FAILED', 'ดึงรายละเอียดแบบฟอร์มไม่สำเร็จ'), 400);
  if (!issue.data) return c.json(fail(reqId, 'ISSUE_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์มงานนี้'), 404);
  return c.json(ok(reqId, { ...issue.data, activities: activities.data ?? [] }));
});

formsRoute.post('/issues', requirePermission('form.manage'), zValidator('json', createIssueFormSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const { data: template } = await admin.from('form_templates').select('*').eq('id', body.templateId).neq('status', 'Archived').maybeSingle();
  if (!template) return c.json(fail(reqId, 'FORM_TEMPLATE_NOT_FOUND', 'ไม่พบ Template ที่พร้อมใช้งาน'), 404);
  const { data, error } = await admin.from('issue_forms').insert({
    title: body.title, template_id: template.id, template_version: template.current_version,
    ticket_id: body.ticketId ?? null, content_html: template.content_html,
    created_by: actorId, updated_by: actorId,
  }).select(ISSUE_SELECT).single();
  if (error || !data) return dbFailJson(c, 'ISSUE_FORM_CREATE_FAILED', error, 'สร้างแบบฟอร์มงานไม่สำเร็จ');
  await addActivity(c.env, data.id, 'CREATE', actorId, { templateId: template.id, version: template.current_version });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'form', targetTable: 'issue_forms', targetId: data.id, detail: { formNo: data.form_no, templateId: template.id }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

formsRoute.patch('/issues/:id', requirePermission('form.manage'), zValidator('json', updateIssueFormSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  if (body.status === 'Closed') return c.json(fail(reqId, 'ISSUE_FORM_CLOSE_ENDPOINT_REQUIRED', 'กรุณาใช้คำสั่งปิดงาน'), 400);
  const patch: Record<string, unknown> = { updated_by: actorId };
  if (body.title !== undefined) patch.title = body.title;
  if (body.contentHtml !== undefined) patch.content_html = sanitizeFormHtml(body.contentHtml);
  if (body.formData !== undefined) patch.form_data = body.formData;
  if (body.status !== undefined) patch.status = body.status;
  const { data, error } = await createAdminClient(c.env).from('issue_forms').update(patch).eq('id', c.req.param('id')!).select(ISSUE_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'ISSUE_FORM_UPDATE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'ISSUE_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์มงานนี้'), 404);
  await addActivity(c.env, data.id, 'UPDATE', actorId, { fields: Object.keys(body), status: body.status });
  return c.json(ok(reqId, data));
});

formsRoute.post('/issues/:id/send-vendor', requirePermission('form.vendor_send'), zValidator('json', sendIssueFormToVendorSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const [{ data: issue }, { data: vendor }] = await Promise.all([
    admin.from('issue_forms').select('id, form_no, status').eq('id', c.req.param('id')!).maybeSingle(),
    admin.from('vendors').select('id, name, email, status').eq('id', body.vendorId).eq('status', 'Active').maybeSingle(),
  ]);
  if (!issue) return c.json(fail(reqId, 'ISSUE_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์มงานนี้'), 404);
  if (!vendor) return c.json(fail(reqId, 'FORM_VENDOR_NOT_FOUND', 'ไม่พบ Vendor ที่ใช้งานอยู่'), 404);
  if (['Closed', 'Cancelled'].includes(issue.status)) return c.json(fail(reqId, 'ISSUE_FORM_NOT_SENDABLE', 'แบบฟอร์มนี้ปิดงานหรือยกเลิกแล้ว'), 400);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString();
  const { data, error } = await admin.from('issue_forms').update({
    vendor_id: body.vendorId,
    vendor_access_token_hash: await hashToken(token),
    vendor_access_expires_at: expiresAt,
    vendor_sent_at: new Date().toISOString(),
    vendor_due_at: body.dueDate || null,
    status: 'Sent to Vendor',
    updated_by: actorId,
  }).eq('id', issue.id).select(ISSUE_SELECT).single();
  if (error) return dbFailJson(c, 'ISSUE_FORM_VENDOR_SEND_FAILED', error);
  await addActivity(c.env, issue.id, 'SEND_VENDOR', actorId, { vendorId: body.vendorId, expiresAt, dueDate: body.dueDate || null });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'SEND_VENDOR', module: 'form', targetTable: 'issue_forms', targetId: issue.id, detail: { vendorId: body.vendorId, expiresAt }, requestId: reqId });
  return c.json(ok(reqId, { issue: data, vendorLink: `/vendor/forms/${token}`, vendor }));
});

formsRoute.post('/issues/:id/close', requirePermission('form.close'), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { data, error } = await createAdminClient(c.env).from('issue_forms').update({
    status: 'Closed', closed_at: new Date().toISOString(), vendor_access_token_hash: null,
    vendor_access_expires_at: null, updated_by: actorId,
  }).eq('id', c.req.param('id')!).select(ISSUE_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'ISSUE_FORM_CLOSE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'ISSUE_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์มงานนี้'), 404);
  await addActivity(c.env, data.id, 'CLOSE', actorId);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CLOSE', module: 'form', targetTable: 'issue_forms', targetId: data.id, requestId: reqId });
  return c.json(ok(reqId, data));
});

async function findVendorIssue(env: AppEnv['Bindings'], token: string) {
  const tokenHash = await hashToken(token);
  return createAdminClient(env).from('issue_forms').select(
    'id, form_no, title, status, content_html, vendor_due_at, vendor_response, vendor_access_expires_at, vendor:vendors(id, name), ticket:tickets(ticket_no, title), template:form_templates(name)',
  ).eq('vendor_access_token_hash', tokenHash).maybeSingle();
}

publicFormsRoute.get('/:token', edgeRateLimit({ keyFn: (c) => `vendor_form_read:${clientIp(c)}` }), rateLimit({ windowMs: 3600_000, max: 60, keyFn: (c) => `vendor_form_read:${clientIp(c)}` }), zValidator('param', vendorTokenParamSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { data } = await findVendorIssue(c.env, c.req.valid('param').token);
  if (!data) return c.json(fail(reqId, 'VENDOR_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์ม หรือลิงก์ไม่ถูกต้อง'), 404);
  if (!data.vendor_access_expires_at || Date.parse(data.vendor_access_expires_at) < Date.now()) return c.json(fail(reqId, 'VENDOR_FORM_LINK_EXPIRED', 'ลิงก์แบบฟอร์มนี้หมดอายุแล้ว กรุณาติดต่อเจ้าหน้าที่ IT'), 410);
  if (['Closed', 'Cancelled'].includes(data.status)) return c.json(fail(reqId, 'VENDOR_FORM_CLOSED', 'แบบฟอร์มนี้ปิดรับคำตอบแล้ว'), 410);
  return c.json(ok(reqId, data));
});

publicFormsRoute.post('/:token/response', edgeRateLimit({ keyFn: (c) => `vendor_form_submit:${clientIp(c)}` }), rateLimit({ windowMs: 3600_000, max: 10, keyFn: (c) => `vendor_form_submit:${clientIp(c)}` }), zValidator('param', vendorTokenParamSchema, zodValidationHook), zValidator('json', submitVendorFormSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const token = c.req.valid('param').token;
  const { data: issue } = await findVendorIssue(c.env, token);
  if (!issue) return c.json(fail(reqId, 'VENDOR_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์ม หรือลิงก์ไม่ถูกต้อง'), 404);
  if (!issue.vendor_access_expires_at || Date.parse(issue.vendor_access_expires_at) < Date.now()) return c.json(fail(reqId, 'VENDOR_FORM_LINK_EXPIRED', 'ลิงก์แบบฟอร์มนี้หมดอายุแล้ว'), 410);
  if (['Closed', 'Cancelled'].includes(issue.status)) return c.json(fail(reqId, 'VENDOR_FORM_CLOSED', 'แบบฟอร์มนี้ปิดรับคำตอบแล้ว'), 410);
  const response = { ...c.req.valid('json'), submittedAt: new Date().toISOString() };
  const { data, error } = await createAdminClient(c.env).from('issue_forms').update({
    vendor_response: response, vendor_responded_at: response.submittedAt, status: 'Vendor Replied',
  }).eq('id', issue.id).select('id, form_no, status, vendor_responded_at').single();
  if (error) return c.json(fail(reqId, 'VENDOR_FORM_SUBMIT_FAILED', 'ส่งผลการประเมินไม่สำเร็จ กรุณาลองใหม่'), 400);
  await addActivity(c.env, issue.id, 'VENDOR_RESPONSE', null, { slaCategory: response.slaCategory, assessorName: response.assessorName }, 'vendor');
  await writeAuditLog(c.env, { actorEmail: `VENDOR:${clientIp(c)}`, action: 'VENDOR_RESPONSE', module: 'form', targetTable: 'issue_forms', targetId: issue.id, detail: { slaCategory: response.slaCategory }, requestId: reqId });
  return c.json(ok(reqId, data));
});

