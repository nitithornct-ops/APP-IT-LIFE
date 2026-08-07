import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Kanban, ListTodo, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Task } from '../../types/tasks';
import { formatThaiDate } from '../../utils/date';
import { TaskDetailPanel } from './TaskDetailPanel';
import { TaskKanbanBoard } from './TaskKanbanBoard';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, priorityTone, statusTone } from './taskDisplay';

function DueBadge({ dueDate, dueDays }: { dueDate: string | null; dueDays: number | null }) {
  if (!dueDate) return <span className="text-xs text-slate-400">—</span>;
  const label = formatThaiDate(dueDate, 'd MMM yyyy');
  if (dueDays === null) return <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>;
  if (dueDays < 0) return <Badge variant="danger">เลยกำหนด {Math.abs(dueDays)} วัน</Badge>;
  if (dueDays === 0) return <Badge variant="warning">ครบกำหนดวันนี้</Badge>;
  if (dueDays <= 3) return <Badge variant="warning">อีก {dueDays} วัน</Badge>;
  return <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>;
}

// <select> ที่ยังไม่ได้เลือกจะส่งค่า "" มาเสมอ ซึ่ง z.enum(...).optional() ไม่ยอมรับ (บั๊กเดิมที่เจอใน
// Module 3/5) — รับ "" แล้วแปลงเป็น undefined เอง
const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal('')])
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const quickAddSchema = z.object({
  title: z.string().trim().min(1, 'กรุณาระบุชื่องาน'),
  category: optionalEnum(['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ']),
  priority: optionalEnum(['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน']),
  dueDate: z.string().optional(),
});
type QuickAddForm = z.infer<typeof quickAddSchema>;

function QuickAddForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<QuickAddForm>({ resolver: zodResolver(quickAddSchema) });

  const mutation = useMutation({
    mutationFn: (values: QuickAddForm) => apiFetch('/api/v1/tasks', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มงานไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-4">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มงานใหม่ (Quick Add)</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="task-title" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่องาน
        </label>
        <input
          id="task-title"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('title')}
        />
        {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
      </div>

      <div>
        <label htmlFor="task-category" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ประเภท
        </label>
        <select
          id="task-category"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('category')}
        >
          <option value="">— ค่าเริ่มต้น —</option>
          {TASK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="task-priority" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ความสำคัญ
        </label>
        <select
          id="task-priority"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('priority')}
        >
          <option value="">— ค่าเริ่มต้น —</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-4">
        <label htmlFor="task-due" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ครบกำหนด (ไม่บังคับ)
        </label>
        <input
          id="task-due"
          type="date"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('dueDate')}
        />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-4">{serverError}</p>}

      <div className="sm:col-span-4">
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          เพิ่มงาน
        </Button>
      </div>
    </form>
  );
}

export function TasksPage() {
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const tasksQuery = useQuery({
    queryKey: ['tasks', status, category, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (category) params.set('category', category);
      if (search) params.set('search', search);
      const qs = params.toString();
      return apiFetch<Task[]>(`/api/v1/tasks${qs ? `?${qs}` : ''}`);
    },
  });

  const tasks = tasksQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">งานของฉัน</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">งานส่วนตัวของท่านเท่านั้น ไม่มีผู้อื่นมองเห็นหรือแก้ไขได้</p>
        </div>
        <Button size="sm" onClick={() => setShowQuickAdd((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          เพิ่มงาน
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setView('list')}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold ${
                view === 'list' ? 'bg-primary-700 text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <ListTodo className="h-3.5 w-3.5" aria-hidden="true" /> รายการ
            </button>
            <button
              type="button"
              onClick={() => setView('kanban')}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold ${
                view === 'kanban' ? 'bg-primary-700 text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Kanban className="h-3.5 w-3.5" aria-hidden="true" /> Kanban
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-normal">
            <input
              placeholder="ค้นหาชื่องาน..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900"
            >
              <option value="">ทุกประเภท</option>
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {view === 'list' && (
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">ทุกสถานะ</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </div>
        </CardHeader>
        <CardBody>
          {showQuickAdd && <QuickAddForm onClose={() => setShowQuickAdd(false)} />}

          {tasksQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {tasksQuery.data && tasks.length === 0 && (
            <EmptyState icon={<ListTodo className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มีงาน" message="เริ่มเพิ่มงานแรกของท่านได้เลย" />
          )}

          {tasksQuery.data && tasks.length > 0 && view === 'list' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">ชื่องาน</th>
                    <th className="px-2 py-2">ประเภท</th>
                    <th className="px-2 py-2">ความสำคัญ</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2">ความคืบหน้า</th>
                    <th className="px-2 py-2">ครบกำหนด</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr
                      key={t.id}
                      data-testid={`task-row-${t.id}`}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900/40"
                      onClick={() => setSelectedTaskId(t.id)}
                    >
                      <td className="px-2 py-2 font-medium text-primary-700 dark:text-primary-300">{t.title}</td>
                      <td className="px-2 py-2">
                        <Badge variant="secondary">{t.category}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={priorityTone[t.priority]}>{t.priority}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={statusTone[t.status]}>{t.status}</Badge>
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{t.progress}%</td>
                      <td className="px-2 py-2">
                        <DueBadge dueDate={t.due_date} dueDays={t.due_days} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tasksQuery.data && tasks.length > 0 && view === 'kanban' && <TaskKanbanBoard tasks={tasks} onSelect={setSelectedTaskId} />}
        </CardBody>
      </Card>

      {selectedTaskId && <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />}
    </div>
  );
}
