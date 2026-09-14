import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { auditHashPayload, sanitizeAuditData, sha256Hex, writeAuditLog, type AuditEventCategory } from '../services/auditService';
import { loginHashPayload, type LoginLogEntry } from '../services/loginLogService';
import type { AppEnv } from '../types';
import { checkExportSize, exportFileName, listCsv, LIST_EXPORT_MAX_ROWS, type ExportColumn } from '../utils/listExport';
import { dbFailJson } from '../utils/dbError';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  auditArchiveSchema,
  auditEvidencePackageQuerySchema,
  auditIntegrityQuerySchema,
  auditOverviewQuerySchema,
  listAuditLogsQuerySchema,
  listLoginLogsQuerySchema,
} from '../validators/auditLogs';

export const auditLogsRoute = new Hono<AppEnv>();
auditLogsRoute.use('*', requireAuth);

const PAGE_BATCH_SIZE = 1_000;

function endOfDay(value: string): string {
  return `${value}T23:59:59.999+07:00`;
}

function jsonText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function packageMonthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const from = new Date(`${month}-01T00:00:00+07:00`);
  const nextMonth = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
  const to = new Date(`${nextMonth}-01T00:00:00+07:00`);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function fetchAllRows<T>(createQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_BATCH_SIZE) {
    const { data, error } = await createQuery(offset, offset + PAGE_BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_BATCH_SIZE) return rows;
  }
}

const AUDIT_EXPORT_COLUMNS: ExportColumn<Record<string, unknown>>[] = [
  { label: 'Timestamp', value: (row) => row.created_at },
  { label: 'Actor', value: (row) => row.actor_email ?? 'system' },
  { label: 'Actor Role', value: (row) => row.actor_role },
  { label: 'Action', value: (row) => row.action },
  { label: 'Module', value: (row) => row.module },
  { label: 'Event Category', value: (row) => row.event_category },
  { label: 'Privileged Action', value: (row) => row.privileged_action ? 'true' : 'false' },
  { label: 'Target Table', value: (row) => row.target_table },
  { label: 'Target ID', value: (row) => row.target_id },
  { label: 'Result', value: (row) => row.result },
  { label: 'Request ID', value: (row) => row.request_id },
  { label: 'Correlation ID', value: (row) => row.correlation_id },
  { label: 'Entry Hash', value: (row) => row.entry_hash },
  { label: 'Detail', value: (row) => jsonText(row.detail) },
];

const LOGIN_EXPORT_COLUMNS: ExportColumn<Record<string, unknown>>[] = [
  { label: 'Timestamp', value: (row) => row.created_at },
  { label: 'Event Type', value: (row) => row.event_type },
  { label: 'Email Attempted', value: (row) => row.email_attempted },
  { label: 'Result', value: (row) => row.success ? 'success' : 'fail' },
  { label: 'MFA Used', value: (row) => row.mfa_used ? 'true' : 'false' },
  { label: 'IP Address', value: (row) => row.ip_address },
  { label: 'User Agent', value: (row) => row.user_agent },
  { label: 'Failure Reason', value: (row) => row.failure_reason },
  { label: 'Request ID', value: (row) => row.request_id },
  { label: 'Correlation ID', value: (row) => row.correlation_id },
  { label: 'Entry Hash', value: (row) => row.entry_hash },
];

