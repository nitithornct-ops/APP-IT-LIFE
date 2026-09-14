import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SearchableMultiSelect } from '../../components/forms/SearchableMultiSelect';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  CORRECTIVE_ACTION_STATUSES,
  PROBLEM_PRIORITIES,
  PROBLEM_STATUSES,
  RCA_METHODS,
  type CorrectiveAction,
  type KnownError,
  type Problem,
  type ProblemDetail,
  type ProblemReferences,
} from '../../types/problems';
import { formatThaiDate } from '../../utils/date';
import { knownErrorStatusTone, priorityTone, problemStatusTone } from './problemDisplay';

const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
const textAreaClass = `${fieldClass} min-h-20`;

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyFiveWhy() {
  return Array.from({ length: 5 }, (_, index) => ({ question: `Why ${index + 1}`, answer: '' }));
}

function emptyFishbone() {
  return { people: '', process: '', technology: '', environment: '', materials: '', measurement: '' };
}

function problemFormValues(problem: Problem) {
  return {
    title: problem.title,
    category: problem.category ?? '',
    affectedSystem: problem.affected_system ?? '',
    impact: problem.impact ?? '',
    rootCause: problem.root_cause ?? '',
    workaround: problem.workaround ?? '',
    permanentFix: problem.permanent_fix ?? '',
    rcaMethod: problem.rca_method ?? '5 Why',
    fiveWhy: problem.five_why?.length ? problem.five_why : emptyFiveWhy(),
    fishbone: { ...emptyFishbone(), ...(problem.fishbone ?? {}) },
    ownerId: problem.owner_id ?? '',
    priority: problem.priority,
    status: problem.status,
    reviewDate: problem.review_date ?? '',
    reviewMeetingAt: toDateTimeLocal(problem.review_meeting_at),
    reviewMeetingOwnerId: problem.review_meeting_owner_id ?? '',
    reviewMeetingNotes: problem.review_meeting_notes ?? '',
    recurrenceCount: problem.recurrence_count ?? 0,
    evidenceUrl: problem.evidence_url ?? '',
    notes: problem.notes ?? '',
    incidentIds: problem.problem_incidents.map((item) => item.incident.id),
    ticketIds: problem.problem_tickets.map((item) => item.ticket.id),
    configurationItemIds: problem.problem_configuration_items?.map((item) => item.configuration_item.id) ?? [],
    changeIds: problem.problem_changes?.map((item) => item.change.id) ?? [],
  };
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="text-xs text-slate-400">{label}</p><div className="text-sm text-slate-700 dark:text-slate-200">{children}</div></div>;
}

