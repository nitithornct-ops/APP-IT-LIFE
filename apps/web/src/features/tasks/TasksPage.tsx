import { DataTable, TablePagination } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CirclePlay,
  Clock3,
  Download,
  Gauge,
  Grid2X2,
  Kanban,
  LayoutList,
  ListChecks,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Table2,
  TicketCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTableParams } from '../../hooks/useTableParams';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Toast, type ToastMessage } from '../../components/ui/Toast';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { apiFetch, ApiError } from '../../services/apiClient';
import { downloadCsv } from '../../utils/csv';
import { useAuth } from '../../stores/authContext';
import type { Task, TaskDashboard, TaskStatus, TaskType } from '../../types/tasks';
import { formatThaiDate } from '../../utils/date';
import { cn } from '../../utils/cn';
import { TaskCalendarView } from './TaskCalendarView';
import { TaskDetailPanel } from './TaskDetailPanel';
import { TaskKanbanBoard } from './TaskKanbanBoard';
import { TaskTodayView } from './TaskTodayView';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, priorityTone, statusTone, taskTypeLabel } from './taskDisplay';

type View = 'list' | 'kanban' | 'calendar' | 'table';
type Scope = 'focus' | 'today' | 'todayOnly' | 'all' | 'inProgress' | 'calendar' | 'recurring' | 'completed' | 'overdue' | 'dueSoon' | 'next7';
const VIEW_STORAGE_KEY = 'itlife-my-tasks-view';

const quickAddSchema = z.object({
  title: z.string().trim().min(1, 'กรุณาระบุชื่องาน'),
  taskType: z.enum(['general', 'meeting', 'follow_up', 'document', 'project', 'system_development', 'personal', 'other']),
  priority: z.enum(['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน']),
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
});
type QuickAddForm = z.infer<typeof quickAddSchema>;

const TERMINAL_STATUSES: TaskStatus[] = ['เสร็จแล้ว', 'ยกเลิก'];

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function DueBadge({ dueDate, dueDays }: { dueDate: string | null; dueDays: number | null }) {
  if (!dueDate) return <span className="text-xs text-slate-400">ไม่ระบุ</span>;
  if (dueDays !== null && dueDays < 0) return <Badge variant="danger">เลยกำหนด {Math.abs(dueDays)} วัน</Badge>;
  if (dueDays === 0) return <Badge variant="warning">ครบกำหนดวันนี้</Badge>;
  if (dueDays !== null && dueDays <= 3) return <Badge variant="warning">อีก {dueDays} วัน</Badge>;
  return <span className="text-xs text-slate-500 dark:text-slate-400">{formatThaiDate(dueDate, 'd MMM yyyy')}</span>;
}

