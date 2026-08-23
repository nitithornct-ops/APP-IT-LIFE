import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { PageTitle } from '../../components/ui/PageTitle';
import { apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  PROBLEM_PRIORITIES, PROBLEM_STATUSES,
  type KnownError, type ProblemDetail, type ProblemReferences,
} from '../../types/problems';
import { formatThaiDate } from '../../utils/date';
import { knownErrorStatusTone, priorityTone, problemStatusTone } from './problemDisplay';

const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
const values = (target: HTMLSelectElement) => Array.from(target.selectedOptions, (option) => option.value);

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs text-slate-400">{label}</p><div className="text-sm text-slate-700 dark:text-slate-200">{children}</div></div>;
}

function ManagementPanel({ detail, references }: { detail: ProblemDetail; references: ProblemReferences }) {
  const { problem } = detail;
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: problem.title, category: problem.category ?? '', affectedSystem: problem.affected_system ?? '', impact: problem.impact ?? '', rootCause: problem.root_cause ?? '', workaround: problem.workaround ?? '', permanentFix: problem.permanent_fix ?? '', ownerId: problem.owner_id ?? '', priority: problem.priority, status: problem.status, reviewDate: problem.review_date ?? '', evidenceUrl: problem.evidence_url ?? '', notes: problem.notes ?? '', incidentIds: problem.problem_incidents.map((item) => item.incident.id), ticketIds: problem.problem_tickets.map((item) => item.ticket.id) });
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/problems/${problem.id}`, { method: 'PATCH', body: JSON.stringify({ ...form, ownerId: form.ownerId || null }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['problems', problem.id] }); void queryClient.invalidateQueries({ queryKey: ['problems'] }); },
  });
  useEffect(() => setForm({ title: problem.title, category: problem.category ?? '', affectedSystem: problem.affected_system ?? '', impact: problem.impact ?? '', rootCause: problem.root_cause ?? '', workaround: problem.workaround ?? '', permanentFix: problem.permanent_fix ?? '', ownerId: problem.owner_id ?? '', priority: problem.priority, status: problem.status, reviewDate: problem.review_date ?? '', evidenceUrl: problem.evidence_url ?? '', notes: problem.notes ?? '', incidentIds: problem.problem_incidents.map((item) => item.incident.id), ticketIds: problem.problem_tickets.map((item) => item.ticket.id) }), [problem]);
  const set = (key: keyof typeof form, value: string | string[]) => setForm((current) => ({ ...current, [key]: value }));
  return <Card data-testid="problem-management-form"><CardHeader>วิเคราะห์และดำเนินการ</CardHeader><CardBody><form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }} className="grid gap-3 sm:grid-cols-3">
    <label className="text-xs font-semibold sm:col-span-2">ชื่อปัญหา<input value={form.title} onChange={(e) => set('title', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">หมวด<input value={form.category} onChange={(e) => set('category', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">ระบบ<input value={form.affectedSystem} onChange={(e) => set('affectedSystem', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Priority<select value={form.priority} onChange={(e) => set('priority', e.target.value)} className={`${fieldClass} mt-1`}>{PROBLEM_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="text-xs font-semibold">สถานะ<select data-testid="problem-manage-status" value={form.status} onChange={(e) => set('status', e.target.value)} className={`${fieldClass} mt-1`}>{PROBLEM_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="text-xs font-semibold sm:col-span-3">ผลกระทบ<textarea value={form.impact} onChange={(e) => set('impact', e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Root Cause<textarea data-testid="problem-manage-root-cause" value={form.rootCause} onChange={(e) => set('rootCause', e.target.value)} rows={4} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Workaround<textarea value={form.workaround} onChange={(e) => set('workaround', e.target.value)} rows={4} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Permanent Fix<textarea data-testid="problem-manage-permanent-fix" value={form.permanentFix} onChange={(e) => set('permanentFix', e.target.value)} rows={4} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Owner<select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่มอบหมาย —</option>{references.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name ?? item.email}</option>)}</select></label>
    <label className="text-xs font-semibold">Review date<input type="date" value={form.reviewDate} onChange={(e) => set('reviewDate', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Evidence URL<input type="url" value={form.evidenceUrl} onChange={(e) => set('evidenceUrl', e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">Incident<select multiple value={form.incidentIds} onChange={(e) => set('incidentIds', values(e.currentTarget))} className={`${fieldClass} mt-1 h-32`}>{references.incidents.map((item) => <option key={item.id} value={item.id}>{item.incident_number} — {item.title}</option>)}</select></label>
    <label className="text-xs font-semibold">Ticket<select multiple value={form.ticketIds} onChange={(e) => set('ticketIds', values(e.currentTarget))} className={`${fieldClass} mt-1 h-32`}>{references.tickets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label className="text-xs font-semibold">หมายเหตุ<textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={4} className={`${fieldClass} mt-1`} /></label>
    {mutation.error && <p className="text-sm text-red-600 sm:col-span-3">{mutation.error.message}</p>}
    <div className="sm:col-span-3"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="problem-manage-submit">บันทึกการดำเนินงาน</Button></div>
  </form></CardBody></Card>;
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
  return <div className="flex flex-col gap-4" data-testid="problem-detail-page">
    <Link to="/problems" className="flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" /> กลับไปรายการ Problem</Link>
    <div className="flex flex-wrap items-start justify-between gap-2"><PageTitle eyebrow={`บริการและกระบวนการ IT / ${problem.problem_number}`} title={<>{problem.title}</>} description={<>สร้างเมื่อ {formatThaiDate(problem.created_at, 'd MMM yyyy HH:mm')}</>} /><div className="flex gap-1"><Badge variant={priorityTone[problem.priority]}>{problem.priority}</Badge><Badge variant={problemStatusTone[problem.status]}>{problem.status}</Badge></div></div>
    <Card><CardHeader>ภาพรวม Problem</CardHeader><CardBody className="grid gap-4 sm:grid-cols-4"><Info label="หมวด">{problem.category ?? '—'}</Info><Info label="ระบบ">{problem.affected_system ?? '—'}</Info><Info label="Owner">{problem.owner?.full_name ?? problem.owner?.email ?? '—'}</Info><Info label="Review date">{problem.review_date ? formatThaiDate(problem.review_date, 'd MMM yyyy') : '—'}</Info><div className="sm:col-span-2"><Info label="ผลกระทบ"><p className="whitespace-pre-wrap">{problem.impact ?? '—'}</p></Info></div><Info label="หลักฐาน">{problem.evidence_url ? <a href={problem.evidence_url} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">เปิดหลักฐาน <ExternalLink className="inline h-3 w-3" /></a> : '—'}</Info><Info label="ปิดเมื่อ">{problem.closed_at ? formatThaiDate(problem.closed_at, 'd MMM yyyy HH:mm') : '—'}</Info></CardBody></Card>
    <div className="grid gap-4 sm:grid-cols-3"><Card><CardHeader>Root Cause</CardHeader><CardBody><p className="whitespace-pre-wrap text-sm">{problem.root_cause ?? '—'}</p></CardBody></Card><Card><CardHeader>Workaround</CardHeader><CardBody><p className="whitespace-pre-wrap text-sm">{problem.workaround ?? '—'}</p></CardBody></Card><Card><CardHeader>Permanent Fix</CardHeader><CardBody><p className="whitespace-pre-wrap text-sm">{problem.permanent_fix ?? '—'}</p></CardBody></Card></div>
    <Card><CardHeader>ความสัมพันธ์</CardHeader><CardBody className="grid gap-4 sm:grid-cols-2"><div><h3 className="mb-2 text-sm font-bold">Incidents ({problem.problem_incidents.length})</h3>{problem.problem_incidents.map(({ incident }) => <Link key={incident.id} to={`/incidents/${incident.id}`} className="block text-sm text-primary-700 hover:underline">{incident.incident_number} — {incident.title}</Link>)}</div><div><h3 className="mb-2 text-sm font-bold">Tickets ({problem.problem_tickets.length})</h3>{problem.problem_tickets.map(({ ticket }) => <Link key={ticket.id} to={`/tickets/${ticket.id}`} className="block text-sm text-primary-700 hover:underline">{ticket.title}</Link>)}</div></CardBody></Card>
    {canManage && references.data && <ManagementPanel detail={query.data} references={references.data} />}
    <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Known Errors ({knownErrors.length})</h2><Link to="/problems" className="text-sm text-primary-700 hover:underline">จัดการ Known Error</Link></div>
    {knownErrors.map((item) => <KnownErrorCard key={item.id} item={item} />)}
  </div>;
}
