import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { zodValidationHook } from '../utils/validation';
import {
  createBackupSchema, createBcpSchema, createLoggingSystemSchema, createLogReviewSchema,
  createRecoverySchema, invokeBcpSchema, updateBackupSchema, updateBcpSchema,
  updateLoggingSystemSchema, updateLogReviewSchema, updateRecoverySchema,
} from '../validators/backupMonitoring';

export const backupMonitoringRoute = new Hono<AppEnv>();
backupMonitoringRoute.use('*', requireAuth);

const BACKUP_SELECT = '*, operator:profiles!backup_logs_operator_id_fkey(id,full_name,email), configuration_item:configuration_items!backup_logs_configuration_item_id_fkey(id,ci_code,name,rpo_hours,rto_hours)';
const RECOVERY_SELECT = '*, tester:profiles!recovery_tests_tester_id_fkey(id,full_name,email), configuration_item:configuration_items!recovery_tests_configuration_item_id_fkey(id,ci_code,name,rpo_hours,rto_hours), backup:backup_logs!recovery_tests_backup_log_id_fkey(id,backup_code,system_name)';
const BCP_SELECT = '*, owner:profiles!bcp_plans_owner_id_fkey(id,full_name,email)';
const LOG_SYSTEM_SELECT = '*, responsible:profiles!logging_systems_responsible_id_fkey(id,full_name,email), configuration_item:configuration_items!logging_systems_configuration_item_id_fkey(id,ci_code,name,rpo_hours,rto_hours)';
const LOG_REVIEW_SELECT = '*, reviewer:profiles!log_reviews_reviewer_id_fkey(id,full_name,email), logging_system:logging_systems!log_reviews_logging_system_id_fkey(id,log_system_code,system_name,review_frequency)';

