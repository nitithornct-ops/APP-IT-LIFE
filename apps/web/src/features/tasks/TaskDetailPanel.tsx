import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Task } from '../../types/tasks';
import { formatThaiDate } from '../../utils/date';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES, priorityTone, statusTone } from './taskDisplay';

const categoryEnum = z.enum(['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ']);
const priorityEnum = z.enum(['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน']);
const statusEnum = z.enum(['ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก']);
const recurrenceEnum = z.enum(['ไม่ทำซ้ำ', 'รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส', 'รายปี']);

const editSchema = z
  .object({
    title: z.string().trim().min(1, 'กรุณาระบุชื่องาน'),
    description: z.string().trim().optional(),
    category: categoryEnum,
    priority: priorityEnum,
    status: statusEnum,
    startDate: z.string().optional(),
    dueDate: z.string().optional(),
    progress: z.coerce.number().min(0).max(100).optional(),
    tags: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    recurrence: recurrenceEnum,
    recurrenceEndDate: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
      ctx.addIssue({ code: 'custom', message: 'วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม', path: ['dueDate'] });
    }
  });
type EditForm = z.infer<typeof editSchema>;

function labelCls() {
  return 'mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300';
}
function inputCls() {
  return 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
}

function EditTaskForm({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      title: task.title,
      description: task.description ?? '',
      category: task.category,
      priority: task.priority,
      status: task.status,
      startDate: task.start_date ?? '',
      dueDate: task.due_date ?? '',
      progress: task.progress,
      tags: task.tags ?? '',
      notes: task.notes ?? '',
      recurrence: task.recurrence,
      recurrenceEndDate: task.recurrence_end_date ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: EditForm) => apiFetch(`/api/v1/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => {
      setServerError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'บันทึกการแก้ไขไม่สำเร็จ'),
  });

  return (
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <label htmlFor="td-title" className={labelCls()}>
          ชื่องาน
        </label>
        <input id="td-title" className={inputCls()} {...register('title')} />
        {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="td-description" className={labelCls()}>
          รายละเอียด
        </label>
        <textarea id="td-description" rows={2} className={inputCls()} {...register('description')} />
      </div>

      <div>
        <label htmlFor="td-category" className={labelCls()}>
          ประเภท
        </label>
        <select id="td-category" className={inputCls()} {...register('category')}>
          {TASK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="td-priority" className={labelCls()}>
          ความสำคัญ
        </label>
        <select id="td-priority" className={inputCls()} {...register('priority')}>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="td-status" className={labelCls()}>
          สถานะ
        </label>
        <select id="td-status" className={inputCls()} {...register('status')}>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="td-progress" className={labelCls()}>
          ความคืบหน้า (%)
        </label>
        <input id="td-progress" type="number" min={0} max={100} className={inputCls()} {...register('progress')} />
      </div>

      <div>
        <label htmlFor="td-start" className={labelCls()}>
          วันที่เริ่ม
        </label>
        <input id="td-start" type="date" className={inputCls()} {...register('startDate')} />
      </div>

      <div>
        <label htmlFor="td-due" className={labelCls()}>
          วันครบกำหนด
        </label>
        <input id="td-due" type="date" className={inputCls()} {...register('dueDate')} />
        {errors.dueDate && <p className="mt-1 text-xs text-red-600">{errors.dueDate.message}</p>}
      </div>

      <div>
        <label htmlFor="td-recurrence" className={labelCls()}>
          ทำซ้ำ
        </label>
        <select id="td-recurrence" className={inputCls()} {...register('recurrence')}>
          {TASK_RECURRENCES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="td-recurrence-end" className={labelCls()}>
          ทำซ้ำถึงวันที่
        </label>
        <input id="td-recurrence-end" type="date" className={inputCls()} {...register('recurrenceEndDate')} />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="td-tags" className={labelCls()}>
          แท็ก
        </label>
        <input id="td-tags" className={inputCls()} {...register('tags')} />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="td-notes" className={labelCls()}>
          บันทึกเพิ่มเติม
        </label>
        <textarea id="td-notes" rows={2} className={inputCls()} {...register('notes')} />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" size="sm" isLoading={isSubmitting} data-testid="td-save">
          บันทึกการแก้ไข
        </Button>
      </div>
    </form>
  );
}

function SubtasksSection({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['tasks'] });

  const addMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/subtasks`, { method: 'POST', body: JSON.stringify({ title }) }),
    onSuccess: () => {
      setTitle('');
      invalidate();
    },
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ต้องทำ' | 'เสร็จแล้ว' }) =>
      apiFetch(`/api/v1/tasks/subtasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/tasks/subtasks/${id}/cancel`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const visible = task.subtasks.filter((s) => s.status !== 'ยกเลิก');
  const done = visible.filter((s) => s.status === 'เสร็จแล้ว').length;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
        รายการย่อย ({done}/{visible.length})
      </h3>
      {visible.length > 0 && (
        <ul className="flex flex-col gap-1">
          {visible.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.status === 'เสร็จแล้ว'}
                onChange={(e) => toggleMutation.mutate({ id: s.id, status: e.target.checked ? 'เสร็จแล้ว' : 'ต้องทำ' })}
              />
              <span className={s.status === 'เสร็จแล้ว' ? 'flex-1 text-slate-400 line-through' : 'flex-1 text-slate-700 dark:text-slate-200'}>
                {s.title}
              </span>
              <button type="button" onClick={() => cancelMutation.mutate(s.id)} className="text-slate-300 hover:text-red-500">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) addMutation.mutate();
        }}
        className="flex gap-2"
      >
        <input
          placeholder="เพิ่มรายการย่อย..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <Button type="submit" size="sm" variant="outline" isLoading={addMutation.isPending} disabled={!title.trim()} data-testid="td-subtask-add">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}

function ProgressLogSection({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(task.progress);

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/progress-logs`, { method: 'POST', body: JSON.stringify({ progress, note }) }),
    onSuccess: () => {
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">บันทึกความคืบหน้า</h3>
      {task.progressLogs.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto">
          {task.progressLogs.map((l) => (
            <li key={l.id} className="rounded-lg border border-slate-100 p-2 text-xs dark:border-slate-700">
              <span className="font-semibold text-primary-700 dark:text-primary-300">{l.progress}%</span> — {l.note}
              <div className="text-slate-400">{formatThaiDate(l.logged_at, 'd MMM yyyy HH:mm')}</div>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) mutation.mutate();
        }}
        className="flex flex-col gap-2"
      >
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="flex-1"
            aria-label="ความคืบหน้า"
          />
          <span className="w-10 text-right text-xs text-slate-500 dark:text-slate-400">{progress}%</span>
        </div>
        <textarea
          rows={2}
          placeholder="บันทึกความคืบหน้า"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <Button type="submit" size="sm" variant="outline" isLoading={mutation.isPending} disabled={!note.trim()} data-testid="td-progress-save">
          บันทึก
        </Button>
      </form>
    </div>
  );
}

function LinksSection({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/links`, { method: 'POST', body: JSON.stringify({ url, label: label || undefined }) }),
    onSuccess: () => {
      setUrl('');
      setLabel('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'เพิ่มลิงก์ไม่สำเร็จ'),
  });

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">ลิงก์ประกอบงาน</h3>
      {task.links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {task.links.map((l) => (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noreferrer" className="text-sm text-primary-700 hover:underline dark:text-primary-300">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) mutation.mutate();
        }}
        className="flex flex-col gap-2"
      >
        <input
          placeholder="ป้ายชื่อ (ไม่บังคับ)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <input
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button type="submit" size="sm" variant="outline" isLoading={mutation.isPending} disabled={!url.trim()} data-testid="td-link-add">
          เพิ่มลิงก์
        </Button>
      </form>
    </div>
  );
}

export function TaskDetailPanel({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const taskQuery = useQuery({
    queryKey: ['tasks', taskId],
    queryFn: () => apiFetch<Task>(`/api/v1/tasks/${taskId}`),
  });

  const restoreMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${taskId}/restore`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const task = taskQuery.data;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl dark:bg-slate-800"
        data-testid="task-detail-panel"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">รายละเอียดงาน</h2>
          <button type="button" onClick={onClose} data-testid="task-detail-close" className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {taskQuery.isLoading && (
          <div className="flex justify-center py-10" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        )}

        {task && (
          <div className="flex flex-col gap-5 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusTone[task.status]}>{task.status}</Badge>
              <Badge variant={priorityTone[task.priority]}>{task.priority}</Badge>
              {task.status === 'ยกเลิก' && (
                <Button size="sm" variant="outline" isLoading={restoreMutation.isPending} onClick={() => restoreMutation.mutate()}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> กู้คืนงาน
                </Button>
              )}
            </div>

            <EditTaskForm task={task} />
            <hr className="border-slate-100 dark:border-slate-700" />
            <SubtasksSection task={task} />
            <hr className="border-slate-100 dark:border-slate-700" />
            <ProgressLogSection task={task} />
            <hr className="border-slate-100 dark:border-slate-700" />
            <LinksSection task={task} />
          </div>
        )}
      </div>
    </div>
  );
}
