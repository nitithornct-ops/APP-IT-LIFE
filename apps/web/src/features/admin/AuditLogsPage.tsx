import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportAllButton } from '../../components/table/ExportAllButton';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { Badge } from '../../components/ui/Badge';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Archive, CheckCircle2, FileClock, Fingerprint, Loader2, LogIn, Search, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, StatCard } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { AuditLogItem, AuditOverview, LoginLogItem, PaginatedResult } from '../../types/admin';
import { formatThaiDate } from '../../utils/date';
import { useAuth } from '../../stores/authContext';
import { auditChanges, auditChangesText, auditContext, auditFieldLabel, auditSummary, auditValueText, hasAuditDetail } from './auditDisplay';

type LogTab = 'audit' | 'login';

interface AuditControls {
  available?: boolean;
  retention: { audit_retention_days: number; login_retention_days: number; archive_after_days: number; legal_hold: boolean } | null;
  archive: { auditRows: number; loginRows: number };
  integrity: { auditHashed: number; auditTotal: number; loginHashed: number; loginTotal: number };
  openAlertCount: number;
  alerts: Array<{ id: string; alert_type: string; severity: string; title: string; message: string; event_count: number; last_seen_at: string }>;
}

interface EvidencePackageResult {
  filename: string;
  content: string;
  checksum: string;
  rowCounts: Record<string, number>;
}

interface IntegrityResult {
  checkedAt: string;
  algorithm: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  audit: { total: number; verified: number; tampered: number; unverified: number };
  login: { total: number; verified: number; tampered: number; unverified: number };
}

function downloadText(content: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

const resultTone: Record<AuditLogItem['result'], 'success' | 'warning' | 'danger'> = {
  success: 'success',
  fail: 'warning',
  denied: 'danger',
};

function errorText(reason: unknown): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : 'โหลดข้อมูลไม่สำเร็จ';
}

/**
 * ข้อความสำหรับไฟล์ส่งออก — ใส่ค่าก่อน/หลังมาด้วยครบ เพราะในไฟล์ไม่มีปุ่มให้กางดู
 * ส่วนบนหน้าจอใช้ auditSummary กับหน้าต่างรายละเอียดแทน
 */
function detailText(detail: Record<string, unknown> | null): string {
  return auditChangesText(detail);
}

/**
 * หน้าต่างเทียบค่าก่อน/หลังของ Audit Log หนึ่งรายการ
 *
 * ฝั่ง api เก็บผลเทียบไว้ตั้งแต่ต้นแล้ว แต่หน้าจอเดิมแสดงเป็น JSON ก้อนเดียวในช่องที่ตัดข้อความ
 * ผู้ตรวจสอบจึงตอบไม่ได้ว่าฟิลด์ไหนเปลี่ยนจากอะไรเป็นอะไร ทั้งที่เป็นคำถามหลักของงาน ISMS
 */
