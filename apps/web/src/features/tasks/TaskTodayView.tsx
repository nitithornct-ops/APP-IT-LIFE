import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, CalendarClock, Check, Clock3, Eye, Loader2, Repeat2, Users } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Toast, type ToastMessage } from '../../components/ui/Toast';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Task, TaskPriority } from '../../types/tasks';
import { formatThaiDate } from '../../utils/date';
import { TASK_PRIORITIES, priorityTone } from './taskDisplay';

function timeLabel(task: Task) {
  return (task.due_time ?? task.start_time)?.slice(0, 5) ?? 'ไม่ระบุเวลา';
}

export function TaskTodayView({ tasks, onSelect }: { tasks: Task[]; onSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
  };

  const statusMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/tasks/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'เสร็จแล้ว' }) }),
    onMutate: (id) => setPendingId(id),
    onSuccess: () => {
      setToast({ tone: 'success', message: 'ทำงานเสร็จแล้ว' });
      invalidate();
    },
    onError: (error) => setToast({ tone: 'error', message: error instanceof ApiError ? error.message : 'อัปเดตงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }),
    onSettled: () => setPendingId(null),
  });

  const priorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: TaskPriority }) => apiFetch(`/api/v1/tasks/${id}/priority`, { method: 'POST', body: JSON.stringify({ priority }) }),
    onMutate: ({ id }) => setPendingId(id),
    onSuccess: () => {
      setToast({ tone: 'success', message: 'เปลี่ยนความสำคัญแล้ว' });
      invalidate();
    },
    onError: (error) => setToast({ tone: 'error', message: error instanceof ApiError ? error.message : 'เปลี่ยนความสำคัญไม่สำเร็จ' }),
    onSettled: () => setPendingId(null),
  });

  const dueDateMutation = useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate: string }) => apiFetch(`/api/v1/tasks/${id}/due-date`, { method: 'POST', body: JSON.stringify({ dueDate }) }),
    onMutate: ({ id }) => setPendingId(id),
    onSuccess: () => {
      setToast({ tone: 'success', message: 'เปลี่ยนวันครบกำหนดแล้ว' });
      invalidate();
    },
    onError: (error) => setToast({ tone: 'error', message: error instanceof ApiError ? error.message : 'เปลี่ยนวันครบกำหนดไม่สำเร็จ' }),
    onSettled: () => setPendingId(null),
  });

  const snoozeMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/tasks/${id}/reminder/snooze`, { method: 'POST', body: JSON.stringify({ minutes: 30 }) }),
    onMutate: (id) => setPendingId(id),
    onSuccess: () => {
      setToast({ tone: 'success', message: 'Snooze การแจ้งเตือน 30 นาทีแล้ว' });
      invalidate();
    },
    onError: (error) => setToast({ tone: 'error', message: error instanceof ApiError ? error.message : 'Snooze การแจ้งเตือนไม่สำเร็จ' }),
    onSettled: () => setPendingId(null),
  });

  const overdue = tasks.filter((task) => task.due_days !== null && task.due_days < 0);
  const today = tasks.filter((task) => task.due_days === 0);

  const renderGroup = (title: string, items: Task[], overdueGroup = false) => (
    <section className="rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <h3 className={overdueGroup ? 'text-sm font-bold text-red-700 dark:text-red-300' : 'text-sm font-bold text-slate-800 dark:text-slate-100'}>{title}</h3>
        <span className="text-xs font-semibold text-slate-400">{items.length} งาน</span>
      </header>
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {items.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">ไม่มีงานในกลุ่มนี้</p>}
        {items.map((task) => (
          <article key={task.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[84px_minmax(0,1fr)_auto] sm:items-center">
            <div className={overdueGroup ? 'flex items-center gap-2 font-mono text-sm font-bold text-red-600' : 'flex items-center gap-2 font-mono text-sm font-bold text-primary-700 dark:text-primary-300'}>
              <Clock3 className="h-4 w-4" aria-hidden="true" /> {timeLabel(task)}
            </div>
            <button type="button" onClick={() => onSelect(task.id)} className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{task.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{task.task_no}</span>
                {task.task_type === 'meeting' && <span className="flex items-center gap-1"><Users className="h-3 w-3" /> ประชุม</span>}
                {task.recurrence !== 'ไม่ทำซ้ำ' && <span className="flex items-center gap-1"><Repeat2 className="h-3 w-3" /> {task.recurrence}</span>}
                {overdueGroup && task.due_date && <span>ครบกำหนด {formatThaiDate(task.due_date, 'd MMM yyyy')}</span>}
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Badge variant={priorityTone[task.priority]}>{task.priority}</Badge>
              <select aria-label={`เปลี่ยนความสำคัญ ${task.title}`} value={task.priority} disabled={pendingId === task.id} onChange={(event) => priorityMutation.mutate({ id: task.id, priority: event.target.value as TaskPriority })} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-900">
                {TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
              </select>
              <label className="sr-only" htmlFor={`today-due-${task.id}`}>เปลี่ยนวันครบกำหนด {task.title}</label>
              <input id={`today-due-${task.id}`} type="date" value={task.due_date ?? ''} disabled={pendingId === task.id} onChange={(event) => dueDateMutation.mutate({ id: task.id, dueDate: event.target.value })} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-900" />
              {task.reminders.some((reminder) => reminder.status !== 'cancelled') && <button type="button" title="Snooze 30 นาที" aria-label={`Snooze การแจ้งเตือน ${task.title} 30 นาที`} disabled={pendingId === task.id} onClick={() => snoozeMutation.mutate(task.id)} className="grid h-8 w-8 place-items-center rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300"><AlarmClock className="h-4 w-4" /></button>}
              <button type="button" title="เปิดรายละเอียด" aria-label={`เปิดรายละเอียด ${task.title}`} onClick={() => onSelect(task.id)} className="grid h-8 w-8 place-items-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 dark:border-slate-600"><Eye className="h-4 w-4" /></button>
              <button type="button" title="ทำงานเสร็จ" aria-label={`ทำงานเสร็จ ${task.title}`} disabled={pendingId === task.id} onClick={() => statusMutation.mutate(task.id)} className="grid h-8 w-8 place-items-center rounded-md bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50">{pendingId === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-3" data-testid="task-today-view">
      <div className="flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200">
        <CalendarClock className="h-5 w-5" aria-hidden="true" />
        <span>ลำดับงานวันนี้เรียงจากงานเลยกำหนด แล้วตามด้วยเร่งด่วน สูง ปกติ และต่ำ</span>
      </div>
      {renderGroup('เลยกำหนด', overdue, true)}
      {renderGroup('วันนี้', today)}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