auditLogsRoute.get('/overview', requirePermission('audit.view'), zValidator('query', auditOverviewQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const since = new Date(Date.now() - c.req.valid('query').days * 86_400_000).toISOString();
  const supabase = c.get('supabase');
  const [audit, denied, failedActions, logins, failedLogins, privilegedActions, openAlerts] = await Promise.all([
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('result', 'denied'),
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('result', 'fail'),
    supabase.from('login_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('login_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('success', false),
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('privileged_action', true),
    supabase.from('audit_activity_alerts').select('id', { count: 'exact', head: true }).eq('status', 'OPEN'),
  ]);
  const error = [audit, denied, failedActions, logins, failedLogins, privilegedActions, openAlerts].find((result) => result.error)?.error;
  if (error) return dbFailJson(c, 'AUDIT_OVERVIEW_FAILED', error);
  return c.json(ok(requestId, {
    days: c.req.valid('query').days,
    auditTotal: audit.count ?? 0,
    denied: denied.count ?? 0,
    failedActions: failedActions.count ?? 0,
    loginTotal: logins.count ?? 0,
    failedLogins: failedLogins.count ?? 0,
    privilegedActions: privilegedActions.count ?? 0,
    openAlerts: openAlerts.count ?? 0,
  }));
});

auditLogsRoute.get('/export', requirePermission('audit.view'), zValidator('query', listAuditLogsQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { module, action, actor, result, eventCategory, privileged, from, to } = c.req.valid('query');
  const supabase = c.get('supabase');
  let countQuery = supabase.from('audit_logs').select('id', { count: 'exact', head: true });
  if (module) countQuery = countQuery.eq('module', module);
  if (action) countQuery = countQuery.eq('action', action);
  if (actor) countQuery = countQuery.ilike('actor_email', `%${actor}%`);
  if (result) countQuery = countQuery.eq('result', result);
  if (eventCategory) countQuery = countQuery.eq('event_category', eventCategory);
  if (privileged !== undefined) countQuery = countQuery.eq('privileged_action', privileged);
  if (from) countQuery = countQuery.gte('created_at', `${from}T00:00:00.000+07:00`);
  if (to) countQuery = countQuery.lte('created_at', endOfDay(to));
  const { count, error: countError } = await countQuery;
  if (countError) return dbFailJson(c, 'AUDIT_LOGS_EXPORT_FAILED', countError);
  const tooLarge = checkExportSize(count);
  if (tooLarge) return c.json(fail(reqId, 'EXPORT_TOO_LARGE', tooLarge.message), 400);

  let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).range(0, LIST_EXPORT_MAX_ROWS - 1);
  if (module) query = query.eq('module', module);
  if (action) query = query.eq('action', action);
  if (actor) query = query.ilike('actor_email', `%${actor}%`);
  if (result) query = query.eq('result', result);
  if (eventCategory) query = query.eq('event_category', eventCategory);
  if (privileged !== undefined) query = query.eq('privileged_action', privileged);
  if (from) query = query.gte('created_at', `${from}T00:00:00.000+07:00`);
  if (to) query = query.lte('created_at', endOfDay(to));
  const { data, error } = await query;
  if (error) return dbFailJson(c, 'AUDIT_LOGS_EXPORT_FAILED', error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'EXPORT_AUDIT_LOGS', module: 'audit',
    detail: { filters: { module, action, actor, result, eventCategory, privileged, from, to }, rowCount: rows.length }, requestId: reqId,
    eventCategory: 'export', privilegedAction: true,
  });
  return c.json(ok(reqId, { filename: exportFileName('audit-log'), csv: listCsv(AUDIT_EXPORT_COLUMNS, rows), rowCount: rows.length }));
});

auditLogsRoute.get('/login-logs/export', requirePermission('audit.view'), zValidator('query', listLoginLogsQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { email, success, eventType, from, to } = c.req.valid('query');
  const supabase = c.get('supabase');
  let countQuery = supabase.from('login_logs').select('id', { count: 'exact', head: true });
  if (email) countQuery = countQuery.ilike('email_attempted', `%${email}%`);
  if (success !== undefined) countQuery = countQuery.eq('success', success);
  if (eventType) countQuery = countQuery.eq('event_type', eventType);
  if (from) countQuery = countQuery.gte('created_at', `${from}T00:00:00.000+07:00`);
  if (to) countQuery = countQuery.lte('created_at', endOfDay(to));
  const { count, error: countError } = await countQuery;
  if (countError) return dbFailJson(c, 'LOGIN_LOGS_EXPORT_FAILED', countError);
  const tooLarge = checkExportSize(count);
  if (tooLarge) return c.json(fail(reqId, 'EXPORT_TOO_LARGE', tooLarge.message), 400);

  let query = supabase.from('login_logs').select('*').order('created_at', { ascending: false }).range(0, LIST_EXPORT_MAX_ROWS - 1);
  if (email) query = query.ilike('email_attempted', `%${email}%`);
  if (success !== undefined) query = query.eq('success', success);
  if (eventType) query = query.eq('event_type', eventType);
  if (from) query = query.gte('created_at', `${from}T00:00:00.000+07:00`);
  if (to) query = query.lte('created_at', endOfDay(to));
  const { data, error } = await query;
  if (error) return dbFailJson(c, 'LOGIN_LOGS_EXPORT_FAILED', error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'EXPORT_LOGIN_HISTORY', module: 'audit',
    detail: { filters: { email, success, eventType, from, to }, rowCount: rows.length }, requestId: reqId,
    eventCategory: 'export', privilegedAction: true,
  });
  return c.json(ok(reqId, { filename: exportFileName('login-history'), csv: listCsv(LOGIN_EXPORT_COLUMNS, rows), rowCount: rows.length }));
});

