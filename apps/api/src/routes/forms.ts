import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { randomToken } from '../lib/lineAuth';
import { renderHtmlToPdf } from '../lib/pdf';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { FORM_MODULES } from '../services/formModuleService';
import { missingRequiredFields, sha256Hex } from '../services/formSchema';
import { fetchGoogleDocHtml, googleDocsConfig } from '../services/googleDriveService';
import type { AppEnv } from '../types';
import { sanitizeFormHtml } from '../utils/formHtml';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { zodValidationHook } from '../utils/validation';
import {
  createFormTemplateSchema,
  importGoogleDocSchema,
  createIssueFormSchema,
  acknowledgeIssueFormSchema,
  compareFormTemplateVersionsSchema,
  publishFormTemplateSchema,
  sendIssueFormToVendorSchema,
  signIssueFormSchema,
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
const ISSUE_SELECT = 'id, form_no, document_number, title, template_id, template_version, source_module, source_record_id, ticket_id, vendor_id, status, content_html, field_schema, form_data, vendor_response, immutable_snapshot, snapshot_hash, issued_at, issued_by, vendor_access_expires_at, vendor_sent_at, vendor_due_at, vendor_responded_at, closed_at, created_by, updated_by, created_at, updated_at, template:form_templates(id, template_code, name, field_schema, acknowledgement_config, approval_signature_config, document_number_rule), vendor:vendors(id, vendor_code, name, email, contact_person), ticket:tickets(id, ticket_no, title), creator:profiles!issue_forms_created_by_fkey(id, full_name)';

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
  const supabase = c.get('supabase');
  const [{ data, error }, { data: bindings, error: bindingsError }] = await Promise.all([
    supabase.from('form_templates').select(TEMPLATE_SELECT).order('updated_at', { ascending: false }),
    supabase.from('form_module_bindings').select('module_key, template_id'),
  ]);
  if (error) return c.json(fail(reqId, 'FORM_TEMPLATE_LIST_FAILED', 'ดึงคลังแบบฟอร์มไม่สำเร็จ'), 400);
  if (bindingsError) return dbFailJson(c, 'FORM_MODULE_BINDING_LIST_FAILED', bindingsError, 'ดึงการใช้งานแบบฟอร์มตามโมดูลไม่สำเร็จ');
  const moduleByTemplateId = new Map((bindings ?? []).map((binding) => [binding.template_id, binding.module_key]));
  return c.json(ok(reqId, (data ?? []).map((template) => ({ ...template, module_key: moduleByTemplateId.get(template.id) ?? null }))));
});

formsRoute.get('/modules', async (c) => {
  const reqId = c.get('requestId');
  const supabase = c.get('supabase');
  const { data: bindings, error: bindingsError } = await supabase.from('form_module_bindings').select('module_key, template_id');
  if (bindingsError) return dbFailJson(c, 'FORM_MODULE_LIST_FAILED', bindingsError, 'ดึงรายการโมดูลของ Form Studio ไม่สำเร็จ');
  const templateIds = (bindings ?? []).map((binding) => binding.template_id);
  const { data: templates, error: templatesError } = templateIds.length
    ? await supabase.from('form_templates').select('id, template_code, name, status, current_version, updated_at').in('id', templateIds)
    : { data: [], error: null };
  if (templatesError) return dbFailJson(c, 'FORM_MODULE_TEMPLATE_LIST_FAILED', templatesError, 'ดึง Template ของโมดูลไม่สำเร็จ');
  const templateById = new Map((templates ?? []).map((template) => [template.id, template]));
  return c.json(ok(reqId, FORM_MODULES.map((module) => ({
    key: module.key,
    label: module.label,
    description: module.description,
    template: templateById.get((bindings ?? []).find((binding) => binding.module_key === module.key)?.template_id ?? '') ?? null,
  }))));
});

