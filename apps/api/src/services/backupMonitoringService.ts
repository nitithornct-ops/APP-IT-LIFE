import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase';
import { sendNotification } from './notificationService';
import { writeAuditLog } from './auditService';
import { dailyRecordCode } from '../utils/recordCode';
import type { Bindings } from '../types';

export interface BackupPolicyRow {
  id: string;
  configuration_item_id: string;
  expected_backup_policy: string;
  rto_target_hours: number | string | null;
  rpo_target_hours: number | string | null;
  backup_schedule: string;
  schedule_interval_minutes: number;
  storage_capacity_bytes: number | string | null;
  storage_used_bytes: number | string | null;
  storage_alert_threshold_percent: number | string;
  restore_verification_required: boolean;
  alerts_enabled: boolean;
  missed_backup_alert: boolean;
  failure_alert: boolean;
  auto_create_incident: boolean;
  owner_id: string | null;
  status: 'active' | 'inactive';
  configuration_item?: { id: string; ci_code: string; name: string } | null;
}

export interface BackupLogRow {
  id: string;
  backup_code?: string;
  system_name: string;
  configuration_item_id: string | null;
  result: string;
  backup_date: string;
  backup_completed_at?: string | null;
  backup_started_at?: string | null;
  storage_used_bytes?: number | string | null;
  storage_capacity_bytes?: number | string | null;
  source_run_id?: string | null;
}

export interface RecoveryRow {
  id: string;
  system_name: string;
  configuration_item_id: string | null;
  test_date: string;
  next_test_due?: string | null;
  result: string;
  restore_verified?: boolean;
}

export interface BcpPlanRow {
  id: string;
  plan_name: string;
  next_dr_exercise_due?: string | null;
  status: string;
}

export interface BackupPolicyStatus extends BackupPolicyRow {
  system_name: string;
  last_backup_result: string | null;
  last_successful_backup_at: string | null;
  backup_age_hours: number | null;
  backup_missed: boolean;
  storage_usage_percent: number | null;
  restore_verification_due: boolean;
  restore_verification_status: 'verified' | 'due' | 'not_required';
  latest_recovery_test_date: string | null;
}

export interface BackupMonitoringDashboard {
  total_systems: number;
  successful_systems: number;
  success_label: string;
  failure_count: number;
  failure_items: Array<{ system_name: string; count: number; latest_date: string; result: string }>;
  recovery_due_items: Array<{ system_name: string; reason: string; next_test_due: string | null }>;
  dr_due_items: Array<{ plan_name: string; next_dr_exercise_due: string }>;
  storage: { systems_over_threshold: number; total_capacity_bytes: number; total_used_bytes: number; usage_percent: number | null };
  open_alert_count: number;
  generated_at: string;
}

