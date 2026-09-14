import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Loader2, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FormModal } from '../../components/ui/Modal';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { TaskRecurrence, TaskTemplate } from '../../types/tasks';
import { TASK_RECURRENCES } from './taskDisplay';

const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';

function todayDate() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function TaskTemplatesPanel({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [recurrence, setRecurrence] = useState<TaskRecurrence>('รายเดือน');
  const [dueOffsetDays, setDueOffsetDays] = useState('0');
  const [estimateHours, setEstimateHours] = useState('');
  const [checklist, setChecklist] = useState('');
  const [applyDate, setApplyDate] = useState(todayDate);
  const [error, setError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['task-templates'],
    queryFn: () => apiFetch<TaskTemplate[]>('/api/v1/tasks/templates'),
  });

  const createMutation = useMutation({
    mutationFn: () => apiFetch<TaskTemplate>('/api/v1/tasks/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        title: title.trim(),
        taskType: 'general',
        category: 'งานทั่วไป',
        priority: 'ปกติ',
        recurrence,
        dueOffsetDays: Number(dueOffsetDays || 0),
        estimateHours: estimateHours === '' ? undefined : Number(estimateHours),
        checklist: checklist.split('\n').map((item) => item.trim()).filter(Boolean),
      }),
    }),
    onSuccess: () => {
      setName('');
      setTitle('');
      setEstimateHours('');
      setChecklist('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['task-templates'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'สร้าง Template ไม่สำเร็จ'),
  });

  const applyMutation = useMutation({
    mutationFn: (template: TaskTemplate) => apiFetch<{ id: string }>(`/api/v1/tasks/templates/${template.id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ startDate: applyDate, status: 'ต้องทำ' }),
    }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
      onApplied();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'สร้างงานจาก Template ไม่สำเร็จ'),
  });

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => apiFetch(`/api/v1/tasks/templates/${templateId}`, { method: 'DELETE' }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['task-templates'] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'ลบ Template ไม่สำเร็จ'),
  });

  const canCreate = name.trim().length > 0 && title.trim().length > 0 && !createMutation.isPending;

  return (
    <FormModal title="Template งานประจำ" description="บันทึกงานที่ทำซ้ำ แล้วสร้างเป็น Task ใหม่ได้ในคลิกเดียว" icon={<FilePlus2 className="h-5 w-5" />} onClose={onClose} testId="task-templates-panel" closeTestId="task-templates-close">
      <div className="flex flex-col gap-5">
        <section className="rounded-xl border border-primary-100 bg-primary-50/50 p-4 dark:border-primary-900 dark:bg-primary-950/20">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">สร้าง Template ใหม่</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อ Template
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น ตรวจ Backup ทุกเดือน" className={`${inputClass} mt-1`} maxLength={150} />
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อ Task ที่จะสร้าง
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="เช่น ตรวจสอบ Backup ประจำเดือน" className={`${inputClass} mt-1`} maxLength={300} />
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">รอบการทำซ้ำ
              <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as TaskRecurrence)} className={`${inputClass} mt-1`}>
                {TASK_RECURRENCES.filter((item) => item !== 'ไม่ทำซ้ำ' && item !== 'กำหนดเอง').map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ครบกำหนดหลังเริ่ม (วัน)
              <input type="number" min={0} max={3650} value={dueOffsetDays} onChange={(event) => setDueOffsetDays(event.target.value)} className={`${inputClass} mt-1`} />
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Estimate Hours
              <input type="number" min={0} max={999999.99} step={0.25} value={estimateHours} onChange={(event) => setEstimateHours(event.target.value)} className={`${inputClass} mt-1`} />
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">Checklist (หนึ่งรายการต่อหนึ่งบรรทัด)
              <textarea rows={3} value={checklist} onChange={(event) => setChecklist(event.target.value)} placeholder="ตรวจผลสำรองข้อมูล\nบันทึกผลการตรวจ" className={`${inputClass} mt-1`} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => createMutation.mutate()} isLoading={createMutation.isPending} disabled={!canCreate}>บันทึก Template</Button>
            {createMutation.isSuccess && <span className="text-xs text-emerald-700 dark:text-emerald-300">บันทึกแล้ว</span>}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Template ของฉัน</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">เลือกวันที่เริ่ม แล้วกดสร้าง Task ได้ทันที</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่เริ่ม
              <input type="date" value={applyDate} onChange={(event) => setApplyDate(event.target.value)} className={`${inputClass} w-auto`} />
            </label>
          </div>
          {templatesQuery.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
          {templatesQuery.isError && <p role="alert" className="mt-3 text-sm text-red-600">โหลด Template ไม่สำเร็จ</p>}
          {!templatesQuery.isLoading && (templatesQuery.data ?? []).length === 0 && <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">ยังไม่มี Template งานประจำ</p>}
          <ul className="mt-3 flex flex-col gap-2">
            {(templatesQuery.data ?? []).map((template) => (
              <li key={template.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-800 dark:text-slate-100">{template.name}</span><Badge variant="secondary">{template.recurrence}</Badge></div>
                  <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{template.title} · ครบกำหนด +{template.due_offset_days} วัน{template.estimate_hours !== null ? ` · ${template.estimate_hours} ชั่วโมง` : ''}</p>
                  {template.checklist.length > 0 && <p className="mt-1 text-[11px] text-slate-400">Checklist {template.checklist.length} รายการ</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" onClick={() => applyMutation.mutate(template)} isLoading={applyMutation.isPending && applyMutation.variables?.id === template.id} disabled={applyMutation.isPending || !applyDate}><Play className="h-3.5 w-3.5" /> สร้าง Task</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => deleteMutation.mutate(template.id)} disabled={deleteMutation.isPending || applyMutation.isPending} aria-label={`ลบ Template ${template.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    </FormModal>
  );
}