formsRoute.get('/templates/:id/versions', async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('form_template_versions').select('*').eq('template_id', c.req.param('id')!).order('version', { ascending: false });
  if (error) return c.json(fail(reqId, 'FORM_TEMPLATE_VERSION_LIST_FAILED', 'ดึงประวัติเวอร์ชันไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data ?? []));
});

formsRoute.get('/templates/:id/compare', zValidator('query', compareFormTemplateVersionsSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { from, to } = c.req.valid('query');
  const { data, error } = await c.get('supabase').from('form_template_versions')
    .select('version, name, description, content_html, field_schema, acknowledgement_config, approval_signature_config, document_number_rule, change_note, created_at')
    .eq('template_id', c.req.param('id')!)
    .in('version', [from, to]);
  if (error) return dbFailJson(c, 'FORM_TEMPLATE_COMPARE_FAILED', error, 'เปรียบเทียบเวอร์ชันแบบฟอร์มไม่สำเร็จ');
  const left = data?.find((item) => item.version === from);
  const right = data?.find((item) => item.version === to);
  if (!left || !right) return c.json(fail(reqId, 'FORM_TEMPLATE_VERSION_NOT_FOUND', 'ไม่พบเวอร์ชันที่ต้องการเปรียบเทียบ'), 404);
  return c.json(ok(reqId, {
    from: left,
    to: right,
    changed: {
      contentHtml: left.content_html !== right.content_html,
      fieldSchema: JSON.stringify(left.field_schema) !== JSON.stringify(right.field_schema),
      acknowledgement: JSON.stringify(left.acknowledgement_config) !== JSON.stringify(right.acknowledgement_config),
      approvalSignature: JSON.stringify(left.approval_signature_config) !== JSON.stringify(right.approval_signature_config),
      documentNumberRule: JSON.stringify(left.document_number_rule) !== JSON.stringify(right.document_number_rule),
    },
  }));
});

formsRoute.post(
  '/templates/import-google-doc',
  requirePermission('form.manage'),
  rateLimit({ windowMs: 3600_000, max: 10, keyFn: (c) => `form_google_doc_import:${c.get('userId')}` }),
  zValidator('json', importGoogleDocSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');
    if (!googleDocsConfig(c.env)) {
      return c.json(fail(reqId, 'GOOGLE_DRIVE_NOT_CONFIGURED', 'ยังไม่ได้เปิดใช้งานการเชื่อมต่อ Google Drive'), 503);
    }

    const imported = await fetchGoogleDocHtml(c.env, body.source);
    if (!imported.ok) {
      const status = imported.reason === 'configuration' ? 503 : imported.reason === 'rejected' ? 400 : 502;
      return c.json(fail(reqId, imported.reason === 'configuration' ? 'GOOGLE_DRIVE_NOT_CONFIGURED' : 'GOOGLE_DOC_IMPORT_FAILED', imported.message), status);
    }

    const contentHtml = sanitizeFormHtml(imported.document.html);
    if (!contentHtml) return c.json(fail(reqId, 'GOOGLE_DOC_IMPORT_EMPTY', 'Google Docs ไม่มีเนื้อหาที่นำมาใช้เป็นแบบฟอร์มได้'), 400);
    if (contentHtml.length > 300_000) return c.json(fail(reqId, 'GOOGLE_DOC_IMPORT_TOO_LARGE', 'เนื้อหา Google Docs ใหญ่เกินขนาดที่ระบบรองรับหลังการนำเข้า'), 400);

    const admin = createAdminClient(c.env);
    const payload = {
      template_code: generatedTemplateCode(),
      name: body.name || imported.document.name,
      description: body.description || `นำเข้าจาก Google Docs: ${imported.document.name}`,
      category: body.category,
      content_html: contentHtml,
      field_schema: [],
      acknowledgement_config: { enabled: false, statement: '' },
      approval_signature_config: { requiredRoles: [] },
      document_number_rule: { prefix: 'FRM', dateFormat: 'YYYYMM', padding: 5 },
      page_settings: { size: 'A4', orientation: 'portrait', marginMm: 20 },
      created_by: actorId,
      updated_by: actorId,
    };
    const { data, error } = await admin.from('form_templates').insert(payload).select(TEMPLATE_SELECT).single();
    if (error || !data) return dbFailJson(c, 'FORM_TEMPLATE_IMPORT_FAILED', error, 'สร้าง Template จาก Google Docs ไม่สำเร็จ');

    const { error: versionError } = await admin.from('form_template_versions').insert({
      field_schema: data.field_schema,
      acknowledgement_config: data.acknowledgement_config,
      approval_signature_config: data.approval_signature_config,
      document_number_rule: data.document_number_rule,
      template_id: data.id,
      version: 1,
      name: data.name,
      description: data.description,
      content_html: data.content_html,
      page_settings: data.page_settings,
      change_note: 'นำเข้าจาก Google Docs',
      created_by: actorId,
    });
    if (versionError) return dbFailJson(c, 'FORM_TEMPLATE_IMPORT_FAILED', versionError, 'สร้างเวอร์ชันเริ่มต้นของ Template ไม่สำเร็จ');

    if (body.moduleKey) {
      const { error: bindingError } = await admin.rpc('assign_form_module_template', {
        module_key_input: body.moduleKey,
        template_id_input: data.id,
        updated_by_input: actorId,
      });
      if (bindingError) return dbFailJson(c, 'FORM_MODULE_BINDING_FAILED', bindingError, 'กำหนด Template ให้โมดูลไม่สำเร็จ');
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'IMPORT_GOOGLE_DOC',
      module: 'form',
      targetTable: 'form_templates',
      targetId: data.id,
      detail: { documentId: imported.document.documentId, source: imported.document.webViewLink, bytes: new TextEncoder().encode(contentHtml).byteLength },
      requestId: reqId,
    });
    return c.json(ok(reqId, { ...data, module_key: body.moduleKey ?? null, source_document: imported.document.webViewLink }), 201);
  },
);

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
    field_schema: body.fieldSchema,
    acknowledgement_config: body.acknowledgementConfig,
    approval_signature_config: body.approvalSignatureConfig,
    document_number_rule: body.documentNumberRule,
    page_settings: body.pageSettings,
    created_by: actorId,
    updated_by: actorId,
  };
  const { data, error } = await admin.from('form_templates').insert(payload).select(TEMPLATE_SELECT).single();
  if (error || !data) return dbFailJson(c, 'FORM_TEMPLATE_CREATE_FAILED', error, 'สร้างแบบฟอร์มไม่สำเร็จ');
  const { error: versionError } = await admin.from('form_template_versions').insert({
    field_schema: data.field_schema, acknowledgement_config: data.acknowledgement_config,
    approval_signature_config: data.approval_signature_config, document_number_rule: data.document_number_rule,
    template_id: data.id, version: 1, name: data.name, description: data.description,
    content_html: data.content_html, page_settings: data.page_settings, change_note: 'สร้างแบบฟอร์ม', created_by: actorId,
  });
  if (versionError) return dbFailJson(c, 'FORM_TEMPLATE_CREATE_FAILED', versionError, 'สร้างเวอร์ชันเริ่มต้นของแบบฟอร์มไม่สำเร็จ');
  if (body.moduleKey) {
    const { error: bindingError } = await admin.rpc('assign_form_module_template', {
      module_key_input: body.moduleKey,
      template_id_input: data.id,
      updated_by_input: actorId,
    });
    if (bindingError) return dbFailJson(c, 'FORM_MODULE_BINDING_FAILED', bindingError, 'กำหนดแบบฟอร์มให้โมดูลไม่สำเร็จ');
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'form', targetTable: 'form_templates', targetId: data.id, detail: { templateCode: data.template_code }, requestId: reqId });
  return c.json(ok(reqId, { ...data, module_key: body.moduleKey ?? null }), 201);
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
  if (body.fieldSchema !== undefined) patch.field_schema = body.fieldSchema;
  if (body.acknowledgementConfig !== undefined) patch.acknowledgement_config = body.acknowledgementConfig;
  if (body.approvalSignatureConfig !== undefined) patch.approval_signature_config = body.approvalSignatureConfig;
  if (body.documentNumberRule !== undefined) patch.document_number_rule = body.documentNumberRule;
  if (body.pageSettings !== undefined) patch.page_settings = body.pageSettings;
  const auditBefore = await loadAuditSnapshot(createAdminClient(c.env), 'form_templates', c.req.param('id'));
  const { data, error } = await createAdminClient(c.env).from('form_templates').update(patch).eq('id', c.req.param('id')!).select(TEMPLATE_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'FORM_TEMPLATE_UPDATE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'FORM_TEMPLATE_NOT_FOUND', 'ไม่พบ Template นี้'), 404);
  if (body.moduleKey !== undefined) {
    const bindingResult = body.moduleKey
      ? await createAdminClient(c.env).rpc('assign_form_module_template', {
        module_key_input: body.moduleKey,
        template_id_input: data.id,
        updated_by_input: actorId,
      })
      : await createAdminClient(c.env).from('form_module_bindings').delete().eq('template_id', data.id);
    if (bindingResult.error) return dbFailJson(c, 'FORM_MODULE_BINDING_FAILED', bindingResult.error, 'อัปเดตการใช้งานแบบฟอร์มของโมดูลไม่สำเร็จ');
  }
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
    content_html: current.content_html, field_schema: current.field_schema, acknowledgement_config: current.acknowledgement_config,
    approval_signature_config: current.approval_signature_config, document_number_rule: current.document_number_rule, page_settings: current.page_settings,
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
  const [vendors, tickets, incidents, changes, contracts, audits, risks, serviceRequests] = await Promise.all([
    admin.from('vendors').select('id, vendor_code, name, email, contact_person, status').eq('status', 'Active').order('name').limit(2000),
    admin.from('tickets').select('id, ticket_no, title, status').order('created_at', { ascending: false }).limit(500),
    admin.from('incidents').select('id, incident_number, title, status').order('updated_at', { ascending: false }).limit(500),
    admin.from('change_requests').select('id, change_number, title, status').order('updated_at', { ascending: false }).limit(500),
    admin.from('contracts').select('id, contract_number, name, status').order('updated_at', { ascending: false }).limit(500),
    admin.from('audit_engagements').select('id, audit_code, title, status').order('updated_at', { ascending: false }).limit(500),
    admin.from('governance_risks').select('id, risk_code, title, status').order('updated_at', { ascending: false }).limit(500),
    admin.from('service_requests').select('id, service_code, service_name, summary, status').order('updated_at', { ascending: false }).limit(500),
  ]);
  const error = vendors.error ?? tickets.error ?? incidents.error ?? changes.error ?? contracts.error ?? audits.error ?? risks.error ?? serviceRequests.error;
  if (error) return c.json(fail(reqId, 'FORM_REFERENCES_FAILED', 'ดึงข้อมูล Ticket/Vendor ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, {
    vendors: vendors.data ?? [], tickets: tickets.data ?? [],
    sources: {
      ticket: tickets.data ?? [], incident: incidents.data ?? [], change: changes.data ?? [],
      contract: contracts.data ?? [], audit: audits.data ?? [], risk: risks.data ?? [], service_request: serviceRequests.data ?? [],
    },
  }));
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
    ticket_id: body.ticketId ?? null,
    source_module: body.sourceModule ?? (body.ticketId ? 'ticket' : 'custom'),
    source_record_id: body.sourceRecordId ?? body.ticketId ?? null,
    field_schema: template.field_schema ?? [],
    content_html: template.content_html,
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
  if (body.fieldSchema !== undefined) patch.field_schema = body.fieldSchema;
  if (body.sourceModule !== undefined) patch.source_module = body.sourceModule;
  if (body.sourceRecordId !== undefined) patch.source_record_id = body.sourceRecordId;
  if (body.formData !== undefined) patch.form_data = body.formData;
  if (body.status !== undefined) patch.status = body.status;
  const currentIssue = await createAdminClient(c.env).from('issue_forms').select('field_schema, form_data, issued_at').eq('id', c.req.param('id')!).maybeSingle();
  if (currentIssue.error) return dbFailJson(c, 'ISSUE_FORM_LOAD_FAILED', currentIssue.error);
  if (body.status && body.status !== 'Draft') {
    const missing = missingRequiredFields(body.fieldSchema ?? currentIssue.data?.field_schema, body.formData ?? currentIssue.data?.form_data ?? {});
    if (missing.length) return c.json(fail(reqId, 'FORM_REQUIRED_FIELDS_MISSING', `กรุณากรอกข้อมูลที่จำเป็น: ${missing.map((field) => field.label).join(', ')}`), 422);
  }
  const { data, error } = await createAdminClient(c.env).from('issue_forms').update(patch).eq('id', c.req.param('id')!).select(ISSUE_SELECT).maybeSingle();
  if (error) return dbFailJson(c, 'ISSUE_FORM_UPDATE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'ISSUE_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์มงานนี้'), 404);
  await addActivity(c.env, data.id, 'UPDATE', actorId, { fields: Object.keys(body), status: body.status });
  return c.json(ok(reqId, data));
});

