import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Download, FileCheck2, Loader2, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormModal, StatusModal } from '../../components/ui/Modal';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { GovernanceDomain, GovernanceDomainData, GovernanceRecord } from '../../types/governance';
import { formatThaiDate } from '../../utils/date';
import { GOVERNANCE_DOMAINS, governanceSearchText, type GovernanceField, type GovernanceForm } from './governanceConfig';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const actionLabels: Record<string, string> = {
  'request-destruction': 'ขอทำลาย', approve: 'อนุมัติ', reject: 'ปฏิเสธ', 'confirm-destroyed': 'ยืนยันทำลายแล้ว',
  complete: 'เสร็จสิ้น', withdraw: 'ถอนความยินยอม', verify: 'ตรวจยืนยันปิด', retry: 'Retry', cancel: 'ยกเลิก',
  'retention-preview': 'Preview Retention', 'retention-apply': 'Run Retention', 'health-check': 'ตรวจสุขภาพระบบ',
};

function errorText(reason: unknown, fallback: string) { return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback; }
function statusTone(status: string): 'secondary' | 'success' | 'danger' | 'warning' {
  if (/(ปิด|เสร็จ|สอดคล้อง|อนุมัติ|ใช้งาน|completed)/i.test(status)) return 'success';
  if (/(ปฏิเสธ|ล้มเหลว|ไม่สอดคล้อง|error|dead)/i.test(status)) return 'danger';
  if (/(รอ|กำลัง|ทบทวน|pending|processing)/i.test(status)) return 'warning';
  return 'secondary';
}

function Field({ field, value, set }: { field: GovernanceField; value: string | boolean; set: (value: string | boolean) => void }) {
  if (field.type === 'checkbox') return <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700"><input type="checkbox" checked={Boolean(value)} onChange={(event) => set(event.target.checked)} />{field.label}</label>;
  if (field.type === 'select') return <label className="text-xs font-semibold">{field.label}<select required={field.required} value={String(value)} onChange={(event) => set(event.target.value)} className={fieldClass}><option value="">— เลือก —</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select></label>;
  if (field.type === 'textarea') return <label className="text-xs font-semibold sm:col-span-2">{field.label}<textarea required={field.required} rows={3} value={String(value)} onChange={(event) => set(event.target.value)} placeholder={field.placeholder} className={fieldClass} /></label>;
  return <label className="text-xs font-semibold">{field.label}<input required={field.required} type={field.type ?? 'text'} min={field.min} max={field.max} value={String(value)} onChange={(event) => set(event.target.value)} placeholder={field.placeholder} className={fieldClass} /></label>;
}

function CreateRecordForm({ domain, form, onClose }: { domain: GovernanceDomain; form: GovernanceForm; onClose: () => void }) {
  const queryClient = useQueryClient();
  const initial = Object.fromEntries(form.fields.map((field) => [field.key, field.type === 'checkbox' ? false : field.key === 'year' ? String(new Date().getFullYear()) : '']));
  const [values, setValues] = useState<Record<string, string | boolean>>(initial);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => {
        const field = form.fields.find((item) => item.key === key);
        if (field?.type === 'number' && value !== '') return [key, Number(value)];
        return [key, value];
      }));
      return apiFetch(`/api/v1/governance/${domain}/${form.entity}`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['governance', domain] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'บันทึกรายการไม่สำเร็จ')),
  });
  return <Card className="border-primary-200 dark:border-primary-900" data-testid="governance-create-form"><CardHeader className="flex items-center justify-between"><span>{form.label}</span><button aria-label="ปิดแบบฟอร์ม" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
    {form.fields.map((field) => <Field key={field.key} field={field} value={values[field.key] ?? ''} set={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />)}
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2 lg:col-span-3 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
    <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" size="sm" isLoading={mutation.isPending}>บันทึก</Button><Button size="sm" variant="ghost" onClick={onClose}>ยกเลิก</Button></div>
  </form></CardBody></Card>;
}