const SUCCESS_RESULT = 'สำเร็จ';

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampFor(row: { backup_completed_at?: string | null; backup_started_at?: string | null; backup_date?: string | null }): number | null {
  const raw = row.backup_completed_at ?? row.backup_started_at ?? (row.backup_date ? `${row.backup_date}T23:59:59Z` : null);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function samePolicyLog(policy: BackupPolicyRow, log: BackupLogRow): boolean {
  return log.configuration_item_id === policy.configuration_item_id;
}

function sortLatest<T extends { backup_date?: string; test_date?: string; backup_completed_at?: string | null; backup_started_at?: string | null }>(rows: T[], dateKey: 'backup_date' | 'test_date'): T[] {
  return [...rows].sort((left, right) => {
    if (dateKey === 'backup_date') {
      const rightFallback = Date.parse(String(right.backup_date ?? ''));
      const leftFallback = Date.parse(String(left.backup_date ?? ''));
      return (timestampFor(right) ?? (Number.isFinite(rightFallback) ? rightFallback : 0)) - (timestampFor(left) ?? (Number.isFinite(leftFallback) ? leftFallback : 0));
    }
    return String(right.test_date ?? '').localeCompare(String(left.test_date ?? ''));
  });
}

export function buildBackupPolicyStatus(
  policy: BackupPolicyRow,
  backupLogs: BackupLogRow[],
  recoveryTests: RecoveryRow[],
  now = new Date(),
): BackupPolicyStatus {
  const logs = sortLatest(backupLogs.filter((log) => samePolicyLog(policy, log)), 'backup_date');
  const latest = logs[0] ?? null;
  const successful = logs.filter((log) => log.result === SUCCESS_RESULT);
  const latestSuccessful = successful[0] ?? null;
  const latestSuccessfulTimestamp = latestSuccessful ? timestampFor(latestSuccessful) : null;
  const latestTimestamp = latest ? timestampFor(latest) : null;
  const intervalMs = Math.max(5, Number(policy.schedule_interval_minutes || 1440)) * 60_000;
  const backupMissed = policy.status === 'active' && (!latestSuccessfulTimestamp || now.getTime() - latestSuccessfulTimestamp > intervalMs);
  const ageHours = latestTimestamp === null ? null : Math.max(0, Math.floor((now.getTime() - latestTimestamp) / 3_600_000));
  const relevantRecoveries = sortLatest(recoveryTests.filter((test) => test.configuration_item_id === policy.configuration_item_id), 'test_date');
  const latestRecovery = relevantRecoveries[0] ?? null;
  const restoreVerified = Boolean(latestRecovery?.restore_verified);
  const restoreDue = policy.status === 'active' && policy.restore_verification_required && !restoreVerified;
  const systemName = policy.configuration_item?.name ?? policy.configuration_item?.ci_code ?? policy.configuration_item_id;
  const capacity = numeric(latest?.storage_capacity_bytes) ?? numeric(policy.storage_capacity_bytes);
  const used = numeric(latest?.storage_used_bytes) ?? numeric(policy.storage_used_bytes);
  const usage = capacity && capacity > 0 && used !== null ? Math.round((used / capacity) * 10000) / 100 : null;

  return {
    ...policy,
    storage_capacity_bytes: capacity,
    storage_used_bytes: used,
    system_name: systemName,
    last_backup_result: latest?.result ?? null,
    last_successful_backup_at: latestSuccessfulTimestamp === null ? null : new Date(latestSuccessfulTimestamp).toISOString(),
    backup_age_hours: ageHours,
    backup_missed: backupMissed,
    storage_usage_percent: usage,
    restore_verification_due: restoreDue,
    restore_verification_status: !policy.restore_verification_required ? 'not_required' : restoreVerified ? 'verified' : 'due',
    latest_recovery_test_date: latestRecovery?.test_date ?? null,
  };
}

export function buildBackupMonitoringDashboard(input: {
  policies: BackupPolicyRow[];
  backups: BackupLogRow[];
  recoveries: RecoveryRow[];
  bcpPlans: BcpPlanRow[];
  openAlertCount?: number;
}, now = new Date()): { policies: BackupPolicyStatus[]; dashboard: BackupMonitoringDashboard } {
  const policies = input.policies.map((policy) => buildBackupPolicyStatus(policy, input.backups, input.recoveries, now));
  const successfulSystems = policies.filter((policy) => policy.last_backup_result === SUCCESS_RESULT && !policy.backup_missed).length;
  const failures = input.backups
    .filter((backup) => backup.result !== SUCCESS_RESULT)
    .sort((left, right) => String(right.backup_date).localeCompare(String(left.backup_date)));
  const failureMap = new Map<string, { system_name: string; count: number; latest_date: string; result: string }>();
  for (const failure of failures) {
    const existing = failureMap.get(failure.system_name);
    if (existing) existing.count += 1;
    else failureMap.set(failure.system_name, { system_name: failure.system_name, count: 1, latest_date: failure.backup_date, result: failure.result });
  }
  const recoveryDueItems = policies.filter((policy) => policy.restore_verification_due).map((policy) => ({
    system_name: policy.system_name,
    reason: policy.latest_recovery_test_date ? 'ยังไม่ได้ยืนยัน Restore ล่าสุด' : 'ยังไม่มี Recovery Test',
    next_test_due: input.recoveries.find((test) => test.configuration_item_id === policy.configuration_item_id)?.next_test_due ?? null,
  }));
  const drDueItems = input.bcpPlans
    .filter((plan) => plan.status === 'ใช้งาน' && Boolean(plan.next_dr_exercise_due) && String(plan.next_dr_exercise_due) <= dateOnly(now))
    .map((plan) => ({ plan_name: plan.plan_name, next_dr_exercise_due: plan.next_dr_exercise_due! }));
  const capacityRows = policies.filter((policy) => (policy.storage_usage_percent ?? 0) >= Number(policy.storage_alert_threshold_percent));
  const totalCapacity = policies.reduce((sum, policy) => sum + (numeric(policy.storage_capacity_bytes) ?? 0), 0);
  const totalUsed = policies.reduce((sum, policy) => sum + (numeric(policy.storage_used_bytes) ?? 0), 0);
  const dashboard: BackupMonitoringDashboard = {
    total_systems: policies.length,
    successful_systems: successfulSystems,
    success_label: `${successfulSystems}/${policies.length}`,
    failure_count: failures.length,
    failure_items: [...failureMap.values()].slice(0, 10),
    recovery_due_items: recoveryDueItems.slice(0, 10),
    dr_due_items: drDueItems.slice(0, 10),
    storage: {
      systems_over_threshold: capacityRows.length,
      total_capacity_bytes: totalCapacity,
      total_used_bytes: totalUsed,
      usage_percent: totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 10000) / 100 : null,
    },
    open_alert_count: input.openAlertCount ?? 0,
    generated_at: now.toISOString(),
  };
  return { policies, dashboard };
}

