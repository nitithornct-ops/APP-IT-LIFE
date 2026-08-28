import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, Bug, Hourglass, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/ui/Card';
import { PageTitle } from '../../components/ui/PageTitle';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import {
  KNOWN_ERROR_STATUSES,
  PROBLEM_PRIORITIES,
  PROBLEM_STATUSES,
  type KnownError,
  type Problem,
  type ProblemReferences,
} from '../../types/problems';
import { formatThaiDate } from '../../utils/date';
import { knownErrorStatusTone, priorityTone, problemStatusTone } from './problemDisplay';

const fieldClass = 'mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/40';
const textAreaClass = `${fieldClass} h-auto min-h-[88px] py-2`;
const labelClass = 'block text-[13px] font-semibold text-slate-700 dark:text-slate-200';

function commaSeparatedValues(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function resolveIncidentIds(value: string, references: ProblemReferences): string[] {
  return commaSeparatedValues(value).map((token) => {
    const match = references.incidents.find((item) => item.id === token || item.incident_number.toLocaleLowerCase() === token.toLocaleLowerCase());
    return match?.id ?? token;
  });
}

function resolveTicketIds(value: string, references: ProblemReferences): string[] {
  return commaSeparatedValues(value).map((token) => {
    const match = references.tickets.find((item) => item.id === token || item.title.toLocaleLowerCase() === token.toLocaleLowerCase());
    return match?.id ?? token;
  });
}

function RequiredMark() {
  return <span className="text-red-500" aria-hidden="true"> *</span>;
}

function FormError({ message }: { message: string | null }) {
  return message ? <p className="text-sm text-red-600 dark:text-red-400" role="alert">{message}</p> : null;
}

function CreateProblemForm({ references, onClose }: { references: ProblemReferences; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    category: '',
    affectedSystem: '',
    incidentIdsText: '',
    ticketIdsText: '',
    impact: '',
    rootCause: '',
    workaround: '',
    permanentFix: '',
    ownerId: '',
    priority: 'ปานกลาง',
    status: 'เปิด',
  });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<Problem>('/api/v1/problems', {
      method: 'POST',
      body: JSON.stringify({
        title: form.title,
        category: form.category,
        affectedSystem: form.affectedSystem,
        impact: form.impact,
        rootCause: form.rootCause,
        workaround: form.workaround,
        permanentFix: form.permanentFix,
        ownerId: form.ownerId || null,
        priority: form.priority,
        status: form.status,
        incidentIds: resolveIncidentIds(form.incidentIdsText, references),
        ticketIds: resolveTicketIds(form.ticketIdsText, references),
      }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['problems'] });
      void queryClient.invalidateQueries({ queryKey: ['known-errors'] });
      onClose();
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'สร้าง Problem ไม่สำเร็จ'),
  });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <form
      id="create-problem-form"
      data-testid="problem-create-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!form.title.trim()) {
          setError('กรุณากรอกชื่อปัญหา');
          return;
        }
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 p-5 sm:grid-cols-4">
        <label className={`${labelClass} sm:col-span-2`}>
          ชื่อปัญหา<RequiredMark />
          <input data-autofocus data-testid="problem-create-title" value={form.title} onChange={(event) => set('title', event.target.value)} maxLength={200} className={fieldClass} />
        </label>
        <label className={labelClass}>
          หมวด
          <input value={form.category} onChange={(event) => set('category', event.target.value)} maxLength={100} className={fieldClass} />
        </label>
        <label className={labelClass}>
          ระบบ
          <input value={form.affectedSystem} onChange={(event) => set('affectedSystem', event.target.value)} maxLength={200} className={fieldClass} />
        </label>

        <label className={`${labelClass} sm:col-span-2`}>
          Incident IDs (คั่น comma)
          <input value={form.incidentIdsText} onChange={(event) => set('incidentIdsText', event.target.value)} placeholder="เช่น INC-001, INC-002" className={fieldClass} list="problem-incident-options" />
          <datalist id="problem-incident-options">{references.incidents.map((item) => <option key={item.id} value={item.incident_number}>{item.title}</option>)}</datalist>
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Ticket IDs (คั่น comma)
          <input value={form.ticketIdsText} onChange={(event) => set('ticketIdsText', event.target.value)} placeholder="UUID หรือชื่อ Ticket" className={fieldClass} list="problem-ticket-options" />
          <datalist id="problem-ticket-options">{references.tickets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</datalist>
        </label>

        <label className={`${labelClass} sm:col-span-2`}>
          ผลกระทบ
          <textarea value={form.impact} onChange={(event) => set('impact', event.target.value)} rows={3} maxLength={1000} className={textAreaClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Root Cause
          <textarea value={form.rootCause} onChange={(event) => set('rootCause', event.target.value)} rows={3} maxLength={1500} className={textAreaClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Workaround
          <textarea value={form.workaround} onChange={(event) => set('workaround', event.target.value)} rows={3} maxLength={1500} className={textAreaClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Permanent Fix
          <textarea value={form.permanentFix} onChange={(event) => set('permanentFix', event.target.value)} rows={3} maxLength={1500} className={textAreaClass} />
        </label>

        <label className={labelClass}>
          Owner
          <select value={form.ownerId} onChange={(event) => set('ownerId', event.target.value)} className={fieldClass}>
            <option value="">ยังไม่มอบหมาย</option>
            {references.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name ?? item.email}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Priority
          <select data-testid="problem-create-priority" value={form.priority} onChange={(event) => set('priority', event.target.value)} className={fieldClass}>
            {PROBLEM_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          สถานะ
          <select value={form.status} onChange={(event) => set('status', event.target.value)} className={fieldClass}>
            {PROBLEM_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="sm:col-span-4"><FormError message={error} /></div>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/50">
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" isLoading={mutation.isPending} data-testid="problem-create-submit">บันทึก</Button>
      </div>
    </form>
  );
}

function CreateKnownErrorForm({ references, onClose }: { references: ProblemReferences; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    problemId: '',
    title: '',
    symptoms: '',
    rootCause: '',
    workaround: '',
    knowledgeArticleRef: '',
    affectedVersions: '',
    fixedVersion: '',
    status: 'เผยแพร่',
  });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<KnownError>('/api/v1/problems/known-errors', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['known-errors'] });
      void queryClient.invalidateQueries({ queryKey: ['problems'] });
      onClose();
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'สร้าง Known Error ไม่สำเร็จ'),
  });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <form
      id="create-known-error-form"
      data-testid="known-error-create-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!form.problemId) {
          setError('กรุณาเลือก Problem');
          return;
        }
        if (!form.title.trim()) {
          setError('กรุณากรอกชื่อ Known Error');
          return;
        }
        if (!form.workaround.trim()) {
          setError('กรุณากรอก Workaround');
          return;
        }
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 p-5 sm:grid-cols-4">
        <label className={labelClass}>
          Problem ID<RequiredMark />
          <select data-autofocus required data-testid="known-error-problem" value={form.problemId} onChange={(event) => set('problemId', event.target.value)} className={fieldClass}>
            <option value="">เลือก Problem</option>
            {references.problems.map((item) => <option key={item.id} value={item.id}>{item.problem_number} — {item.title}</option>)}
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-3`}>
          ชื่อ Known Error<RequiredMark />
          <input required data-testid="known-error-title" value={form.title} onChange={(event) => set('title', event.target.value)} maxLength={200} className={fieldClass} />
        </label>

        <label className={`${labelClass} sm:col-span-2`}>
          อาการ
          <textarea value={form.symptoms} onChange={(event) => set('symptoms', event.target.value)} rows={3} maxLength={1500} className={textAreaClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Root Cause
          <textarea value={form.rootCause} onChange={(event) => set('rootCause', event.target.value)} rows={3} maxLength={1500} className={textAreaClass} />
        </label>

        <label className={`${labelClass} sm:col-span-3`}>
          Workaround<RequiredMark />
          <textarea required data-testid="known-error-workaround" value={form.workaround} onChange={(event) => set('workaround', event.target.value)} rows={3} maxLength={1500} className={textAreaClass} />
        </label>
        <label className={labelClass}>
          KB Article ID
          <select value={form.knowledgeArticleRef} onChange={(event) => set('knowledgeArticleRef', event.target.value)} className={fieldClass}>
            <option value="">ไม่เชื่อมบทความ</option>
            {references.knowledgeArticles.map((item) => <option key={item.id} value={item.article_code}>{item.article_code} — {item.title}</option>)}
          </select>
        </label>

        <label className={labelClass}>
          Affected versions
          <input value={form.affectedVersions} onChange={(event) => set('affectedVersions', event.target.value)} maxLength={500} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Fixed version
          <input value={form.fixedVersion} onChange={(event) => set('fixedVersion', event.target.value)} maxLength={200} className={fieldClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          สถานะ
          <select value={form.status} onChange={(event) => set('status', event.target.value)} className={fieldClass}>
            {KNOWN_ERROR_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="sm:col-span-4"><FormError message={error} /></div>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/50">
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" isLoading={mutation.isPending} data-testid="known-error-create-submit">บันทึก</Button>
      </div>
    </form>
  );
}

function ReferencesState({ isError, onRetry }: { isError: boolean; onRetry: () => void }) {
  if (isError) {
    return <div className="flex min-h-44 flex-col items-center justify-center gap-3 p-5 text-sm text-red-600"><p>โหลดข้อมูลสำหรับแบบฟอร์มไม่สำเร็จ</p><Button type="button" size="sm" variant="outline" onClick={onRetry}>ลองใหม่</Button></div>;
  }
  return <div className="flex min-h-44 items-center justify-center gap-2 p-5 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" />กำลังเตรียมแบบฟอร์ม</div>;
}

function CompactEmpty({ children }: { children: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-card dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">{children}</div>;
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
  const references = useQuery({
    queryKey: ['problems', 'references'],
    queryFn: () => apiFetch<ProblemReferences>('/api/v1/problems/references'),
    enabled: canManage && (problemForm || knownForm),
  });
  const problems = useQuery({
    queryKey: ['problems', debouncedSearch, status, priority],
    queryFn: () => apiFetch<PaginatedResult<Problem>>(`/api/v1/problems?page=1&pageSize=100${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}${priority ? `&priority=${encodeURIComponent(priority)}` : ''}`),
  });
  const knownErrors = useQuery({
    queryKey: ['known-errors'],
    queryFn: () => apiFetch<PaginatedResult<KnownError>>('/api/v1/problems/known-errors?page=1&pageSize=100'),
  });
  const items = problems.data?.items ?? [];
  const knownItems = knownErrors.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5" data-testid="problems-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle eyebrow="บริการและกระบวนการ IT / Problem" title="Problem / Known Error" description="RCA · Workaround · Permanent fix · เชื่อม Ticket/Incident/KB" />
        <RequirePermission permission="problem.manage">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setKnownForm(false); setProblemForm(true); }} data-testid="problem-create-toggle"><Plus className="h-4 w-4" /> เพิ่ม Problem</Button>
            <Button size="sm" variant="outline" onClick={() => { setProblemForm(false); setKnownForm(true); }} data-testid="known-error-create-toggle"><Plus className="h-4 w-4" /> เพิ่ม Known Error</Button>
          </div>
        </RequirePermission>
      </div>

      {problemForm && (
        <FormModal title="เพิ่ม Problem" size="lg" closeDisabled={false} onClose={() => setProblemForm(false)}>
          {references.data
            ? <CreateProblemForm references={references.data} onClose={() => setProblemForm(false)} />
            : <ReferencesState isError={references.isError} onRetry={() => { void references.refetch(); }} />}
        </FormModal>
      )}
      {knownForm && (
        <FormModal title="เพิ่ม Known Error" size="lg" closeDisabled={false} onClose={() => setKnownForm(false)}>
          {references.data
            ? <CreateKnownErrorForm references={references.data} onClose={() => setKnownForm(false)} />
            : <ReferencesState isError={references.isError} onRetry={() => { void references.refetch(); }} />}
        </FormModal>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard icon={<Bug className="h-5 w-5" />} label="Problem" value={problems.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<Hourglass className="h-5 w-5" />} label="ยังเปิด" value={items.filter((item) => item.status !== 'ปิด').length} tone="amber" />
        <StatCard icon={<BookMarked className="h-5 w-5" />} label="Known Error" value={knownErrors.data?.pagination.totalItems ?? 0} tone="teal" />
      </div>

      <section aria-labelledby="problems-heading">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="problems-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">Problems</h2>
          {(items.length > 0 || search || status || priority) && (
            <div className="flex flex-wrap gap-2 text-xs">
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา Problem..." className="h-9 rounded-full border border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-900" />
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-full border border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกสถานะ</option>{PROBLEM_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-9 rounded-full border border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-900"><option value="">ทุก Priority</option>{PROBLEM_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </div>
          )}
        </div>
        {problems.isLoading && <div className="flex justify-center py-8" role="status"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {problems.data && items.length === 0 && <CompactEmpty>ยังไม่มี Problem</CompactEmpty>}
        {items.length > 0 && (
          <DataTable itemLabel="Problem">
            <thead><tr><th>เลขที่</th><th>ปัญหา</th><th>เชื่อมโยง</th><th>Owner</th><th>Priority</th><th>สถานะ</th><th className="text-right">ดำเนินการ</th></tr></thead>
            <tbody>{items.map((item) => (
              <tr key={item.id}>
                <td><Link to={`/problems/${item.id}`} className="font-mono text-xs text-primary-700 hover:underline dark:text-primary-300">{item.problem_number}</Link><p className="text-xs text-slate-400">{formatThaiDate(item.created_at, 'd MMM yyyy')}</p></td>
                <td><Link to={`/problems/${item.id}`} className="font-semibold hover:underline">{item.title}</Link><p className="text-xs text-slate-400">{item.affected_system ?? '—'}</p></td>
                <td className="text-xs">Incident {item.problem_incidents.length} · Ticket {item.problem_tickets.length}</td>
                <td className="text-slate-500">{item.owner?.full_name ?? '—'}</td>
                <td><Badge variant={priorityTone[item.priority]}>{item.priority}</Badge></td>
                <td><Badge variant={problemStatusTone[item.status]}>{item.status}</Badge></td>
                <td className="text-right"><RowActions recordLabel={item.problem_number} actions={[{ kind: 'view', to: `/problems/${item.id}` }, { kind: 'delete', permission: 'problem.manage', deleteEndpoint: `/api/v1/record-deletions/problems/${item.id}` }]} /></td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
      </section>

      <section aria-labelledby="known-errors-heading">
        <h2 id="known-errors-heading" className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">Known Error Database</h2>
        {knownErrors.isLoading && <div className="flex justify-center py-8" role="status"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {knownErrors.data && knownItems.length === 0 && <CompactEmpty>ยังไม่มี Known Error</CompactEmpty>}
        {knownItems.length > 0 && (
          <DataTable itemLabel="Known Error">
            <thead><tr><th>เลขที่</th><th>Problem</th><th>Known Error / อาการ</th><th>Workaround</th><th>KB</th><th>สถานะ</th><th className="text-right">ดำเนินการ</th></tr></thead>
            <tbody>{knownItems.map((item) => (
              <tr key={item.id} data-testid={`known-error-row-${item.id}`}>
                <td className="font-mono text-xs">{item.known_error_number}</td>
                <td><Link to={`/problems/${item.problem_id}`} className="text-primary-700 hover:underline dark:text-primary-300">{item.problem?.problem_number}</Link></td>
                <td><b>{item.title}</b><p className="text-xs text-slate-500">{item.symptoms ?? '—'}</p></td>
                <td className="max-w-sm whitespace-pre-wrap text-xs">{item.workaround}</td>
                <td className="text-xs">{item.knowledge_article_ref ? <Link to="/knowledge" className="text-primary-700 hover:underline dark:text-primary-300">{item.knowledge_article_ref}</Link> : '—'}</td>
                <td><Badge variant={knownErrorStatusTone[item.status]}>{item.status}</Badge></td>
                <td className="text-right"><RowActions recordLabel={item.known_error_number} actions={[{ kind: 'view', to: `/problems/${item.problem_id}`, label: 'ดู Problem' }, { kind: 'delete', permission: 'problem.manage', deleteEndpoint: `/api/v1/record-deletions/known-errors/${item.id}` }]} /></td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}