formsRoute.post('/issues/:id/acknowledgement', requirePermission('form.acknowledge'), zValidator('json', acknowledgeIssueFormSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const issueId = c.req.param('id')!;
  const issue = await createAdminClient(c.env).from('issue_forms').select('id, issued_at').eq('id', issueId).maybeSingle();
  if (issue.error) return dbFailJson(c, 'ISSUE_FORM_LOAD_FAILED', issue.error);
  if (!issue.data) return c.json(fail(reqId, 'ISSUE_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์มงานนี้'), 404);
  if (issue.data.issued_at) return c.json(fail(reqId, 'ISSUE_FORM_ALREADY_ISSUED', 'เอกสารนี้ออกเอกสารและล็อก Snapshot แล้ว'), 409);
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).from('issue_form_acknowledgements').insert({
    issue_form_id: issueId, party_type: body.partyType, party_name: body.partyName, party_email: body.partyEmail || null,
    statement: body.statement, accepted: body.accepted, actor_id: actorId,
    evidence: { requestId: reqId, ip: clientIp(c), userAgent: c.req.header('user-agent') ?? null },
  }).select('*').single();
  if (error) return dbFailJson(c, 'ISSUE_FORM_ACKNOWLEDGEMENT_FAILED', error, error.code === '23505' ? 'ผู้เกี่ยวข้องนี้ลงนามรับทราบไปแล้ว' : undefined);
  await addActivity(c.env, issueId, 'ACKNOWLEDGEMENT', actorId, { partyType: body.partyType });
  return c.json(ok(reqId, data), 201);
});

