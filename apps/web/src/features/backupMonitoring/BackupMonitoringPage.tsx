import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArchiveRestore, CalendarClock, CheckCircle2, CloudCog, DatabaseBackup,
  FileClock, Loader2, Plus, RotateCcw, Save, ScrollText, SearchCheck,
  Settings2,
  ShieldCheck, Siren, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  BACKUP_RESULTS, BACKUP_SCHEDULES, BACKUP_TYPES, BCP_STATUSES, LOG_FREQUENCIES, LOG_REVIEW_STATUSES, RECOVERY_RESULTS,
  type BackupLog, type BackupMonitoringOptions, type BackupMonitoringOverview, type BackupPolicy, type BcpPlan,
  type LoggingSystem, type LogReview, type RecoveryTest,
} from '../../types/backupMonitoring';
import { formatThaiDate } from '../../utils/date';
import { backupSuccessPercent, daysUntilOperationsDue, isOperationsOverdue, openAnomalyCount } from './backupMonitoringDisplay';

type Tab = 'backups' | 'policies' | 'recoveries' | 'bcp' | 'systems' | 'reviews';
type EditableRecord = BackupLog | BackupPolicy | RecoveryTest | BcpPlan | LoggingSystem | LogReview;

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const tabs: Array<{ key: Tab; label: string; icon: typeof DatabaseBackup }> = [
  { key: 'backups', label: 'Backup Log', icon: DatabaseBackup },
  { key: 'policies', label: 'Expected Policy ต่อ CI', icon: Settings2 },
  { key: 'recoveries', label: 'Recovery Test', icon: ArchiveRestore },
  { key: 'bcp', label: 'BCP / DR', icon: ShieldCheck },
  { key: 'systems', label: 'Logging Register', icon: ScrollText },
  { key: 'reviews', label: 'Log Review', icon: SearchCheck },
];

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function Field({ label, required, children, span = '' }: { label: string; required?: boolean; children: React.ReactNode; span?: string }) {
  return <label className={`text-xs font-semibold ${span}`}>{label}{required ? ' *' : ''}{children}</label>;
}

function Due({ date, threshold = 7 }: { date: string | null; threshold?: number }) {
  const days = daysUntilOperationsDue(date);
  if (!date) return <span className="text-slate-400">—</span>;
  return <div><p>{formatThaiDate(date)}</p>{days !== null && <p className={`text-xs font-semibold ${days < 0 ? 'text-red-600' : days <= threshold ? 'text-amber-600' : 'text-slate-400'}`}>{days < 0 ? `เกิน ${Math.abs(days)} วัน` : `เหลือ ${days} วัน`}</p>}</div>;
}

function scheduleMinutes(schedule: string): string {
  return ({ 'ทุก 15 นาที': '15', 'ทุกชั่วโมง': '60', 'ทุก 6 ชั่วโมง': '360', 'ทุกวัน': '1440', 'ทุกสัปดาห์': '10080', 'ทุกเดือน': '43200' } as Record<string, string>)[schedule] ?? '1440';
}

function bytesLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const bytes = Number(value);
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(1)} TB`;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${bytes.toLocaleString('th-TH')} B`;
}

