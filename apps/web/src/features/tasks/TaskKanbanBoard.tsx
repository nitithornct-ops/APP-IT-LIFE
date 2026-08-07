import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Task, TaskStatus } from '../../types/tasks';
import { formatThaiDate } from '../../utils/date';
import { TASK_STATUSES, priorityTone } from './taskDisplay';

/**
 * ลาก-วางด้วย HTML5 Drag and Drop API มาตรฐาน (ไม่เพิ่ม dependency ใหม่) — ทุกสถานะใน
 * TASK_STATUSES เป็นคอลัมน์ได้หมด รวม "ยกเลิก" ด้วย (ลากเข้า = ยกเลิกงาน, ลากออก = กู้คืนแบบ implicit
 * ผ่าน endpoint เดียวกับการย้ายคอลัมน์ทั่วไป)
 */
export function TaskKanbanBoard({ tasks, onSelect }: { tasks: Task[]; onSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const moveMutation = useMutation({
    mutationFn: ({ id, status, sortOrder }: { id: string; status: TaskStatus; sortOrder: number }) =>
      apiFetch(`/api/v1/tasks/${id}/board`, { method: 'POST', body: JSON.stringify({ status, sortOrder }) }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'ย้ายงานไม่สำเร็จ'),
  });

  const columns = TASK_STATUSES.map((status) => ({
    status,
    items: tasks.filter((t) => t.status === status).sort((a, b) => a.sort_order - b.sort_order),
  }));

  return (
    <div className="flex flex-col gap-2" data-testid="task-kanban-board">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => (
          <div
            key={col.status}
            data-testid={`kanban-column-${col.status}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStatus(col.status);
            }}
            onDragLeave={() => setDragOverStatus((s) => (s === col.status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              const taskId = e.dataTransfer.getData('text/task-id');
              setDragOverStatus(null);
              if (!taskId) return;
              moveMutation.mutate({ id: taskId, status: col.status, sortOrder: Date.now() });
            }}
            className={`flex w-64 min-w-[16rem] flex-shrink-0 flex-col gap-2 rounded-xl border p-2 transition-colors ${
              dragOverStatus === col.status
                ? 'border-primary-400 bg-primary-50 dark:border-primary-500 dark:bg-primary-900/20'
                : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{col.status}</span>
              <span className="text-xs text-slate-400">{col.items.length}</span>
            </div>
            <div className="flex min-h-[2rem] flex-col gap-2">
              {col.items.map((t) => (
                <div
                  key={t.id}
                  draggable
                  data-testid={`kanban-card-${t.id}`}
                  onDragStart={(e) => e.dataTransfer.setData('text/task-id', t.id)}
                  onClick={() => onSelect(t.id)}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-sm hover:border-primary-300 dark:border-slate-700 dark:bg-slate-800"
                >
                  <p className="font-medium text-slate-800 dark:text-slate-100">{t.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge variant={priorityTone[t.priority]}>{t.priority}</Badge>
                    {t.due_date && <span className="text-xs text-slate-400">{formatThaiDate(t.due_date, 'd MMM')}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