formsRoute.post('/issues/:id/signature', requirePermission('form.sign'), zValidator('json', signIssueFormSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const issueId = c.req.param('id')!;
  const issue = await createAdminClient(c.env).from('issue_forms').select('id, issued_at').eq('id', issueId).maybeSingle();
  if (issue.error) return dbFailJson(c, 'ISSUE_FORM_LOAD_FAILED', issue.error);
  if (!issue.data) return c.json(fail(reqId, 'ISSUE_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์มงานนี้'), 404);
  if (issue.data.issued_at) return c.json(fail(reqId, 'ISSUE_FORM_ALREADY_ISSUED', 'เอกสารนี้ออกเอกสารและล็อก Snapshot แล้ว'), 409);
  const body = c.req.valid('json');
  const evidence = { requestId: reqId, ip: clientIp(c), userAgent: c.req.header('user-agent') ?? null };
  const evidenceHash = await sha256Hex({ issueId, role: body.role, signerName: body.signerName, signatureType: body.signatureType, signatureValue: body.signatureValue, evidence });
  const { data, error } = await createAdminClient(c.env).from('issue_form_signatures').insert({
    issue_form_id: issueId, role: body.role, signer_name: body.signerName, signer_email: body.signerEmail || null,
    signature_type: body.signatureType, signature_value: body.signatureValue, evidence_hash: evidenceHash, evidence, actor_id: actorId,
  }).select('*').single();
  if (error) return dbFailJson(c, 'ISSUE_FORM_SIGNATURE_FAILED', error, error.code === '23505' ? 'บทบาทนี้ลงลายเซ็นไปแล้ว' : undefined);
  await addActivity(c.env, issueId, 'SIGNATURE', actorId, { role: body.role, evidenceHash });
  return c.json(ok(reqId, data), 201);
});