auditLogsRoute.get('/login-logs', requirePermission('audit.view'), zValidator('query', listLoginLogsQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const { page, pageSize, email, success, eventType, from, to } = c.req.valid('query');
  let query = c.get('supabase').from('login_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (email) query = query.ilike('email_attempted', `%${email}%`);
  if (success !== undefined) query = query.eq('success', success);
  if (eventType) query = query.eq('event_type', eventType);
  if (from) query = query.gte('created_at', `${from}T00:00:00.000+07:00`);
  if (to) query = query.lte('created_at', endOfDay(to));
  const { data, count, error } = await query;
  if (error) return dbFailJson(c, 'LOGIN_LOGS_LIST_FAILED', error);
  return c.json(ok(requestId, toPaginatedData(data, count, page, pageSize)));
});

auditLogsRoute.get('/controls', requirePermission('audit.view'), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [policy, auditArchive, loginArchive, alerts, openAlertCount, auditHash, loginHash, auditTotal, loginTotal] = await Promise.all([
    admin.from('audit_retention_policies').select('*').eq('status', 'ACTIVE').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('audit_log_archive').select('id', { count: 'exact', head: true }),
    admin.from('login_log_archive').select('id', { count: 'exact', head: true }),
    admin.from('audit_activity_alerts').select('id,alert_type,severity,title,message,event_count,last_seen_at,status').eq('status', 'OPEN').order('last_seen_at', { ascending: false }).limit(10),
    admin.from('audit_activity_alerts').select('id', { count: 'exact', head: true }).eq('status', 'OPEN'),
    admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('hash_algorithm', 'sha256'),
    admin.from('login_logs').select('id', { count: 'exact', head: true }).eq('hash_algorithm', 'sha256'),
    admin.from('audit_logs').select('id', { count: 'exact', head: true }),
    admin.from('login_logs').select('id', { count: 'exact', head: true }),
  ]);
  const error = [policy, auditArchive, loginArchive, alerts, openAlertCount, auditHash, loginHash, auditTotal, loginTotal].find((result) => result.error)?.error;
  if (error) return dbFailJson(c, 'AUDIT_CONTROLS_LOAD_FAILED', error);
  return c.json(ok(reqId, {
    retention: policy.data,
    archive: { auditRows: auditArchive.count ?? 0, loginRows: loginArchive.count ?? 0 },
    integrity: { auditHashed: auditHash.count ?? 0, auditTotal: auditTotal.count ?? 0, loginHashed: loginHash.count ?? 0, loginTotal: loginTotal.count ?? 0 },
    openAlertCount: openAlertCount.count ?? 0,
    alerts: alerts.data ?? [],
  }));
});

auditLogsRoute.get('/alerts', requirePermission('audit.view'), async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('audit_activity_alerts').select('*').order('last_seen_at', { ascending: false }).limit(50);
  if (error) return dbFailJson(c, 'AUDIT_ALERTS_LOAD_FAILED', error);
  return c.json(ok(reqId, data ?? []));
});

interface AuditIntegrityRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  module: string;
  target_table: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  result: 'success' | 'fail' | 'denied';
  request_id: string | null;
  correlation_id: string | null;
  event_category: string;
  privileged_action: boolean;
  entry_hash: string | null;
  hash_algorithm: string;
  created_at: string;
}

interface LoginIntegrityRow {
  id: string;
  user_id: string | null;
  email_attempted: string;
  success: boolean;
  failure_reason: string | null;
  mfa_used: boolean;
  ip_address: string | null;
  user_agent: string | null;
  event_type: LoginLogEntry['eventType'];
  request_id: string | null;
  correlation_id: string | null;
  entry_hash: string | null;
  hash_algorithm: string;
  created_at: string;
}

