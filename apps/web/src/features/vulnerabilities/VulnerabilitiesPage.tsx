import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileCheck2,
  Loader2,
  Activity,
  Plus,
  Save,
  ShieldAlert,
  ShieldCheck,
  Siren,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import {
  VULNERABILITY_SEVERITIES,
  VULNERABILITY_STATUSES,
  type VulnerabilityFinding,
  type VulnerabilityOptions,
  type VulnerabilitySeverity,
  type VulnerabilityStatus,
} from '../../types/vulnerabilities';
import { formatThaiDate } from '../../utils/date';
import { daysUntilVulnerabilityDue, remediationPercent, severityFromCvss, vulnerabilityIsOverdue } from './vulnerabilityDisplay';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';

const severityTone: Record<VulnerabilitySeverity, 'secondary' | 'warning' | 'danger'> = {
  ต่ำ: 'secondary',
  ปานกลาง: 'warning',
  สูง: 'danger',
  วิกฤต: 'danger',
};

const statusTone: Record<VulnerabilityStatus, 'secondary' | 'info' | 'warning' | 'primary' | 'success'> = {
  เปิด: 'secondary',
  กำลังวิเคราะห์: 'info',
  กำลังแก้ไข: 'warning',
  รอตรวจยืนยัน: 'primary',
  ปิด: 'success',
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

interface FindingFormState {
  title: string;
  assetId: string;
  configurationItemId: string;
  affectedSystem: string;
  source: string;
  cve: string;
  cvss: string;
  severity: VulnerabilitySeverity;
  description: string;
  detectedAt: string;
  ownerId: string;
  remediationPlan: string;
  patchReference: string;
  dueDate: string;
  status: VulnerabilityStatus;
  exceptionReason: string;
  exceptionExpiry: string;
  evidenceLink: string;
  notes: string;
}

function initialForm(finding: VulnerabilityFinding | undefined, currentUserId: string | undefined): FindingFormState {
  return {
    title: finding?.title ?? '',
    assetId: finding?.asset_id ?? '',
    configurationItemId: finding?.configuration_item_id ?? '',
    affectedSystem: finding?.affected_system ?? '',
    source: finding?.source ?? '',
    cve: finding?.cve ?? '',
    cvss: finding?.cvss === null || finding?.cvss === undefined ? '' : String(finding.cvss),
    severity: finding?.severity ?? 'ปานกลาง',
    description: finding?.description ?? '',
    detectedAt: finding?.detected_at ?? new Date().toISOString().slice(0, 10),
    ownerId: finding?.owner_id ?? currentUserId ?? '',
    remediationPlan: finding?.remediation_plan ?? '',
    patchReference: finding?.patch_reference ?? '',
    dueDate: finding?.due_date ?? '',
    status: finding?.status === 'ปิด' ? 'รอตรวจยืนยัน' : finding?.status ?? 'เปิด',
    exceptionReason: finding?.exception_reason ?? '',
    exceptionExpiry: finding?.exception_expiry ?? '',
    evidenceLink: finding?.evidence_link ?? '',
    notes: finding?.notes ?? '',
  };
}

function FindingForm({
  finding,
  options,
  currentUserId,
  onClose,
}: {
  finding?: VulnerabilityFinding;
  options: VulnerabilityOptions;
  currentUserId?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => initialForm(finding, currentUserId));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FindingFormState,>(key: K, value: FindingFormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const mutation = useMutation({
    mutationFn: () => {
      const cvss = form.cvss === '' ? undefined : Number(form.cvss);
      if (cvss !== undefined && (!Number.isFinite(cvss) || cvss < 0 || cvss > 10)) throw new Error('CVSS ต้องอยู่ระหว่าง 0–10');
      if (form.dueDate && form.detectedAt && form.dueDate < form.detectedAt) throw new Error('วันครบกำหนดต้องไม่ก่อนวันที่ตรวจพบ');
      if (form.exceptionExpiry && !form.exceptionReason.trim()) throw new Error('กรุณาระบุเหตุผลข้อยกเว้นเมื่อกำหนดวันหมดอายุข้อยกเว้น');
      if (form.evidenceLink && !form.evidenceLink.startsWith('https://')) throw new Error('ลิงก์หลักฐานต้องเป็น HTTPS');
      return apiFetch(finding ? `/api/v1/vulnerabilities/${finding.id}` : '/api/v1/vulnerabilities', {
        method: finding ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title: form.title,
          assetId: form.assetId,
          configurationItemId: form.configurationItemId,
          affectedSystem: form.affectedSystem,
          source: form.source,
          cve: form.cve,
          cvss,
          severity: form.severity,
          description: form.description,
          detectedAt: form.detectedAt,
          ownerId: form.ownerId,
          remediationPlan: form.remediationPlan,
          patchReference: form.patchReference,
          dueDate: form.dueDate,
          status: form.status,
          exceptionReason: form.exceptionReason,
          exceptionExpiry: form.exceptionExpiry,
          evidenceLink: form.evidenceLink,
          notes: form.notes,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      onClose();
    },
    onError: (reason) => setError(errorText(reason, 'บันทึกช่องโหว่ไม่สำเร็จ')),
  });

  const inferredSeverity = severityFromCvss(form.cvss === '' ? null : Number(form.cvss));

  return (
    <Card data-testid="vulnerability-form" className="border-primary-200 dark:border-primary-900">
      <CardHeader className="flex items-center justify-between gap-3">
        <div>
          <p>{finding ? `แก้ไข ${finding.vulnerability_code}` : 'เพิ่มช่องโหว่'}</p>
          <p className="mt-0.5 text-xs font-normal text-slate-500">CVE/CVSS · Asset/CI · แผนแก้ไข · ข้อยกเว้น · หลักฐาน</p>
        </div>
        <button type="button" aria-label="ปิดแบบฟอร์ม" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
      </CardHeader>
      <CardBody>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
          <label className="text-xs font-semibold sm:col-span-2">ชื่อช่องโหว่<input required maxLength={200} data-testid="vuln-form-title" value={form.title} onChange={(event) => set('title', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold">CVE<input maxLength={100} value={form.cve} onChange={(event) => set('cve', event.target.value.toUpperCase())} placeholder="CVE-2026-12345" className={fieldClass} /></label>
          <label className="text-xs font-semibold">แหล่งตรวจพบ<input maxLength={150} value={form.source} onChange={(event) => set('source', event.target.value)} placeholder="Scanner / Pentest / Vendor" className={fieldClass} /></label>
          <label className="text-xs font-semibold">CVSS 0–10<input type="number" min="0" max="10" step="0.1" data-testid="vuln-form-cvss" value={form.cvss} onChange={(event) => { const next = event.target.value; setForm((current) => ({ ...current, cvss: next, ...(severityFromCvss(next === '' ? null : Number(next)) ? { severity: severityFromCvss(Number(next))! } : {}) })); }} className={fieldClass} />{inferredSeverity && <span className="mt-1 block text-[11px] font-normal text-slate-400">ระดับแนะนำ: {inferredSeverity}</span>}</label>
          <label className="text-xs font-semibold">Severity<select value={form.severity} onChange={(event) => set('severity', event.target.value as VulnerabilitySeverity)} className={fieldClass}>{VULNERABILITY_SEVERITIES.map((severity) => <option key={severity}>{severity}</option>)}</select></label>
          <label className="text-xs font-semibold">วันที่ตรวจพบ<input required type="date" value={form.detectedAt} onChange={(event) => set('detectedAt', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold">กำหนดแก้ไข<input type="date" data-testid="vuln-form-due" value={form.dueDate} onChange={(event) => set('dueDate', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold sm:col-span-2">Asset<select value={form.assetId} onChange={(event) => set('assetId', event.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{options.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} — {asset.name}</option>)}</select></label>
          <label className="text-xs font-semibold sm:col-span-2">Configuration Item<select value={form.configurationItemId} onChange={(event) => set('configurationItemId', event.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{options.configurationItems.map((ci) => <option key={ci.id} value={ci.id}>{ci.ci_code} — {ci.name} ({ci.environment})</option>)}</select></label>
          <label className="text-xs font-semibold sm:col-span-2">ระบบที่ได้รับผลกระทบ<input maxLength={200} value={form.affectedSystem} onChange={(event) => set('affectedSystem', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold sm:col-span-2">Owner<select required value={form.ownerId} onChange={(event) => set('ownerId', event.target.value)} className={fieldClass}><option value="">— เลือกผู้รับผิดชอบ —</option>{options.users.map((user) => <option key={user.id} value={user.id}>{user.full_name} — {user.email}</option>)}</select></label>
          <label className="text-xs font-semibold sm:col-span-2">รายละเอียด<textarea rows={3} maxLength={1500} value={form.description} onChange={(event) => set('description', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold sm:col-span-2">แผนแก้ไข<textarea rows={3} maxLength={1500} value={form.remediationPlan} onChange={(event) => set('remediationPlan', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold sm:col-span-2">Patch / Fix Reference<input maxLength={300} value={form.patchReference} onChange={(event) => set('patchReference', event.target.value)} placeholder="KB / Vendor advisory / Patch ID" className={fieldClass} /></label>
          <label className="text-xs font-semibold">สถานะ<select value={form.status} onChange={(event) => set('status', event.target.value as VulnerabilityStatus)} className={fieldClass}>{VULNERABILITY_STATUSES.filter((status) => status !== 'ปิด').map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="text-xs font-semibold">ข้อยกเว้นถึงวันที่<input type="date" value={form.exceptionExpiry} onChange={(event) => set('exceptionExpiry', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold sm:col-span-2">เหตุผลข้อยกเว้น<input maxLength={1000} value={form.exceptionReason} onChange={(event) => set('exceptionReason', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold sm:col-span-2">หลักฐาน HTTPS<input type="url" maxLength={500} value={form.evidenceLink} onChange={(event) => set('evidenceLink', event.target.value)} placeholder="https://..." className={fieldClass} /></label>
          <label className="text-xs font-semibold sm:col-span-2 lg:col-span-4">หมายเหตุ<textarea rows={2} maxLength={1000} value={form.notes} onChange={(event) => set('notes', event.target.value)} className={fieldClass} /></label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 lg:col-span-4 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!form.title.trim() || !form.ownerId} data-testid="vuln-form-submit"><Save className="h-4 w-4" />บันทึกช่องโหว่</Button><Button size="sm" variant="ghost" onClick={onClose}>ยกเลิก</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

function StatusPanel({ finding, currentUserId, onClose }: { finding: VulnerabilityFinding; currentUserId?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<VulnerabilityStatus>(finding.status);
  const [evidenceLink, setEvidenceLink] = useState(finding.evidence_link ?? '');
  const [error, setError] = useState<string | null>(null);
  const ownerCannotVerify = status === 'ปิด' && finding.owner_id === currentUserId;
  const mutation = useMutation({
    mutationFn: () => {
      if (status === 'ปิด' && !evidenceLink.startsWith('https://')) throw new Error('การปิดรายการต้องมีหลักฐาน HTTPS');
      if (ownerCannotVerify) throw new Error('Owner ผู้แก้ไขห้ามตรวจยืนยันปิดรายการของตนเอง');
      return apiFetch(`/api/v1/vulnerabilities/${finding.id}/status`, { method: 'POST', body: JSON.stringify({ status, evidenceLink }) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'อัปเดตสถานะไม่สำเร็จ')),
  });
  return (
    <div className="mt-3 grid gap-2 rounded-xl border border-primary-200 bg-primary-50 p-3 dark:border-primary-900 dark:bg-primary-950/30 sm:grid-cols-[180px_1fr_auto]" data-testid={`vuln-status-${finding.id}`}>
      <label className="text-xs font-semibold">สถานะ<select value={status} onChange={(event) => setStatus(event.target.value as VulnerabilityStatus)} className={fieldClass}>{VULNERABILITY_STATUSES.filter((item) => item !== 'ปิด' || finding.status === 'รอตรวจยืนยัน' || finding.status === 'ปิด').map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold">หลักฐาน HTTPS<input type="url" value={evidenceLink} onChange={(event) => setEvidenceLink(event.target.value)} placeholder="จำเป็นเมื่อปิดรายการ" className={fieldClass} /></label>
      <div className="flex items-end gap-1"><Button size="sm" isLoading={mutation.isPending} disabled={ownerCannotVerify} onClick={() => { setError(null); mutation.mutate(); }}><UserRoundCheck className="h-4 w-4" />บันทึก</Button><Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button></div>
      {ownerCannotVerify && <p className="text-xs text-amber-700 sm:col-span-3 dark:text-amber-300">ต้องให้ผู้ดูแลคนอื่นตรวจยืนยันตามหลัก Separation of Duties</p>}
      {error && <p className="text-xs text-red-600 sm:col-span-3">{error}</p>}
    </div>
  );
}

function DueText({ finding }: { finding: VulnerabilityFinding }) {
  const days = daysUntilVulnerabilityDue(finding.due_date);
  if (!finding.due_date) return <span className="text-slate-400">ไม่กำหนด</span>;
  return <div><p>{formatThaiDate(finding.due_date, 'd MMM yyyy')}</p>{finding.status !== 'ปิด' && days !== null && <p className={`text-xs font-semibold ${days < 0 ? 'text-red-600' : days <= 7 ? 'text-amber-600' : 'text-slate-400'}`}>{days < 0 ? `เกิน ${Math.abs(days)} วัน` : `เหลือ ${days} วัน`}</p>}</div>;
}

export function VulnerabilitiesPage() {
  const { hasPermission, me } = useAuth();
  const canManage = hasPermission('vulnerability.manage');
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VulnerabilityFinding | undefined>();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const findingsQuery = useQuery({
    queryKey: ['vulnerabilities', debouncedSearch],
    queryFn: () => apiFetch<PaginatedResult<VulnerabilityFinding>>(`/api/v1/vulnerabilities?page=1&pageSize=100${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`),
  });
  const optionsQuery = useQuery({
    queryKey: ['vulnerabilities', 'options'],
    enabled: canManage && showForm,
    queryFn: () => apiFetch<VulnerabilityOptions>('/api/v1/vulnerabilities/options'),
  });

  const items = useMemo(() => findingsQuery.data?.items ?? [], [findingsQuery.data?.items]);
  const visibleItems = items.filter((item) => (!severityFilter || item.severity === severityFilter) && (!statusFilter || item.status === statusFilter));
  const criticalOpen = items.filter((item) => item.status !== 'ปิด' && (item.severity === 'วิกฤต' || item.severity === 'สูง')).length;
  const overdue = items.filter((item) => vulnerabilityIsOverdue(item)).length;
  const waitingVerification = items.filter((item) => item.status === 'รอตรวจยืนยัน').length;
  const closed = items.filter((item) => item.status === 'ปิด').length;
  const resetForm = () => { setShowForm(false); setEditing(undefined); };

  return (
    <div className="flex flex-col gap-4" data-testid="vulnerabilities-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle eyebrow="ทรัพย์สินและโครงสร้างพื้นฐาน / Vulnerability & Patch" title="Vulnerability / Patch" description="ติดตาม CVE/CVSS แผนแก้ไข ข้อยกเว้น Patch และการตรวจยืนยันแบบแยกหน้าที่" />
        {canManage && <Button size="sm" data-testid="vuln-create-toggle" onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus className="h-4 w-4" />เพิ่มช่องโหว่</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard icon={<ShieldAlert className="h-5 w-5" />} label="ช่องโหว่ทั้งหมด" value={findingsQuery.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<Siren className="h-5 w-5" />} label="สูง / วิกฤตที่เปิด" value={criticalOpen} tone={criticalOpen ? 'danger' : 'gray'} />
        <StatCard icon={<CalendarClock className="h-5 w-5" />} label="เกินกำหนด" value={overdue} tone={overdue ? 'danger' : 'gray'} />
        <StatCard icon={<FileCheck2 className="h-5 w-5" />} label="รอตรวจยืนยัน" value={waitingVerification} tone={waitingVerification ? 'amber' : 'gray'} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="แก้ไขแล้ว" value={`${remediationPercent(items)}%`} note={`${closed} / ${items.length} รายการ`} tone="teal" />
      </div>

      {showForm && <FormModal title={editing ? 'แก้ไขช่องโหว่' : 'เพิ่มช่องโหว่'} description="บันทึกผลตรวจ แผนแก้ไข Owner และหลักฐาน" size="xl" onClose={resetForm}>{optionsQuery.isLoading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />กำลังเตรียม Asset, CI และ Owner</div> : optionsQuery.isError || !optionsQuery.data ? <div className="flex items-center justify-between p-5 text-sm text-red-700"><span>โหลดตัวเลือกสำหรับแบบฟอร์มไม่สำเร็จ</span><Button size="sm" variant="ghost" onClick={resetForm}>ปิด</Button></div> : <FindingForm finding={editing} options={optionsQuery.data} currentUserId={me?.profile.id} onClose={resetForm} />}</FormModal>}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div><p>ทะเบียนช่องโหว่</p><p className="mt-0.5 text-xs font-normal text-slate-500">เรียงตาม Severity และวันครบกำหนดเพื่อจัดลำดับการแก้ไข</p></div>
          <div className="flex flex-wrap gap-2"><select aria-label="กรอง Severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"><option value="">ทุก Severity</option>{VULNERABILITY_SEVERITIES.map((severity) => <option key={severity}>{severity}</option>)}</select><select aria-label="กรองสถานะช่องโหว่" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกสถานะ</option>{VULNERABILITY_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></div>
        </CardHeader>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center gap-2"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารหัส CVE ชื่อ Asset ระบบ หรือ Owner..." className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />{(search || severityFilter || statusFilter) && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setSeverityFilter(''); setStatusFilter(''); }}>ล้างตัวกรอง</Button>}</div>
          {findingsQuery.isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {findingsQuery.isError && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{errorText(findingsQuery.error, 'โหลดทะเบียนช่องโหว่ไม่สำเร็จ')}</div>}
          {!findingsQuery.isLoading && !findingsQuery.isError && visibleItems.length === 0 && <EmptyState icon={<ShieldCheck className="h-10 w-10" />} title="ไม่พบช่องโหว่" message="เพิ่มรายการใหม่หรือลองเปลี่ยนคำค้นหาและตัวกรอง" />}
          {visibleItems.length > 0 && <div className="overflow-x-auto"><DataTable className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="p-2">ช่องโหว่</th><th className="p-2">Severity</th><th className="p-2">Asset / CI</th><th className="p-2">Owner</th><th className="p-2">กำหนดแก้ไข</th><th className="p-2">สถานะ</th><th className="p-2 text-right">จัดการ</th></tr></thead><tbody>{visibleItems.map((finding) => {
            const expanded = expandedId === finding.id;
            const overdueItem = vulnerabilityIsOverdue(finding);
            return <Fragment key={finding.id}><tr data-testid={`vuln-row-${finding.id}`} className={`border-t border-slate-100 align-top dark:border-slate-700 ${overdueItem ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}><td className="p-2"><p className="font-semibold text-slate-800 dark:text-slate-100">{finding.title}</p><p className="font-mono text-xs text-primary-700 dark:text-primary-300">{finding.vulnerability_code}{finding.cve ? ` · ${finding.cve}` : ''}</p><p className="mt-0.5 max-w-72 truncate text-xs text-slate-400">{finding.source || 'ไม่ระบุแหล่งตรวจพบ'}</p></td><td className="p-2"><Badge variant={severityTone[finding.severity]}>{finding.severity}</Badge><p className="mt-1 text-xs font-semibold text-slate-500">CVSS {finding.cvss ?? '—'}</p></td><td className="p-2 text-slate-500"><p>{finding.asset ? `${finding.asset.asset_code} — ${finding.asset.name}` : '—'}</p>{finding.configuration_item && <p className="mt-1 font-mono text-xs text-primary-700 dark:text-primary-300">{finding.configuration_item.ci_code} · {finding.configuration_item.environment}</p>}{!finding.asset && !finding.configuration_item && finding.affected_system && <p>{finding.affected_system}</p>}</td><td className="p-2 text-slate-500"><p>{finding.owner?.full_name ?? '—'}</p><p className="text-xs text-slate-400">{finding.owner?.email}</p></td><td className="p-2 text-slate-500"><DueText finding={finding} /></td><td className="p-2"><Badge variant={statusTone[finding.status]}>{finding.status}</Badge>{finding.exception_expiry && <p className="mt-1 text-xs text-amber-600">ยกเว้นถึง {formatThaiDate(finding.exception_expiry, 'd MMM yyyy')}</p>}</td><td className="p-2"><RowActions recordLabel={finding.vulnerability_code} actions={[
                          { kind: 'view', icon: expanded ? ChevronUp : ChevronDown, label: expanded ? 'ย่อ' : 'รายละเอียด', onClick: () => setExpandedId(expanded ? null : finding.id) },
                          { kind: 'custom', icon: Activity, label: 'สถานะ', permission: 'risk.manage', onClick: () => setStatusId(statusId === finding.id ? null : finding.id) },
                          { kind: 'edit', permission: 'risk.manage', onClick: () => { setEditing(finding); setShowForm(true); } },
                          { kind: 'delete', permission: 'vulnerability.manage', deleteEndpoint: `/api/v1/record-deletions/vulnerabilities/${finding.id}` },
                        ]} />{statusId === finding.id && <StatusPanel finding={finding} currentUserId={me?.profile.id} onClose={() => setStatusId(null)} />}</td></tr>{expanded && <tr className="border-t border-slate-100 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/40"><td colSpan={7} className="p-4"><div className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><p className="font-semibold text-slate-500">รายละเอียด</p><p className="mt-1 whitespace-pre-wrap">{finding.description || '—'}</p></div><div><p className="font-semibold text-slate-500">แผนแก้ไข</p><p className="mt-1 whitespace-pre-wrap">{finding.remediation_plan || '—'}</p></div><div><p className="font-semibold text-slate-500">Patch / Fix</p><p className="mt-1">{finding.patch_reference || '—'}</p><p className="mt-1 text-slate-400">Asset patch: {finding.asset?.patch_status || '—'}{finding.asset?.patch_date ? ` · ${formatThaiDate(finding.asset.patch_date)}` : ''}</p></div><div><p className="font-semibold text-slate-500">การตรวจยืนยัน</p><p className="mt-1">{finding.verifier ? `${finding.verifier.full_name} · ${finding.verified_at ? formatThaiDate(finding.verified_at) : ''}` : 'ยังไม่ตรวจยืนยัน'}</p>{finding.evidence_link && <a href={finding.evidence_link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary-700 hover:underline">เปิดหลักฐาน <ExternalLink className="h-3 w-3" /></a>}</div><div className="sm:col-span-2"><p className="font-semibold text-slate-500">ข้อยกเว้น</p><p className="mt-1 whitespace-pre-wrap">{finding.exception_reason || '—'}</p></div><div className="sm:col-span-2"><p className="font-semibold text-slate-500">หมายเหตุ</p><p className="mt-1 whitespace-pre-wrap">{finding.notes || '—'}</p></div></div></td></tr>}</Fragment>;
          })}</tbody></DataTable></div>}
        </CardBody>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>การปิดช่องโหว่ต้องใช้หลักฐาน HTTPS และผู้ตรวจยืนยันต้องไม่ใช่ Owner ของแผนแก้ไขรายการเดียวกัน เมื่อปิดสำเร็จ ระบบจะอัปเดตสถานะ Patch ของ Asset ที่เชื่อมโยงโดยอัตโนมัติ</span></div>
    </div>
  );
}