interface AlertCandidate {
  alertKey: string;
  alertType: 'MISSED_BACKUP' | 'BACKUP_FAILURE' | 'STORAGE_CAPACITY' | 'RESTORE_VERIFICATION' | 'DR_EXERCISE';
  policyId?: string | null;
  configurationItemId?: string | null;
  backupLogId?: string | null;
  bcpPlanId?: string | null;
  severity: 'ปานกลาง' | 'สูง' | 'วิกฤต';
  title: string;
  message: string;
  autoCreateIncident: boolean;
  ownerId?: string | null;
  actorId?: string | null;
}

async function notificationRecipients(admin: SupabaseClient, ownerId?: string | null): Promise<string[]> {
  const recipients = ownerId ? [ownerId] : [];
  const { data } = await admin.from('user_roles').select('user_id, roles!inner(key), profiles!inner(status)').in('roles.key', ['super_admin', 'it_admin']).eq('profiles.status', 'active');
  return [...new Set([...recipients, ...(data ?? []).map((row) => row.user_id)])];
}

async function fallbackReporter(admin: SupabaseClient, preferred?: string | null): Promise<string | null> {
  if (preferred) {
    const { data } = await admin.from('profiles').select('id').eq('id', preferred).eq('status', 'active').maybeSingle();
    if (data) return data.id;
  }
  const { data } = await admin.from('profiles').select('id').eq('status', 'active').order('full_name').limit(1).maybeSingle();
  return data?.id ?? null;
}

async function autoCreateIncident(env: Bindings, alertId: string, candidate: AlertCandidate): Promise<string | null> {
  const admin = createAdminClient(env);
  const reporterId = await fallbackReporter(admin, candidate.ownerId);
  if (!reporterId) return null;
  const { data, error } = await admin.from('incidents').insert({
    incident_number: dailyRecordCode('INC'),
    title: candidate.title.slice(0, 200),
    reported_by: reporterId,
    category: 'ระบบล่ม/ใช้งานไม่ได้',
    severity: candidate.severity,
    description: candidate.message.slice(0, 3000),
    affected_system: candidate.title.replace(/^Backup Alert: /, '').slice(0, 150),
    affected_ci_id: candidate.configurationItemId ?? null,
    detection_source: 'Backup Monitoring',
    contains_personal_data: false,
    source_backup_alert_id: alertId,
    created_by: candidate.actorId ?? null,
    updated_by: candidate.actorId ?? null,
  }).select('id,incident_number').maybeSingle();
  if (error) {
    const { data: existing } = await admin.from('incidents').select('id').eq('source_backup_alert_id', alertId).maybeSingle();
    return existing?.id ?? null;
  }
  await writeAuditLog(env, {
    actorId: candidate.actorId ?? null,
    actorEmail: candidate.actorId ? null : 'backup-monitoring-worker',
    action: 'AUTO_CREATE',
    module: 'backup',
    targetTable: 'incidents',
    targetId: data?.id,
    detail: { alertId, alertType: candidate.alertType, incidentNumber: data?.incident_number },
  });
  return data?.id ?? null;
}

async function upsertAlert(env: Bindings, candidate: AlertCandidate, now: Date): Promise<{ created: boolean; incidentId: string | null }> {
  const admin = createAdminClient(env);
  const { data: existing } = await admin.from('backup_alerts').select('id,status,incident_id').eq('alert_key', candidate.alertKey).maybeSingle();
  const payload = {
    alert_key: candidate.alertKey,
    alert_type: candidate.alertType,
    policy_id: candidate.policyId ?? null,
    configuration_item_id: candidate.configurationItemId ?? null,
    backup_log_id: candidate.backupLogId ?? null,
    bcp_plan_id: candidate.bcpPlanId ?? null,
    status: 'OPEN',
    severity: candidate.severity,
    title: candidate.title.slice(0, 200),
    message: candidate.message.slice(0, 2000),
    observed_at: now.toISOString(),
    resolved_at: null,
  };
  const result = existing
    ? await admin.from('backup_alerts').update(payload).eq('id', existing.id).select('id,incident_id').single()
    : await admin.from('backup_alerts').insert(payload).select('id,incident_id').single();
  if (result.error || !result.data) throw new Error(`backup alert write failed: ${result.error?.message ?? 'no row returned'}`);
  const incidentId = result.data.incident_id ?? (candidate.autoCreateIncident ? await autoCreateIncident(env, result.data.id, candidate) : null);
  if (incidentId && !result.data.incident_id) await admin.from('backup_alerts').update({ incident_id: incidentId }).eq('id', result.data.id);
  if (!existing || existing.status !== 'OPEN') {
    const recipients = await notificationRecipients(admin, candidate.ownerId);
    await Promise.all(recipients.map((recipientId) => sendNotification(env, {
      recipientId,
      type: `backup_${candidate.alertType.toLowerCase()}`,
      title: candidate.title,
      body: candidate.message,
      link: '/backup-monitoring',
    })));
  }
  return { created: !existing, incidentId };
}

