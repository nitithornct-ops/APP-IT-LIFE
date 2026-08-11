import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckSquare2, GripVertical } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Toast, type ToastMessage } from '../../components/ui/Toast';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Task, TaskStatus } from '../../types/tasks';
import { formatThaiDate } from '../../utils/date';
import { priorityTone } from './taskDisplay';

interface KanbanColumn {
  id: string;
  label: string;
  targetStatus: TaskStatus;
  matches: TaskStatus[];
  tone: string;
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'todo', label: 'ต้องทำ', targetStatus: 'ต้องทำ', matches: ['ต้องทำ'], tone: 'border-t-slate-400' },
  { id: 'in-progress', label: 'กำลังทำ', targetStatus: 'กำลังทำ', matches: ['กำลังทำ'], tone: 'border-t-primary-500' },
  { id: 'waiting', label: 'รอติดตาม', targetStatus: 'รอข้อมูล', matches: ['รอข้อมูล', 'รอผู้อื่นดำเนินการ'], tone: 'border-t-amber-500' },
  { id: 'blocked', label: 'ติดปัญหา', targetStatus: 'พักไว้ก่อน', matches: ['พักไว้ก่อน'], tone: 'border-t-red-500' },
  { id: 'completed', label: 'เสร็จแล้ว', targetStatus: 'เสร็จแล้ว', matches: ['เสร็จแล้ว'], tone: 'border-t-emerald-500' },
];

function tagsOf(task: Task) {
  return (task.tags ?? '').split(/[#,\s]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 2);
}

export function TaskKanbanBoard({ tasks, onSelect }: { tasks: Task[]; onSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const moveMutation = useMutation({
    mutationFn: ({ id, status, sortOrder }: { id: string; status: TaskStatus; sortOrder: number }) =>
      apiFetch(`/api/v1/tasks/${id}/board`, { method: 'POST', body: JSON.stringify({ status, sortOrder }) }),
    onMutate: async ({ id, status, sortOrder }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData<Task[]>(['tasks']);
      queryClient.setQueryData<Task[]>(['tasks'], (current) => current?.map((task) => task.id === id ? { ...task, status, sort_order: sortOrder } : task));
      return { previousTasks };
    },
    onSuccess: () => setToast({ tone: 'success', message: 'ย้ายงานสำเร็จ' }),
    onError: (error, _variables, context) => {
      if (context?.previousTasks) queryClient.setQueryData(['tasks'], context.previousTasks);
      setToast({ tone: 'error', message: error instanceof ApiError ? error.message : 'ย้ายงานไม่สำเร็จ ระบบคืนสถานะเดิมแล้ว' });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
    },
  });

  const columns = KANBAN_COLUMNS.map((column) => ({
    ...column,
    items: tasks.filter((task) => column.matches.includes(task.status)).sort((a, b) => a.sort_order - b.sort_order),
  }));

  return (
    <div className="flex flex-col gap-2" data-testid="task-kanban-board">
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((column) => (
          <section
            key={column.id}
            data-testid={`kanban-column-${column.id}`}
            onDragOver={(event) => { event.preventDefault(); if (!moveMutation.isPending) setDragOverColumn(column.id); }}
            onDragLeave={() => setDragOverColumn((id) => id === column.id ? null : id)}
            onDrop={(event) => {
              event.preventDefault();
              const taskId = event.dataTransfer.getData('text/task-id');
              setDragOverColumn(null);
              if (taskId && !moveMutation.isPending) moveMutation.mutate({ id: taskId, status: column.targetStatus, sortOrder: Date.now() });
            }}
            className={`flex w-72 min-w-[18rem] flex-shrink-0 flex-col gap-2 rounded-xl border border-t-4 p-2 transition-colors ${column.tone} ${dragOverColumn === column.id ? 'bg-primary-50 ring-2 ring-primary-300 dark:bg-primary-900/20 dark:ring-primary-700' : 'bg-slate-50 dark:border-x-slate-700 dark:border-b-slate-700 dark:bg-slate-900/40'}`}
          >
            <header className="flex items-center justify-between px-1 py-1">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{column.label}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm dark:bg-slate-800">{column.items.length}</span>
            </header>
            <div className="flex min-h-[5rem] flex-col gap-2">
              {column.items.length === 0 && <div className="grid min-h-20 place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700">วางงานที่นี่</div>}
              {column.items.map((task) => {
                const checklist = task.subtasks.filter((item) => item.status !== 'ยกเลิก');
                const checklistDone = checklist.filter((item) => item.status === 'เสร็จแล้ว').length;
                return (
                  <article
                    key={task.id}
                    draggable={!moveMutation.isPending}
                    tabIndex={0}
                    data-testid={`kanban-card-${task.id}`}
                    onDragStart={(event) => event.dataTransfer.setData('text/task-id', task.id)}
                    onClick={() => onSelect(task.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(task.id); } }}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm transition hover:border-primary-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-semibold text-slate-800 dark:text-slate-100">{task.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">{task.task_no}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant={priorityTone[task.priority]}>{task.priority}</Badge>
                      {task.due_date && <span className="flex items-center gap-1 text-[10px] text-slate-500"><CalendarDays className="h-3 w-3" /> {formatThaiDate(task.due_date, 'd MMM')}</span>}
                      {checklist.length > 0 && <span className="flex items-center gap-1 text-[10px] text-slate-500"><CheckSquare2 className="h-3 w-3" /> {checklistDone}/{checklist.length}</span>}
                    </div>
                    {tagsOf(task).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{tagsOf(task).map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-700 dark:text-slate-300">#{tag}</span>)}</div>}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-primary-600" style={{ width: `${task.progress}%` }} /></div>
                      <span className="text-[10px] font-semibold text-slate-500">{task.progress}%</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