function QuickAdd({ inputRef, onCreated, presetDueDate }: { inputRef: React.RefObject<HTMLInputElement>; onCreated: () => void; presetDueDate?: string | null }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<QuickAddForm>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: { title: '', taskType: 'general', priority: 'ปกติ', dueDate: '', dueTime: '' },
  });
  const titleRegister = register('title');
  useEffect(() => {
    if (!presetDueDate) return;
    setExpanded(true);
    setValue('dueDate', presetDueDate);
    inputRef.current?.focus();
  }, [inputRef, presetDueDate, setValue]);
  const mutation = useMutation({
    mutationFn: (values: QuickAddForm) => apiFetch('/api/v1/tasks', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      reset();
      setServerError(null);
      onCreated();
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มงานไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="rounded-lg border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800"
      noValidate
    >
      <div className="flex items-start gap-2">
        <div className="mt-2.5 hidden text-primary-600 sm:block"><ListTodo className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <input
            {...titleRegister}
            ref={(element) => {
              titleRegister.ref(element);
              (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = element;
            }}
            aria-label="ชื่องานใหม่"
            placeholder="จดงานใหม่ที่นี่... พิมพ์แล้วกด Enter เพื่อเพิ่ม"
            className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          title="เพิ่มงาน"
          aria-label="เพิ่มงาน"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-700 text-white shadow-sm hover:bg-primary-800 disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 pl-0 sm:flex sm:items-center sm:pl-6">
        <select aria-label="ประเภทงาน" {...register('taskType')} className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-900 sm:w-[150px]">
          {TASK_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select aria-label="ความสำคัญ" {...register('priority')} className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-900 sm:w-[140px]">
          {TASK_PRIORITIES.map((value) => <option key={value}>{value}</option>)}
        </select>
        {expanded && <input aria-label="วันครบกำหนด" type="date" {...register('dueDate')} className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-900 sm:w-[170px]" />}
        {expanded && <input aria-label="เวลาครบกำหนด" type="time" {...register('dueTime')} className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-900 sm:w-[120px]" />}
        <button type="button" onClick={() => setExpanded((value) => !value)} className="col-span-2 ml-auto flex h-9 items-center justify-end gap-1 px-1 text-xs font-semibold text-primary-700 dark:text-primary-300 sm:px-2">
          <SlidersHorizontal className="h-3.5 w-3.5" /> รายละเอียดเพิ่มเติม <ChevronDown className={cn('h-3.5 w-3.5 transition', expanded && 'rotate-180')} />
        </button>
      </div>
      {serverError && <p className="mt-2 pl-0 text-xs text-red-600 sm:pl-6">{serverError}</p>}
    </form>
  );
}

function TaskProgress({ value }: { value: number }) {
  return (
    <div className="flex min-w-[110px] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-primary-500" style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right text-xs text-slate-500">{value}%</span>
    </div>
  );
}

function TaskActions({
  task,
  pending,
  onView,
  onStatus,
}: {
  task: Task;
  pending: boolean;
  onView: () => void;
  onStatus: (status: TaskStatus) => void;
}) {
  const isTerminal = TERMINAL_STATUSES.includes(task.status);

  // งานที่ปิดไปแล้วเปลี่ยนสถานะไม่ได้ ปุ่มจึงหายไปทั้งชุด เหลือแต่ "ดู"
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <RowActions
        recordLabel={task.title}
        actions={[
          { kind: 'view', label: 'ดูรายละเอียด', onClick: onView },
          { kind: 'custom', icon: pending ? Loader2 : CirclePlay, label: 'เริ่มงาน', disabled: pending, hidden: isTerminal || task.status === 'กำลังทำ', onClick: () => onStatus('กำลังทำ') },
          { kind: 'custom', icon: pending ? Loader2 : Check, label: 'ทำงานเสร็จ', disabled: pending, hidden: isTerminal, onClick: () => onStatus('เสร็จแล้ว') },
          {
            kind: 'cancel',
            label: 'ยกเลิกงาน',
            hidden: isTerminal,
            isPending: pending,
            confirmDescription: 'งานนี้จะถูกยกเลิก แต่ยังอยู่ในรายการและประวัติการทำงานเพื่อการตรวจสอบย้อนหลัง',
            onConfirm: () => onStatus('ยกเลิก'),
          },
        ]}
      />
    </div>
  );
}

export function TasksPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const quickInputRef = useRef<HTMLInputElement>(null);
  const table = useTableParams<'view' | 'scope' | 'status' | 'priority' | 'type' | 'category' | 'dueFrom' | 'dueTo' | 'q'>({
    filters: ['view', 'scope', 'status', 'priority', 'type', 'category', 'dueFrom', 'dueTo', 'q'],
  });
  const { page, pageSize } = table;
  const { status, priority, category, dueFrom, dueTo, q: search } = table.filters;
  // มุมมองที่ผู้ใช้เลือกไว้ล่าสุดยังจำผ่าน localStorage แต่ URL มีสิทธิ์เหนือกว่าเสมอ
  const [storedView] = useState(() => localStorage.getItem(VIEW_STORAGE_KEY));
  const preferredView = table.filters.view || storedView;
  const view: View = preferredView === 'kanban' || preferredView === 'calendar' || preferredView === 'table' ? preferredView : 'list';
  const scopeParam = table.filters.scope;
  const scope: Scope = scopeParam === 'today' || scopeParam === 'todayOnly' || scopeParam === 'all' || scopeParam === 'inProgress' || scopeParam === 'calendar' || scopeParam === 'recurring' || scopeParam === 'completed' || scopeParam === 'overdue' || scopeParam === 'dueSoon' || scopeParam === 'next7' ? scopeParam : 'focus';
  const taskType: TaskType | '' = TASK_TYPES.some((item) => item.value === table.filters.type) ? (table.filters.type as TaskType) : '';
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [calendarCreateDate, setCalendarCreateDate] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 350);

  const setView = (nextView: View) => {
    localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    table.setFilter('view', nextView);
  };
  const setScope = (nextScope: Scope) => table.setFilter('scope', nextScope);

  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: () => apiFetch<Task[]>('/api/v1/tasks') });
  const dashboardQuery = useQuery({ queryKey: ['task-dashboard'], queryFn: () => apiFetch<TaskDashboard>('/api/v1/tasks/dashboard') });
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const today = localDateKey();
  const openTasks = tasks.filter((task) => !TERMINAL_STATUSES.includes(task.status));
  const overdueCount = openTasks.filter((task) => task.due_days !== null && task.due_days < 0).length;
  const dueSoonCount = openTasks.filter((task) => task.due_days !== null && task.due_days >= 0 && task.due_days <= 3).length;
  const averageProgress = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length) : 0;

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const text = `${task.task_no} ${task.title} ${task.description ?? ''} ${task.category} ${task.tags ?? ''}`.toLowerCase();
      if (debouncedSearch && !text.includes(debouncedSearch.toLowerCase())) return false;
      if (status && task.status !== status) return false;
      if (priority && task.priority !== priority) return false;
      if (taskType && task.task_type !== taskType) return false;
      if (category && task.category !== category) return false;
      if (dueFrom && (!task.due_date || task.due_date < dueFrom)) return false;
      if (dueTo && (!task.due_date || task.due_date > dueTo)) return false;
      if (scope === 'focus' && TERMINAL_STATUSES.includes(task.status)) return false;
      if (scope === 'today' && (TERMINAL_STATUSES.includes(task.status) || task.due_days === null || task.due_days > 0)) return false;
      if (scope === 'todayOnly' && (TERMINAL_STATUSES.includes(task.status) || task.due_date !== today)) return false;
      if (scope === 'inProgress' && task.status !== 'กำลังทำ') return false;
      if (scope === 'recurring' && task.recurrence === 'ไม่ทำซ้ำ') return false;
      if (scope === 'completed' && task.status !== 'เสร็จแล้ว') return false;
      if (scope === 'overdue' && (TERMINAL_STATUSES.includes(task.status) || task.due_days === null || task.due_days >= 0)) return false;
      if (scope === 'dueSoon' && (TERMINAL_STATUSES.includes(task.status) || task.due_days === null || task.due_days < 0 || task.due_days > 3)) return false;
      if (scope === 'next7' && (TERMINAL_STATUSES.includes(task.status) || task.due_days === null || task.due_days < 0 || task.due_days > 7)) return false;
      return true;
    });
  }, [category, debouncedSearch, dueFrom, dueTo, priority, scope, status, taskType, tasks, today]);

  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const dashboard = dashboardQuery.data;
  const summary = dashboard?.summary ?? {
    open: openTasks.length,
    today: tasks.filter((task) => !TERMINAL_STATUSES.includes(task.status) && task.due_date === today).length,
    dueSoon: dueSoonCount,
    overdue: overdueCount,
    completed: tasks.filter((task) => task.status === 'เสร็จแล้ว').length,
    inProgress: tasks.filter((task) => task.status === 'กำลังทำ').length,
    averageProgress,
  };
  const todayPlanTasks = dashboard?.todayItems.filter((item) => filteredTasks.some((task) => task.id === item.id)) ?? filteredTasks;

  const statusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: TaskStatus }) =>
      apiFetch(`/api/v1/tasks/${id}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) }),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      setToast({ tone: 'success', message: 'อัปเดตสถานะงานสำเร็จ' });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : 'อัปเดตสถานะงานไม่สำเร็จ กรุณาลองใหม่'),
  });

  const changeStatus = (task: Task, nextStatus: TaskStatus) => {
    if (statusMutation.isPending) return;
    statusMutation.mutate({ id: task.id, nextStatus });
  };

  const navItems: { scope: Scope; label: string; icon: typeof Gauge; count?: number; view?: View }[] = [
    { scope: 'focus', label: 'ภาพรวม', icon: Grid2X2, count: openTasks.length },
    { scope: 'today', label: 'วันนี้', icon: Sun, count: summary.today + summary.overdue, view: 'list' },
    { scope: 'all', label: 'งานทั้งหมด', icon: ListChecks, count: tasks.length },
    { scope: 'inProgress', label: 'งานที่กำลังทำ', icon: CirclePlay, count: tasks.filter((task) => task.status === 'กำลังทำ').length },
    { scope: 'calendar', label: 'ปฏิทินงาน', icon: CalendarDays, view: 'calendar' },
    { scope: 'recurring', label: 'งานประจำ', icon: Repeat2, count: tasks.filter((task) => task.recurrence !== 'ไม่ทำซ้ำ').length },
    { scope: 'completed', label: 'งานที่เสร็จแล้ว', icon: CheckCircle2, count: tasks.filter((task) => task.status === 'เสร็จแล้ว').length },
  ];

  const setTaskScope = (nextScope: Scope, nextView?: View) => {
    if (nextView) localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    table.setFilters({ scope: nextScope, ...(nextView ? { view: nextView } : {}) });
  };

  const exportCsv = () => {
    const rows = [
      ['งาน', 'ประเภท', 'ความสำคัญ', 'สถานะ', 'ความคืบหน้า', 'ครบกำหนด'],
      ...filteredTasks.map((task) => [task.title, task.category, task.priority, task.status, `${task.progress}%`, task.due_date ?? '']),
    ];
    downloadCsv(rows, `my-tasks-${today}.csv`);
  };

  const viewItems: { value: View; label: string; icon: typeof LayoutList }[] = [
    { value: 'list', label: 'รายการ', icon: LayoutList },
    { value: 'kanban', label: 'Kanban', icon: Kanban },
    { value: 'calendar', label: 'ปฏิทิน', icon: CalendarDays },
    { value: 'table', label: 'ตาราง', icon: Table2 },
  ];

  return (
    <div className="w-full space-y-3">
      <header className="relative overflow-hidden rounded-lg bg-gradient-to-r from-[#162b63] via-[#30339b] to-primary-600 px-5 py-5 text-white shadow-elevated sm:px-7">
        <div className="absolute right-0 top-0 h-full w-40 skew-x-[-14deg] bg-white/10" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-100"><Sparkles className="h-3 w-3" /> My work command center</p>
            <h1 className="flex items-center gap-2 text-xl font-bold"><ListTodo className="h-5 w-5" /> งานของฉัน</h1>
            <p className="mt-1 text-xs text-blue-100">เห็นงานสำคัญของคุณ จัดลำดับได้เร็ว และปิดงานได้จากหน้าเดียว</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportCsv} className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-blue-50"><Download className="h-4 w-4" /> CSV</button>
            <button type="button" onClick={() => quickInputRef.current?.focus()} className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold text-primary-700 hover:bg-blue-50"><Plus className="h-4 w-4" /> สร้างงานใหม่</button>
            {me?.profile.email && <span className="hidden max-w-[210px] truncate rounded-full border border-white/20 bg-white/10 px-3 py-2 text-[11px] text-blue-50 lg:block">{me.profile.email}</span>}
          </div>
        </div>
      </header>

      <div className="grid items-start gap-3 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 lg:sticky lg:top-[84px]">
          <p className="mb-2 px-2 text-[10px] font-bold text-slate-400">พื้นที่งานส่วนตัว</p>
          <nav className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1" aria-label="ตัวกรองงานส่วนตัว">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.scope}
                  type="button"
                  onClick={() => setTaskScope(item.scope, item.view)}
                  className={cn(
                    'flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium transition',
                    scope === item.scope ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.count !== undefined && <span className="text-[10px] font-bold">{item.count}</span>}
                </button>
              );
            })}
          </nav>
          <div className="mt-3 flex gap-2 rounded-lg bg-slate-50 p-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
            <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> เริ่มเช้าวันใหม่ที่เมนู “วันนี้” เพื่อเห็นงานเร่งด่วนก่อน
          </div>
        </aside>

        <main className="min-w-0 space-y-3">
          <section>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">ภาพรวมงาน</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">สิ่งที่ต้องสนใจ สถานะล่าสุด และงานที่ใกล้ครบกำหนด</p>
          </section>

          <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
            {[
              { label: 'งานที่เปิดอยู่', value: summary.open, icon: TicketCheck, tone: 'bg-primary-600', border: 'border-b-primary-500', scope: 'focus' as Scope },
              { label: 'งานวันนี้', value: summary.today, icon: Sun, tone: 'bg-sky-700', border: 'border-b-sky-600', scope: 'todayOnly' as Scope },
              { label: 'ใกล้ครบกำหนด', value: summary.dueSoon, icon: Clock3, tone: 'bg-teal-700', border: 'border-b-teal-600', scope: 'dueSoon' as Scope },
              { label: 'เลยกำหนด', value: summary.overdue, icon: ShieldAlert, tone: 'bg-red-600', border: 'border-b-red-500', scope: 'overdue' as Scope },
              { label: 'งานเสร็จแล้ว', value: summary.completed, icon: CheckCircle2, tone: 'bg-emerald-700', border: 'border-b-emerald-600', scope: 'completed' as Scope },
              { label: 'งานกำลังทำ', value: summary.inProgress, icon: CirclePlay, tone: 'bg-amber-600', border: 'border-b-amber-500', scope: 'inProgress' as Scope },
              { label: 'ความคืบหน้าเฉลี่ย', value: `${summary.averageProgress}%`, icon: Gauge, tone: 'bg-slate-600', border: 'border-b-slate-500', scope: 'all' as Scope },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <button type="button" key={stat.label} onClick={() => setScope(stat.scope)} aria-pressed={scope === stat.scope} className={cn('flex min-h-[84px] items-center gap-3 rounded-lg border border-b-2 border-slate-200 bg-white p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-800', stat.border, scope === stat.scope && 'ring-2 ring-primary-300 dark:ring-primary-700')}>
                  <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white', stat.tone)}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0"><p className="text-xl font-bold text-slate-800 dark:text-slate-100">{stat.value}</p><p className="truncate text-xs text-slate-500 dark:text-slate-400">{stat.label}</p></div>
                </button>
              );
            })}
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            {[
              { title: 'วันนี้', items: dashboard?.todayItems.filter((task) => task.due_days === 0).slice(0, 4) ?? [], empty: 'วันนี้ยังไม่มีงานครบกำหนด' },
              { title: 'Upcoming', items: dashboard?.upcoming.slice(0, 4) ?? [], empty: 'ยังไม่มีงานใน 7 วันข้างหน้า' },
            ].map((widget) => (
              <div key={widget.title} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{widget.title}</h3><CalendarDays className="h-4 w-4 text-primary-600" /></div>
                {dashboardQuery.isLoading && <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />}
                {dashboardQuery.isError && <p className="text-xs text-red-600">โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p>}
                {!dashboardQuery.isLoading && !dashboardQuery.isError && widget.items.length === 0 && <p className="py-4 text-center text-xs text-slate-400">{widget.empty}</p>}
                <div className="space-y-1">
                  {widget.items.map((task) => (
                    <button key={task.id} type="button" onClick={() => setSelectedTaskId(task.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-slate-700">
                      <span className="w-14 shrink-0 font-mono text-xs font-semibold text-primary-700 dark:text-primary-300">{task.due_time?.slice(0, 5) ?? (task.due_date ? formatThaiDate(task.due_date, 'd MMM') : '—')}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200">{task.title}</span>
                      <Badge variant={priorityTone[task.priority]}>{task.priority}</Badge>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"><Sparkles className="h-3.5 w-3.5 text-primary-600" /> โฟกัสด่วน</p>
            <div className="flex flex-wrap gap-2">
              {[
                { scope: 'focus' as Scope, label: 'งานที่ต้องทำ', icon: ListTodo },
                { scope: 'today' as Scope, label: 'วันนี้', icon: Sun },
                { scope: 'overdue' as Scope, label: 'เลยกำหนด', icon: ShieldAlert },
                { scope: 'next7' as Scope, label: '7 วันข้างหน้า', icon: CalendarDays },
                { scope: 'all' as Scope, label: 'งานทั้งหมด', icon: ListChecks },
              ].map((item) => {
                const Icon = item.icon;
                return <button key={item.scope} type="button" onClick={() => setScope(item.scope)} className={cn('flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold', scope === item.scope ? 'border-primary-300 bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700')}><Icon className="h-3.5 w-3.5" /> {item.label}</button>;
              })}
            </div>
          </section>

          <QuickAdd inputRef={quickInputRef} presetDueDate={calendarCreateDate} onCreated={() => { setCalendarCreateDate(null); setToast({ tone: 'success', message: 'สร้างงานสำเร็จ' }); }} />

          <section>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div><h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">รายการงาน</h2><p className="text-xs text-slate-500 dark:text-slate-400">เลือกมุมมองที่เหมาะกับวิธีทำงานของคุณ</p></div>
              <div className="flex w-fit items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-card dark:border-slate-700 dark:bg-slate-800">
                {viewItems.map((item) => {
                  const Icon = item.icon;
                  return <button key={item.value} type="button" onClick={() => { setView(item.value); if (scope === 'today') setScope('all'); }} className={cn('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold', view === item.value && scope !== 'today' ? 'bg-primary-50 text-primary-700 shadow-sm dark:bg-primary-900/50 dark:text-primary-200' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700')}><Icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{item.label}</span></button>;
                })}
              </div>
            </div>

            <div className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/70 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_repeat(3,minmax(125px,155px))_40px]">
              <label className="flex h-10 min-w-0 items-center rounded-lg border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900 sm:col-span-2 xl:col-span-1">
                <Search className="mx-3 h-4 w-4 shrink-0 text-slate-400" /><input aria-label="ค้นหางาน" value={search} onChange={(event) => table.setFilter('q', event.target.value, { replace: true })} placeholder="ค้นหาเลขที่งาน ชื่อ รายละเอียด หมวดหมู่ หรือแท็ก" className="min-w-0 flex-1 bg-transparent pr-3 text-xs outline-none" />
              </label>
              <select aria-label="กรองสถานะ" value={status} onChange={(event) => table.setFilter('status', event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกสถานะ</option>{TASK_STATUSES.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="กรองความสำคัญ" value={priority} onChange={(event) => table.setFilter('priority', event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกความสำคัญ</option>{TASK_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="กรองประเภทงาน" value={taskType} onChange={(event) => table.setFilter('type', event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกประเภทงาน</option>{TASK_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <button type="button" title="ล้างตัวกรอง" aria-label="ล้างตัวกรอง" onClick={() => table.setFilters({ q: '', status: '', priority: '', type: '', category: '', dueFrom: '', dueTo: '', scope: 'all' })} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900"><RefreshCw className="h-4 w-4" /></button>
              <select aria-label="กรองหมวดหมู่" value={category} onChange={(event) => table.setFilter('category', event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกหมวดหมู่</option>{TASK_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select>
              <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900"><span className="shrink-0">ครบกำหนดจาก</span><input aria-label="วันครบกำหนดตั้งแต่" type="date" value={dueFrom} onChange={(event) => table.setFilter('dueFrom', event.target.value)} className="min-w-0 flex-1 bg-transparent text-slate-700 dark:text-slate-200" /></label>
              <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900"><span className="shrink-0">ถึง</span><input aria-label="วันครบกำหนดถึง" type="date" value={dueTo} min={dueFrom || undefined} onChange={(event) => table.setFilter('dueTo', event.target.value)} className="min-w-0 flex-1 bg-transparent text-slate-700 dark:text-slate-200" /></label>
            </div>
          </section>

          {tasksQuery.isLoading && <div className="grid min-h-[240px] place-items-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" role="status"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}
          {tasksQuery.isError && <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">โหลดรายการงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>}
          {actionError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label="ปิดข้อความผิดพลาด" className="font-bold">ปิด</button></div>}
          {tasksQuery.data && filteredTasks.length === 0 && scope !== 'today' && view !== 'calendar' && <div className="rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800"><EmptyState icon={<ListTodo className="h-9 w-9" />} title="ไม่มีงานที่ต้องแสดง" message="ลองเปลี่ยนตัวกรอง หรือสร้างงานใหม่จากช่องด้านบน" /></div>}

          {tasksQuery.data && scope === 'today' && <TaskTodayView tasks={todayPlanTasks} onSelect={setSelectedTaskId} />}
          {tasksQuery.data && scope !== 'today' && filteredTasks.length > 0 && view === 'kanban' && <TaskKanbanBoard tasks={filteredTasks} onSelect={setSelectedTaskId} />}
          {tasksQuery.data && scope !== 'today' && view === 'calendar' && <div className="overflow-x-auto"><TaskCalendarView tasks={filteredTasks} onSelect={setSelectedTaskId} onCreate={(dueDate) => { setCalendarCreateDate(dueDate); quickInputRef.current?.focus(); }} /></div>}

          {tasksQuery.data && scope !== 'today' && filteredTasks.length > 0 && view === 'list' && (
            <div className="space-y-2">
              {pagedTasks.map((task) => (
                <article key={task.id} className="grid cursor-pointer gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-card transition hover:border-primary-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-[minmax(0,1fr)_140px_120px_auto] sm:items-center" onClick={() => setSelectedTaskId(task.id)}>
                  <div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-semibold text-slate-400">{task.task_no}</span><h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{task.title}</h3><Badge variant={priorityTone[task.priority]}>{task.priority}</Badge></div><p className="truncate text-xs text-slate-500 dark:text-slate-400">{taskTypeLabel[task.task_type] ?? 'งานทั่วไป'} · {task.description || task.category}</p></div>
                  <TaskProgress value={task.progress} />
                  <div><Badge variant={statusTone[task.status]}>{task.status}</Badge><div className="mt-1"><DueBadge dueDate={task.due_date} dueDays={task.due_days} /></div></div>
                  <TaskActions task={task} pending={statusMutation.isPending && statusMutation.variables?.id === task.id} onView={() => setSelectedTaskId(task.id)} onStatus={(nextStatus) => changeStatus(task, nextStatus)} />
                </article>
              ))}
            </div>
          )}

          {tasksQuery.data && scope !== 'today' && filteredTasks.length > 0 && view === 'table' && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
              <DataTable mode="server" className="w-full min-w-[850px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900/50 dark:text-slate-300"><tr><th className="px-4 py-3">งาน</th><th className="px-3 py-3">ประเภท</th><th className="px-3 py-3">ความสำคัญ</th><th className="px-3 py-3">ครบกำหนด</th><th className="px-3 py-3">ความคืบหน้า</th><th className="px-3 py-3">สถานะ</th><th className="px-3 py-3">จัดการ</th></tr></thead>
                <tbody>{pagedTasks.map((task) => <tr key={task.id} onClick={() => setSelectedTaskId(task.id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40"><td className="max-w-[360px] px-4 py-3 font-semibold text-slate-800 dark:text-slate-100"><span className="mr-2 font-mono text-[10px] text-slate-400">{task.task_no}</span>{task.title}</td><td className="px-3 py-3 text-slate-500">{taskTypeLabel[task.task_type] ?? 'งานทั่วไป'}</td><td className="px-3 py-3"><Badge variant={priorityTone[task.priority]}>{task.priority}</Badge></td><td className="px-3 py-3"><DueBadge dueDate={task.due_date} dueDays={task.due_days} /></td><td className="px-3 py-3"><TaskProgress value={task.progress} /></td><td className="px-3 py-3"><Badge variant={statusTone[task.status]}>{task.status}</Badge></td><td className="px-3 py-3"><TaskActions task={task} pending={statusMutation.isPending && statusMutation.variables?.id === task.id} onView={() => setSelectedTaskId(task.id)} onStatus={(nextStatus) => changeStatus(task, nextStatus)} /></td></tr>)}</tbody>
              </DataTable>
              <div className="border-t border-slate-100 px-4 py-3 text-right text-xs text-slate-400 dark:border-slate-700">แสดง {filteredTasks.length} จาก {tasks.length} งาน</div>
            </div>
          )}

          {tasksQuery.data && scope !== 'today' && filteredTasks.length > 0 && (view === 'list' || view === 'table') && <TablePagination page={currentPage} pageSize={pageSize} totalItems={filteredTasks.length} totalPages={pageCount} itemLabel="งาน" onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />}
        </main>
      </div>

      {selectedTaskId && <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} onDeleted={() => setToast({ tone: 'success', message: 'ลบงานสำเร็จ' })} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
