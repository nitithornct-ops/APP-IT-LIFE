import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Clock3, Plus } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { Toast, type ToastMessage } from '../../components/ui/Toast';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Task } from '../../types/tasks';
import { cn } from '../../utils/cn';
import { formatThaiDate } from '../../utils/date';
import { priorityTone } from './taskDisplay';
import { Badge } from '../../components/ui/Badge';

type CalendarMode = 'month' | 'week' | 'day' | 'agenda';
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];

function dateKey(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

function bangkokDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dueDaysFromToday(nextDate: string) {
  const today = Date.parse(`${bangkokDateKey()}T12:00:00Z`);
  return Math.round((Date.parse(`${nextDate}T12:00:00Z`) - today) / 86_400_000);
}

function taskHoverText(task: Task) {
  return `${task.title}\nความสำคัญ: ${task.priority}\nสถานะ: ${task.status}\nครบกำหนด: ${task.due_date ? formatThaiDate(task.due_date, 'd MMM yyyy') : 'ไม่ระบุ'}${task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''}\nความคืบหน้า: ${task.progress}%`;
}

export function TaskCalendarView({ tasks, onSelect, onCreate }: { tasks: Task[]; onSelect: (id: string) => void; onCreate: (dueDate: string) => void }) {
  const queryClient = useQueryClient();
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [mode, setMode] = useState<CalendarMode>('month');
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const todayKey = dateKey(new Date());

  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    tasks.forEach((task) => {
      if (!task.due_date) return;
      grouped.set(task.due_date, [...(grouped.get(task.due_date) ?? []), task].sort((a, b) => (a.due_time ?? '23:59').localeCompare(b.due_time ?? '23:59')));
    });
    return grouped;
  }, [tasks]);

  const moveMutation = useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate: string }) => apiFetch(`/api/v1/tasks/${id}/due-date`, { method: 'POST', body: JSON.stringify({ dueDate }) }),
    onMutate: async ({ id, dueDate }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData<Task[]>(['tasks']);
      queryClient.setQueryData<Task[]>(['tasks'], (current) => current?.map((task) => task.id === id ? { ...task, due_date: dueDate, due_days: dueDaysFromToday(dueDate) } : task));
      return { previousTasks };
    },
    onSuccess: () => setToast({ tone: 'success', message: 'ย้ายวันครบกำหนดสำเร็จ' }),
    onError: (error, _variables, context) => {
      if (context?.previousTasks) queryClient.setQueryData(['tasks'], context.previousTasks);
      setToast({ tone: 'error', message: error instanceof ApiError ? error.message : 'ย้ายวันครบกำหนดไม่สำเร็จ ระบบคืนวันเดิมแล้ว' });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
    },
  });

  const navigate = (direction: -1 | 1) => {
    setAnchorDate((current) => {
      if (mode === 'month') return direction < 0 ? subMonths(current, 1) : addMonths(current, 1);
      if (mode === 'week') return direction < 0 ? subWeeks(current, 1) : addWeeks(current, 1);
      return direction < 0 ? subDays(current, 1) : addDays(current, 1);
    });
  };

  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 0 }),
  });
  const weekDays = eachDayOfInterval({
    start: startOfWeek(anchorDate, { weekStartsOn: 1 }),
    end: endOfWeek(anchorDate, { weekStartsOn: 1 }),
  });
  const agendaTasks = tasks.filter((task) => task.due_date).sort((a, b) => `${a.due_date}${a.due_time ?? '23:59'}`.localeCompare(`${b.due_date}${b.due_time ?? '23:59'}`));

  const taskButton = (task: Task, compact = false) => (
    <button
      key={task.id}
      type="button"
      draggable={!moveMutation.isPending}
      onDragStart={(event) => event.dataTransfer.setData('text/task-id', task.id)}
      onClick={(event) => { event.stopPropagation(); onSelect(task.id); }}
      title={taskHoverText(task)}
      className={cn(
        'block w-full truncate rounded px-1.5 py-1 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        compact ? 'text-[11px]' : 'text-xs',
        task.status === 'เสร็จแล้ว'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
          : task.due_days !== null && task.due_days < 0
            ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200'
            : task.category === 'ประชุม' || task.category === 'ติดตาม'
              ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200'
              : task.category === 'โครงการ' || task.category === 'พัฒนาระบบ'
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200'
                : 'bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200',
      )}
    >
      {task.recurrence !== 'ไม่ทำซ้ำ' ? '↻ ' : ''}{task.due_time ? `${task.due_time.slice(0, 5)} ` : ''}{task.title}
    </button>
  );

  const dropProps = (key: string) => ({
    onDragOver: (event: DragEvent) => { event.preventDefault(); setDragOverDate(key); },
    onDragLeave: () => setDragOverDate((value) => value === key ? null : value),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const taskId = event.dataTransfer.getData('text/task-id');
      setDragOverDate(null);
      if (taskId) moveMutation.mutate({ id: taskId, dueDate: key });
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 sm:p-4" data-testid="task-calendar-view">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">เลือกชื่องานเพื่อดูรายละเอียด หรือลากงานเพื่อเปลี่ยนวันครบกำหนด</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden overflow-hidden rounded-md border border-slate-300 dark:border-slate-600 sm:flex">
            {(['month', 'week', 'day', 'agenda'] as CalendarMode[]).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={cn('h-8 px-3 text-xs font-semibold', mode === value ? 'bg-primary-700 text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700')}>{value === 'month' ? 'เดือน' : value === 'week' ? 'สัปดาห์' : value === 'day' ? 'วัน' : 'รายการ'}</button>)}
          </div>
          <div className="flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
            <button type="button" title="ก่อนหน้า" aria-label="ก่อนหน้า" onClick={() => navigate(-1)} className="grid h-8 w-9 place-items-center text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setAnchorDate(new Date())} className="h-8 border-x border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">วันนี้</button>
            <button type="button" title="ถัดไป" aria-label="ถัดไป" onClick={() => navigate(1)} className="grid h-8 w-9 place-items-center text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <h3 className="mb-4 text-center text-lg font-bold text-slate-800 dark:text-slate-100">{mode === 'day' ? formatThaiDate(anchorDate, 'EEEE d MMMM yyyy') : formatThaiDate(anchorDate, 'MMMM yyyy')}</h3>

      <div className="sm:hidden">
        <p className="mb-2 text-center text-[11px] text-slate-400">หน้าจอมือถือแสดงแบบรายการอัตโนมัติ</p>
        <div className="space-y-2">{agendaTasks.map((task) => <button key={task.id} type="button" onClick={() => onSelect(task.id)} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left dark:border-slate-700"><span className="w-20 shrink-0 text-xs font-semibold text-primary-700 dark:text-primary-300">{task.due_date ? formatThaiDate(task.due_date, 'd MMM') : '—'}<span className="block font-mono text-[10px] text-slate-400">{task.due_time?.slice(0, 5)}</span></span><span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span><Badge variant={priorityTone[task.priority]}>{task.priority}</Badge></button>)}</div>
      </div>

      {mode === 'month' && <div className="hidden min-w-[700px] overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 sm:block">
        <div className="grid grid-cols-7 bg-slate-50 dark:bg-slate-900/60">{WEEKDAYS.map((day) => <div key={day} className="border-r border-slate-200 px-2 py-2 text-center text-xs font-semibold text-primary-700 last:border-r-0 dark:border-slate-700 dark:text-primary-300">{day}</div>)}</div>
        <div className="grid grid-cols-7">{monthDays.map((day) => {
          const key = dateKey(day);
          const dayTasks = tasksByDate.get(key) ?? [];
          return <div key={key} {...dropProps(key)} onClick={() => onCreate(key)} className={cn('group min-h-[112px] cursor-pointer border-r border-t border-slate-200 p-1.5 transition last:border-r-0 dark:border-slate-700', (day.getDay() === 0 || day.getDay() === 6) && 'bg-slate-50/80 dark:bg-slate-900/30', !isSameMonth(day, anchorDate) && 'bg-slate-50/70 dark:bg-slate-900/40', key === todayKey && 'bg-primary-50 shadow-[inset_0_0_0_2px_#1D4ED8] dark:bg-primary-900/20', dragOverDate === key && 'ring-2 ring-inset ring-primary-400')}><div className="mb-1 flex items-center justify-between"><Plus className="h-3 w-3 text-transparent group-hover:text-slate-300" /><span className={cn('text-xs font-semibold text-slate-600 dark:text-slate-300', !isSameMonth(day, anchorDate) && 'text-slate-300 dark:text-slate-600')}>{format(day, 'd')}</span></div><div className="space-y-1">{dayTasks.slice(0, 3).map((task) => taskButton(task, true))}{dayTasks.length > 3 && <p className="px-1 text-[10px] text-slate-400">+{dayTasks.length - 3} งาน</p>}</div></div>;
        })}</div>
      </div>}

      {mode === 'week' && <div className="hidden grid-cols-7 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 sm:grid">{weekDays.map((day) => { const key = dateKey(day); return <div key={key} {...dropProps(key)} onClick={() => onCreate(key)} className={cn('min-h-[260px] cursor-pointer border-r p-2 last:border-r-0 dark:border-slate-700', key === todayKey && 'bg-primary-50 dark:bg-primary-950/20', dragOverDate === key && 'ring-2 ring-inset ring-primary-400')}><div className="mb-2 text-center"><p className="text-[10px] text-slate-400">{formatThaiDate(day, 'EEE')}</p><p className="text-sm font-bold">{format(day, 'd')}</p></div><div className="space-y-1">{(tasksByDate.get(key) ?? []).map((task) => taskButton(task, true))}</div></div>; })}</div>}

      {mode === 'day' && <div {...dropProps(dateKey(anchorDate))} onClick={() => onCreate(dateKey(anchorDate))} className={cn('hidden min-h-[360px] cursor-pointer rounded-lg border border-slate-200 p-4 dark:border-slate-700 sm:block', dragOverDate === dateKey(anchorDate) && 'ring-2 ring-primary-400')}><div className="space-y-2">{(tasksByDate.get(dateKey(anchorDate)) ?? []).map((task) => <div key={task.id} className="flex items-center gap-3"><span className="w-14 font-mono text-xs text-slate-500"><Clock3 className="mr-1 inline h-3 w-3" />{task.due_time?.slice(0, 5) ?? '—'}</span><div className="min-w-0 flex-1">{taskButton(task)}</div></div>)}</div></div>}

      {mode === 'agenda' && <div className="hidden space-y-2 sm:block">{agendaTasks.length === 0 && <p className="py-10 text-center text-sm text-slate-400">ยังไม่มีงานที่ระบุวันครบกำหนด</p>}{agendaTasks.map((task) => <button key={task.id} type="button" onClick={() => onSelect(task.id)} title={taskHoverText(task)} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-primary-300 dark:border-slate-700"><span className="w-24 shrink-0 text-xs font-semibold text-primary-700 dark:text-primary-300">{task.due_date ? formatThaiDate(task.due_date, 'd MMM yyyy') : '—'}<span className="block font-mono text-[10px] text-slate-400">{task.due_time?.slice(0, 5)}</span></span><span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span><Badge variant={priorityTone[task.priority]}>{task.priority}</Badge><span className="text-xs text-slate-400">{task.progress}%</span></button>)}</div>}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </section>
  );
}