function formInitial(tab: Tab, record: EditableRecord | undefined, userId: string | undefined): Record<string, string> {
  const today = new Date().toISOString().slice(0, 10);
  if (tab === 'backups') { const r = record as BackupLog | undefined; return { systemName: r?.system_name ?? '', configurationItemId: r?.configuration_item_id ?? '', backupType: r?.backup_type ?? 'Full', backupDate: r?.backup_date ?? today, result: r?.result ?? 'สำเร็จ', dataSize: r?.data_size ?? '', storageLocation: r?.storage_location ?? '', operatorId: r?.operator_id ?? userId ?? '', nextBackupDue: r?.next_backup_due ?? '', evidenceLink: r?.evidence_link ?? '', checksum: r?.checksum ?? '', rowCount: r?.row_count === null || r?.row_count === undefined ? '' : String(r.row_count), notes: r?.notes ?? '' }; }
  if (tab === 'policies') { const r = record as BackupPolicy | undefined; return { configurationItemId: r?.configuration_item_id ?? '', expectedBackupPolicy: r?.expected_backup_policy ?? '', rtoTargetHours: r?.rto_target_hours === null || r?.rto_target_hours === undefined ? '' : String(r.rto_target_hours), rpoTargetHours: r?.rpo_target_hours === null || r?.rpo_target_hours === undefined ? '' : String(r.rpo_target_hours), backupSchedule: r?.backup_schedule ?? 'ทุกวัน', scheduleIntervalMinutes: String(r?.schedule_interval_minutes ?? 1440), storageCapacityBytes: r?.storage_capacity_bytes === null || r?.storage_capacity_bytes === undefined ? '' : String(r.storage_capacity_bytes), storageUsedBytes: r?.storage_used_bytes === null || r?.storage_used_bytes === undefined ? '' : String(r.storage_used_bytes), storageAlertThresholdPercent: String(r?.storage_alert_threshold_percent ?? 80), restoreVerificationRequired: r?.restore_verification_required === false ? 'false' : 'true', alertsEnabled: r?.alerts_enabled === false ? 'false' : 'true', missedBackupAlert: r?.missed_backup_alert === false ? 'false' : 'true', failureAlert: r?.failure_alert === false ? 'false' : 'true', autoCreateIncident: r?.auto_create_incident === false ? 'false' : 'true', ownerId: r?.owner_id ?? userId ?? '', status: r?.status ?? 'active', notes: r?.notes ?? '' }; }
  if (tab === 'recoveries') { const r = record as RecoveryTest | undefined; return { backupLogId: r?.backup_log_id ?? '', systemName: r?.system_name ?? '', configurationItemId: r?.configuration_item_id ?? '', testDate: r?.test_date ?? today, scenario: r?.scenario ?? '', result: r?.result ?? 'ผ่าน', rtoActual: r?.rto_actual ?? '', rpoActual: r?.rpo_actual ?? '', testerId: r?.tester_id ?? userId ?? '', nextTestDue: r?.next_test_due ?? '', evidenceLink: r?.evidence_link ?? '', findings: r?.findings ?? '', restoreVerified: r?.restore_verified === true ? 'true' : 'false', restoreVerifiedAt: r?.restore_verified_at ?? '', restoreVerificationNotes: r?.restore_verification_notes ?? '', notes: r?.notes ?? '' }; }
  if (tab === 'bcp') { const r = record as BcpPlan | undefined; return { planName: r?.plan_name ?? '', scope: r?.scope ?? '', ownerId: r?.owner_id ?? userId ?? '', lastReviewDate: r?.last_review_date ?? today, nextReviewDue: r?.next_review_due ?? '', documentLink: r?.document_link ?? '', drExerciseSchedule: r?.dr_exercise_schedule ?? '', lastDrExerciseDate: r?.last_dr_exercise_date ?? '', nextDrExerciseDue: r?.next_dr_exercise_due ?? '', drExerciseResult: r?.dr_exercise_result ?? 'ยังไม่ได้ทดสอบ', status: r?.status ?? 'ใช้งาน', notes: r?.notes ?? '' }; }
  if (tab === 'systems') { const r = record as LoggingSystem | undefined; return { systemName: r?.system_name ?? '', configurationItemId: r?.configuration_item_id ?? '', logType: r?.log_type ?? '', logLocation: r?.log_location ?? '', reviewFrequency: r?.review_frequency ?? 'รายเดือน', responsibleId: r?.responsible_id ?? userId ?? '', retentionPeriod: r?.retention_period ?? '', status: r?.status ?? 'ใช้งาน', notes: r?.notes ?? '' }; }
  const r = record as LogReview | undefined; return { loggingSystemId: r?.logging_system_id ?? '', reviewDate: r?.review_date ?? today, reviewerId: r?.reviewer_id ?? userId ?? '', period: r?.period ?? '', anomalyFound: r?.anomaly_found ? 'true' : 'false', anomalyDetail: r?.anomaly_detail ?? '', actionTaken: r?.action_taken ?? '', status: r?.status ?? 'ปกติ', evidenceLink: r?.evidence_link ?? '', notes: r?.notes ?? '' };
}