auditLogsRoute.get('/integrity', requirePermission('audit_management.verify'), zValidator('query', auditIntegrityQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { from, to } = c.req.valid('query');
  const admin = createAdminClient(c.env);
  try {
    const auditRows = await fetchAllRows<AuditIntegrityRow>((rangeFrom, rangeTo) => {
      let query = admin.from('audit_logs').select('id,actor_id,actor_email,actor_role,action,module,target_table,target_id,detail,result,request_id,correlation_id,event_category,privileged_action,entry_hash,hash_algorithm,created_at').order('created_at', { ascending: true }).range(rangeFrom, rangeTo);
      if (from) query = query.gte('created_at', `${from}T00:00:00.000+07:00`);
      if (to) query = query.lte('created_at', endOfDay(to));
      return query;
    });
    const loginRows = await fetchAllRows<LoginIntegrityRow>((rangeFrom, rangeTo) => {
      let query = admin.from('login_logs').select('id,user_id,email_attempted,success,failure_reason,mfa_used,ip_address,user_agent,event_type,request_id,correlation_id,entry_hash,hash_algorithm,created_at').order('created_at', { ascending: true }).range(rangeFrom, rangeTo);
      if (from) query = query.gte('created_at', `${from}T00:00:00.000+07:00`);
      if (to) query = query.lte('created_at', endOfDay(to));
      return query;
    });

    let verified = 0;
    let tampered = 0;
    let unverified = 0;
    const tamperedIds: string[] = [];
    for (const row of auditRows) {
      if (!row.entry_hash || row.hash_algorithm !== 'sha256') { unverified += 1; continue; }
      const expected = await sha256Hex(auditHashPayload({ id: row.id, createdAt: row.created_at, actorId: row.actor_id, actorEmail: row.actor_email, actorRole: row.actor_role, action: row.action, module: row.module, targetTable: row.target_table, targetId: row.target_id, detail: row.detail, result: row.result, requestId: row.request_id, correlationId: row.correlation_id, eventCategory: row.event_category as AuditEventCategory, privilegedAction: row.privileged_action }));
      if (expected === row.entry_hash) verified += 1;
      else { tampered += 1; if (tamperedIds.length < 20) tamperedIds.push(row.id); }
    }
    let loginVerified = 0;
    let loginTampered = 0;
    let loginUnverified = 0;
    const loginTamperedIds: string[] = [];
    for (const row of loginRows) {
      if (!row.entry_hash || row.hash_algorithm !== 'sha256') { loginUnverified += 1; continue; }
      const expected = await sha256Hex(loginHashPayload({ id: row.id, createdAt: row.created_at, userId: row.user_id, emailAttempted: row.email_attempted, success: row.success, failureReason: row.failure_reason, mfaUsed: row.mfa_used, ipAddress: row.ip_address, userAgent: row.user_agent, eventType: row.event_type, requestId: row.request_id, correlationId: row.correlation_id }));
      if (expected === row.entry_hash) loginVerified += 1;
      else { loginTampered += 1; if (loginTamperedIds.length < 20) loginTamperedIds.push(row.id); }
    }
    const totalTampered = tampered + loginTampered;
    const totalUnverified = unverified + loginUnverified;
    return c.json(ok(reqId, {
      checkedAt: new Date().toISOString(), algorithm: 'SHA-256',
      status: totalTampered > 0 ? 'FAIL' : totalUnverified > 0 ? 'WARN' : 'PASS',
      audit: { total: auditRows.length, verified, tampered, unverified, tamperedIds },
      login: { total: loginRows.length, verified: loginVerified, tampered: loginTampered, unverified: loginUnverified, tamperedIds: loginTamperedIds },
    }));
  } catch (error) {
    console.error(JSON.stringify({ requestId: reqId, code: 'AUDIT_INTEGRITY_FAILED', error: String(error) }));
    return c.json(fail(reqId, 'AUDIT_INTEGRITY_FAILED', 'Unable to verify audit evidence integrity'), 500);
  }
});