async function issueSnapshot(env: AppEnv['Bindings'], issueId: string, actorId: string, requestId: string) {
  const admin = createAdminClient(env);
  const { data: issue, error: issueError } = await admin.from('issue_forms')
    .select('id, form_no, document_number, title, template_id, template_version, source_module, source_record_id, content_html, field_schema, form_data, issued_at')
    .eq('id', issueId).maybeSingle();
  if (issueError) return { error: issueError };
  if (!issue) return { missing: true, error: null };
  const [{ data: acks, error: ackError }, { data: signatures, error: signatureError }, { data: template, error: templateError }] = await Promise.all([
    admin.from('issue_form_acknowledgements').select('*').eq('issue_form_id', issueId).order('acknowledged_at'),
    admin.from('issue_form_signatures').select('*').eq('issue_form_id', issueId).order('signed_at'),
    admin.from('form_templates').select('acknowledgement_config, approval_signature_config').eq('id', issue.template_id).maybeSingle(),
  ]);
  if (ackError || signatureError || templateError) return { error: ackError ?? signatureError ?? templateError };
  if (issue.issued_at) {
    const existing = await admin.from('issue_form_snapshots').select('*').eq('issue_form_id', issueId).maybeSingle();
    return { snapshot: existing.data, error: existing.error };
  }
  const acknowledgementConfig = (template?.acknowledgement_config ?? {}) as { enabled?: boolean };
  if (acknowledgementConfig.enabled && (!acks || acks.length === 0)) {
    return { validationError: 'Digital acknowledgement ต้องถูกบันทึกก่อนออกเอกสาร' };
  }
  const approvalSignatureConfig = (template?.approval_signature_config ?? {}) as { requiredRoles?: unknown };
  const requiredRoles = Array.isArray(approvalSignatureConfig.requiredRoles)
    ? approvalSignatureConfig.requiredRoles.filter((role): role is string => typeof role === 'string' && role.length > 0)
    : [];
  const signedRoles = new Set((signatures ?? []).map((signature) => signature.role));
  const missingRoles = requiredRoles.filter((role) => !signedRoles.has(role));
  if (missingRoles.length) {
    return { validationError: `ต้องมี Approval Signature Evidence สำหรับบทบาท: ${missingRoles.join(', ')}` };
  }
  const snapshot = {
    issue_form_id: issue.id, form_no: issue.form_no, document_number: issue.document_number ?? issue.form_no,
    title: issue.title, template_id: issue.template_id, template_version: issue.template_version,
    source_module: issue.source_module, source_record_id: issue.source_record_id, content_html: issue.content_html,
    field_schema: issue.field_schema ?? [], form_data: issue.form_data ?? {}, acknowledgement_evidence: acks ?? [], signature_evidence: signatures ?? [],
  };
  const snapshotHash = await sha256Hex(snapshot);
  const { data: created, error: createError } = await admin.from('issue_form_snapshots').insert({ ...snapshot, snapshot_hash: snapshotHash, issued_by: actorId }).select('*').single();
  if (createError) {
    if (createError.code === '23505') {
      const existing = await admin.from('issue_form_snapshots').select('*').eq('issue_form_id', issueId).maybeSingle();
      return { snapshot: existing.data, error: existing.error };
    }
    return { error: createError };
  }
  const { error: lockError } = await admin.from('issue_forms').update({ immutable_snapshot: { ...snapshot, snapshot_hash: snapshotHash }, snapshot_hash: snapshotHash, issued_at: created.issued_at, issued_by: actorId, updated_by: actorId }).eq('id', issueId).is('issued_at', null);
  if (lockError) return { error: lockError };
  await addActivity(env, issueId, 'ISSUE_DOCUMENT', actorId, { documentNumber: snapshot.document_number, snapshotHash });
  await writeAuditLog(env, { actorId, action: 'ISSUE_DOCUMENT', module: 'form', targetTable: 'issue_forms', targetId: issueId, detail: { documentNumber: snapshot.document_number, snapshotHash }, requestId });
  return { snapshot: created };
}