async function resolveAlerts(admin: SupabaseClient, filter: { policyId?: string; configurationItemId?: string; bcpPlanId?: string; alertType: AlertCandidate['alertType'] }, now: Date): Promise<number> {
  let query = admin.from('backup_alerts').update({ status: 'RESOLVED', resolved_at: now.toISOString() }).eq('alert_type', filter.alertType).eq('status', 'OPEN');
  if (filter.policyId) query = query.eq('policy_id', filter.policyId);
  if (filter.configurationItemId) query = query.eq('configuration_item_id', filter.configurationItemId);
  if (filter.bcpPlanId) query = query.eq('bcp_plan_id', filter.bcpPlanId);
  const { data, error } = await query.select('id');
  if (error) throw new Error(`backup alert resolve failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function evaluateBackupLog(env: Bindings, log: BackupLogRow, actorId: string | null = null, now = new Date()): Promise<void> {
  const admin = createAdminClient(env);
  const { data: policy } = log.configuration_item_id
    ? await admin.from('backup_policies').select('*').eq('configuration_item_id', log.configuration_item_id).maybeSingle()
    : { data: null };
  if (log.result === SUCCESS_RESULT) {
    if (log.configuration_item_id) await resolveAlerts(admin, { configurationItemId: log.configuration_item_id, alertType: 'BACKUP_FAILURE' }, now);
    return;
  }
  if (policy && (!policy.alerts_enabled || !policy.failure_alert)) return;
  await upsertAlert(env, {
    alertKey: `failure:${log.id}`,
    alertType: 'BACKUP_FAILURE',
    policyId: policy?.id ?? null,
    configurationItemId: log.configuration_item_id,
    backupLogId: log.id,
    severity: 'สูง',
    title: `Backup Alert: ${log.system_name}`,
    message: `${log.backup_code ?? log.id} · ผลการสำรองข้อมูล: ${log.result}`,
    autoCreateIncident: policy?.auto_create_incident ?? true,
    ownerId: policy?.owner_id ?? null,
    actorId,
  }, now);
}

export async function dispatchBackupMonitoring(env: Bindings, scheduledAt = new Date()): Promise<{ alertsCreated: number; incidentsCreated: number; resolved: number }> {
  const admin = createAdminClient(env);
  const [policiesResult, backupsResult, recoveriesResult, bcpResult] = await Promise.all([
    admin.from('backup_policies').select('*, configuration_item:configuration_items(id,ci_code,name)').eq('status', 'active').limit(2000),
    admin.from('backup_logs').select('id,backup_code,system_name,configuration_item_id,result,backup_date,backup_completed_at,backup_started_at,storage_used_bytes,storage_capacity_bytes').is('archived_at', null).order('backup_date', { ascending: false }).limit(10000),
    admin.from('recovery_tests').select('id,system_name,configuration_item_id,test_date,next_test_due,result,restore_verified').is('archived_at', null).order('test_date', { ascending: false }).limit(10000),
    admin.from('bcp_plans').select('id,plan_name,next_dr_exercise_due,status').is('archived_at', null).limit(2000),
  ]);
  const error = policiesResult.error ?? backupsResult.error ?? recoveriesResult.error ?? bcpResult.error;
  if (error) throw new Error(`backup monitoring load failed: ${error.message}`);
  const policies = (policiesResult.data ?? []) as unknown as BackupPolicyRow[];
  const backups = (backupsResult.data ?? []) as unknown as BackupLogRow[];
  const recoveries = (recoveriesResult.data ?? []) as unknown as RecoveryRow[];
  const bcpPlans = (bcpResult.data ?? []) as unknown as BcpPlanRow[];
  const statuses = policies.map((policy) => buildBackupPolicyStatus(policy, backups, recoveries, scheduledAt));
  let alertsCreated = 0;
  let incidentsCreated = 0;
  let resolved = 0;
  for (const status of statuses) {
    const latest = sortLatest(backups.filter((log) => log.configuration_item_id === status.configuration_item_id), 'backup_date')[0] ?? null;
    if (latest?.result && latest.result !== SUCCESS_RESULT && status.failure_alert) {
      const result = await upsertAlert(env, {
        alertKey: `failure:${latest.id}`,
        alertType: 'BACKUP_FAILURE',
        policyId: status.id,
        configurationItemId: status.configuration_item_id,
        backupLogId: latest.id,
        severity: 'สูง',
        title: `Backup Alert: ${status.system_name}`,
        message: `${latest.backup_code ?? latest.id} · ผลการสำรองข้อมูล: ${latest.result}`,
        autoCreateIncident: status.auto_create_incident,
        ownerId: status.owner_id,
      }, scheduledAt);
      if (result.created) alertsCreated += 1;
      if (result.incidentId) incidentsCreated += 1;
    } else if (!latest || latest.result === SUCCESS_RESULT) {
      resolved += await resolveAlerts(admin, { policyId: status.id, alertType: 'BACKUP_FAILURE' }, scheduledAt);
    }
    const fixedCandidates: Array<{ enabled: boolean; candidate: AlertCandidate; active: boolean }> = [
      { enabled: status.missed_backup_alert, active: status.backup_missed, candidate: { alertKey: `missed:${status.id}`, alertType: 'MISSED_BACKUP', policyId: status.id, configurationItemId: status.configuration_item_id, severity: 'สูง', title: `Missed Backup: ${status.system_name}`, message: `ไม่พบ Backup สำเร็จตาม Schedule ${status.backup_schedule} · Backup Age ${status.backup_age_hours ?? '—'} ชั่วโมง`, autoCreateIncident: status.auto_create_incident, ownerId: status.owner_id } },
      { enabled: status.storage_usage_percent !== null, active: (status.storage_usage_percent ?? 0) >= Number(status.storage_alert_threshold_percent), candidate: { alertKey: `storage:${status.id}`, alertType: 'STORAGE_CAPACITY', policyId: status.id, configurationItemId: status.configuration_item_id, severity: 'ปานกลาง', title: `Storage Capacity Alert: ${status.system_name}`, message: `พื้นที่ Backup ใช้งาน ${status.storage_usage_percent ?? 0}% (เกณฑ์ ${status.storage_alert_threshold_percent}%)`, autoCreateIncident: false, ownerId: status.owner_id } },
      { enabled: status.restore_verification_required, active: status.restore_verification_due, candidate: { alertKey: `restore:${status.id}`, alertType: 'RESTORE_VERIFICATION', policyId: status.id, configurationItemId: status.configuration_item_id, severity: 'ปานกลาง', title: `Restore Verification Due: ${status.system_name}`, message: status.latest_recovery_test_date ? 'มี Recovery Test แต่ยังไม่ได้ยืนยัน Restore ล่าสุด' : 'ยังไม่มี Recovery Test สำหรับระบบนี้', autoCreateIncident: status.auto_create_incident, ownerId: status.owner_id } },
    ];
    for (const item of fixedCandidates) {
      if (!item.enabled) continue;
      if (item.active) {
        const result = await upsertAlert(env, item.candidate, scheduledAt);
        if (result.created) alertsCreated += 1;
        if (result.incidentId) incidentsCreated += 1;
      } else resolved += await resolveAlerts(admin, { policyId: status.id, alertType: item.candidate.alertType }, scheduledAt);
    }
  }
  for (const plan of bcpPlans) {
    const active = plan.status === 'ใช้งาน' && Boolean(plan.next_dr_exercise_due) && plan.next_dr_exercise_due! <= dateOnly(scheduledAt);
    const candidate: AlertCandidate = { alertKey: `dr:${plan.id}`, alertType: 'DR_EXERCISE', bcpPlanId: plan.id, severity: 'สูง', title: `DR Exercise Due: ${plan.plan_name}`, message: `แผน ${plan.plan_name} ยังไม่ได้ทำ DR Exercise ตามกำหนด ${plan.next_dr_exercise_due}`, autoCreateIncident: false };
    if (active) {
      const result = await upsertAlert(env, candidate, scheduledAt);
      if (result.created) alertsCreated += 1;
    } else resolved += await resolveAlerts(admin, { bcpPlanId: plan.id, alertType: 'DR_EXERCISE' }, scheduledAt);
  }
  return { alertsCreated, incidentsCreated, resolved };
}