auditLogsRoute.get('/evidence-package', requirePermission('evidence.export'), zValidator('query', auditEvidencePackageQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const month = c.req.valid('query').month;
  const { from, to } = packageMonthBounds(month);
  const admin = createAdminClient(c.env);
  const [audit, login, changes, campaigns, campaignItems, backupEvidence] = await Promise.all([
    admin.from('audit_logs').select('id,actor_id,actor_email,actor_role,action,module,target_table,target_id,detail,result,request_id,correlation_id,event_category,privileged_action,entry_hash,hash_algorithm,created_at', { count: 'exact' }).gte('created_at', from).lt('created_at', to).order('created_at', { ascending: true }).limit(LIST_EXPORT_MAX_ROWS),
    admin.from('login_logs').select('id,user_id,email_attempted,success,failure_reason,mfa_used,ip_address,user_agent,event_type,request_id,correlation_id,entry_hash,hash_algorithm,created_at', { count: 'exact' }).gte('created_at', from).lt('created_at', to).order('created_at', { ascending: true }).limit(LIST_EXPORT_MAX_ROWS),
    admin.from('change_requests').select('id,change_number,title,system_affected,request_date,status,risk_level,test_passed,approve_result,approve_date,deploy_date,version', { count: 'exact' }).gte('request_date', from).lt('request_date', to).order('request_date', { ascending: true }).limit(LIST_EXPORT_MAX_ROWS),
    admin.from('access_certification_campaigns').select('id,campaign_code,name,due_date,status,signed_off_at,created_at', { count: 'exact' }).gte('created_at', from).lt('created_at', to).order('created_at', { ascending: true }).limit(LIST_EXPORT_MAX_ROWS),
    admin.from('access_certification_items').select('id,campaign_id,access_level,permission_actions,data_classification,privileged_access,status,decided_at,created_at', { count: 'exact' }).gte('created_at', from).lt('created_at', to).order('created_at', { ascending: true }).limit(LIST_EXPORT_MAX_ROWS),
    admin.from('backup_evidence_snapshots').select('id,snapshot_code,source_table,source_record_id,captured_at,checksum,generated,created_at,payload', { count: 'exact' }).gte('captured_at', from).lt('captured_at', to).order('captured_at', { ascending: true }).limit(LIST_EXPORT_MAX_ROWS),
  ]);
  const error = [audit, login, changes, campaigns, campaignItems, backupEvidence].find((result) => result.error)?.error;
  if (error) return dbFailJson(c, 'AUDIT_EVIDENCE_PACKAGE_FAILED', error);
  const oversized = [audit, login, changes, campaigns, campaignItems, backupEvidence].map((result) => checkExportSize(result.count)).find(Boolean);
  if (oversized) return c.json(fail(reqId, 'EXPORT_TOO_LARGE', 'Evidence package section exceeds the 5,000-row safety limit'), 400);
  const sections = {
    auditLog: audit.data ?? [],
    loginHistory: login.data ?? [],
    changeManagement: changes.data ?? [],
    accessReviewCampaigns: campaigns.data ?? [],
    accessReviewItems: campaignItems.data ?? [],
    backupEvidence: (backupEvidence.data ?? []).map((row) => ({ ...row, payload: sanitizeAuditData(row.payload) ?? {} })),
  };
  const manifest = await Promise.all(Object.entries(sections).map(async ([name, rows]) => ({ name, rowCount: rows.length, sha256: await sha256Hex(rows) })));
  const evidencePackage = {
    packageType: 'audit-evidence', version: 1, month, generatedAt: new Date().toISOString(),
    generatedBy: { id: c.get('userId'), email: c.get('userEmail') }, algorithm: 'SHA-256',
    scope: 'Audit Log + Login History + Change Management + Access Review + Backup Evidence', manifest, sections,
  };
  const content = JSON.stringify(evidencePackage, null, 2);
  const checksum = await sha256Hex(content);
  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'EXPORT_EVIDENCE_PACKAGE', module: 'audit',
    detail: { month, checksum, rowCounts: Object.fromEntries(manifest.map((item) => [item.name, item.rowCount])) }, requestId: reqId,
    eventCategory: 'export', privilegedAction: true,
  });
  return c.json(ok(reqId, { filename: `audit-evidence-${month}.json`, content, checksum, rowCounts: Object.fromEntries(manifest.map((item) => [item.name, item.rowCount])) }));
});

auditLogsRoute.post('/archive', requirePermission('audit_management.manage'), zValidator('json', auditArchiveSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const cutoff = c.req.valid('json').cutoff;
  const { data, error } = await createAdminClient(c.env).rpc('archive_audit_history', { cutoff_input: cutoff });
  if (error) return dbFailJson(c, 'AUDIT_ARCHIVE_FAILED', error);
  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'ARCHIVE_AUDIT_HISTORY', module: 'audit',
    detail: { cutoff, result: data }, requestId: reqId, eventCategory: 'administration', privilegedAction: true,
  });
  const result = Array.isArray(data) ? data[0] : data;
  return c.json(ok(reqId, result ?? { audit_archived: 0, login_archived: 0 }));
});

/** Read-only list. Writes are service-role-only through auditService/loginLogService. */
auditLogsRoute.get('/', requirePermission('audit.view'), zValidator('query', listAuditLogsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, module, action, actor, result, eventCategory, privileged, from, to } = c.req.valid('query');
  let query = supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (module) query = query.eq('module', module);
  if (action) query = query.eq('action', action);
  if (actor) query = query.ilike('actor_email', `%${actor}%`);
  if (result) query = query.eq('result', result);
  if (eventCategory) query = query.eq('event_category', eventCategory);
  if (privileged !== undefined) query = query.eq('privileged_action', privileged);
  if (from) query = query.gte('created_at', `${from}T00:00:00.000+07:00`);
  if (to) query = query.lte('created_at', endOfDay(to));
  const { data, count, error } = await query;
  if (error) return dbFailJson(c, 'AUDIT_LOGS_LIST_FAILED', error);
  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});
