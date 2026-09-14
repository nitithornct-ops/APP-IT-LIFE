import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Task, TaskContextOption, TaskRecordType } from '../../types/tasks';

const recordTypeLabels: Record<TaskRecordType, string> = {
  incident: 'Incident',
  change: 'Change',
  asset: 'Asset',
  contract: 'Contract',
  risk: 'Risk',
};

const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';

function useTaskExtensionInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
  };
}

export function TaskDependenciesSection({ task }: { task: Task }) {
  const invalidate = useTaskExtensionInvalidation();
  const [dependsOnTaskId, setDependsOnTaskId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tasksQuery = useQuery({
    queryKey: ['tasks', 'dependency-options'],
    queryFn: () => apiFetch<Task[]>('/api/v1/tasks'),
  });
  const addMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnTaskId, note: note.trim() || undefined }),
    }),
    onSuccess: () => {
      setDependsOnTaskId('');
      setNote('');
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'เพิ่ม dependency ไม่สำเร็จ'),
  });
  const removeMutation = useMutation({
    mutationFn: (dependencyId: string) => apiFetch(`/api/v1/tasks/dependencies/${dependencyId}`, { method: 'DELETE' }),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'ลบ dependency ไม่สำเร็จ'),
  });

  const existingIds = new Set(task.dependencies.map((item) => item.depends_on_task_id));
  const options = (tasksQuery.data ?? []).filter((item) => item.id !== task.id && !existingIds.has(item.id));
  const hasOpenDependency = task.dependencies.some((item) => item.depends_on_task && item.depends_on_task.status !== 'เสร็จแล้ว');

  return (
    <section className="flex flex-col gap-2" aria-label="งานที่ต้องทำก่อน">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Link2 className="h-4 w-4 text-primary-600" /> งานที่ต้องทำก่อน</h3>
        {hasOpenDependency && <Badge variant="warning">ติด dependency</Badge>}
      </div>
      {task.dependencies.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {task.dependencies.map((dependency) => (
            <li key={dependency.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-700 dark:text-slate-200">
                  {dependency.depends_on_task?.task_no ?? 'Task'} — {dependency.depends_on_task?.title ?? dependency.depends_on_task_id}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-slate-500 dark:text-slate-400">
                  <span>{dependency.depends_on_task?.status ?? 'ไม่ทราบสถานะ'}</span>
                  {dependency.note && <span>· {dependency.note}</span>}
                </div>
              </div>
              <button type="button" title="ลบ dependency" aria-label="ลบ dependency" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(dependency.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30">
                {removeMutation.isPending && removeMutation.variables === dependency.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">ยังไม่มีงานที่ต้องรอให้เสร็จก่อน</p>
      )}
      <form onSubmit={(event) => { event.preventDefault(); if (dependsOnTaskId) addMutation.mutate(); }} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)_auto]">
        <select aria-label="เลือกงานที่ต้องทำก่อน" value={dependsOnTaskId} onChange={(event) => setDependsOnTaskId(event.target.value)} className={inputClass}>
          <option value="">เลือก Task ที่ต้องเสร็จก่อน</option>
          {options.map((item) => <option key={item.id} value={item.id}>{item.task_no} — {item.title}</option>)}
        </select>
        <input aria-label="หมายเหตุ dependency" placeholder="หมายเหตุ (ไม่บังคับ)" value={note} onChange={(event) => setNote(event.target.value)} className={inputClass} maxLength={500} />
        <Button type="submit" size="sm" variant="outline" isLoading={addMutation.isPending} disabled={!dependsOnTaskId || addMutation.isPending}><Plus className="h-3.5 w-3.5" /> เพิ่ม</Button>
      </form>
      {tasksQuery.isError && <p className="text-xs text-amber-700 dark:text-amber-300">โหลดรายการ Task สำหรับเชื่อม dependency ไม่สำเร็จ</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </section>
  );
}

export function TaskRelationsSection({ task }: { task: Task }) {
  const invalidate = useTaskExtensionInvalidation();
  const [recordType, setRecordType] = useState<TaskRecordType>('incident');
  const [recordId, setRecordId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const optionsQuery = useQuery({
    queryKey: ['task-context-options', recordType],
    queryFn: () => apiFetch<TaskContextOption[]>(`/api/v1/tasks/context-options?type=${recordType}`),
  });
  const addMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/relations`, { method: 'POST', body: JSON.stringify({ recordType, recordId }) }),
    onSuccess: () => { setRecordId(''); setError(null); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'เชื่อมโยงรายการไม่สำเร็จ'),
  });
  const removeMutation = useMutation({
    mutationFn: (relationId: string) => apiFetch(`/api/v1/tasks/relations/${relationId}`, { method: 'DELETE' }),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'ยกเลิกการเชื่อมโยงไม่สำเร็จ'),
  });
  const existingIds = new Set(task.relations.filter((item) => item.record_type === recordType).map((item) => item.record_id));
  const options = (optionsQuery.data ?? []).filter((item) => !existingIds.has(item.id));

  return (
    <section className="flex flex-col gap-2" aria-label="รายการที่เชื่อมโยง">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Link2 className="h-4 w-4 text-primary-600" /> เชื่อมกับรายการระบบ</h3>
      {task.relations.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {task.relations.map((relation) => (
            <li key={relation.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
              <div className="min-w-0 flex-1"><Badge variant="secondary">{recordTypeLabels[relation.record_type]}</Badge><span className="ml-2 font-semibold text-slate-700 dark:text-slate-200">{relation.record_code}</span><span className="ml-2 truncate text-slate-500">{relation.record_title}</span></div>
              <button type="button" title="ยกเลิกการเชื่อมโยง" aria-label="ยกเลิกการเชื่อมโยง" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(relation.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30">
                {removeMutation.isPending && removeMutation.variables === relation.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">เชื่อม Incident, Change, Asset, Contract หรือ Risk ได้จากที่นี่</p>
      )}
      <form onSubmit={(event) => { event.preventDefault(); if (recordId) addMutation.mutate(); }} className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_auto]">
        <select aria-label="ประเภทข้อมูลที่เชื่อมโยง" value={recordType} onChange={(event) => { setRecordType(event.target.value as TaskRecordType); setRecordId(''); }} className={inputClass}>
          {(Object.keys(recordTypeLabels) as TaskRecordType[]).map((value) => <option key={value} value={value}>{recordTypeLabels[value]}</option>)}
        </select>
        <select aria-label="เลือกรายการที่เชื่อมโยง" value={recordId} onChange={(event) => setRecordId(event.target.value)} className={inputClass}>
          <option value="">เลือกรายการ</option>
          {options.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.title}</option>)}
        </select>
        <Button type="submit" size="sm" variant="outline" isLoading={addMutation.isPending} disabled={!recordId || addMutation.isPending}><Plus className="h-3.5 w-3.5" /> เพิ่ม</Button>
      </form>
      {optionsQuery.isLoading && <p className="text-xs text-slate-400">กำลังโหลดรายการ...</p>}
      {optionsQuery.isError && <p className="text-xs text-amber-700 dark:text-amber-300">โหลดรายการสำหรับเชื่อมโยงไม่สำเร็จ</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </section>
  );
}
