import { DataTable } from '../../components/table/DataTable';
import { FormModal } from '../../components/ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArchiveRestore, CalendarClock, CheckCircle2, CloudCog, DatabaseBackup,
  ExternalLink, FileClock, Loader2, Pencil, Plus, RotateCcw, Save, ScrollText, SearchCheck,
  ShieldCheck, Siren, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  BACKUP_RESULTS, BACKUP_TYPES, BCP_STATUSES, LOG_FREQUENCIES, LOG_REVIEW_STATUSES, RECOVERY_RESULTS,
  type BackupLog, type BackupMonitoringOptions, type BackupMonitoringOverview, type BcpPlan,
  type LoggingSystem, type LogReview, type RecoveryTest,
} from '../../types/backupMonitoring';
import { formatThaiDate } from '../../utils/date';
import { backupSuccessPercent, daysUntilOperationsDue, isOperationsOverdue, openAnomalyCount } from './backupMonitoringDisplay';

type Tab = 'backups' | 'recoveries' | 'bcp' | 'systems' | 'reviews';
type EditableRecord = BackupLog | RecoveryTest | BcpPlan | LoggingSystem | LogReview;

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const tabs: Array<{ key: Tab; label: string; icon: typeof DatabaseBackup }> = [
  { key: 'backups', label: 'Backup Log', icon: DatabaseBackup },
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

function formInitial(tab: Tab, record: EditableRecord | undefined, userId: string | undefined): Record<string, string> {
  const today = new Date().toISOString().slice(0, 10);
  if (tab === 'backups') { const r = record as BackupLog | undefined; return { systemName: r?.system_name ?? '', configurationItemId: r?.configuration_item_id ?? '', backupType: r?.backup_type ?? 'Full', backupDate: r?.backup_date ?? today, result: r?.result ?? 'สำเร็จ', dataSize: r?.data_size ?? '', storageLocation: r?.storage_location ?? '', operatorId: r?.operator_id ?? userId ?? '', nextBackupDue: r?.next_backup_due ?? '', evidenceLink: r?.evidence_link ?? '', checksum: r?.checksum ?? '', rowCount: r?.row_count === null || r?.row_count === undefined ? '' : String(r.row_count), notes: r?.notes ?? '' }; }
  if (tab === 'recoveries') { const r = record as RecoveryTest | undefined; return { backupLogId: r?.backup_log_id ?? '', systemName: r?.system_name ?? '', configurationItemId: r?.configuration_item_id ?? '', testDate: r?.test_date ?? today, scenario: r?.scenario ?? '', result: r?.result ?? 'ผ่าน', rtoActual: r?.rto_actual ?? '', rpoActual: r?.rpo_actual ?? '', testerId: r?.tester_id ?? userId ?? '', nextTestDue: r?.next_test_due ?? '', evidenceLink: r?.evidence_link ?? '', findings: r?.findings ?? '', notes: r?.notes ?? '' }; }
  if (tab === 'bcp') { const r = record as BcpPlan | undefined; return { planName: r?.plan_name ?? '', scope: r?.scope ?? '', ownerId: r?.owner_id ?? userId ?? '', lastReviewDate: r?.last_review_date ?? today, nextReviewDue: r?.next_review_due ?? '', documentLink: r?.document_link ?? '', status: r?.status ?? 'ใช้งาน', notes: r?.notes ?? '' }; }
  if (tab === 'systems') { const r = record as LoggingSystem | undefined; return { systemName: r?.system_name ?? '', configurationItemId: r?.configuration_item_id ?? '', logType: r?.log_type ?? '', logLocation: r?.log_location ?? '', reviewFrequency: r?.review_frequency ?? 'รายเดือน', responsibleId: r?.responsible_id ?? userId ?? '', retentionPeriod: r?.retention_period ?? '', status: r?.status ?? 'ใช้งาน', notes: r?.notes ?? '' }; }
  const r = record as LogReview | undefined; return { loggingSystemId: r?.logging_system_id ?? '', reviewDate: r?.review_date ?? today, reviewerId: r?.reviewer_id ?? userId ?? '', period: r?.period ?? '', anomalyFound: r?.anomaly_found ? 'true' : 'false', anomalyDetail: r?.anomaly_detail ?? '', actionTaken: r?.action_taken ?? '', status: r?.status ?? 'ปกติ', evidenceLink: r?.evidence_link ?? '', notes: r?.notes ?? '' };
}

function RegistryForm({ tab, record, options, overview, userId, onClose }: { tab: Tab; record?: EditableRecord; options: BackupMonitoringOptions; overview: BackupMonitoringOverview; userId?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => formInitial(tab, record, userId));
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const base = '/api/v1/backup-monitoring';
  const segment = { backups: 'backups', recoveries: 'recoveries', bcp: 'bcp-plans', systems: 'log-systems', reviews: 'log-reviews' }[tab];
  const mutation = useMutation({
    mutationFn: () => {
      for (const key of ['evidenceLink', 'documentLink']) if (form[key] && !form[key].startsWith('https://')) throw new Error('ลิงก์หลักฐานและเอกสารต้องเป็น HTTPS');
      if (tab === 'reviews' && form.anomalyFound === 'true' && !form.anomalyDetail.trim()) throw new Error('กรุณาระบุรายละเอียด Anomaly');
      return apiFetch(`${base}/${segment}${record ? `/${record.id}` : ''}`, {
        method: record ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...form, anomalyFound: form.anomalyFound === 'true', rowCount: form.rowCount === '' || form.rowCount === undefined ? undefined : Number(form.rowCount) }),
      });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['backup-monitoring'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'บันทึกข้อมูลไม่สำเร็จ')),
  });
  const users = options.users.map((u) => <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>);
  const cis = options.configurationItems.map((ci) => <option key={ci.id} value={ci.id}>{ci.ci_code} — {ci.name}</option>);
  const title = { backups: 'บันทึกผลสำรองข้อมูล', recoveries: 'บันทึกผลทดสอบกู้คืน', bcp: 'แผนฉุกเฉิน BCP / DR', systems: 'ระบบ Logging / Monitoring', reviews: 'ผลการตรวจสอบ Log' }[tab];

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
      <Field label="หลักฐาน HTTPS" span="sm:col-span-2"><input type="url" value={form.evidenceLink} onChange={(e) => set('evidenceLink', e.target.value)} className={fieldClass} /></Field>
    </>}
    {tab === 'bcp' && <>
      <Field label="ชื่อแผน" required span="sm:col-span-2"><input required value={form.planName} onChange={(e) => set('planName', e.target.value)} className={fieldClass} /></Field>
      <Field label="Owner" required><select required value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={fieldClass}>{users}</select></Field>
      <Field label="สถานะ"><select value={form.status} onChange={(e) => set('status', e.target.value)} className={fieldClass}>{BCP_STATUSES.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="ขอบเขต" span="sm:col-span-2"><textarea rows={3} value={form.scope} onChange={(e) => set('scope', e.target.value)} className={fieldClass} /></Field>
      <Field label="ทบทวนล่าสุด"><input type="date" value={form.lastReviewDate} onChange={(e) => set('lastReviewDate', e.target.value)} className={fieldClass} /></Field>
      <Field label="ทบทวนครั้งถัดไป"><input type="date" value={form.nextReviewDue} onChange={(e) => set('nextReviewDue', e.target.value)} className={fieldClass} /></Field>
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

  const editButton = (record: EditableRecord) => canManage ? <Button size="sm" variant="ghost" onClick={() => openEdit(record)}><Pencil className="h-3.5 w-3.5" />แก้ไข</Button> : null;
  const tableEmpty = (title: string) => <EmptyState icon={<CloudCog className="h-10 w-10" />} title={title} message="ยังไม่มีข้อมูลในทะเบียนนี้" />;

  return <div className="flex flex-col gap-4" data-testid="backup-monitoring-page">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Backup / Recovery / Monitoring</h1><p className="text-sm text-slate-500">ติดตามการสำรอง กู้คืน BCP/DR รอบตรวจ Log และ Anomaly จากศูนย์เดียว</p></div>{canManage && <Button size="sm" data-testid="operations-create-toggle" onClick={openCreate}><Plus className="h-4 w-4" />เพิ่มรายการ</Button>}</div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5"><StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Backup สำเร็จ" value={`${metrics.success}%`} tone={metrics.failed ? 'amber' : 'teal'} /><StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Backup มีปัญหา" value={metrics.failed} tone={metrics.failed ? 'danger' : 'gray'} /><StatCard icon={<FileClock className="h-5 w-5" />} label="Recovery เกินกำหนด" value={metrics.recoveryDue} tone={metrics.recoveryDue ? 'danger' : 'gray'} /><StatCard icon={<CalendarClock className="h-5 w-5" />} label="BCP ถึงรอบ 30 วัน" value={metrics.bcpDue} tone={metrics.bcpDue ? 'amber' : 'gray'} /><StatCard icon={<Siren className="h-5 w-5" />} label="Anomaly ค้าง" value={metrics.anomalies} tone={metrics.anomalies ? 'danger' : 'teal'} /></div>
    <div className="flex flex-wrap gap-2">{tabs.map((item) => <Button key={item.key} size="sm" variant={tab === item.key ? 'primary' : 'outline'} onClick={() => { setTab(item.key); closeForm(); }}><item.icon className="h-4 w-4" />{item.label}</Button>)}</div>
    {showForm && <FormModal title={editing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'} description={tabs.find((item) => item.key === tab)?.label} size="xl" onClose={closeForm}>{optionsQuery.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div> : optionsQuery.data ? <RegistryForm key={`${tab}-${editing?.id ?? 'new'}`} tab={tab} record={editing} options={optionsQuery.data} overview={data} userId={me?.profile.id} onClose={closeForm} /> : <div className="p-5 text-red-700">โหลดตัวเลือกแบบฟอร์มไม่สำเร็จ</div>}</FormModal>}
    <Card><CardHeader>{tabs.find((item) => item.key === tab)?.label}</CardHeader><CardBody className="overflow-x-auto">
      {tab === 'backups' && (data.backups.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">วันที่/รหัส</th><th className="p-2">ระบบ/CI</th><th className="p-2">ประเภท/ผล</th><th className="p-2">Operator</th><th className="p-2">ครั้งถัดไป</th><th className="p-2">หลักฐาน</th><th /></tr></thead><tbody>{data.backups.map((r) => <tr key={r.id} data-testid={`backup-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2">{formatThaiDate(r.backup_date)}<p className="font-mono text-xs text-primary-700">{r.backup_code}</p></td><td className="p-2 font-semibold">{r.system_name}<p className="text-xs font-normal text-slate-400">{r.configuration_item?.ci_code}</p></td><td className="p-2">{r.backup_type}<p className="mt-1"><Badge variant={r.result === 'สำเร็จ' ? 'success' : r.result === 'ล้มเหลว' ? 'danger' : 'warning'}>{r.result}</Badge></p></td><td className="p-2 text-slate-500">{r.operator?.full_name}</td><td className="p-2"><Due date={r.next_backup_due} /></td><td className="p-2">{r.evidence_link && <a className="text-primary-700" href={r.evidence_link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>}</td><td className="p-2 text-right">{editButton(r)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี Backup Log'))}
      {tab === 'recoveries' && (data.recoveries.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">วันที่/รหัส</th><th className="p-2">ระบบ/Scenario</th><th className="p-2">ผล</th><th className="p-2">RTO / RPO</th><th className="p-2">ครั้งถัดไป</th><th /></tr></thead><tbody>{data.recoveries.map((r) => <tr key={r.id} data-testid={`recovery-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2">{formatThaiDate(r.test_date)}<p className="font-mono text-xs text-primary-700">{r.recovery_code}</p></td><td className="p-2 font-semibold">{r.system_name}<p className="max-w-96 text-xs font-normal text-slate-400">{r.scenario}</p></td><td className="p-2"><Badge variant={r.result === 'ผ่าน' ? 'success' : r.result === 'ไม่ผ่าน' ? 'danger' : 'warning'}>{r.result}</Badge></td><td className="p-2 text-slate-500">{r.rto_actual || '—'} / {r.rpo_actual || '—'}</td><td className="p-2"><Due date={r.next_test_due} /></td><td className="p-2 text-right">{editButton(r)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี Recovery Test'))}
      {tab === 'bcp' && (data.bcpPlans.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">แผน</th><th className="p-2">Owner</th><th className="p-2">ทบทวนถัดไป</th><th className="p-2">ใช้จริงล่าสุด</th><th className="p-2">สถานะ</th><th /></tr></thead><tbody>{data.bcpPlans.map((r) => <tr key={r.id} data-testid={`bcp-row-${r.id}`} className="border-t border-slate-100 align-top dark:border-slate-700"><td className="p-2 font-semibold">{r.plan_name}<p className="font-mono text-xs font-normal text-primary-700">{r.plan_code}</p></td><td className="p-2 text-slate-500">{r.owner?.full_name}</td><td className="p-2"><Due date={r.next_review_due} threshold={30} /></td><td className="p-2 text-slate-500">{r.last_invoked_date ? formatThaiDate(r.last_invoked_date) : '—'}<p className="max-w-64 text-xs">{r.invoke_reason}</p></td><td className="p-2"><Badge variant={r.status === 'ใช้งาน' ? 'success' : 'secondary'}>{r.status}</Badge></td><td className="p-2"><div className="flex justify-end gap-1">{canManage && <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ path: `/bcp-plans/${r.id}/review` })}><RotateCcw className="h-3.5 w-3.5" />ทบทวน</Button>}{canManage && <Button size="sm" variant="danger" onClick={() => setInvokeId(invokeId === r.id ? null : r.id)}>ใช้แผน</Button>}{editButton(r)}</div>{invokeId === r.id && <div className="mt-2 flex min-w-96 gap-2"><input value={invokeReason} onChange={(e) => setInvokeReason(e.target.value)} placeholder="เหตุการณ์/เหตุผลที่ใช้แผน" className={fieldClass} /><Button size="sm" disabled={!invokeReason.trim()} onClick={() => actionMutation.mutate({ path: `/bcp-plans/${r.id}/invoke`, body: { reason: invokeReason } })}>บันทึก</Button></div>}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี BCP / DR Plan'))}
      {tab === 'systems' && (data.loggingSystems.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">ระบบ</th><th className="p-2">Log/Location</th><th className="p-2">ความถี่</th><th className="p-2">Responsible</th><th className="p-2">ตรวจครั้งถัดไป</th><th /></tr></thead><tbody>{data.loggingSystems.map((r) => <tr key={r.id} data-testid={`log-system-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2 font-semibold">{r.system_name}<p className="font-mono text-xs font-normal text-primary-700">{r.log_system_code}</p></td><td className="p-2 text-slate-500">{r.log_type || '—'}<p className="text-xs">{r.log_location}</p></td><td className="p-2">{r.review_frequency}</td><td className="p-2 text-slate-500">{r.responsible?.full_name}</td><td className="p-2"><Due date={r.next_review_due} /></td><td className="p-2 text-right">{editButton(r)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มีระบบ Logging'))}
      {tab === 'reviews' && (data.logReviews.length ? <DataTable className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">วันที่/รหัส</th><th className="p-2">ระบบ/รอบ</th><th className="p-2">Anomaly</th><th className="p-2">รายละเอียด/การดำเนินการ</th><th className="p-2">สถานะ</th><th /></tr></thead><tbody>{data.logReviews.map((r) => <tr key={r.id} data-testid={`log-review-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2">{formatThaiDate(r.review_date)}<p className="font-mono text-xs text-primary-700">{r.review_code}</p></td><td className="p-2 font-semibold">{r.logging_system?.system_name}<p className="text-xs font-normal text-slate-400">{r.period}</p></td><td className="p-2"><Badge variant={r.anomaly_found ? 'danger' : 'success'}>{r.anomaly_found ? 'พบ' : 'ไม่พบ'}</Badge></td><td className="p-2 text-slate-500"><p>{r.anomaly_detail || '—'}</p><p className="text-xs">{r.action_taken}</p></td><td className="p-2"><Badge variant={r.status === 'แก้ไขแล้ว' || r.status === 'ปกติ' ? 'success' : 'warning'}>{r.status}</Badge></td><td className="p-2 text-right">{editButton(r)}</td></tr>)}</tbody></DataTable> : tableEmpty('ยังไม่มี Log Review'))}
    </CardBody></Card>
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>ระบบจะแจ้งผู้ดูแลเมื่อ Backup ล้มเหลว/สำเร็จบางส่วนหรือพบ Anomaly และการบันทึก Log Review จะเลื่อนรอบตรวจครั้งถัดไปตามความถี่โดยอัตโนมัติ</span></div>
  </div>;
}