formsRoute.post('/issues/:id/issue', requirePermission('form.manage'), async (c) => {
  const reqId = c.get('requestId');
  const result = await issueSnapshot(c.env, c.req.param('id')!, c.get('userId'), reqId);
  if (result.missing) return c.json(fail(reqId, 'ISSUE_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์มงานนี้'), 404);
  if (result.validationError) return c.json(fail(reqId, 'FORM_EVIDENCE_REQUIRED', result.validationError), 422);
  if (result.error) return dbFailJson(c, 'ISSUE_FORM_ISSUE_FAILED', result.error);
  return c.json(ok(reqId, result.snapshot));
});

formsRoute.post('/issues/:id/exports/pdf', requirePermission('form.export'), async (c) => {
  const reqId = c.get('requestId');
  if (!c.env.MYBROWSER) return c.json(fail(reqId, 'PDF_EXPORT_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า Browser Rendering สำหรับสร้าง PDF'), 503);
  const { data: snapshot, error } = await createAdminClient(c.env).from('issue_form_snapshots').select('*').eq('issue_form_id', c.req.param('id')!).maybeSingle();
  if (error) return dbFailJson(c, 'FORM_SNAPSHOT_LOAD_FAILED', error);
  if (!snapshot) return c.json(fail(reqId, 'FORM_SNAPSHOT_REQUIRED', 'กรุณาออกเอกสารเพื่อสร้าง Immutable Snapshot ก่อนส่งออก PDF'), 409);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${snapshot.document_number}</title><style>body{font-family:Arial,"Noto Sans Thai",sans-serif;color:#111827;margin:0;padding:18mm}h1,h2,h3{break-after:avoid}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:6px;vertical-align:top}img{max-width:100%}.meta{font-size:11px;color:#4b5563;border-bottom:1px solid #d1d5db;padding-bottom:8px;margin-bottom:16px}</style></head><body><div class="meta"><strong>${snapshot.document_number}</strong> · ${snapshot.title} · source: ${snapshot.source_module}/${snapshot.source_record_id ?? '—'} · issued: ${snapshot.issued_at}</div>${snapshot.content_html}</body></html>`;
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderHtmlToPdf(c.env.MYBROWSER, html);
  } catch (renderError) {
    console.error(JSON.stringify({ requestId: reqId, code: 'FORM_PDF_RENDER_FAILED', message: renderError instanceof Error ? renderError.message : String(renderError) }));
    return c.json(fail(reqId, 'PDF_RENDER_FAILED', 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 502);
  }
  const filename = `${snapshot.document_number}.pdf`;
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'FORM_EXPORT_PDF', module: 'form', targetTable: 'issue_form_snapshots', targetId: snapshot.id, detail: { filename, bytes: pdfBytes.byteLength, snapshotHash: snapshot.snapshot_hash }, requestId: reqId });
  return c.json(ok(reqId, { filename, pdfBase64: Buffer.from(pdfBytes).toString('base64'), snapshotHash: snapshot.snapshot_hash }));
});