function AuditDetailModal({ log, onClose }: { log: AuditLogItem; onClose: () => void }) {
  const changes = auditChanges(log.detail);
  const context = auditContext(log.detail);

  return (
    <Modal title={`${log.action} · ${log.module}`} size="lg" onClose={onClose} contentClassName="px-5 py-5">
      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        {[
          ['เวลา', `${formatThaiDate(log.created_at, 'd MMM yyyy HH:mm')} น.`],
          ['ผู้ดำเนินการ', log.actor_email ?? 'ระบบ'],
          ['ตารางเป้าหมาย', log.target_table ?? '—'],
          ['Target ID', log.target_id ?? '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold text-slate-400">{label}</dt>
            <dd className="mt-1 break-all font-medium text-slate-700 dark:text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 text-sm md:grid-cols-4 dark:border-slate-700">
        {[
          ['Event Category', log.event_category ?? 'system'],
          ['Privileged Action', log.privileged_action ? 'Yes' : 'No'],
          ['Request ID', log.request_id ?? '—'],
          ['Correlation ID', log.correlation_id ?? log.request_id ?? '—'],
          ['Hash', log.entry_hash ? `${log.hash_algorithm ?? 'sha256'}:${log.entry_hash.slice(0, 16)}…` : 'legacy / unverified'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold text-slate-400">{label}</dt>
            <dd className="mt-1 break-all font-mono text-xs font-medium text-slate-700 dark:text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>

      {changes.length > 0 && (
        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
          <h3 className="mb-3 font-bold text-slate-800 dark:text-slate-100">ค่าที่เปลี่ยน</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2">ฟิลด์</th>
                  <th className="px-3 py-2">ค่าเดิม</th>
                  <th className="px-3 py-2">ค่าใหม่</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => (
                  <tr key={change.field} className="border-t border-slate-100 align-top dark:border-slate-700">
                    <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                      {change.label}
                      {change.label !== change.field && <span className="block font-mono text-[11px] font-normal text-slate-400">{change.field}</span>}
                    </td>
                    <td className="px-3 py-2 text-red-700 line-through decoration-red-300 dark:text-red-300">{auditValueText(change.from)}</td>
                    <td className="px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-300">{auditValueText(change.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {context.length > 0 && (
        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
          <h3 className="mb-3 font-bold text-slate-800 dark:text-slate-100">ข้อมูลประกอบ</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            {context.map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs font-semibold text-slate-400">{auditFieldLabel(key)}</dt>
                <dd className="mt-1 break-all font-medium text-slate-700 dark:text-slate-200">{auditValueText(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {changes.length === 0 && context.length === 0 && (
        <p className="mt-5 text-sm text-slate-400">รายการนี้ไม่มีรายละเอียดเพิ่มเติม</p>
      )}
    </Modal>
  );
}

export function AuditLogsPage() {
  const table = useTableParams<'tab' | 'from' | 'to' | 'actor' | 'module' | 'action' | 'result' | 'eventCategory' | 'privileged' | 'eventType'>({
    filters: ['tab', 'from', 'to', 'actor', 'module', 'action', 'result', 'eventCategory', 'privileged', 'eventType'],
  });
  const { page, pageSize } = table;
  const { from, to, actor, module, action, result, eventCategory, privileged, eventType } = table.filters;
  const tab: LogTab = table.filters.tab === 'login' ? 'login' : 'audit';

  const { hasPermission } = useAuth();
  const canExportEvidence = hasPermission('evidence.export');
  const canVerifyIntegrity = hasPermission('audit_management.verify');
  const canArchive = hasPermission('audit_management.manage');
  const [evidenceMonth, setEvidenceMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [archiveCutoff, setArchiveCutoff] = useState('');

  const filterQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (actor.trim()) params.set(tab === 'audit' ? 'actor' : 'email', actor.trim());
    if (tab === 'audit') {
      if (module.trim()) params.set('module', module.trim());
      if (action.trim()) params.set('action', action.trim());
      if (result) params.set('result', result);
      if (eventCategory) params.set('eventCategory', eventCategory);
      if (privileged) params.set('privileged', privileged);
    } else {
      if (result) params.set('success', result);
      if (eventType) params.set('eventType', eventType);
    }
    return params.toString();
  }, [action, actor, eventCategory, eventType, from, module, privileged, result, tab, to]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams(filterQueryString);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return params.toString();
  }, [filterQueryString, page, pageSize]);

  const overviewQuery = useQuery({
    queryKey: ['admin', 'audit-overview'],
    queryFn: () => apiFetch<AuditOverview>('/api/v1/audit-logs/overview?days=30', undefined, { silent: true }),
  });
  const logsQuery = useQuery<PaginatedResult<AuditLogItem | LoginLogItem>>({
    queryKey: ['admin', 'audit-logs', tab, queryString],
    queryFn: () => tab === 'audit'
      ? apiFetch<PaginatedResult<AuditLogItem | LoginLogItem>>(`/api/v1/audit-logs?${queryString}`, undefined, { silent: true })
      : apiFetch<PaginatedResult<AuditLogItem | LoginLogItem>>(`/api/v1/audit-logs/login-logs?${queryString}`, undefined, { silent: true }),
  });
  const controlsQuery = useQuery({
    queryKey: ['admin', 'audit-controls'],
    queryFn: () => apiFetch<AuditControls>('/api/v1/audit-logs/controls', undefined, { silent: true }),
  });
  const integrityQuery = useQuery({
    queryKey: ['admin', 'audit-integrity'],
    enabled: false,
    queryFn: () => apiFetch<IntegrityResult>('/api/v1/audit-logs/integrity'),
  });
  const evidenceMutation = useMutation({
    mutationFn: () => apiFetch<EvidencePackageResult>(`/api/v1/audit-logs/evidence-package?month=${encodeURIComponent(evidenceMonth)}`),
    onSuccess: (result) => downloadText(result.content, result.filename, 'application/json;charset=utf-8'),
  });
  const archiveMutation = useMutation({
    mutationFn: () => apiFetch<{ audit_archived: number; login_archived: number }>('/api/v1/audit-logs/archive', { method: 'POST', body: JSON.stringify({ cutoff: new Date(`${archiveCutoff}T23:59:59+07:00`).toISOString() }) }),
    onSuccess: () => { setArchiveCutoff(''); void controlsQuery.refetch(); },
  });

  // สลับแท็บแล้วต้องล้างตัวกรองที่มีเฉพาะแท็บเดิม ไม่งั้น query จะพกค่าที่อีกแท็บไม่รู้จักติดไปด้วย
  const switchTab = (next: LogTab) => {
    table.setFilters({ tab: next === 'audit' ? '' : next, actor: '', module: '', action: '', result: '', eventCategory: '', privileged: '', eventType: '' });
  };

  return (
    <div className="space-y-5" data-testid="audit-log-page">
      <PageTitle eyebrow="ธรรมาภิบาลและรายงาน / Audit Log" title="Audit Log" description="ตรวจสอบกิจกรรมระบบและประวัติการเข้าสู่ระบบ ข้อมูลส่วนนี้อ่านอย่างเดียวและแก้ไขไม่ได้" />

      {overviewQuery.data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard icon={<FileClock className="h-5 w-5" />} label="กิจกรรม 30 วัน" value={overviewQuery.data.auditTotal} tone="primary" />
          <StatCard icon={<ShieldAlert className="h-5 w-5" />} label="ถูกปฏิเสธ" value={overviewQuery.data.denied} tone="danger" />
          <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="ทำรายการไม่สำเร็จ" value={overviewQuery.data.failedActions} tone="amber" />
          <StatCard icon={<LogIn className="h-5 w-5" />} label="เข้าสู่ระบบ" value={overviewQuery.data.loginTotal} tone="teal" />
          <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="เข้าสู่ระบบไม่สำเร็จ" value={overviewQuery.data.failedLogins} tone="danger" />
        </div>
      )}
      {overviewQuery.isError && <p className="text-sm text-amber-700 dark:text-amber-300" role="status">โหลดสรุป Audit Log บางส่วนไม่สำเร็จ แต่ยังสามารถดูรายการ Audit Trail ได้</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2"><Fingerprint className="h-5 w-5 text-primary-600" /><h2 className="font-bold text-slate-800 dark:text-slate-100">Audit Controls</h2></div>
            {controlsQuery.isLoading && <Loader2 className="h-5 w-5 animate-spin text-primary-600" />}
            {(controlsQuery.isError || controlsQuery.data?.available === false) && <p className="text-sm text-amber-700 dark:text-amber-300" role="status">Audit Controls ยังไม่พร้อม จึงแสดงเฉพาะรายการ Audit Log หลัก</p>}
            {controlsQuery.data && <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-slate-500">Hash coverage</p><p className="font-semibold">{controlsQuery.data.integrity.auditHashed + controlsQuery.data.integrity.loginHashed} / {controlsQuery.data.integrity.auditTotal + controlsQuery.data.integrity.loginTotal}</p></div>
              <div><p className="text-xs text-slate-500">Open alerts</p><p className="font-semibold text-amber-700">{controlsQuery.data.openAlertCount}</p></div>
              <div><p className="text-xs text-slate-500">Retention</p><p className="font-semibold">{controlsQuery.data.retention?.audit_retention_days ?? '—'}d audit · {controlsQuery.data.retention?.login_retention_days ?? '—'}d login</p></div>
              <div><p className="text-xs text-slate-500">Archive</p><p className="font-semibold">{controlsQuery.data.archive.auditRows + controlsQuery.data.archive.loginRows} rows · after {controlsQuery.data.retention?.archive_after_days ?? '—'}d</p></div>
            </div>}
            {controlsQuery.data?.alerts.slice(0, 3).map((alert) => <div key={alert.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-semibold">{alert.title} · {alert.event_count}</p><p>{alert.message}</p></div>)}
            {canArchive && <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700"><label className="text-xs font-semibold text-slate-500">Archive rows before<input type="date" value={archiveCutoff} onChange={(event) => setArchiveCutoff(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label><Button size="sm" variant="outline" disabled={!archiveCutoff} isLoading={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}><Archive className="h-4 w-4" />Archive evidence</Button></div>}
            {archiveMutation.isSuccess && <p className="text-xs text-emerald-700">Archived successfully; source rows remain immutable and online.</p>}
            {archiveMutation.error && <p className="text-xs font-semibold text-red-600" role="alert">{errorText(archiveMutation.error)}</p>}
            {canVerifyIntegrity && <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" isLoading={integrityQuery.isFetching} onClick={() => integrityQuery.refetch()}><CheckCircle2 className="h-4 w-4" />Verify Integrity</Button>{integrityQuery.data && <Badge variant={integrityQuery.data.status === 'PASS' ? 'success' : integrityQuery.data.status === 'WARN' ? 'warning' : 'danger'}>{integrityQuery.data.status} · {integrityQuery.data.audit.verified + integrityQuery.data.login.verified} verified</Badge>}</div>}
            {integrityQuery.error && <p className="text-xs font-semibold text-red-600" role="alert">{errorText(integrityQuery.error)}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2"><Archive className="h-5 w-5 text-primary-600" /><h2 className="font-bold text-slate-800 dark:text-slate-100">Audit Evidence Package</h2></div>
            <p className="text-sm text-slate-500">Export monthly evidence: Audit Log, Login, Change, Access Review, and Backup Evidence.</p>
            <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-semibold text-slate-500">Month<input type="month" value={evidenceMonth} onChange={(event) => setEvidenceMonth(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label><Button size="sm" disabled={!canExportEvidence || !evidenceMonth} isLoading={evidenceMutation.isPending} onClick={() => evidenceMutation.mutate()}><Archive className="h-4 w-4" />Export Evidence Package</Button></div>
            {!canExportEvidence && <p className="text-xs text-slate-500">ต้องมีสิทธิ์ evidence.export</p>}
            {evidenceMutation.isSuccess && <p className="break-all text-xs text-emerald-700">SHA-256: {evidenceMutation.data.checksum}</p>}
            {evidenceMutation.error && <p className="text-xs font-semibold text-red-600" role="alert">{errorText(evidenceMutation.error)}</p>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="ประเภทประวัติ">
              <button type="button" role="tab" aria-selected={tab === 'audit'} onClick={() => switchTab('audit')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'audit' ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Audit Trail</button>
              <button type="button" role="tab" aria-selected={tab === 'login'} onClick={() => switchTab('login')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'login' ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Login History</button>
            </div>
            <ExportCsvButton
              disabled={!logsQuery.data?.items.length}
              label="ส่งออกหน้าปัจจุบัน"
              fileName={`${tab === 'audit' ? 'audit-trail' : 'login-history'}-page-${page}.csv`}
              getRows={() => (tab === 'audit'
                ? [
                  ['เวลา', 'ผู้ดำเนินการ', 'การกระทำ', 'โมดูล', 'ตารางเป้าหมาย', 'Target ID', 'รายละเอียด', 'ผลลัพธ์'],
                  ...((logsQuery.data?.items ?? []) as AuditLogItem[]).map((log) => [
                    formatThaiDate(log.created_at, 'd MMM yyyy HH:mm'),
                    log.actor_email ?? 'ระบบ',
                    log.action,
                    log.module,
                    log.target_table ?? '',
                    log.target_id ?? '',
                    detailText(log.detail),
                    log.result,
                  ]),
                ]
                : [
                  ['เวลา', 'อีเมล', 'ผลลัพธ์', 'MFA', 'IP Address', 'หมายเหตุ'],
                  ...((logsQuery.data?.items ?? []) as LoginLogItem[]).map((log) => [
                    formatThaiDate(log.created_at, 'd MMM yyyy HH:mm'),
                    log.email_attempted,
                    log.success ? 'success' : 'fail',
                    log.mfa_used ? 'ผ่าน' : '',
                    log.ip_address ?? '',
                    log.failure_reason ?? '',
                  ]),
                ])}
            />
            <ExportAllButton
              disabled={!logsQuery.data?.pagination.totalItems}
              label="ส่งออกตาม Filter ทั้งหมด"
              url={`/api/v1/audit-logs/${tab === 'audit' ? 'export' : 'login-logs/export'}${filterQueryString ? `?${filterQueryString}` : ''}`}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
            <label className="text-xs font-semibold text-slate-500">ตั้งแต่วันที่<input aria-label="ตั้งแต่วันที่" type="date" value={from} onChange={(event) => table.setFilter('from', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
            <label className="text-xs font-semibold text-slate-500">ถึงวันที่<input aria-label="ถึงวันที่" type="date" value={to} onChange={(event) => table.setFilter('to', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
            <label className="text-xs font-semibold text-slate-500">{tab === 'audit' ? 'ผู้ดำเนินการ' : 'อีเมล'}<div className="relative mt-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={actor} onChange={(event) => table.setFilter('actor', event.target.value, { replace: true })} placeholder="ค้นหาอีเมล" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-900" /></div></label>
            {tab === 'audit' && <label className="text-xs font-semibold text-slate-500">โมดูล<input value={module} onChange={(event) => table.setFilter('module', event.target.value, { replace: true })} placeholder="เช่น settings" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>}
            {tab === 'audit' && <label className="text-xs font-semibold text-slate-500">การกระทำ<input value={action} onChange={(event) => table.setFilter('action', event.target.value, { replace: true })} placeholder="เช่น UPDATE_SETTING" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>}
            <label className="text-xs font-semibold text-slate-500">ผลลัพธ์<select value={result} onChange={(event) => table.setFilter('result', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">ทั้งหมด</option>{tab === 'audit' ? <><option value="success">success</option><option value="fail">fail</option><option value="denied">denied</option></> : <><option value="true">สำเร็จ</option><option value="false">ไม่สำเร็จ</option></>}</select></label>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tab === 'audit' && <label className="text-xs font-semibold text-slate-500">Event Category<select value={eventCategory} onChange={(event) => table.setFilter('eventCategory', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">All categories</option><option value="authentication">authentication</option><option value="authorization">authorization</option><option value="data_change">data_change</option><option value="privileged_action">privileged_action</option><option value="administration">administration</option><option value="access_review">access_review</option><option value="backup">backup</option><option value="export">export</option><option value="security">security</option><option value="system">system</option></select></label>}
            {tab === 'audit' && <label className="text-xs font-semibold text-slate-500">Privileged Action<select value={privileged} onChange={(event) => table.setFilter('privileged', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>}
            {tab === 'login' && <label className="text-xs font-semibold text-slate-500">Authentication Event<select value={eventType} onChange={(event) => table.setFilter('eventType', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">All events</option><option value="login_attempt">login_attempt</option><option value="logout">logout</option><option value="mfa_challenge">mfa_challenge</option><option value="password_reset">password_reset</option><option value="password_change">password_change</option><option value="session_refresh">session_refresh</option></select></label>}
          </div>
        </CardBody>
      </Card>

      {logsQuery.isLoading && <div className="flex justify-center py-12" role="status"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>}
      {logsQuery.isError && <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title="โหลดประวัติไม่สำเร็จ" message={errorText(logsQuery.error)} />}
      {logsQuery.data && logsQuery.data.items.length === 0 && <EmptyState icon={<Search className="h-10 w-10" />} title="ไม่พบประวัติ" message="ลองเปลี่ยนช่วงวันที่หรือเงื่อนไขการค้นหา" />}
      {logsQuery.data && logsQuery.data.items.length > 0 && (tab === 'audit'
        ? <AuditTable items={logsQuery.data.items as AuditLogItem[]} rowNumberStart={(page - 1) * pageSize + 1} />
        : <LoginTable items={logsQuery.data.items as LoginLogItem[]} rowNumberStart={(page - 1) * pageSize + 1} />)}

      {logsQuery.data && <TablePagination page={logsQuery.data.pagination.page} pageSize={pageSize} totalItems={logsQuery.data.pagination.totalItems} totalPages={logsQuery.data.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />}
    </div>
  );
}

/** export ไว้ให้เทสต์เรียกตรง ๆ ได้ โดยไม่ต้องประกอบทั้งหน้าซึ่งต้องใช้ auth และ query client */
export function AuditTable({ items, rowNumberStart = 1 }: { items: AuditLogItem[]; rowNumberStart?: number }) {
  const [openLog, setOpenLog] = useState<AuditLogItem | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <DataTable mode="server" rowNumberStart={rowNumberStart} className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3">เวลา</th>
              <th className="px-4 py-3">ผู้ดำเนินการ</th>
              <th className="px-4 py-3">การกระทำ / โมดูล</th>
              <th className="px-4 py-3">เป้าหมาย</th>
              <th className="px-4 py-3">สิ่งที่เปลี่ยน</th>
              <th className="px-4 py-3">ผลลัพธ์</th>
            </tr>
          </thead>
          <tbody>
            {items.map((log) => (
              <tr key={log.id} className="border-t border-slate-100 align-top dark:border-slate-700">
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatThaiDate(log.created_at, 'd MMM yyyy HH:mm')} น.</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{log.actor_email ?? 'ระบบ'}</td>
                <td className="px-4 py-3">
                  <code className="text-xs font-semibold text-primary-700 dark:text-primary-300">{log.action}</code>
                  <p className="mt-1 text-xs text-slate-500">{log.module}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{log.event_category ?? 'system'}{log.privileged_action ? ' · privileged' : ''}</p>
                  {log.correlation_id && <p className="max-w-40 truncate font-mono text-[10px] text-slate-400" title={log.correlation_id}>CID {log.correlation_id}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {log.target_table ?? '—'}
                  {log.target_id && <span className="block max-w-40 truncate" title={log.target_id}>{log.target_id}</span>}
                </td>
                <td className="max-w-xs px-4 py-3">
                  <span className="block text-xs text-slate-600 dark:text-slate-300">{auditSummary(log.detail)}</span>
                  {hasAuditDetail(log.detail) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-auto px-0 text-xs"
                      aria-label={`ดูรายละเอียด ${log.action} ${log.module}`}
                      onClick={() => setOpenLog(log)}
                    >
                      ดูรายละเอียด
                    </Button>
                  )}
                </td>
                <td className="px-4 py-3"><Badge variant={resultTone[log.result]}>{log.result}</Badge></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
      {openLog && <AuditDetailModal log={openLog} onClose={() => setOpenLog(null)} />}
    </>
  );
}

function LoginTable({ items, rowNumberStart = 1 }: { items: LoginLogItem[]; rowNumberStart?: number }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><DataTable mode="server" rowNumberStart={rowNumberStart} className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="px-4 py-3">เวลา</th><th className="px-4 py-3">อีเมล</th><th className="px-4 py-3">ผลลัพธ์</th><th className="px-4 py-3">MFA</th><th className="px-4 py-3">IP Address</th><th className="px-4 py-3">สาเหตุ</th></tr></thead><tbody>{items.map((log) => <tr key={log.id} className="border-t border-slate-100 dark:border-slate-700"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatThaiDate(log.created_at, 'd MMM yyyy HH:mm')} น.</td><td className="px-4 py-3 text-slate-700 dark:text-slate-300">{log.email_attempted}</td><td className="px-4 py-3"><Badge variant={log.success ? 'success' : 'warning'}>{log.success ? 'success' : 'fail'}</Badge></td><td className="px-4 py-3 text-slate-500">{log.mfa_used ? 'ใช้งาน' : '—'}</td><td className="px-4 py-3 font-mono text-xs text-slate-500">{log.ip_address ?? '—'}</td><td className="px-4 py-3 text-xs text-slate-500">{log.failure_reason ?? '—'}</td></tr>)}</tbody></DataTable></div>;
}