function RegistryForm({ tab, record, options, overview, userId, onClose }: { tab: Tab; record?: EditableRecord; options: BackupMonitoringOptions; overview: BackupMonitoringOverview; userId?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => formInitial(tab, record, userId));
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const base = '/api/v1/backup-monitoring';
  const segment = { backups: 'backups', policies: 'policies', recoveries: 'recoveries', bcp: 'bcp-plans', systems: 'log-systems', reviews: 'log-reviews' }[tab];
  const mutation = useMutation({
    mutationFn: () => {
      for (const key of ['evidenceLink', 'documentLink']) if (form[key] && !form[key].startsWith('https://')) throw new Error('ลิงก์หลักฐานและเอกสารต้องเป็น HTTPS');
      if (tab === 'reviews' && form.anomalyFound === 'true' && !form.anomalyDetail.trim()) throw new Error('กรุณาระบุรายละเอียด Anomaly');
      const payload: Record<string, unknown> = { ...form, anomalyFound: form.anomalyFound === 'true', rowCount: form.rowCount === '' || form.rowCount === undefined ? undefined : Number(form.rowCount) };
      for (const key of ['rtoTargetHours', 'rpoTargetHours', 'scheduleIntervalMinutes', 'storageCapacityBytes', 'storageUsedBytes', 'storageAlertThresholdPercent']) payload[key] = form[key] === '' || form[key] === undefined ? undefined : Number(form[key]);
      for (const key of ['restoreVerified', 'alertsEnabled', 'missedBackupAlert', 'failureAlert', 'autoCreateIncident', 'restoreVerificationRequired']) if (form[key] !== undefined) payload[key] = form[key] === 'true';
      return apiFetch(`${base}/${segment}${record ? `/${record.id}` : ''}`, {
        method: record ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['backup-monitoring'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'บันทึกข้อมูลไม่สำเร็จ')),
  });
  const users = options.users.map((u) => <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>);
  const cis = options.configurationItems.map((ci) => <option key={ci.id} value={ci.id}>{ci.ci_code} — {ci.name}</option>);
  const title = { backups: 'บันทึกผลสำรองข้อมูล', policies: 'Expected Backup Policy ต่อ CI', recoveries: 'บันทึกผลทดสอบกู้คืน', bcp: 'แผนฉุกเฉิน BCP / DR', systems: 'ระบบ Logging / Monitoring', reviews: 'ผลการตรวจสอบ Log' }[tab];

  return <Card data-testid="operations-form" className="border-primary-200 dark:border-primary-900"><CardHeader className="flex items-center justify-between"><span>{record ? `แก้ไข ${title}` : `เพิ่ม${title}`}</span><button aria-label="ปิดแบบฟอร์ม" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
    {tab === 'backups' && <>
      <Field label="ระบบงาน" required span="sm:col-span-2"><input required value={form.systemName} onChange={(e) => set('systemName', e.target.value)} className={fieldClass} /></Field>
      <Field label="Configuration Item"><select value={form.configurationItemId} onChange={(e) => set('configurationItemId', e.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{cis}</select></Field>
      <Field label="Operator" required><select required value={form.operatorId} onChange={(e) => set('operatorId', e.target.value)} className={fieldClass}>{users}</select></Field>
      <Field label="ประเภท"><select value={form.backupType} onChange={(e) => set('backupType', e.target.value)} className={fieldClass}>{BACKUP_TYPES.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="วันที่สำรอง" required><input required type="date" value={form.backupDate} onChange={(e) => set('backupDate', e.target.value)} className={fieldClass} /></Field>
      <Field label="ผล"><select value={form.result} onChange={(e) => set('result', e.target.value)} className={fieldClass}>{BACKUP_RESULTS.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="ครั้งถัดไป"><input type="date" value={form.nextBackupDue} onChange={(e) => set('nextBackupDue', e.target.value)} className={fieldClass} /></Field>
      <Field label="ขนาดข้อมูล"><input value={form.dataSize} onChange={(e) => set('dataSize', e.target.value)} className={fieldClass} /></Field>
      <Field label="จำนวนแถว"><input type="number" min="0" value={form.rowCount} onChange={(e) => set('rowCount', e.target.value)} className={fieldClass} /></Field>
      <Field label="Storage Location" span="sm:col-span-2"><input value={form.storageLocation} onChange={(e) => set('storageLocation', e.target.value)} className={fieldClass} /></Field>
      <Field label="Checksum SHA-256" span="sm:col-span-2"><input value={form.checksum} onChange={(e) => set('checksum', e.target.value)} className={fieldClass} /></Field>
      <Field label="หลักฐาน HTTPS" span="sm:col-span-2"><input type="url" value={form.evidenceLink} onChange={(e) => set('evidenceLink', e.target.value)} className={fieldClass} /></Field>
    </>}
    {tab === 'policies' && <>
      <Field label="Configuration Item" required span="sm:col-span-2"><select required value={form.configurationItemId} onChange={(e) => set('configurationItemId', e.target.value)} className={fieldClass}><option value="">— เลือก CI —</option>{cis}</select></Field>
      <Field label="Expected Backup Policy" required span="sm:col-span-2"><textarea required rows={2} value={form.expectedBackupPolicy} onChange={(e) => set('expectedBackupPolicy', e.target.value)} placeholder="เช่น Full ทุกคืน + Incremental ทุก 1 ชั่วโมง" className={fieldClass} /></Field>
      <Field label="RTO Target (ชั่วโมง)"><input type="number" min="0" step="0.01" value={form.rtoTargetHours} onChange={(e) => set('rtoTargetHours', e.target.value)} className={fieldClass} /></Field>
      <Field label="RPO Target (ชั่วโมง)"><input type="number" min="0" step="0.01" value={form.rpoTargetHours} onChange={(e) => set('rpoTargetHours', e.target.value)} className={fieldClass} /></Field>
      <Field label="Backup Schedule" required><select value={form.backupSchedule} onChange={(e) => { set('backupSchedule', e.target.value); set('scheduleIntervalMinutes', scheduleMinutes(e.target.value)); }} className={fieldClass}>{BACKUP_SCHEDULES.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="ตรวจทุกกี่นาที"><input type="number" min="5" value={form.scheduleIntervalMinutes} onChange={(e) => set('scheduleIntervalMinutes', e.target.value)} className={fieldClass} /></Field>
      <Field label="Storage Capacity (bytes)"><input type="number" min="0" value={form.storageCapacityBytes} onChange={(e) => set('storageCapacityBytes', e.target.value)} className={fieldClass} /></Field>
      <Field label="Storage Used (bytes)"><input type="number" min="0" value={form.storageUsedBytes} onChange={(e) => set('storageUsedBytes', e.target.value)} className={fieldClass} /></Field>
      <Field label="แจ้งเตือนเมื่อใช้เกิน (%)"><input type="number" min="1" max="100" value={form.storageAlertThresholdPercent} onChange={(e) => set('storageAlertThresholdPercent', e.target.value)} className={fieldClass} /></Field>
      <Field label="Owner"><select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{users}</select></Field>
      <Field label="สถานะ"><select value={form.status} onChange={(e) => set('status', e.target.value)} className={fieldClass}><option value="active">ใช้งาน</option><option value="inactive">ระงับ</option></select></Field>
      <div className="grid gap-2 sm:col-span-2 lg:col-span-4 sm:grid-cols-2"><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.restoreVerificationRequired === 'true'} onChange={(e) => set('restoreVerificationRequired', String(e.target.checked))} />ต้องยืนยัน Restore</label><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.alertsEnabled === 'true'} onChange={(e) => set('alertsEnabled', String(e.target.checked))} />เปิด Alert อัตโนมัติ</label><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.autoCreateIncident === 'true'} onChange={(e) => set('autoCreateIncident', String(e.target.checked))} />สร้าง Incident เมื่อผิดปกติ</label></div>
    </>}
    {tab === 'recoveries' && <>
      <Field label="Backup อ้างอิง" span="sm:col-span-2"><select value={form.backupLogId} onChange={(e) => { set('backupLogId', e.target.value); const b = overview.backups.find((row) => row.id === e.target.value); if (b) { set('systemName', b.system_name); set('configurationItemId', b.configuration_item_id ?? ''); } }} className={fieldClass}><option value="">— ไม่ระบุ —</option>{overview.backups.map((b) => <option key={b.id} value={b.id}>{b.backup_code} — {b.system_name}</option>)}</select></Field>
      <Field label="ระบบงาน" required span="sm:col-span-2"><input required value={form.systemName} onChange={(e) => set('systemName', e.target.value)} className={fieldClass} /></Field>
      <Field label="วันที่ทดสอบ" required><input required type="date" value={form.testDate} onChange={(e) => set('testDate', e.target.value)} className={fieldClass} /></Field>
      <Field label="ผล"><select value={form.result} onChange={(e) => set('result', e.target.value)} className={fieldClass}>{RECOVERY_RESULTS.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="RTO จริง"><input value={form.rtoActual} onChange={(e) => set('rtoActual', e.target.value)} placeholder="เช่น 30 นาที" className={fieldClass} /></Field>
      <Field label="RPO จริง"><input value={form.rpoActual} onChange={(e) => set('rpoActual', e.target.value)} placeholder="เช่น 1 ชั่วโมง" className={fieldClass} /></Field>
      <Field label="Tester" required><select required value={form.testerId} onChange={(e) => set('testerId', e.target.value)} className={fieldClass}>{users}</select></Field>
      <Field label="ทดสอบครั้งถัดไป"><input type="date" value={form.nextTestDue} onChange={(e) => set('nextTestDue', e.target.value)} className={fieldClass} /></Field>
      <Field label="Scenario" span="sm:col-span-2"><textarea rows={2} value={form.scenario} onChange={(e) => set('scenario', e.target.value)} className={fieldClass} /></Field>
      <Field label="ข้อค้นพบ" span="sm:col-span-2"><textarea rows={2} value={form.findings} onChange={(e) => set('findings', e.target.value)} className={fieldClass} /></Field>
      <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.restoreVerified === 'true'} onChange={(e) => set('restoreVerified', String(e.target.checked))} />Restore Verification ผ่าน</label>
      <Field label="หลักฐานการยืนยัน Restore" span="sm:col-span-2"><input value={form.restoreVerificationNotes} onChange={(e) => set('restoreVerificationNotes', e.target.value)} className={fieldClass} placeholder="เช่น checksum / smoke test / ผู้ตรวจสอบ" /></Field>
      <Field label="หลักฐาน HTTPS" span="sm:col-span-2"><input type="url" value={form.evidenceLink} onChange={(e) => set('evidenceLink', e.target.value)} className={fieldClass} /></Field>
    </>}
    {tab === 'bcp' && <>
      <Field label="ชื่อแผน" required span="sm:col-span-2"><input required value={form.planName} onChange={(e) => set('planName', e.target.value)} className={fieldClass} /></Field>
      <Field label="Owner" required><select required value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={fieldClass}>{users}</select></Field>
      <Field label="สถานะ"><select value={form.status} onChange={(e) => set('status', e.target.value)} className={fieldClass}>{BCP_STATUSES.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="ขอบเขต" span="sm:col-span-2"><textarea rows={3} value={form.scope} onChange={(e) => set('scope', e.target.value)} className={fieldClass} /></Field>
      <Field label="ทบทวนล่าสุด"><input type="date" value={form.lastReviewDate} onChange={(e) => set('lastReviewDate', e.target.value)} className={fieldClass} /></Field>
      <Field label="ทบทวนครั้งถัดไป"><input type="date" value={form.nextReviewDue} onChange={(e) => set('nextReviewDue', e.target.value)} className={fieldClass} /></Field>
      <Field label="DR Exercise Schedule" span="sm:col-span-2"><input value={form.drExerciseSchedule} onChange={(e) => set('drExerciseSchedule', e.target.value)} placeholder="เช่น ทดสอบกู้คืนรายปี" className={fieldClass} /></Field>
      <Field label="DR Exercise ล่าสุด"><input type="date" value={form.lastDrExerciseDate} onChange={(e) => set('lastDrExerciseDate', e.target.value)} className={fieldClass} /></Field>
      <Field label="DR Exercise ครั้งถัดไป"><input type="date" value={form.nextDrExerciseDue} onChange={(e) => set('nextDrExerciseDue', e.target.value)} className={fieldClass} /></Field>
      <Field label="ผล DR Exercise"><select value={form.drExerciseResult} onChange={(e) => set('drExerciseResult', e.target.value)} className={fieldClass}><option>ยังไม่ได้ทดสอบ</option><option>ผ่าน</option><option>ผ่านบางส่วน</option><option>ไม่ผ่าน</option></select></Field>
      <Field label="ลิงก์เอกสาร HTTPS" span="sm:col-span-2"><input type="url" value={form.documentLink} onChange={(e) => set('documentLink', e.target.value)} className={fieldClass} /></Field>
    </>}
    {tab === 'systems' && <>
      <Field label="ระบบงาน" required span="sm:col-span-2"><input required value={form.systemName} onChange={(e) => set('systemName', e.target.value)} className={fieldClass} /></Field>
      <Field label="Configuration Item"><select value={form.configurationItemId} onChange={(e) => set('configurationItemId', e.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{cis}</select></Field>
      <Field label="Responsible" required><select required value={form.responsibleId} onChange={(e) => set('responsibleId', e.target.value)} className={fieldClass}>{users}</select></Field>
      <Field label="ประเภท Log"><input value={form.logType} onChange={(e) => set('logType', e.target.value)} className={fieldClass} /></Field>
      <Field label="ความถี่"><select value={form.reviewFrequency} onChange={(e) => set('reviewFrequency', e.target.value)} className={fieldClass}>{LOG_FREQUENCIES.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="ระยะเก็บรักษา"><input value={form.retentionPeriod} onChange={(e) => set('retentionPeriod', e.target.value)} className={fieldClass} /></Field>
      <Field label="สถานะ"><select value={form.status} onChange={(e) => set('status', e.target.value)} className={fieldClass}><option>ใช้งาน</option><option>ระงับ</option></select></Field>
      <Field label="ที่จัดเก็บ Log" span="sm:col-span-2"><input value={form.logLocation} onChange={(e) => set('logLocation', e.target.value)} className={fieldClass} /></Field>
    </>}
    {tab === 'reviews' && <>
      <Field label="ระบบ Log" required span="sm:col-span-2"><select required value={form.loggingSystemId} onChange={(e) => set('loggingSystemId', e.target.value)} className={fieldClass}><option value="">— เลือกระบบ —</option>{overview.loggingSystems.map((s) => <option key={s.id} value={s.id}>{s.log_system_code} — {s.system_name}</option>)}</select></Field>
      <Field label="วันที่ตรวจ" required><input required type="date" value={form.reviewDate} onChange={(e) => set('reviewDate', e.target.value)} className={fieldClass} /></Field>
      <Field label="รอบ/ช่วงที่ตรวจ" required><input required value={form.period} onChange={(e) => set('period', e.target.value)} className={fieldClass} /></Field>
      <Field label="พบ Anomaly"><select value={form.anomalyFound} onChange={(e) => { set('anomalyFound', e.target.value); if (e.target.value === 'false') set('status', 'ปกติ'); }} className={fieldClass}><option value="false">ไม่พบ</option><option value="true">พบ Anomaly</option></select></Field>
      <Field label="สถานะ"><select value={form.status} onChange={(e) => set('status', e.target.value)} className={fieldClass}>{LOG_REVIEW_STATUSES.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="รายละเอียด Anomaly" span="sm:col-span-2"><textarea rows={3} value={form.anomalyDetail} onChange={(e) => set('anomalyDetail', e.target.value)} className={fieldClass} /></Field>
      <Field label="การดำเนินการ" span="sm:col-span-2"><textarea rows={3} value={form.actionTaken} onChange={(e) => set('actionTaken', e.target.value)} className={fieldClass} /></Field>
      <Field label="หลักฐาน HTTPS" span="sm:col-span-2"><input type="url" value={form.evidenceLink} onChange={(e) => set('evidenceLink', e.target.value)} className={fieldClass} /></Field>
    </>}
    <Field label="หมายเหตุ" span="sm:col-span-2 lg:col-span-4"><textarea rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} className={fieldClass} /></Field>
    {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 lg:col-span-4">{error}</p>}
    <div className="flex gap-2 sm:col-span-2 lg:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="operations-form-submit"><Save className="h-4 w-4" />บันทึก</Button><Button size="sm" variant="ghost" onClick={onClose}>ยกเลิก</Button></div>
  </form></CardBody></Card>;
}

export function BackupMonitoringPage() {
  const { hasPermission, me } = useAuth();
  const canManageBackup = hasPermission('backup.manage');
  const canManageMonitoring = hasPermission('monitoring.manage');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('backups');
  const canManage = tab === 'systems' || tab === 'reviews' ? canManageMonitoring : canManageBackup;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EditableRecord | undefined>();
  const [invokeId, setInvokeId] = useState<string | null>(null);
  const [invokeReason, setInvokeReason] = useState('');
  const overviewQuery = useQuery({ queryKey: ['backup-monitoring'], queryFn: () => apiFetch<BackupMonitoringOverview>('/api/v1/backup-monitoring') });
  const optionsQuery = useQuery({ queryKey: ['backup-monitoring-options'], enabled: canManage && showForm, queryFn: () => apiFetch<BackupMonitoringOptions>('/api/v1/backup-monitoring/options') });
  const actionMutation = useMutation({ mutationFn: ({ path, body }: { path: string; body?: object }) => apiFetch(`/api/v1/backup-monitoring${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['backup-monitoring'] }); setInvokeId(null); setInvokeReason(''); } });
  const data = overviewQuery.data;
  const metrics = useMemo(() => data ? {
    success: backupSuccessPercent(data.backups), failed: data.backups.filter((r) => r.result !== 'สำเร็จ').length,
    recoveryDue: data.recoveries.filter((r) => isOperationsOverdue(r.next_test_due)).length,
    bcpDue: data.bcpPlans.filter((r) => r.status === 'ใช้งาน' && (daysUntilOperationsDue(r.next_review_due) ?? 999) <= 30).length,
    anomalies: openAnomalyCount(data.logReviews),
  } : { success: 0, failed: 0, recoveryDue: 0, bcpDue: 0, anomalies: 0 }, [data]);
  const openCreate = () => { setEditing(undefined); setShowForm(true); };
  const openEdit = (record: EditableRecord) => { setEditing(record); setShowForm(true); };
  const closeForm = () => { setEditing(undefined); setShowForm(false); };

  if (overviewQuery.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>;
  if (overviewQuery.isError || !data) return <Card><CardBody className="text-red-700">{errorText(overviewQuery.error, 'โหลดข้อมูล Backup / Monitoring ไม่สำเร็จ')}</CardBody></Card>;

  // ทุกแท็บของหน้านี้ใช้ตัวช่วยเดียวกัน ปุ่มจึงอยู่ตำแหน่งเดียวกับตารางอื่นทั้งระบบโดยอัตโนมัติ
  const deleteResourceByTab: Partial<Record<Tab, string>> = {
    backups: 'backup-logs', recoveries: 'recovery-tests', bcp: 'bcp-plans', systems: 'logging-systems', reviews: 'log-reviews',
  };
  const managePermission = tab === 'systems' || tab === 'reviews' ? 'monitoring.manage' : 'backup.manage';
  const editButton = (record: EditableRecord, label: string) => (
    <RowActions recordLabel={label} actions={[
      { kind: 'edit', permission: managePermission, onClick: () => openEdit(record) },
      ...(deleteResourceByTab[tab] ? [{ kind: 'archive' as const, permission: managePermission, archiveEndpoint: `/api/v1/record-deletions/${deleteResourceByTab[tab]}/${record.id}` }] : []),
    ]} />
  );
  const tableEmpty = (title: string) => <EmptyState icon={<CloudCog className="h-10 w-10" />} title={title} message="ยังไม่มีข้อมูลในทะเบียนนี้" />;

  return <div className="flex flex-col gap-4" data-testid="backup-monitoring-page">
    <div className="flex flex-wrap items-center justify-between gap-3"><PageTitle eyebrow="ทรัพย์สินและโครงสร้างพื้นฐาน / Backup & Monitoring" title="Backup / Recovery / Monitoring" description="ติดตามการสำรอง กู้คืน BCP/DR รอบตรวจ Log และ Anomaly จากศูนย์เดียว" />{canManage && <Button size="sm" data-testid="operations-create-toggle" onClick={openCreate}><Plus className="h-4 w-4" />เพิ่มรายการ</Button>}</div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5"><StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Backup สำเร็จ" value={data.backupDashboard.success_label} tone={data.backupDashboard.failure_count ? 'amber' : 'teal'} /><StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Backup มีปัญหา" value={data.backupDashboard.failure_count} tone={data.backupDashboard.failure_count ? 'danger' : 'gray'} /><StatCard icon={<FileClock className="h-5 w-5" />} label="Recovery เกินกำหนด" value={data.backupDashboard.recovery_due_items.length || metrics.recoveryDue} tone={data.backupDashboard.recovery_due_items.length ? 'danger' : 'gray'} /><StatCard icon={<CalendarClock className="h-5 w-5" />} label="BCP ถึงรอบ 30 วัน" value={metrics.bcpDue + data.backupDashboard.dr_due_items.length} tone={metrics.bcpDue || data.backupDashboard.dr_due_items.length ? 'amber' : 'gray'} /><StatCard icon={<Siren className="h-5 w-5" />} label="Alert ค้าง" value={data.backupDashboard.open_alert_count + metrics.anomalies} tone={data.backupDashboard.open_alert_count || metrics.anomalies ? 'danger' : 'teal'} /></div>
    <Card className="overflow-hidden border-primary-100 dark:border-primary-900/60" data-testid="backup-health-dashboard"><CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Backup Control Dashboard</span><span className="text-xs font-normal text-slate-400">ตรวจอัตโนมัติทุก 5 นาที · Evidence Snapshot อัตโนมัติ</span></CardHeader><CardBody><div className="grid gap-3 lg:grid-cols-3"><div className={`rounded-xl border px-4 py-3 ${data.backupDashboard.failure_count ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20'}`}><p className="text-xs font-semibold text-slate-500">สถานะรวมระบบ Backup</p><p className="mt-1 text-2xl font-extrabold">🟢 {data.backupDashboard.success_label} ระบบ Backup สำเร็จ</p><p className="mt-1 text-xs text-slate-500">{data.backupDashboard.total_systems} ระบบตาม Expected Policy ต่อ CI</p></div><div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/20"><p className="text-xs font-semibold text-red-700 dark:text-red-300">Failure Alert</p>{data.backupDashboard.failure_items.length ? data.backupDashboard.failure_items.slice(0, 3).map((item) => <p key={item.system_name} className="mt-1 text-sm font-semibold text-red-800 dark:text-red-200">🔴 {item.system_name} Backup {item.result} {item.count} ครั้ง</p>) : <p className="mt-1 text-sm text-slate-500">ไม่พบ Backup Fail ล่าสุด</p>}</div><div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/20"><p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Recovery / DR ที่ต้องติดตาม</p>{data.backupDashboard.recovery_due_items.length || data.backupDashboard.dr_due_items.length ? <>{data.backupDashboard.recovery_due_items.slice(0, 2).map((item) => <p key={item.system_name} className="mt-1 text-sm font-semibold text-amber-800 dark:text-amber-200">🟠 {item.system_name} {item.reason}</p>)}{data.backupDashboard.dr_due_items.slice(0, 2).map((item) => <p key={item.plan_name} className="mt-1 text-sm font-semibold text-amber-800 dark:text-amber-200">🟠 {item.plan_name} DR Exercise ยังไม่เสร็จ</p>)}</> : <p className="mt-1 text-sm text-slate-500">ไม่มีรายการค้าง</p>}</div></div></CardBody></Card>
    <div className="flex flex-wrap gap-2">{tabs.map((item) => <Button key={item.key} size="sm" variant={tab === item.key ? 'primary' : 'outline'} onClick={() => { setTab(item.key); closeForm(); }}><item.icon className="h-4 w-4" />{item.label}</Button>)}</div>
    {showForm && <FormModal title={editing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'} description={tabs.find((item) => item.key === tab)?.label} size="xl" onClose={closeForm}>{optionsQuery.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div> : optionsQuery.data ? <RegistryForm key={`${tab}-${editing?.id ?? 'new'}`} tab={tab} record={editing} options={optionsQuery.data} overview={data} userId={me?.profile.id} onClose={closeForm} /> : <div className="p-5 text-red-700">โหลดตัวเลือกแบบฟอร์มไม่สำเร็จ</div>}</FormModal>}
    <Card><CardHeader>{tabs.find((item) => item.key === tab)?.label}</CardHeader><CardBody className="overflow-x-auto">
      {tab === 'backups' && (data.backups.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">วันที่/รหัส</th><th className="p-2">ระบบ/CI</th><th className="p-2">ประเภท/ผล</th><th className="p-2">Operator</th><th className="p-2">ครั้งถัดไป</th><th className="p-2">Age / Snapshot</th><th /></tr></thead><tbody>{data.backups.map((r) => <tr key={r.id} data-testid={`backup-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2">{formatThaiDate(r.backup_date)}<p className="font-mono text-xs text-primary-700">{r.backup_code}</p></td><td className="p-2 font-semibold">{r.system_name}<p className="text-xs font-normal text-slate-400">{r.configuration_item?.ci_code}</p></td><td className="p-2">{r.backup_type}<p className="mt-1"><Badge variant={r.result === 'สำเร็จ' ? 'success' : r.result === 'ล้มเหลว' ? 'danger' : 'warning'}>{r.result}</Badge></p></td><td className="p-2 text-slate-500">{r.operator?.full_name}</td><td className="p-2"><Due date={r.next_backup_due} /></td><td className="p-2 text-xs text-slate-500">{r.backup_completed_at ? `เสร็จ ${formatThaiDate(r.backup_completed_at)}` : 'ยังไม่มีเวลาเสร็จ'}<p className="text-emerald-700">{data.evidenceSnapshots.some((snapshot) => snapshot.source_record_id === r.id) ? '✓ Evidence Snapshot' : '—'}</p></td><td className="p-2 text-right">{editButton(r, r.backup_code)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี Backup Log'))}
      {tab === 'policies' && (data.policies.length ? <DataTable className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">CI / Policy</th><th className="p-2">Expected Backup Policy</th><th className="p-2">RTO / RPO Target</th><th className="p-2">Schedule</th><th className="p-2">Last Successful / Age</th><th className="p-2">Storage</th><th className="p-2">Restore</th><th /></tr></thead><tbody>{data.policies.map((r) => <tr key={r.id} data-testid={`backup-policy-row-${r.id}`} className="border-t border-slate-100 align-top dark:border-slate-700"><td className="p-2 font-semibold">{r.configuration_item?.ci_code} · {r.system_name}<p className="font-mono text-xs font-normal text-primary-700">{r.policy_code}</p></td><td className="max-w-xs p-2 text-slate-600 dark:text-slate-300">{r.expected_backup_policy}</td><td className="p-2 text-slate-500">{r.rto_target_hours ?? '—'} / {r.rpo_target_hours ?? '—'} ชม.</td><td className="p-2">{r.backup_schedule}<p className="text-xs text-slate-400">ตรวจทุก {r.schedule_interval_minutes} นาที</p></td><td className="p-2">{r.last_successful_backup_at ? formatThaiDate(r.last_successful_backup_at) : 'ยังไม่เคยสำเร็จ'}<p className={`text-xs font-semibold ${r.backup_missed ? 'text-red-600' : 'text-slate-500'}`}>{r.backup_age_hours === null ? '—' : `Backup Age ${r.backup_age_hours} ชม.`}</p></td><td className="p-2">{r.storage_usage_percent === null ? '—' : `${r.storage_usage_percent}%`}<p className="text-xs text-slate-400">{bytesLabel(r.storage_used_bytes)} / {bytesLabel(r.storage_capacity_bytes)}</p></td><td className="p-2"><Badge variant={r.restore_verification_status === 'verified' ? 'success' : r.restore_verification_status === 'not_required' ? 'secondary' : 'warning'}>{r.restore_verification_status === 'verified' ? 'ยืนยันแล้ว' : r.restore_verification_status === 'not_required' ? 'ไม่บังคับ' : 'ต้องตรวจ'}</Badge></td><td className="p-2 text-right">{editButton(r, r.policy_code)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี Expected Backup Policy ต่อ CI'))}
      {tab === 'recoveries' && (data.recoveries.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">วันที่/รหัส</th><th className="p-2">ระบบ/Scenario</th><th className="p-2">ผล</th><th className="p-2">RTO / RPO</th><th className="p-2">Restore Verification</th><th className="p-2">ครั้งถัดไป</th><th /></tr></thead><tbody>{data.recoveries.map((r) => <tr key={r.id} data-testid={`recovery-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2">{formatThaiDate(r.test_date)}<p className="font-mono text-xs text-primary-700">{r.recovery_code}</p></td><td className="p-2 font-semibold">{r.system_name}<p className="max-w-96 text-xs font-normal text-slate-400">{r.scenario}</p></td><td className="p-2"><Badge variant={r.result === 'ผ่าน' ? 'success' : r.result === 'ไม่ผ่าน' ? 'danger' : 'warning'}>{r.result}</Badge></td><td className="p-2 text-slate-500">{r.rto_actual || '—'} / {r.rpo_actual || '—'}</td><td className="p-2"><Badge variant={r.restore_verified ? 'success' : 'warning'}>{r.restore_verified ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}</Badge></td><td className="p-2"><Due date={r.next_test_due} /></td><td className="p-2 text-right">{editButton(r, r.recovery_code)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี Recovery Test'))}
      {tab === 'bcp' && (data.bcpPlans.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">แผน</th><th className="p-2">Owner</th><th className="p-2">ทบทวนถัดไป</th><th className="p-2">DR Exercise</th><th className="p-2">ใช้จริงล่าสุด</th><th className="p-2">สถานะ</th><th /></tr></thead><tbody>{data.bcpPlans.map((r) => <tr key={r.id} data-testid={`bcp-row-${r.id}`} className="border-t border-slate-100 align-top dark:border-slate-700"><td className="p-2 font-semibold">{r.plan_name}<p className="font-mono text-xs font-normal text-primary-700">{r.plan_code}</p></td><td className="p-2 text-slate-500">{r.owner?.full_name}</td><td className="p-2"><Due date={r.next_review_due} threshold={30} /></td><td className="p-2"><Due date={r.next_dr_exercise_due ?? null} threshold={30} /><p className="text-xs text-slate-400">{r.dr_exercise_schedule || 'ยังไม่กำหนด'}</p></td><td className="p-2 text-slate-500">{r.last_invoked_date ? formatThaiDate(r.last_invoked_date) : '—'}<p className="max-w-64 text-xs">{r.invoke_reason}</p></td><td className="p-2"><Badge variant={r.status === 'ใช้งาน' ? 'success' : 'secondary'}>{r.status}</Badge></td><td className="p-2"><div className="flex justify-end gap-1">{canManage && <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ path: `/bcp-plans/${r.id}/review` })}><RotateCcw className="h-3.5 w-3.5" />ทบทวน</Button>}{canManage && <Button size="sm" variant="danger" onClick={() => setInvokeId(invokeId === r.id ? null : r.id)}>ใช้แผน</Button>}{editButton(r, r.plan_code)}</div>{invokeId === r.id && <div className="mt-2 flex min-w-96 gap-2"><input value={invokeReason} onChange={(e) => setInvokeReason(e.target.value)} placeholder="เหตุการณ์/เหตุผลที่ใช้แผน" className={fieldClass} /><Button size="sm" disabled={!invokeReason.trim()} onClick={() => actionMutation.mutate({ path: `/bcp-plans/${r.id}/invoke`, body: { reason: invokeReason } })}>บันทึก</Button></div>}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี BCP / DR Plan'))}
      {tab === 'systems' && (data.loggingSystems.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">ระบบ</th><th className="p-2">Log/Location</th><th className="p-2">ความถี่</th><th className="p-2">Responsible</th><th className="p-2">ตรวจครั้งถัดไป</th><th /></tr></thead><tbody>{data.loggingSystems.map((r) => <tr key={r.id} data-testid={`log-system-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2 font-semibold">{r.system_name}<p className="font-mono text-xs font-normal text-primary-700">{r.log_system_code}</p></td><td className="p-2 text-slate-500">{r.log_type || '—'}<p className="text-xs">{r.log_location}</p></td><td className="p-2">{r.review_frequency}</td><td className="p-2 text-slate-500">{r.responsible?.full_name}</td><td className="p-2"><Due date={r.next_review_due} /></td><td className="p-2 text-right">{editButton(r, r.log_system_code)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มีระบบ Logging'))}
      {tab === 'reviews' && (data.logReviews.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">วันที่/รหัส</th><th className="p-2">ระบบ/รอบ</th><th className="p-2">Anomaly</th><th className="p-2">รายละเอียด/การดำเนินการ</th><th className="p-2">สถานะ</th><th /></tr></thead><tbody>{data.logReviews.map((r) => <tr key={r.id} data-testid={`log-review-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2">{formatThaiDate(r.review_date)}<p className="font-mono text-xs text-primary-700">{r.review_code}</p></td><td className="p-2 font-semibold">{r.logging_system?.system_name}<p className="text-xs font-normal text-slate-400">{r.period}</p></td><td className="p-2"><Badge variant={r.anomaly_found ? 'danger' : 'success'}>{r.anomaly_found ? 'พบ' : 'ไม่พบ'}</Badge></td><td className="p-2 text-slate-500"><p>{r.anomaly_detail || '—'}</p><p className="text-xs">{r.action_taken}</p></td><td className="p-2"><Badge variant={r.status === 'แก้ไขแล้ว' || r.status === 'ปกติ' ? 'success' : 'warning'}>{r.status}</Badge></td><td className="p-2 text-right">{editButton(r, r.review_code)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี Log Review'))}
    </CardBody></Card>
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>ระบบจะแจ้งผู้ดูแลเมื่อ Backup ล้มเหลว/สำเร็จบางส่วนหรือพบ Anomaly และการบันทึก Log Review จะเลื่อนรอบตรวจครั้งถัดไปตามความถี่โดยอัตโนมัติ</span></div>
  </div>;
}