formsRoute.post('/issues/:id/send-vendor', requirePermission('form.vendor_send'), zValidator('json', sendIssueFormToVendorSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const [{ data: issue }, { data: vendor }] = await Promise.all([
    admin.from('issue_forms').select('id, form_no, status, field_schema, form_data, issued_at').eq('id', c.req.param('id')!).maybeSingle(),
    admin.from('vendors').select('id, name, email, status').eq('id', body.vendorId).eq('status', 'Active').maybeSingle(),
  ]);
  if (issue?.status && !['Closed', 'Cancelled'].includes(issue.status)) {
    const missing = missingRequiredFields(issue.field_schema, issue.form_data ?? {});
    if (missing.length) return c.json(fail(reqId, 'FORM_REQUIRED_FIELDS_MISSING', `กรุณากรอกข้อมูลที่จำเป็น: ${missing.map((field) => field.label).join(', ')}`), 422);
  }
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
  return c.json(ok(reqId, { issue: data, vendorLink: `/vendor/forms#token=${encodeURIComponent(token)}`, vendor }));
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
    'id, form_no, title, status, content_html, vendor_due_at, vendor_response, vendor_access_expires_at, vendor:vendors(id, name), ticket:tickets(ticket_no, title), template:form_templates(name, acknowledgement_config)',
  ).eq('vendor_access_token_hash', tokenHash).maybeSingle();
}