function ManagementPanel({ detail, references }: { detail: ProblemDetail; references: ProblemReferences }) {
  const { problem } = detail;
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => problemFormValues(problem));
  const [verificationNotes, setVerificationNotes] = useState(problem.change_verification_notes ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<Problem>(`/api/v1/problems/${problem.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...form, ownerId: form.ownerId || null, reviewMeetingAt: form.reviewMeetingAt ? new Date(form.reviewMeetingAt).toISOString() : '', reviewMeetingOwnerId: form.reviewMeetingOwnerId || null }),
    }),
    onSuccess: () => { setLocalError(null); void queryClient.invalidateQueries({ queryKey: ['problems', problem.id] }); void queryClient.invalidateQueries({ queryKey: ['problems'] }); },
    onError: (reason) => setLocalError(reason instanceof ApiError ? reason.message : 'บันทึกการดำเนินงานไม่สำเร็จ'),
  });
  const verifyMutation = useMutation({
    mutationFn: () => apiFetch<Problem>(`/api/v1/problems/${problem.id}/verify-after-change`, { method: 'POST', body: JSON.stringify({ notes: verificationNotes }) }),
    onSuccess: () => { setLocalError(null); void queryClient.invalidateQueries({ queryKey: ['problems', problem.id] }); void queryClient.invalidateQueries({ queryKey: ['problems'] }); },
    onError: (reason) => setLocalError(reason instanceof ApiError ? reason.message : 'Verify หลัง Change ไม่สำเร็จ'),
  });
  useEffect(() => { setForm(problemFormValues(problem)); setVerificationNotes(problem.change_verification_notes ?? ''); }, [problem]);
  const set = (key: keyof typeof form, value: string | number | string[]) => setForm((current) => ({ ...current, [key]: value }));
  const hasDeployedChange = (problem.problem_changes ?? []).some(({ change }) => change.status === 'ติดตั้งใช้งานแล้ว');

  const submit = () => {
    setLocalError(null);
    if (form.permanentFix.trim() && !form.changeIds.length) { setLocalError('Permanent Fix ต้องผูกกับ Change อย่างน้อย 1 รายการ'); return; }
    if (form.status === 'ปิด' && !problem.change_verified_at) { setLocalError('ต้อง Verify หลัง Change สำเร็จก่อนปิด Problem'); return; }
    mutation.mutate();
  };

  return <Card data-testid="problem-management-form"><CardHeader>วิเคราะห์และดำเนินการ</CardHeader><CardBody><form onSubmit={(event) => { event.preventDefault(); submit(); }} className="grid gap-3 sm:grid-cols-3">
    <label className="text-xs font-semibold sm:col-span-2">ชื่อปัญหา<input value={form.title} onChange={(e) => set('title', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">หมวด<input value={form.category} onChange={(e) => set('category', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">ระบบ<input value={form.affectedSystem} onChange={(e) => set('affectedSystem', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Priority<select value={form.priority} onChange={(e) => set('priority', e.target.value)} className={`${fieldClass} mt-1`}>{PROBLEM_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="text-xs font-semibold">สถานะ<select data-testid="problem-manage-status" value={form.status} onChange={(e) => set('status', e.target.value)} className={`${fieldClass} mt-1`}>{PROBLEM_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="text-xs font-semibold sm:col-span-3">ผลกระทบ<textarea value={form.impact} onChange={(e) => set('impact', e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Root Cause<textarea data-testid="problem-manage-root-cause" value={form.rootCause} onChange={(e) => set('rootCause', e.target.value)} rows={4} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Workaround<textarea value={form.workaround} onChange={(e) => set('workaround', e.target.value)} rows={4} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Permanent Fix<textarea data-testid="problem-manage-permanent-fix" value={form.permanentFix} onChange={(e) => set('permanentFix', e.target.value)} rows={4} className={`${fieldClass} mt-1`} /></label>

    <div className="sm:col-span-3 rounded-xl border border-primary-100 bg-primary-50/50 p-4 dark:border-primary-900/50 dark:bg-primary-950/20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold">RCA Template</p><p className="text-xs text-slate-500">5 Why หรือ Fishbone พร้อมเก็บเป็นหลักฐาน RCA</p></div><select value={form.rcaMethod} onChange={(e) => set('rcaMethod', e.target.value)} className={fieldClass}>{RCA_METHODS.map((method) => <option key={method}>{method}</option>)}</select></div>
      {form.rcaMethod === '5 Why' && <div className="grid gap-2 sm:grid-cols-2">{form.fiveWhy.map((step, index) => <label key={step.question} className="text-xs font-semibold">{step.question}<input value={step.answer} onChange={(e) => setForm((current) => ({ ...current, fiveWhy: current.fiveWhy.map((item, itemIndex) => itemIndex === index ? { ...item, answer: e.target.value } : item) }))} className={`${fieldClass} mt-1`} /></label>)}</div>}
      {form.rcaMethod === 'Fishbone' && <div className="grid gap-2 sm:grid-cols-3">{(['people', 'process', 'technology', 'environment', 'materials', 'measurement'] as const).map((key) => <label key={key} className="text-xs font-semibold">{key}<textarea rows={2} value={form.fishbone[key]} onChange={(e) => setForm((current) => ({ ...current, fishbone: { ...current.fishbone, [key]: e.target.value } }))} className={`${textAreaClass} mt-1`} /></label>)}</div>}
    </div>

    <SearchableMultiSelect label="Incidents ที่เกี่ยวข้อง" options={references.incidents.map((item) => ({ id: item.id, label: `${item.incident_number} — ${item.title}`, description: item.status }))} value={form.incidentIds} onChange={(value) => set('incidentIds', value)} className="sm:col-span-2" />
    <SearchableMultiSelect label="Tickets ที่เกี่ยวข้อง" options={references.tickets.map((item) => ({ id: item.id, label: item.title, description: item.status }))} value={form.ticketIds} onChange={(value) => set('ticketIds', value)} className="sm:col-span-2" />
    <SearchableMultiSelect label="Linked CI" options={references.configurationItems.map((item) => ({ id: item.id, label: `${item.ci_code} — ${item.name}`, description: `${item.ci_type} · ${item.status}` }))} value={form.configurationItemIds} onChange={(value) => set('configurationItemIds', value)} className="sm:col-span-2" />
    <SearchableMultiSelect label="Change ที่ผูกกับ Permanent Fix" options={references.changes.map((item) => ({ id: item.id, label: `${item.change_number} — ${item.title}`, description: `${item.status}${item.version ? ` · v${item.version}` : ''}` }))} value={form.changeIds} onChange={(value) => set('changeIds', value)} className="sm:col-span-2" />

    <label className="text-xs font-semibold">Owner<select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่มอบหมาย —</option>{references.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name ?? item.email}</option>)}</select></label>
    <label className="text-xs font-semibold">Recurrence Count<input type="number" min={0} max={100000} value={form.recurrenceCount} onChange={(e) => set('recurrenceCount', Math.max(0, Number(e.target.value) || 0))} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Review date<input type="date" value={form.reviewDate} onChange={(e) => set('reviewDate', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Problem Review Meeting<input type="datetime-local" value={form.reviewMeetingAt} onChange={(e) => set('reviewMeetingAt', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Meeting Owner<select value={form.reviewMeetingOwnerId} onChange={(e) => set('reviewMeetingOwnerId', e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่ระบุ —</option>{references.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name ?? item.email}</option>)}</select></label>
    <label className="text-xs font-semibold sm:col-span-2">Meeting Notes<textarea value={form.reviewMeetingNotes} onChange={(e) => set('reviewMeetingNotes', e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Evidence URL<input type="url" value={form.evidenceUrl} onChange={(e) => set('evidenceUrl', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold sm:col-span-3">หมายเหตุ<textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className={`${fieldClass} mt-1`} /></label>

    <div className="sm:col-span-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20"><div className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4" />Verify หลัง Change สำเร็จ</div>{problem.change_verified_at ? <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">ยืนยันแล้ว {formatThaiDate(problem.change_verified_at, 'd MMM yyyy HH:mm')} โดย {problem.change_verifier?.full_name ?? problem.change_verifier?.email ?? 'ผู้ตรวจสอบ'} · {problem.change_verification_notes}</p> : <><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">ต้องมี Change สถานะ “ติดตั้งใช้งานแล้ว” ก่อนจึงจะยืนยันและปิด Problem ได้</p><textarea value={verificationNotes} onChange={(e) => setVerificationNotes(e.target.value)} rows={2} placeholder="ผลการทดสอบหลัง Change และหลักฐานที่ตรวจพบ" className={`${fieldClass} mt-2`} /><Button type="button" size="sm" className="mt-2" disabled={!hasDeployedChange || !verificationNotes.trim()} isLoading={verifyMutation.isPending} onClick={() => verifyMutation.mutate()} data-testid="problem-verify-after-change"><CheckCircle2 className="h-4 w-4" />Verify หลัง Change</Button></>}</div>
    {localError && <p className="text-sm text-red-600 sm:col-span-3" role="alert">{localError}</p>}
    <div className="sm:col-span-3"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="problem-manage-submit">บันทึกการดำเนินงาน</Button></div>
  </form></CardBody></Card>;
}

function CorrectiveActionsPanel({ problem, references, canManage }: { problem: Problem; references?: ProblemReferences; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: '', description: '', ownerId: '', dueDate: '' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const addMutation = useMutation({
    mutationFn: () => apiFetch<CorrectiveAction>(`/api/v1/problems/${problem.id}/corrective-actions`, { method: 'POST', body: JSON.stringify({ ...form, ownerId: form.ownerId || null, dueDate: form.dueDate || '', status: 'เปิด' }) }),
    onSuccess: () => { setForm({ title: '', description: '', ownerId: '', dueDate: '' }); setError(null); void queryClient.invalidateQueries({ queryKey: ['problems', problem.id] }); },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'เพิ่ม Corrective Action ไม่สำเร็จ'),
  });
  const statusMutation = useMutation({
    mutationFn: ({ action, status }: { action: CorrectiveAction; status: string }) => apiFetch<CorrectiveAction>(`/api/v1/problems/corrective-actions/${action.id}`, { method: 'PATCH', body: JSON.stringify({ status, verificationNotes: status === 'เสร็จสิ้น' ? notes[action.id] ?? '' : action.verification_notes ?? '' }) }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['problems', problem.id] }); },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'อัปเดต Corrective Action ไม่สำเร็จ'),
  });
  const actions = problem.corrective_actions ?? [];
  return <Card data-testid="problem-corrective-actions"><CardHeader className="flex flex-wrap items-center justify-between gap-2"><span>Child Corrective Actions ({actions.length})</span><span className="text-xs font-normal text-slate-500">ติดตามงานป้องกันการเกิดซ้ำ</span></CardHeader><CardBody className="space-y-3">
    {actions.length === 0 && <p className="text-sm text-slate-500">ยังไม่มี Corrective Action</p>}
    {actions.map((action) => <div key={action.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{action.title}</p><p className="text-xs text-slate-500">{action.description || 'ไม่มีรายละเอียด'} · Owner: {action.owner?.full_name ?? action.owner?.email ?? '—'} · Due: {action.due_date ?? '—'}</p></div><Badge variant={action.status === 'เสร็จสิ้น' ? 'success' : action.status === 'ยกเลิก' ? 'secondary' : 'warning'}>{action.status}</Badge></div>{canManage && <div className="mt-2 flex flex-wrap items-end gap-2"><label className="min-w-56 flex-1 text-xs font-semibold">ผล Verify เมื่อเสร็จ<input value={notes[action.id] ?? action.verification_notes ?? ''} onChange={(e) => setNotes((current) => ({ ...current, [action.id]: e.target.value }))} className={`${fieldClass} mt-1`} /></label><select value={action.status} onChange={(e) => statusMutation.mutate({ action, status: e.target.value })} className={`${fieldClass} w-auto min-w-40`} disabled={statusMutation.isPending}>{CORRECTIVE_ACTION_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></div>}</div>)}
    {canManage && <form className="grid gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); if (!form.title.trim()) { setError('กรุณาระบุ Corrective Action'); return; } addMutation.mutate(); }}><input value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} placeholder="เพิ่ม Corrective Action..." maxLength={200} className={fieldClass} /><input value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} placeholder="รายละเอียด" maxLength={1500} className={fieldClass} /><select value={form.ownerId} onChange={(e) => setForm((current) => ({ ...current, ownerId: e.target.value }))} className={fieldClass}><option value="">Owner</option>{references?.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name ?? item.email}</option>)}</select><div className="flex gap-2"><input type="date" value={form.dueDate} onChange={(e) => setForm((current) => ({ ...current, dueDate: e.target.value }))} className={fieldClass} /><Button type="submit" size="sm" isLoading={addMutation.isPending}>เพิ่ม</Button></div></form>}
    {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
  </CardBody></Card>;
}

function KnownErrorCard({ item }: { item: KnownError }) {
  return <Card><CardHeader className="flex items-center justify-between"><span>{item.known_error_number} — {item.title}</span><Badge variant={knownErrorStatusTone[item.status]}>{item.status}</Badge></CardHeader><CardBody className="grid gap-3 sm:grid-cols-3"><Info label="อาการ"><p className="whitespace-pre-wrap">{item.symptoms ?? '—'}</p></Info><Info label="Root Cause"><p className="whitespace-pre-wrap">{item.root_cause ?? '—'}</p></Info><Info label="Workaround"><p className="whitespace-pre-wrap font-medium text-amber-800 dark:text-amber-200">{item.workaround}</p></Info><Info label="Affected / Fixed version">{item.affected_versions ?? '—'} / {item.fixed_version ?? '—'}</Info><Info label="KB Reference">{item.knowledge_article_ref ? <Link to="/knowledge" className="text-primary-700 hover:underline">{item.knowledge_article_ref}</Link> : '—'}</Info><Info label="Review date">{item.review_date ? formatThaiDate(item.review_date, 'd MMM yyyy') : '—'}</Info></CardBody></Card>;
}

export function ProblemDetailPage() {
  const { id = '' } = useParams();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('problem.manage');
  const query = useQuery({ queryKey: ['problems', id], queryFn: () => apiFetch<ProblemDetail>(`/api/v1/problems/${id}`), enabled: Boolean(id) });
  const references = useQuery({ queryKey: ['problems', 'references'], queryFn: () => apiFetch<ProblemReferences>('/api/v1/problems/references'), enabled: canManage });
  if (query.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!query.data) return <p className="text-sm text-red-600">ไม่พบ Problem</p>;
  const { problem, knownErrors } = query.data;
  const linkedChanges = problem.problem_changes ?? [];
  return <div className="flex flex-col gap-4" data-testid="problem-detail-page">
    <Link to="/problems" className="flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" /> กลับไปรายการ Problem</Link>
    <div className="flex flex-wrap items-start justify-between gap-2"><PageTitle eyebrow={`บริการและกระบวนการ IT / ${problem.problem_number}`} title={<>{problem.title}</>} description={<>สร้างเมื่อ {formatThaiDate(problem.created_at, 'd MMM yyyy HH:mm')}</>} /><div className="flex gap-1"><Badge variant={priorityTone[problem.priority]}>{problem.priority}</Badge><Badge variant={problemStatusTone[problem.status]}>{problem.status}</Badge></div></div>
    <Card><CardHeader>ภาพรวม Problem</CardHeader><CardBody className="grid gap-4 sm:grid-cols-4"><Info label="หมวด">{problem.category ?? '—'}</Info><Info label="ระบบ">{problem.affected_system ?? '—'}</Info><Info label="Owner">{problem.owner?.full_name ?? problem.owner?.email ?? '—'}</Info><Info label="Recurrence Count"><span className={problem.recurrence_count ? 'font-bold text-amber-700 dark:text-amber-300' : ''}>{problem.recurrence_count}</span></Info><div className="sm:col-span-2"><Info label="ผลกระทบ"><p className="whitespace-pre-wrap">{problem.impact ?? '—'}</p></Info></div><Info label="Review date">{problem.review_date ? formatThaiDate(problem.review_date, 'd MMM yyyy') : '—'}</Info><Info label="Review Meeting">{problem.review_meeting_at ? `${formatThaiDate(problem.review_meeting_at, 'd MMM yyyy HH:mm')} · ${problem.review_meeting_owner?.full_name ?? problem.review_meeting_owner?.email ?? '—'}` : '—'}</Info><Info label="หลักฐาน">{problem.evidence_url ? <a href={problem.evidence_url} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">เปิดหลักฐาน <ExternalLink className="inline h-3 w-3" /></a> : '—'}</Info><Info label="ปิดเมื่อ">{problem.closed_at ? formatThaiDate(problem.closed_at, 'd MMM yyyy HH:mm') : '—'}</Info></CardBody></Card>
    <div className="grid gap-4 sm:grid-cols-3"><Card><CardHeader>Root Cause</CardHeader><CardBody><p className="whitespace-pre-wrap text-sm">{problem.root_cause ?? '—'}</p></CardBody></Card><Card><CardHeader>Workaround</CardHeader><CardBody><p className="whitespace-pre-wrap text-sm">{problem.workaround ?? '—'}</p></CardBody></Card><Card><CardHeader>Permanent Fix / Change</CardHeader><CardBody><p className="whitespace-pre-wrap text-sm">{problem.permanent_fix ?? '—'}</p>{linkedChanges.map(({ change }) => <Link key={change.id} to={`/changes/${change.id}`} className="mt-2 block text-xs text-primary-700 hover:underline dark:text-primary-300">{change.change_number} · {change.status}</Link>)}</CardBody></Card></div>
    <Card><CardHeader>RCA Template: {problem.rca_method}</CardHeader><CardBody>{problem.rca_method === '5 Why' ? <div className="grid gap-3 sm:grid-cols-2">{(problem.five_why ?? []).map((step) => <Info key={step.question} label={step.question}>{step.answer || '—'}</Info>)}</div> : problem.rca_method === 'Fishbone' ? <div className="grid gap-3 sm:grid-cols-3">{Object.entries(problem.fishbone ?? {}).map(([key, value]) => <Info key={key} label={key}>{String(value || '—')}</Info>)}</div> : <p className="text-sm text-slate-500">ใช้ RCA แบบ Other — ดูรายละเอียดใน Root Cause</p>}</CardBody></Card>
    <Card><CardHeader>ความสัมพันธ์</CardHeader><CardBody className="grid gap-4 sm:grid-cols-3"><div><h3 className="mb-2 text-sm font-bold">Incidents ({problem.problem_incidents.length})</h3>{problem.problem_incidents.map(({ incident }) => <Link key={incident.id} to={`/incidents/${incident.id}`} className="block text-sm text-primary-700 hover:underline">{incident.incident_number} — {incident.title}</Link>)}</div><div><h3 className="mb-2 text-sm font-bold">Tickets ({problem.problem_tickets.length})</h3>{problem.problem_tickets.map(({ ticket }) => <Link key={ticket.id} to={`/tickets/${ticket.id}`} className="block text-sm text-primary-700 hover:underline">{ticket.title}</Link>)}</div><div><h3 className="mb-2 text-sm font-bold">Linked CI ({problem.problem_configuration_items?.length ?? 0})</h3>{(problem.problem_configuration_items ?? []).map(({ configuration_item }) => <Link key={configuration_item.id} to={`/cmdb/${configuration_item.id}`} className="block text-sm text-primary-700 hover:underline">{configuration_item.ci_code} — {configuration_item.name}</Link>)}</div></CardBody></Card>
    {canManage && references.data && <ManagementPanel detail={query.data} references={references.data} />}
    <CorrectiveActionsPanel problem={problem} references={references.data} canManage={canManage} />
    <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Known Errors ({knownErrors.length})</h2><Link to="/problems" className="text-sm text-primary-700 hover:underline">จัดการ Known Error</Link></div>
    {knownErrors.map((item) => <KnownErrorCard key={item.id} item={item} />)}
  </div>;
}
