import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, BookOpenCheck, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import {
  KNOWN_ERROR_STATUSES, PROBLEM_PRIORITIES, PROBLEM_STATUSES,
  type KnownError, type Problem, type ProblemReferences,
} from '../../types/problems';
import { formatThaiDate } from '../../utils/date';
import { knownErrorStatusTone, priorityTone, problemStatusTone } from './problemDisplay';

const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
const selectedValues = (target: HTMLSelectElement) => Array.from(target.selectedOptions, (option) => option.value);

function CreateProblemForm({ references, onClose }: { references: ProblemReferences; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: '', category: '', affectedSystem: '', impact: '', rootCause: '', workaround: '', permanentFix: '', ownerId: '', priority: 'ปานกลาง', status: 'เปิด', reviewDate: '', evidenceUrl: '', notes: '', incidentIds: [] as string[], ticketIds: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<Problem>('/api/v1/problems', { method: 'POST', body: JSON.stringify({ ...form, ownerId: form.ownerId || null }) }),
    onSuccess: (data) => { void queryClient.invalidateQueries({ queryKey: ['problems'] }); void navigate(`/problems/${data.id}`); },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'สร้าง Problem ไม่สำเร็จ'),
  });
  const set = (key: keyof typeof form, value: string | string[]) => setForm((current) => ({ ...current, [key]: value }));
  return <Card data-testid="problem-create-form"><CardHeader className="flex items-center justify-between"><span>เพิ่ม Problem</span><button onClick={onClose} aria-label="ปิด"><X className="h-4 w-4" /></button></CardHeader><CardBody>
    <form onSubmit={(event) => { event.preventDefault(); if (!form.title.trim()) { setError('กรุณากรอกชื่อปัญหา'); return; } mutation.mutate(); }} className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs font-semibold sm:col-span-2">ชื่อปัญหา<input data-testid="problem-create-title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">หมวด<input value={form.category} onChange={(e) => set('category', e.target.value)} maxLength={100} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">ระบบที่ได้รับผลกระทบ<input value={form.affectedSystem} onChange={(e) => set('affectedSystem', e.target.value)} maxLength={200} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">Priority<select data-testid="problem-create-priority" value={form.priority} onChange={(e) => set('priority', e.target.value)} className={`${fieldClass} mt-1`}>{PROBLEM_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-semibold">Owner<select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่มอบหมาย —</option>{references.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name ?? item.email}</option>)}</select></label>
      <label className="text-xs font-semibold sm:col-span-3">ผลกระทบ<textarea value={form.impact} onChange={(e) => set('impact', e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">Root Cause<textarea value={form.rootCause} onChange={(e) => set('rootCause', e.target.value)} rows={3} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">Workaround<textarea value={form.workaround} onChange={(e) => set('workaround', e.target.value)} rows={3} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">Permanent Fix<textarea value={form.permanentFix} onChange={(e) => set('permanentFix', e.target.value)} rows={3} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">เชื่อม Incident<select multiple data-testid="problem-create-incidents" value={form.incidentIds} onChange={(e) => set('incidentIds', selectedValues(e.currentTarget))} className={`${fieldClass} mt-1 h-28`}>{references.incidents.map((item) => <option key={item.id} value={item.id}>{item.incident_number} — {item.title}</option>)}</select></label>
      <label className="text-xs font-semibold">เชื่อม Ticket<select multiple data-testid="problem-create-tickets" value={form.ticketIds} onChange={(e) => set('ticketIds', selectedValues(e.currentTarget))} className={`${fieldClass} mt-1 h-28`}>{references.tickets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="grid gap-3"><label className="text-xs font-semibold">Review date<input type="date" value={form.reviewDate} onChange={(e) => set('reviewDate', e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">HTTPS Evidence URL<input type="url" value={form.evidenceUrl} onChange={(e) => set('evidenceUrl', e.target.value)} className={`${fieldClass} mt-1`} /></label></div>
      {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
      <div className="sm:col-span-3"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="problem-create-submit">สร้าง Problem</Button></div>
    </form>
  </CardBody></Card>;
}

function CreateKnownErrorForm({ references, onClose }: { references: ProblemReferences; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ problemId: '', title: '', symptoms: '', rootCause: '', workaround: '', affectedVersions: '', fixedVersion: '', knowledgeArticleRef: '', status: 'เผยแพร่', reviewDate: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<KnownError>('/api/v1/problems/known-errors', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['known-errors'] }); void queryClient.invalidateQueries({ queryKey: ['problems'] }); onClose(); },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'สร้าง Known Error ไม่สำเร็จ'),
  });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <Card data-testid="known-error-create-form"><CardHeader className="flex items-center justify-between"><span>เพิ่ม Known Error</span><button onClick={onClose} aria-label="ปิด"><X className="h-4 w-4" /></button></CardHeader><CardBody>
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }} className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs font-semibold">Problem<select required data-testid="known-error-problem" value={form.problemId} onChange={(e) => set('problemId', e.target.value)} className={`${fieldClass} mt-1`}><option value="">— เลือก Problem —</option>{references.problems.map((item) => <option key={item.id} value={item.id}>{item.problem_number} — {item.title}</option>)}</select></label>
      <label className="text-xs font-semibold sm:col-span-2">ชื่อ Known Error<input required data-testid="known-error-title" value={form.title} onChange={(e) => set('title', e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">อาการ<textarea value={form.symptoms} onChange={(e) => set('symptoms', e.target.value)} rows={3} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">Root Cause<textarea value={form.rootCause} onChange={(e) => set('rootCause', e.target.value)} rows={3} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">Workaround<textarea required data-testid="known-error-workaround" value={form.workaround} onChange={(e) => set('workaround', e.target.value)} rows={3} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">Affected versions<input value={form.affectedVersions} onChange={(e) => set('affectedVersions', e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">Fixed version<input value={form.fixedVersion} onChange={(e) => set('fixedVersion', e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold">บทความฐานความรู้<select value={form.knowledgeArticleRef} onChange={(e) => set('knowledgeArticleRef', e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ไม่เชื่อมบทความ —</option>{references.knowledgeArticles.map((item) => <option key={item.id} value={item.article_code}>{item.article_code} — {item.title}</option>)}</select></label>
      <label className="text-xs font-semibold">สถานะ<select value={form.status} onChange={(e) => set('status', e.target.value)} className={`${fieldClass} mt-1`}>{KNOWN_ERROR_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-semibold">Review date<input type="date" value={form.reviewDate} onChange={(e) => set('reviewDate', e.target.value)} className={`${fieldClass} mt-1`} /></label>
      {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
      <div className="sm:col-span-3"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="known-error-create-submit">บันทึก Known Error</Button></div>
    </form>
  </CardBody></Card>;
}

export function ProblemsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('problem.manage');
  const [problemForm, setProblemForm] = useState(false);
  const [knownForm, setKnownForm] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const references = useQuery({ queryKey: ['problems', 'references'], queryFn: () => apiFetch<ProblemReferences>('/api/v1/problems/references'), enabled: canManage });
  const problems = useQuery({ queryKey: ['problems', debouncedSearch, status, priority], queryFn: () => apiFetch<PaginatedResult<Problem>>(`/api/v1/problems?page=1&pageSize=100${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}${priority ? `&priority=${encodeURIComponent(priority)}` : ''}`) });
  const knownErrors = useQuery({ queryKey: ['known-errors'], queryFn: () => apiFetch<PaginatedResult<KnownError>>('/api/v1/problems/known-errors?page=1&pageSize=100') });
  const items = problems.data?.items ?? [];
  const knownItems = knownErrors.data?.items ?? [];
  return <div className="flex flex-col gap-4" data-testid="problems-page">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-xl font-bold">Problem / Known Error</h1><p className="text-sm text-slate-500">RCA · Workaround · Permanent Fix · เชื่อม Ticket/Incident/KB</p></div><RequirePermission permission="problem.manage"><div className="flex gap-2"><Button size="sm" onClick={() => setProblemForm((value) => !value)} data-testid="problem-create-toggle"><Plus className="h-4 w-4" /> Problem</Button><Button size="sm" variant="outline" onClick={() => setKnownForm((value) => !value)} data-testid="known-error-create-toggle"><Plus className="h-4 w-4" /> Known Error</Button></div></RequirePermission></div>
    {problemForm && references.data && <CreateProblemForm references={references.data} onClose={() => setProblemForm(false)} />}
    {knownForm && references.data && <CreateKnownErrorForm references={references.data} onClose={() => setKnownForm(false)} />}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><StatCard icon={<Bug className="h-5 w-5" />} label="Problem ทั้งหมด" value={problems.data?.pagination.totalItems ?? 0} tone="primary" /><StatCard icon={<Bug className="h-5 w-5" />} label="ยังเปิด" value={items.filter((item) => item.status !== 'ปิด').length} tone="amber" /><StatCard icon={<BookOpenCheck className="h-5 w-5" />} label="Known Error" value={knownErrors.data?.pagination.totalItems ?? 0} tone="gray" /></div>
    <Card><CardHeader className="flex flex-wrap items-center justify-between gap-2"><span>Problems</span><div className="flex gap-2 text-xs font-normal"><select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border px-3 py-1 dark:bg-slate-900"><option value="">ทุกสถานะ</option>{PROBLEM_STATUSES.map((value) => <option key={value}>{value}</option>)}</select><select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-full border px-3 py-1 dark:bg-slate-900"><option value="">ทุก Priority</option>{PROBLEM_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></div></CardHeader><CardBody>
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาเลข Problem ชื่อ หรือระบบ..." className={`${fieldClass} mb-3 max-w-sm`} />
      {problems.isLoading && <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin" />}{problems.data && !items.length && <EmptyState icon={<Bug className="h-10 w-10" />} title="ยังไม่มี Problem" />}
      {!!items.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="p-2">เลขที่</th><th className="p-2">ปัญหา</th><th className="p-2">เชื่อมโยง</th><th className="p-2">Owner</th><th className="p-2">Priority</th><th className="p-2">สถานะ</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t"><td className="p-2"><Link to={`/problems/${item.id}`} className="font-mono text-xs text-primary-700 hover:underline">{item.problem_number}</Link><p className="text-xs text-slate-400">{formatThaiDate(item.created_at, 'd MMM yyyy')}</p></td><td className="p-2"><Link to={`/problems/${item.id}`} className="font-semibold hover:underline">{item.title}</Link><p className="text-xs text-slate-400">{item.affected_system ?? '—'}</p></td><td className="p-2 text-xs">Incident {item.problem_incidents.length} · Ticket {item.problem_tickets.length}</td><td className="p-2 text-slate-500">{item.owner?.full_name ?? '—'}</td><td className="p-2"><Badge variant={priorityTone[item.priority]}>{item.priority}</Badge></td><td className="p-2"><Badge variant={problemStatusTone[item.status]}>{item.status}</Badge></td></tr>)}</tbody></table></div>}
    </CardBody></Card>
    <Card><CardHeader>Known Error Database</CardHeader><CardBody>{knownErrors.isLoading && <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin" />}{knownErrors.data && !knownItems.length && <EmptyState icon={<BookOpenCheck className="h-10 w-10" />} title="ยังไม่มี Known Error" />}{!!knownItems.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="p-2">เลขที่</th><th className="p-2">Problem</th><th className="p-2">Known Error / อาการ</th><th className="p-2">Workaround</th><th className="p-2">KB</th><th className="p-2">สถานะ</th></tr></thead><tbody>{knownItems.map((item) => <tr key={item.id} data-testid={`known-error-row-${item.id}`} className="border-t"><td className="p-2 font-mono text-xs">{item.known_error_number}</td><td className="p-2"><Link to={`/problems/${item.problem_id}`} className="text-primary-700 hover:underline">{item.problem?.problem_number}</Link></td><td className="p-2"><b>{item.title}</b><p className="text-xs text-slate-500">{item.symptoms ?? '—'}</p></td><td className="max-w-sm whitespace-pre-wrap p-2 text-xs">{item.workaround}</td><td className="p-2 text-xs">{item.knowledge_article_ref ? <Link to="/knowledge" className="text-primary-700 hover:underline">{item.knowledge_article_ref}</Link> : '—'}</td><td className="p-2"><Badge variant={knownErrorStatusTone[item.status]}>{item.status}</Badge></td></tr>)}</tbody></table></div>}</CardBody></Card>
  </div>;
}