publicFormsRoute.get('/current', edgeRateLimit({ keyFn: (c) => `vendor_form_read:${clientIp(c)}` }), rateLimit({ windowMs: 3600_000, max: 60, keyFn: (c) => `vendor_form_read:${clientIp(c)}` }), async (c) => {
  const reqId = c.get('requestId');
  const tokenResult = vendorTokenParamSchema.safeParse({ token: c.req.header('x-vendor-token') });
  if (!tokenResult.success) return c.json(fail(reqId, 'VENDOR_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์ม หรือลิงก์ไม่ถูกต้อง'), 404);
  const { data } = await findVendorIssue(c.env, tokenResult.data.token);
  if (!data) return c.json(fail(reqId, 'VENDOR_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์ม หรือลิงก์ไม่ถูกต้อง'), 404);
  if (!data.vendor_access_expires_at || Date.parse(data.vendor_access_expires_at) < Date.now()) return c.json(fail(reqId, 'VENDOR_FORM_LINK_EXPIRED', 'ลิงก์แบบฟอร์มนี้หมดอายุแล้ว กรุณาติดต่อเจ้าหน้าที่ IT'), 410);
  if (['Closed', 'Cancelled'].includes(data.status)) return c.json(fail(reqId, 'VENDOR_FORM_CLOSED', 'แบบฟอร์มนี้ปิดรับคำตอบแล้ว'), 410);
  return c.json(ok(reqId, data));
});

publicFormsRoute.post('/current/acknowledgement', edgeRateLimit({ keyFn: (c) => `vendor_form_ack:${clientIp(c)}` }), rateLimit({ windowMs: 3600_000, max: 10, keyFn: (c) => `vendor_form_ack:${clientIp(c)}` }), zValidator('json', acknowledgeIssueFormSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const tokenResult = vendorTokenParamSchema.safeParse({ token: c.req.header('x-vendor-token') });
  if (!tokenResult.success) return c.json(fail(reqId, 'VENDOR_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์ม หรือ Token ไม่ถูกต้อง'), 404);
  const { data: issue } = await findVendorIssue(c.env, tokenResult.data.token);
  if (!issue) return c.json(fail(reqId, 'VENDOR_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์ม หรือ Token ไม่ถูกต้อง'), 404);
  if (!issue.vendor_access_expires_at || Date.parse(issue.vendor_access_expires_at) < Date.now()) return c.json(fail(reqId, 'VENDOR_FORM_LINK_EXPIRED', 'ลิงก์แบบฟอร์มนี้หมดอายุแล้ว'), 410);
  if (['Closed', 'Cancelled'].includes(issue.status)) return c.json(fail(reqId, 'VENDOR_FORM_CLOSED', 'แบบฟอร์มนี้ปิดรับคำตอบแล้ว'), 410);
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).from('issue_form_acknowledgements').insert({
    issue_form_id: issue.id, party_type: 'vendor', party_name: body.partyName, party_email: body.partyEmail || null,
    statement: body.statement, accepted: body.accepted,
    evidence: { requestId: reqId, ip: clientIp(c), userAgent: c.req.header('user-agent') ?? null, tokenHash: await hashToken(tokenResult.data.token) },
  }).select('id, issue_form_id, party_type, party_name, acknowledged_at').single();
  if (error) return dbFailJson(c, 'VENDOR_FORM_ACKNOWLEDGEMENT_FAILED', error, error.code === '23505' ? 'แบบฟอร์มนี้มีการรับทราบแล้ว' : undefined);
  await addActivity(c.env, issue.id, 'VENDOR_ACKNOWLEDGEMENT', null, { partyName: body.partyName }, 'vendor');
  return c.json(ok(reqId, data), 201);
});

publicFormsRoute.post('/current/response', edgeRateLimit({ keyFn: (c) => `vendor_form_submit:${clientIp(c)}` }), rateLimit({ windowMs: 3600_000, max: 10, keyFn: (c) => `vendor_form_submit:${clientIp(c)}` }), zValidator('json', submitVendorFormSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const tokenResult = vendorTokenParamSchema.safeParse({ token: c.req.header('x-vendor-token') });
  if (!tokenResult.success) return c.json(fail(reqId, 'VENDOR_FORM_NOT_FOUND', 'ไม่พบแบบฟอร์ม หรือลิงก์ไม่ถูกต้อง'), 404);
  const token = tokenResult.data.token;
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