function generatedCode(prefix: string): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${date}-${randomCodeSuffix()}`;
}

function valueOrNull(value: string | undefined): string | null | undefined {
  return value === undefined ? undefined : value || null;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function frequencyDays(frequency: string): number {
  return ({ 'รายวัน': 1, 'รายสัปดาห์': 7, 'รายเดือน': 30, 'รายไตรมาส': 90 } as Record<string, number>)[frequency] ?? 30;
}

async function activeReferenceError(
  admin: ReturnType<typeof createAdminClient>,
  refs: { profileId?: string; configurationItemId?: string; backupLogId?: string; loggingSystemId?: string },
): Promise<string | null> {
  if (refs.profileId) {
    const { data } = await admin.from('profiles').select('id').eq('id', refs.profileId).eq('status', 'active').maybeSingle();
    if (!data) return 'ไม่พบผู้รับผิดชอบที่ใช้งานอยู่';
  }
  if (refs.configurationItemId) {
    const { data } = await admin.from('configuration_items').select('id').eq('id', refs.configurationItemId).maybeSingle();
    if (!data) return 'ไม่พบ Configuration Item ที่เลือก';
  }
  if (refs.backupLogId) {
    const { data } = await admin.from('backup_logs').select('id').eq('id', refs.backupLogId).maybeSingle();
    if (!data) return 'ไม่พบ Backup Log ที่อ้างอิง';
  }
  if (refs.loggingSystemId) {
    const { data } = await admin.from('logging_systems').select('id').eq('id', refs.loggingSystemId).maybeSingle();
    if (!data) return 'ไม่พบระบบ Logging ที่เลือก';
  }
  return null;
}

async function adminRecipientIds(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data } = await admin.from('user_roles').select('user_id, roles!inner(key), profiles!inner(status)').in('roles.key', ['super_admin', 'it_admin']).eq('profiles.status', 'active');
  return [...new Set((data ?? []).map((row) => row.user_id))];
}

backupMonitoringRoute.get('/', requireAnyPermission(['backup.view', 'monitoring.view']), async (c) => {
  const reqId = c.get('requestId');
  const client = c.get('supabase');
  const [backups, recoveries, bcpPlans, loggingSystems, logReviews] = await Promise.all([
    client.from('backup_logs').select(BACKUP_SELECT).order('backup_date', { ascending: false }).limit(500),
    client.from('recovery_tests').select(RECOVERY_SELECT).order('test_date', { ascending: false }).limit(500),
    client.from('bcp_plans').select(BCP_SELECT).order('created_at', { ascending: false }).limit(500),
    client.from('logging_systems').select(LOG_SYSTEM_SELECT).order('created_at', { ascending: false }).limit(500),
    client.from('log_reviews').select(LOG_REVIEW_SELECT).order('review_date', { ascending: false }).limit(500),
  ]);
  const error = backups.error ?? recoveries.error ?? bcpPlans.error ?? loggingSystems.error ?? logReviews.error;
  if (error) return dbFailJson(c, 'BACKUP_MONITORING_LOAD_FAILED', error);
  return c.json(ok(reqId, { backups: backups.data ?? [], recoveries: recoveries.data ?? [], bcpPlans: bcpPlans.data ?? [], loggingSystems: loggingSystems.data ?? [], logReviews: logReviews.data ?? [] }));
});

backupMonitoringRoute.get('/options', requireAnyPermission(['backup.manage', 'monitoring.manage']), async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [users, cis] = await Promise.all([
    admin.from('profiles').select('id,full_name,email').eq('status', 'active').order('full_name').limit(1000),
    admin.from('configuration_items').select('id,ci_code,name,rpo_hours,rto_hours').neq('status', 'Retired').order('ci_code').limit(2000),
  ]);
  if (users.error || cis.error) return c.json(fail(reqId, 'BACKUP_MONITORING_OPTIONS_FAILED', 'โหลดผู้รับผิดชอบและ CI ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { users: users.data ?? [], configurationItems: cis.data ?? [] }));
});

backupMonitoringRoute.post('/backups', requirePermission('backup.manage'), zValidator('json', createBackupSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const operatorId = body.operatorId || actorId;
  const invalid = await activeReferenceError(admin, { profileId: operatorId, configurationItemId: body.configurationItemId || undefined });
  if (invalid) return c.json(fail(reqId, 'BACKUP_REFERENCE_INVALID', invalid), 400);
  const { data, error } = await admin.from('backup_logs').insert({
    backup_code: generatedCode('BKP'), system_name: body.systemName, configuration_item_id: body.configurationItemId || null,
    backup_type: body.backupType, backup_date: body.backupDate, result: body.result, data_size: body.dataSize || null,
    storage_location: body.storageLocation || null, operator_id: operatorId, next_backup_due: body.nextBackupDue || null,
    evidence_link: body.evidenceLink || null, checksum: body.checksum || null, row_count: body.rowCount ?? null,
    notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select(BACKUP_SELECT).single();
  if (error) return dbFailJson(c, 'BACKUP_CREATE_FAILED', error);
  if (body.result !== 'สำเร็จ') {
    const recipients = await adminRecipientIds(admin);
    await Promise.all(recipients.map((recipientId) => sendNotification(c.env, { recipientId, type: 'backup_problem', title: `Backup มีปัญหา: ${body.systemName}`, body: `${data.backup_code} · ${body.result}`, link: '/backup-monitoring' })));
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'backup', targetTable: 'backup_logs', targetId: data.id, detail: { backupCode: data.backup_code, result: body.result }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

backupMonitoringRoute.patch('/backups/:id', requirePermission('backup.manage'), zValidator('json', updateBackupSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const id = c.req.param('id')!;
  const { data: current } = await admin.from('backup_logs').select('*').eq('id', id).maybeSingle();
  if (!current) return c.json(fail(reqId, 'BACKUP_NOT_FOUND', 'ไม่พบ Backup Log'), 404);
  const invalid = await activeReferenceError(admin, { profileId: body.operatorId || current.operator_id, configurationItemId: body.configurationItemId || undefined });
  if (invalid) return c.json(fail(reqId, 'BACKUP_REFERENCE_INVALID', invalid), 400);
  const map = { systemName: 'system_name', configurationItemId: 'configuration_item_id', backupType: 'backup_type', backupDate: 'backup_date', result: 'result', dataSize: 'data_size', storageLocation: 'storage_location', operatorId: 'operator_id', nextBackupDue: 'next_backup_due', evidenceLink: 'evidence_link', checksum: 'checksum', rowCount: 'row_count', notes: 'notes' } as const;
  const patch: Record<string, unknown> = { updated_by: actorId }; for (const [key, column] of Object.entries(map)) { const value = body[key as keyof typeof body]; if (value !== undefined) patch[column] = typeof value === 'string' ? valueOrNull(value) : value; }
  const auditBefore = await loadAuditSnapshot(admin, 'backup_logs', id);
  const { data, error } = await admin.from('backup_logs').update(patch).eq('id', id).select(BACKUP_SELECT).single();
  if (error) return dbFailJson(c, 'BACKUP_UPDATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'backup', targetTable: 'backup_logs', targetId: id, detail: body, requestId: reqId, before: auditBefore, after: data });
  return c.json(ok(reqId, data));
});

backupMonitoringRoute.post('/recoveries', requirePermission('backup.manage'), zValidator('json', createRecoverySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const testerId = body.testerId || actorId;
  const invalid = await activeReferenceError(admin, { profileId: testerId, configurationItemId: body.configurationItemId || undefined, backupLogId: body.backupLogId || undefined });
  if (invalid) return c.json(fail(reqId, 'RECOVERY_REFERENCE_INVALID', invalid), 400);
  const { data, error } = await admin.from('recovery_tests').insert({ recovery_code: generatedCode('RCV'), backup_log_id: body.backupLogId || null, system_name: body.systemName, configuration_item_id: body.configurationItemId || null, test_date: body.testDate, scenario: body.scenario || null, result: body.result, rto_actual: body.rtoActual || null, rpo_actual: body.rpoActual || null, tester_id: testerId, next_test_due: body.nextTestDue || null, evidence_link: body.evidenceLink || null, findings: body.findings || null, notes: body.notes || null, created_by: actorId, updated_by: actorId }).select(RECOVERY_SELECT).single();
  if (error) return dbFailJson(c, 'RECOVERY_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'backup', targetTable: 'recovery_tests', targetId: data.id, detail: { recoveryCode: data.recovery_code, result: body.result }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

backupMonitoringRoute.patch('/recoveries/:id', requirePermission('backup.manage'), zValidator('json', updateRecoverySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const id = c.req.param('id')!;
  const { data: current } = await admin.from('recovery_tests').select('*').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'RECOVERY_NOT_FOUND', 'ไม่พบ Recovery Test'), 404);
  const invalid = await activeReferenceError(admin, { profileId: body.testerId || current.tester_id, configurationItemId: body.configurationItemId || undefined, backupLogId: body.backupLogId || undefined }); if (invalid) return c.json(fail(reqId, 'RECOVERY_REFERENCE_INVALID', invalid), 400);
  const map = { backupLogId: 'backup_log_id', systemName: 'system_name', configurationItemId: 'configuration_item_id', testDate: 'test_date', scenario: 'scenario', result: 'result', rtoActual: 'rto_actual', rpoActual: 'rpo_actual', testerId: 'tester_id', nextTestDue: 'next_test_due', evidenceLink: 'evidence_link', findings: 'findings', notes: 'notes' } as const;
  const patch: Record<string, unknown> = { updated_by: actorId }; for (const [key, column] of Object.entries(map)) { const value = body[key as keyof typeof body]; if (value !== undefined) patch[column] = typeof value === 'string' ? valueOrNull(value) : value; }
  const auditBefore = await loadAuditSnapshot(admin, 'recovery_tests', id);
  const { data, error } = await admin.from('recovery_tests').update(patch).eq('id', id).select(RECOVERY_SELECT).single(); if (error) return dbFailJson(c, 'RECOVERY_UPDATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'backup', targetTable: 'recovery_tests', targetId: id, detail: body, requestId: reqId, before: auditBefore, after: data }); return c.json(ok(reqId, data));
});

backupMonitoringRoute.post('/bcp-plans', requirePermission('backup.manage'), zValidator('json', createBcpSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const ownerId = body.ownerId || actorId;
  const invalid = await activeReferenceError(admin, { profileId: ownerId }); if (invalid) return c.json(fail(reqId, 'BCP_REFERENCE_INVALID', invalid), 400);
  const { data, error } = await admin.from('bcp_plans').insert({ plan_code: generatedCode('BCP'), plan_name: body.planName, scope: body.scope || null, owner_id: ownerId, last_review_date: body.lastReviewDate || null, next_review_due: body.nextReviewDue || null, document_link: body.documentLink || null, status: body.status, notes: body.notes || null, created_by: actorId, updated_by: actorId }).select(BCP_SELECT).single();
  if (error) return dbFailJson(c, 'BCP_CREATE_FAILED', error); await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'backup', targetTable: 'bcp_plans', targetId: data.id, detail: { planCode: data.plan_code }, requestId: reqId }); return c.json(ok(reqId, data), 201);
});

backupMonitoringRoute.patch('/bcp-plans/:id', requirePermission('backup.manage'), zValidator('json', updateBcpSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const id = c.req.param('id')!; const { data: current } = await admin.from('bcp_plans').select('*').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'BCP_NOT_FOUND', 'ไม่พบแผน BCP/DR'), 404);
  const invalid = await activeReferenceError(admin, { profileId: body.ownerId || current.owner_id }); if (invalid) return c.json(fail(reqId, 'BCP_REFERENCE_INVALID', invalid), 400);
  const map = { planName: 'plan_name', scope: 'scope', ownerId: 'owner_id', lastReviewDate: 'last_review_date', nextReviewDue: 'next_review_due', documentLink: 'document_link', status: 'status', notes: 'notes' } as const; const patch: Record<string, unknown> = { updated_by: actorId }; for (const [key, column] of Object.entries(map)) { const value = body[key as keyof typeof body]; if (value !== undefined) patch[column] = typeof value === 'string' ? valueOrNull(value) : value; }
  const auditBefore = await loadAuditSnapshot(admin, 'bcp_plans', id);
  const { data, error } = await admin.from('bcp_plans').update(patch).eq('id', id).select(BCP_SELECT).single(); if (error) return dbFailJson(c, 'BCP_UPDATE_FAILED', error); await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'backup', targetTable: 'bcp_plans', targetId: id, detail: body, requestId: reqId, before: auditBefore, after: data }); return c.json(ok(reqId, data));
});

backupMonitoringRoute.post('/bcp-plans/:id/review', requirePermission('backup.manage'), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const admin = createAdminClient(c.env); const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin.from('bcp_plans').update({ last_review_date: today, next_review_due: addDays(today, 365), updated_by: actorId }).eq('id', id).select(BCP_SELECT).single(); if (error) return dbFailJson(c, 'BCP_REVIEW_FAILED', error); await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'REVIEW', module: 'backup', targetTable: 'bcp_plans', targetId: id, detail: { nextReviewDue: addDays(today, 365) }, requestId: reqId }); return c.json(ok(reqId, data));
});

backupMonitoringRoute.post('/bcp-plans/:id/invoke', requirePermission('backup.manage'), zValidator('json', invokeBcpSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const { reason } = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('bcp_plans').update({ last_invoked_date: new Date().toISOString(), invoke_reason: reason, updated_by: actorId }).eq('id', id).select(BCP_SELECT).single(); if (error) return dbFailJson(c, 'BCP_INVOKE_FAILED', error); await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'BCP_INVOKE', module: 'backup', targetTable: 'bcp_plans', targetId: id, detail: { reason }, requestId: reqId }); return c.json(ok(reqId, data));
});

backupMonitoringRoute.post('/log-systems', requirePermission('monitoring.manage'), zValidator('json', createLoggingSystemSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const responsibleId = body.responsibleId || actorId; const invalid = await activeReferenceError(admin, { profileId: responsibleId, configurationItemId: body.configurationItemId || undefined }); if (invalid) return c.json(fail(reqId, 'LOG_SYSTEM_REFERENCE_INVALID', invalid), 400); const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin.from('logging_systems').insert({ log_system_code: generatedCode('LOGSYS'), system_name: body.systemName, configuration_item_id: body.configurationItemId || null, log_type: body.logType || null, log_location: body.logLocation || null, review_frequency: body.reviewFrequency, responsible_id: responsibleId, next_review_due: addDays(today, frequencyDays(body.reviewFrequency)), retention_period: body.retentionPeriod || null, status: body.status, notes: body.notes || null, created_by: actorId, updated_by: actorId }).select(LOG_SYSTEM_SELECT).single(); if (error) return dbFailJson(c, 'LOG_SYSTEM_CREATE_FAILED', error); await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'monitoring', targetTable: 'logging_systems', targetId: data.id, detail: { logSystemCode: data.log_system_code }, requestId: reqId }); return c.json(ok(reqId, data), 201);
});

backupMonitoringRoute.patch('/log-systems/:id', requirePermission('monitoring.manage'), zValidator('json', updateLoggingSystemSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const id = c.req.param('id')!; const { data: current } = await admin.from('logging_systems').select('*').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'LOG_SYSTEM_NOT_FOUND', 'ไม่พบระบบ Logging'), 404); const invalid = await activeReferenceError(admin, { profileId: body.responsibleId || current.responsible_id, configurationItemId: body.configurationItemId || undefined }); if (invalid) return c.json(fail(reqId, 'LOG_SYSTEM_REFERENCE_INVALID', invalid), 400);
  const map = { systemName: 'system_name', configurationItemId: 'configuration_item_id', logType: 'log_type', logLocation: 'log_location', reviewFrequency: 'review_frequency', responsibleId: 'responsible_id', retentionPeriod: 'retention_period', status: 'status', notes: 'notes' } as const; const patch: Record<string, unknown> = { updated_by: actorId }; for (const [key, column] of Object.entries(map)) { const value = body[key as keyof typeof body]; if (value !== undefined) patch[column] = typeof value === 'string' ? valueOrNull(value) : value; } if (body.reviewFrequency && body.reviewFrequency !== current.review_frequency) patch.next_review_due = addDays(current.last_review_date || new Date().toISOString().slice(0, 10), frequencyDays(body.reviewFrequency));
  const auditBefore = await loadAuditSnapshot(admin, 'logging_systems', id);
  const { data, error } = await admin.from('logging_systems').update(patch).eq('id', id).select(LOG_SYSTEM_SELECT).single(); if (error) return dbFailJson(c, 'LOG_SYSTEM_UPDATE_FAILED', error); await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'monitoring', targetTable: 'logging_systems', targetId: id, detail: body, requestId: reqId, before: auditBefore, after: data }); return c.json(ok(reqId, data));
});

backupMonitoringRoute.post('/log-reviews', requirePermission('monitoring.manage'), zValidator('json', createLogReviewSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const reviewerId = body.reviewerId || actorId; const invalid = await activeReferenceError(admin, { profileId: reviewerId, loggingSystemId: body.loggingSystemId }); if (invalid) return c.json(fail(reqId, 'LOG_REVIEW_REFERENCE_INVALID', invalid), 400); const { data: system } = await admin.from('logging_systems').select('*').eq('id', body.loggingSystemId).single();
  const { data, error } = await admin.from('log_reviews').insert({ review_code: generatedCode('LGR'), logging_system_id: body.loggingSystemId, review_date: body.reviewDate, reviewer_id: reviewerId, period: body.period, anomaly_found: body.anomalyFound, anomaly_detail: body.anomalyDetail || null, action_taken: body.actionTaken || null, status: body.status, evidence_link: body.evidenceLink || null, notes: body.notes || null, created_by: actorId, updated_by: actorId }).select(LOG_REVIEW_SELECT).single(); if (error) return dbFailJson(c, 'LOG_REVIEW_CREATE_FAILED', error);
  const { error: scheduleError } = await admin.from('logging_systems').update({ last_review_date: body.reviewDate, next_review_due: addDays(body.reviewDate, frequencyDays(system!.review_frequency)), updated_by: actorId }).eq('id', body.loggingSystemId);
  if (scheduleError) {
    await admin.from('log_reviews').delete().eq('id', data.id);
    return dbFailJson(c, 'LOG_REVIEW_SCHEDULE_FAILED', scheduleError);
  }
  if (body.anomalyFound) { const recipients = await adminRecipientIds(admin); await Promise.all(recipients.map((recipientId) => sendNotification(c.env, { recipientId, type: 'log_anomaly', title: `พบ Anomaly: ${system!.system_name}`, body: body.anomalyDetail, link: '/backup-monitoring' }))); }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'monitoring', targetTable: 'log_reviews', targetId: data.id, detail: { reviewCode: data.review_code, anomalyFound: body.anomalyFound }, requestId: reqId }); return c.json(ok(reqId, data), 201);
});

backupMonitoringRoute.patch('/log-reviews/:id', requirePermission('monitoring.manage'), zValidator('json', updateLogReviewSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env); const id = c.req.param('id')!; const { data: current } = await admin.from('log_reviews').select('*').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'LOG_REVIEW_NOT_FOUND', 'ไม่พบ Log Review'), 404); const systemId = body.loggingSystemId || current.logging_system_id; const invalid = await activeReferenceError(admin, { profileId: body.reviewerId || current.reviewer_id, loggingSystemId: systemId }); if (invalid) return c.json(fail(reqId, 'LOG_REVIEW_REFERENCE_INVALID', invalid), 400);
  const map = { loggingSystemId: 'logging_system_id', reviewDate: 'review_date', reviewerId: 'reviewer_id', period: 'period', anomalyFound: 'anomaly_found', anomalyDetail: 'anomaly_detail', actionTaken: 'action_taken', status: 'status', evidenceLink: 'evidence_link', notes: 'notes' } as const; const patch: Record<string, unknown> = { updated_by: actorId }; for (const [key, column] of Object.entries(map)) { const value = body[key as keyof typeof body]; if (value !== undefined) patch[column] = typeof value === 'string' ? valueOrNull(value) : value; }
  const auditBefore = await loadAuditSnapshot(admin, 'log_reviews', id);
  const { data, error } = await admin.from('log_reviews').update(patch).eq('id', id).select(LOG_REVIEW_SELECT).single(); if (error) return dbFailJson(c, 'LOG_REVIEW_UPDATE_FAILED', error); if (body.reviewDate || body.loggingSystemId) { const reviewDate = body.reviewDate || current.review_date; const { data: system } = await admin.from('logging_systems').select('review_frequency').eq('id', systemId).single(); if (system) await admin.from('logging_systems').update({ last_review_date: reviewDate, next_review_due: addDays(reviewDate, frequencyDays(system.review_frequency)), updated_by: actorId }).eq('id', systemId); }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'monitoring', targetTable: 'log_reviews', targetId: id, detail: body, requestId: reqId, before: auditBefore, after: data }); return c.json(ok(reqId, data));
});