function GovernanceRecordCard({ domain, record }: { domain: GovernanceDomain; record: GovernanceRecord }) {
  const queryClient = useQueryClient(); const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [comment, setComment] = useState(''); const [method, setMethod] = useState(''); const [evidenceUrl, setEvidenceUrl] = useState('');
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, string> }) => apiFetch(`/api/v1/governance/${domain}/${record.entity}/${record.id}/actions/${action}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { setError(null); setPendingAction(null); setComment(''); setMethod(''); setEvidenceUrl(''); void queryClient.invalidateQueries({ queryKey: ['governance', domain] }); },
    onError: (reason) => setError(errorText(reason, 'ดำเนินการไม่สำเร็จ')),
  });
  const submitAction = () => {
    if (!pendingAction) return;
    const body: Record<string, string> = {};
    if (pendingAction === 'reject') body.comment = comment;
    if (pendingAction === 'confirm-destroyed') { body.method = method; body.evidenceUrl = evidenceUrl; }
    if (pendingAction === 'verify') body.evidenceUrl = evidenceUrl;
    mutation.mutate({ action: pendingAction, body });
  };
  const requiresComment = pendingAction === 'reject'; const requiresMethod = pendingAction === 'confirm-destroyed';
  return <Card data-testid={`governance-record-${record.id}`} className="h-full"><CardBody className="space-y-3">
    <div className="flex items-start gap-2"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" /><div className="min-w-0 flex-1"><p className="font-bold text-slate-800 dark:text-slate-100">{record.title}</p><p className="text-xs text-slate-400">{record.code} · {record.entity}</p></div><Badge variant={statusTone(record.status)}>{record.status}</Badge></div>
    {record.subtitle && <p className="text-sm text-slate-500">{record.subtitle}</p>}
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">{record.details.slice(0, 8).map((detail) => <div key={detail.label}><dt className="text-slate-400">{detail.label}</dt><dd className="break-words font-medium text-slate-700 dark:text-slate-200">{detail.value === null || detail.value === '' ? '—' : typeof detail.value === 'boolean' ? (detail.value ? 'ใช่' : 'ไม่ใช่') : String(detail.value)}</dd></div>)}</dl>
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">{record.owner && <span className="text-xs text-slate-400">Owner: {record.owner}</span>}{record.due_date && <span className="text-xs text-slate-400">Due: {formatThaiDate(record.due_date, 'd MMM yyyy')}</span>}{record.score !== null && record.score !== undefined && <Badge variant={record.score >= 16 ? 'danger' : record.score >= 10 ? 'warning' : 'success'}>Score {record.score}</Badge>}<div className="ml-auto flex flex-wrap gap-1">{record.actions?.map((action) => <Button key={action} size="sm" variant={action === 'reject' || action === 'cancel' ? 'danger' : 'outline'} disabled={mutation.isPending} onClick={() => setPendingAction(action)}>{actionLabels[action] ?? action}</Button>)}</div></div>
    {error && <p className="text-sm text-red-600">{error}</p>}
    {pendingAction && <StatusModal title={actionLabels[pendingAction] ?? pendingAction} description={`${record.code} — ${record.title}`} closeDisabled={mutation.isPending} onClose={() => setPendingAction(null)} footer={<><Button variant="outline" disabled={mutation.isPending} onClick={() => setPendingAction(null)}>ยกเลิก</Button><Button variant={pendingAction === 'reject' || pendingAction === 'cancel' || pendingAction === 'retention-apply' ? 'danger' : 'primary'} isLoading={mutation.isPending} disabled={(requiresComment && !comment.trim()) || (requiresMethod && !method.trim())} onClick={submitAction}>ยืนยันดำเนินการ</Button></>}><div className="space-y-3 p-5">{requiresComment && <label className="block text-sm font-semibold">เหตุผลที่ปฏิเสธ<textarea data-autofocus rows={4} value={comment} onChange={(event) => setComment(event.target.value)} className={fieldClass} /></label>}{requiresMethod && <label className="block text-sm font-semibold">วิธีทำลายข้อมูล<input data-autofocus value={method} onChange={(event) => setMethod(event.target.value)} className={fieldClass} /></label>}{(requiresMethod || pendingAction === 'verify') && <label className="block text-sm font-semibold">Evidence URL (HTTPS)<input type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} className={fieldClass} /></label>}{!requiresComment && !requiresMethod && pendingAction !== 'verify' && <p className="text-sm text-slate-600 dark:text-slate-300">ยืนยันดำเนินการ “{actionLabels[pendingAction] ?? pendingAction}” กับรายการนี้ การเปลี่ยนแปลงจะถูกบันทึกใน Audit Log</p>}{pendingAction === 'retention-apply' && <p className="text-xs font-semibold text-red-600">ระบบจะรัน Retention จริงตามรายการ Preview ล่าสุด</p>}{error && <p className="text-sm text-red-600">{error}</p>}</div></StatusModal>}
  </CardBody></Card>;
}

export function GovernancePage() {
  const { hasPermission } = useAuth();
  const available = useMemo(() => GOVERNANCE_DOMAINS.filter((domain) => hasPermission(domain.viewPermission)), [hasPermission]);
  const [domain, setDomain] = useState<GovernanceDomain>(() => available[0]?.domain ?? 'data-classification');
  const [search, setSearch] = useState(''); const [form, setForm] = useState<GovernanceForm>();
  useEffect(() => { if (!available.some((item) => item.domain === domain) && available[0]) setDomain(available[0].domain); }, [available, domain]);
  const config = GOVERNANCE_DOMAINS.find((item) => item.domain === domain) ?? GOVERNANCE_DOMAINS[0];
  const query = useQuery({ queryKey: ['governance', domain], queryFn: () => apiFetch<GovernanceDomainData>(`/api/v1/governance/${domain}`), enabled: available.length > 0 });
  const records = useMemo(() => (query.data?.records ?? []).filter((record) => !search.trim() || governanceSearchText(record).includes(search.trim().toLocaleLowerCase('th'))), [query.data?.records, search]);
  const exportMutation = useMutation({ mutationFn: () => apiFetch<{ filename: string; csv: string }>(`/api/v1/governance/${domain}/exports/csv`, { method: 'POST' }), onSuccess: ({ filename, csv }) => { const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); } });
  if (!available.length) return <EmptyState icon={<ShieldCheck className="h-10 w-10" />} title="ไม่มีสิทธิ์เข้าถึง Governance Center" />;
  return <div className="space-y-5" data-testid="governance-page">
    <div><h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Governance, Risk & Compliance Center</h1><p className="mt-1 text-sm text-slate-500">ISMS · PDPA · Legal Compliance · Audit · Operational Governance</p></div>
    <div className="flex gap-2 overflow-x-auto pb-1">{available.map((item) => <button key={item.domain} onClick={() => { setDomain(item.domain); setForm(undefined); setSearch(''); }} className={`whitespace-nowrap rounded-full border px-3 py-2 text-xs font-semibold ${domain === item.domain ? 'border-primary-700 bg-primary-700 text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{item.shortLabel}</button>)}</div>
    <Card><CardBody className="flex flex-wrap items-start gap-3"><div className="min-w-[240px] flex-1"><h2 className="font-bold">{config.label}</h2><p className="mt-1 text-sm text-slate-500">{config.description}</p></div>{domain === 'evidence' && hasPermission('evidence.export') && <Button size="sm" variant="outline" isLoading={exportMutation.isPending} onClick={() => exportMutation.mutate()}><Download className="h-4 w-4" />Export CSV</Button>}{config.forms.filter((item) => query.data?.canManage || (domain === 'awareness' && item.entity === 'acknowledgements' && query.data?.canAct)).map((item) => <Button key={item.entity} size="sm" variant="outline" onClick={() => setForm(item)}><Plus className="h-4 w-4" />{item.label}</Button>)}<Button size="sm" variant="ghost" onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />รีเฟรช</Button></CardBody></Card>
    {(domain === 'evidence' || domain === 'documents') && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Field Designer และ PDF Designer แบบลากวางถูกเลื่อนไปหลัง Go-live ตามมติ Owner; metadata, CSV export และโครงสร้างรองรับ template version ยังคงอยู่ครบ</div>}
    {form && <FormModal title={form.label} description={config.label} size="xl" onClose={() => setForm(undefined)}><CreateRecordForm key={`${domain}-${form.entity}`} domain={domain} form={form} onClose={() => setForm(undefined)} /></FormModal>}
    {query.isLoading && <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>}
    {query.isError && <EmptyState icon={<Activity className="h-10 w-10" />} title="โหลดข้อมูล Governance ไม่สำเร็จ" message={errorText(query.error, 'กรุณาลองใหม่')} />}
    {query.data && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{query.data.metrics.map((metric) => <StatCard key={metric.label} icon={<ShieldCheck className="h-5 w-5" />} label={metric.label} value={metric.value} tone={metric.tone ?? 'gray'} />)}</div><Card><CardBody className="flex items-center gap-2"><Search className="h-4 w-4 text-slate-400" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารหัส ชื่อ สถานะ หรือรายละเอียด..." className="w-full bg-transparent text-sm outline-none" /><span className="whitespace-nowrap text-xs text-slate-400">{records.length} รายการ</span></CardBody></Card>{records.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{records.map((record) => <GovernanceRecordCard key={`${record.entity}-${record.id}`} domain={domain} record={record} />)}</div> : <EmptyState icon={<Search className="h-10 w-10" />} title="ยังไม่มีรายการในส่วนนี้" />}</>}
  </div>;
}
