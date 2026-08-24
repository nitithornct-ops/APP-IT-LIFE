import { DataTable, TablePagination } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  CheckCircle2,
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
  Repeat2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Table2,
  TicketCheck,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTableParams } from '../../hooks/useTableParams';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FilterBar, filterControlClass } from '../../components/ui/FilterBar';
import { KpiStrip } from '../../components/ui/KpiStrip';
import { PageHeader } from '../../components/ui/PageHeader';
import { Toast, type ToastMessage } from '../../components/ui/Toast';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { apiFetch, ApiError } from '../../services/apiClient';
import { downloadCsv } from '../../utils/csv';
import type { Task, TaskDashboard, TaskStatus, TaskType } from '../../types/tasks';
import { formatThaiDate } from '../../utils/date';
import { cn } from '../../utils/cn';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskCalendarView } from './TaskCalendarView';
import { TaskDetailPanel } from './TaskDetailPanel';
import { TaskKanbanBoard } from './TaskKanbanBoard';
import { TaskTodayView } from './TaskTodayView';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, priorityTone, statusTone, taskTypeLabel } from './taskDisplay';

type View = 'list' | 'kanban' | 'calendar' | 'table';
type Scope = 'focus' | 'today' | 'todayOnly' | 'all' | 'inProgress' | 'calendar' | 'recurring' | 'completed' | 'overdue' | 'dueSoon' | 'next7';
const VIEW_STORAGE_KEY = 'itlife-my-tasks-view';

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

export function TaskActions({
  task,
  statusPending,
  deletePending,
  onView,
  onEdit,
  onStatus,
  onDelete,
}: {
  task: Task;
  statusPending: boolean;
  deletePending: boolean;
  onView: () => void;
  onEdit: () => void;
  onStatus: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  const isTerminal = TERMINAL_STATUSES.includes(task.status);

  // งานที่ปิดไปแล้วเปลี่ยนสถานะไม่ได้ แต่ยังดู แก้ไข หรือลบแบบ soft delete ได้
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <RowActions
        recordLabel={task.title}
        className="gap-0.5 [&_a]:h-8 [&_a]:w-8 [&_a]:justify-center [&_a]:px-0 [&_a]:text-[0] [&_button]:h-8 [&_button]:w-8 [&_button]:justify-center [&_button]:px-0 [&_button]:text-[0]"
        actions={[
          { kind: 'view', label: 'ดู', disabled: statusPending || deletePending, onClick: onView },
          { kind: 'edit', label: 'แก้ไข', disabled: statusPending || deletePending, onClick: onEdit },
          { kind: 'custom', icon: statusPending ? Loader2 : CirclePlay, label: 'เริ่มงาน', disabled: statusPending || deletePending, hidden: isTerminal || task.status === 'กำลังทำ', onClick: () => onStatus('กำลังทำ') },
          { kind: 'custom', icon: statusPending ? Loader2 : Check, label: 'ทำงานเสร็จ', disabled: statusPending || deletePending, hidden: isTerminal, onClick: () => onStatus('เสร็จแล้ว') },
          {
            kind: 'cancel',
            label: 'ยกเลิกงาน',
            hidden: isTerminal,
            disabled: deletePending,
            isPending: statusPending,
            confirmDescription: 'งานนี้จะถูกยกเลิก แต่ยังอยู่ในรายการและประวัติการทำงานเพื่อการตรวจสอบย้อนหลัง',
            onConfirm: () => onStatus('ยกเลิก'),
          },
          {
            kind: 'delete',
            label: 'ลบ',
            hidden: task.status === 'ยกเลิก',
            disabled: statusPending,
            isPending: deletePending,
            confirmTitle: `ยืนยันลบ “${task.title}”?`,
            confirmDescription: 'งานจะถูกย้ายเป็นสถานะยกเลิกและซ่อนจากรายการงานที่เปิดอยู่ โดยระบบยังเก็บประวัติไว้สำหรับการตรวจสอบย้อนหลัง',
            onConfirm: onDelete,
          },
        ]}
      />
    </div>
  );
}

function TaskPreviewPane({ task, onClose, onOpenDetail }: { task: Task; onClose: () => void; onOpenDetail: () => void }) {
  const checklist = task.subtasks.filter((item) => item.status !== 'ยกเลิก');
  const checklistDone = checklist.filter((item) => item.status === 'เสร็จแล้ว').length;
  const tags = (task.tags ?? '').split(/[#/,\s]+/).map((tag) => tag.trim()).filter(Boolean);

  return (
    <aside className="min-w-0 overflow-hidden rounded-card border border-hairline bg-white shadow-card dark:border-white/[.08] dark:bg-white/[.035]" aria-label="รายละเอียดงานที่เลือก">
      <div className="flex h-11 items-center gap-2 border-b border-hairline-row px-3 dark:border-white/[.07]">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[.1em] text-slate-500 dark:text-white/45">รายละเอียดงาน</span>
        <span className="ml-auto font-mono text-[10px] font-semibold text-primary-700 dark:text-primary-300">{task.task_no}</span>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[7px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[.07] dark:hover:text-white" aria-label="ปิดแผงรายละเอียดงาน">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusTone[task.status]}>{task.status}</Badge>
            <Badge variant={priorityTone[task.priority]}>{task.priority}</Badge>
            <span className="text-[11px] text-slate-400">{taskTypeLabel[task.task_type] ?? 'งานทั่วไป'}</span>
          </div>
          <h2 className="mt-2 text-lg font-extrabold leading-snug text-ink-heading dark:text-[#e8eef9]">{task.title}</h2>
          <p className="mt-2 text-[13px] leading-6 text-slate-600 dark:text-white/62">{task.description || 'ยังไม่มีรายละเอียดเพิ่มเติมสำหรับงานนี้'}</p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold text-slate-600 dark:text-slate-300">ความคืบหน้า</span><span className="font-mono font-bold text-primary-700 dark:text-primary-300">{task.progress}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-primary-600" style={{ width: `${task.progress}%` }} /></div>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-[9px] bg-surface-header p-3 dark:bg-white/[.035]"><dt className="text-[10px] text-slate-400">ครบกำหนด</dt><dd className="mt-1 font-semibold"><DueBadge dueDate={task.due_date} dueDays={task.due_days} /></dd></div>
          <div className="rounded-[9px] bg-surface-header p-3 dark:bg-white/[.035]"><dt className="text-[10px] text-slate-400">Checklist</dt><dd className="mt-1 font-mono font-semibold text-slate-700 dark:text-slate-200">{checklistDone} / {checklist.length}</dd></div>
          <div className="rounded-[9px] bg-surface-header p-3 dark:bg-white/[.035]"><dt className="text-[10px] text-slate-400">หมวดหมู่</dt><dd className="mt-1 font-semibold text-slate-700 dark:text-slate-200">{task.category}</dd></div>
          <div className="rounded-[9px] bg-surface-header p-3 dark:bg-white/[.035]"><dt className="text-[10px] text-slate-400">ทำซ้ำ</dt><dd className="mt-1 font-semibold text-slate-700 dark:text-slate-200">{task.recurrence}</dd></div>
        </dl>

        {checklist.length > 0 && (
          <section className="border-y border-hairline-row py-3 dark:border-white/[.07]">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold text-slate-700 dark:text-slate-200">งานย่อย</h3><span className="font-mono text-[10px] text-slate-400">{checklistDone}/{checklist.length}</span></div>
            <ul className="space-y-2">
              {checklist.slice(0, 4).map((item) => <li key={item.id} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300"><span className={cn('mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border', item.status === 'เสร็จแล้ว' ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 dark:border-slate-600')}>{item.status === 'เสร็จแล้ว' && <Check className="h-2.5 w-2.5" />}</span><span className={item.status === 'เสร็จแล้ว' ? 'text-slate-400 line-through' : ''}>{item.title}</span></li>)}
            </ul>
          </section>
        )}

        {tags.length > 0 && <div className="flex flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} className="rounded-full bg-primary-50 px-2 py-1 text-[10px] font-semibold text-primary-700 dark:bg-primary-900/35 dark:text-primary-200">#{tag}</span>)}</div>}

        <Button type="button" size="sm" className="w-full" onClick={onOpenDetail}>เปิดรายละเอียดและดำเนินการ</Button>
      </div>
    </aside>
  );
}

export function TasksPage() {
  const queryClient = useQueryClient();
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
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [createModal, setCreateModal] = useState<{ dueDate?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
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
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null;
  const activeFilterCount = [search, status, priority, taskType, category, dueFrom, dueTo].filter(Boolean).length;

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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/tasks/${id}`, { method: 'DELETE' }),
    onMutate: () => setActionError(null),
    onSuccess: (_data, id) => {
      setSelectedTaskId((current) => current === id ? null : current);
      setDetailTaskId((current) => current === id ? null : current);
      setToast({ tone: 'success', message: 'ลบงานสำเร็จ' });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : 'ลบงานไม่สำเร็จ กรุณาลองใหม่'),
  });

  const deleteTask = (task: Task) => {
    if (deleteMutation.isPending || statusMutation.isPending) return;
    deleteMutation.mutate(task.id);
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
      <PageHeader
        eyebrow={<span className="flex items-center gap-1.5"><Sparkles className="h-3 w-3" /> Personal task board · 001</span>}
        title="งานของฉัน"
        description="งานที่คุณเป็นเจ้าของ จัดลำดับ ติดตาม และอัปเดตได้จากหน้าจอเดียว"
        leading={<ListTodo className="h-5 w-5" aria-hidden="true" />}
        secondaryActions={<Button type="button" size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4" aria-hidden="true" /> CSV</Button>}
        primaryAction={<Button type="button" size="sm" onClick={() => setCreateModal({})}><Plus className="h-4 w-4" aria-hidden="true" /> สร้างงานใหม่</Button>}
      />

      <KpiStrip
        label="สรุปงานของฉัน"
        items={[
          { key: 'open', label: 'งานที่เปิดอยู่', value: summary.open, note: 'งานที่ยังไม่จบ', icon: <TicketCheck className="h-4 w-4" />, active: scope === 'focus', onClick: () => setScope('focus') },
          { key: 'today', label: 'ครบกำหนดวันนี้', value: summary.today, note: 'ต้องจัดการวันนี้', icon: <Sun className="h-4 w-4" />, active: scope === 'todayOnly', onClick: () => setScope('todayOnly') },
          { key: 'dueSoon', label: 'ใกล้ครบกำหนด', value: summary.dueSoon, note: 'ภายใน 3 วัน', icon: <Clock3 className="h-4 w-4" />, active: scope === 'dueSoon', onClick: () => setScope('dueSoon') },
          { key: 'overdue', label: 'เลยกำหนด', value: summary.overdue, note: 'ควรจัดการก่อน', icon: <ShieldAlert className="h-4 w-4" />, active: scope === 'overdue', onClick: () => setScope('overdue') },
          { key: 'inProgress', label: 'กำลังทำ', value: summary.inProgress, note: 'อยู่ระหว่างดำเนินการ', icon: <CirclePlay className="h-4 w-4" />, active: scope === 'inProgress', onClick: () => setScope('inProgress') },
          { key: 'completed', label: 'เสร็จแล้ว', value: summary.completed, note: 'ปิดงานเรียบร้อย', icon: <CheckCircle2 className="h-4 w-4" />, active: scope === 'completed', onClick: () => setScope('completed') },
          { key: 'average', label: 'ความคืบหน้าเฉลี่ย', value: `${summary.averageProgress}%`, note: 'ทุกงานของคุณ', icon: <Gauge className="h-4 w-4" />, active: scope === 'all', onClick: () => setScope('all') },
        ]}
      />

      <section className="space-y-0" aria-label="รายการงานของฉัน">
        <div className="flex flex-col gap-2 rounded-t-card border border-b-0 border-hairline bg-white px-3 py-2 shadow-card dark:border-white/[.08] dark:bg-white/[.035] xl:flex-row xl:items-center xl:justify-between">
          <nav className="flex min-w-0 gap-1 overflow-x-auto" aria-label="กลุ่มงาน">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.scope} type="button" onClick={() => setTaskScope(item.scope, item.view)} aria-pressed={scope === item.scope} className={cn('flex h-9 shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-semibold', scope === item.scope ? 'bg-primary-700 text-white shadow-action' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[.07]')}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" /><span>{item.label}</span>{item.count !== undefined && <span className={cn('font-mono text-[9px]', scope === item.scope ? 'text-white/75' : 'text-slate-400')}>{item.count}</span>}
                </button>
              );
            })}
          </nav>
          <div className="flex w-fit shrink-0 items-center rounded-[7px] border border-hairline-control bg-surface-header p-1 dark:border-white/[.1] dark:bg-white/[.035]" aria-label="มุมมองงาน">
            {viewItems.map((item) => {
              const Icon = item.icon;
              return <button key={item.value} type="button" onClick={() => { setView(item.value); if (scope === 'today') setScope('all'); }} aria-pressed={view === item.value && scope !== 'today'} className={cn('flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-semibold', view === item.value && scope !== 'today' ? 'bg-primary-700 text-white shadow-sm' : 'text-slate-500 hover:bg-white dark:text-slate-300 dark:hover:bg-white/[.07]')}><Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden sm:inline">{item.label}</span></button>;
            })}
          </div>
        </div>

        <FilterBar
          className="rounded-none border-b-0 shadow-none"
          searchValue={search}
          onSearchChange={(value) => table.setFilter('q', value, { replace: true })}
          searchLabel="ค้นหางาน"
          searchPlaceholder="ค้นหาเลขที่งาน ชื่อ รายละเอียด หมวดหมู่ หรือแท็ก"
          filters={<>
            <select aria-label="กรองสถานะ" value={status} onChange={(event) => table.setFilter('status', event.target.value)} className={`${filterControlClass} flex-1 xl:max-w-40`}><option value="">สถานะ: ทั้งหมด</option>{TASK_STATUSES.map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="กรองความสำคัญ" value={priority} onChange={(event) => table.setFilter('priority', event.target.value)} className={`${filterControlClass} flex-1 xl:max-w-40`}><option value="">ความสำคัญ: ทั้งหมด</option>{TASK_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="กรองประเภทงาน" value={taskType} onChange={(event) => table.setFilter('type', event.target.value)} className={`${filterControlClass} flex-1 xl:max-w-44`}><option value="">ประเภท: ทั้งหมด</option>{TASK_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          </>}
          actions={<Button type="button" size="sm" variant="ghost" onClick={() => setShowAdvancedFilters((value) => !value)} aria-expanded={showAdvancedFilters}><SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> ตัวกรองเพิ่มเติม</Button>}
          onClear={() => table.setFilters({ q: '', status: '', priority: '', type: '', category: '', dueFrom: '', dueTo: '', scope: 'focus' })}
          activeFilterCount={activeFilterCount}
          resultCount={filteredTasks.length}
          itemLabel="งาน"
        />

        {showAdvancedFilters && (
          <div className="grid gap-2 border-x border-b border-hairline bg-surface-header p-3 dark:border-white/[.08] dark:bg-white/[.025] sm:grid-cols-3">
            <select aria-label="กรองหมวดหมู่" value={category} onChange={(event) => table.setFilter('category', event.target.value)} className={filterControlClass}><option value="">หมวดหมู่: ทั้งหมด</option>{TASK_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select>
            <label className={`${filterControlClass} flex items-center gap-2`}><span className="shrink-0 text-slate-400">จาก</span><input aria-label="วันครบกำหนดตั้งแต่" type="date" value={dueFrom} onChange={(event) => table.setFilter('dueFrom', event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs" /></label>
            <label className={`${filterControlClass} flex items-center gap-2`}><span className="shrink-0 text-slate-400">ถึง</span><input aria-label="วันครบกำหนดถึง" type="date" value={dueTo} min={dueFrom || undefined} onChange={(event) => table.setFilter('dueTo', event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs" /></label>
          </div>
        )}

        {actionError && <div role="alert" className="flex items-center justify-between gap-3 border-x border-t border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label="ปิดข้อความผิดพลาด" className="font-bold">ปิด</button></div>}

        <div className={cn('grid items-start gap-3', selectedTask && view !== 'calendar' && 'xl:grid-cols-[minmax(0,1fr)_minmax(330px,.55fr)]')}>
          <div className="min-w-0">
            {tasksQuery.isLoading && <div className="grid min-h-[240px] place-items-center rounded-b-card border border-hairline bg-white dark:border-white/[.08] dark:bg-white/[.035]" role="status"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}
            {tasksQuery.isError && <div className="rounded-b-card border border-red-200 bg-red-50 p-5 text-sm text-red-700">โหลดรายการงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>}
            {tasksQuery.data && filteredTasks.length === 0 && scope !== 'today' && view !== 'calendar' && <div className="rounded-b-card border border-hairline bg-white shadow-card dark:border-white/[.08] dark:bg-white/[.035]"><EmptyState icon={<ListTodo className="h-9 w-9" />} title="ไม่มีงานที่ต้องแสดง" message="ลองเปลี่ยนตัวกรอง หรือสร้างงานใหม่จากช่องด้านบน" /></div>}

            {tasksQuery.data && scope === 'today' && <TaskTodayView tasks={todayPlanTasks} onSelect={setSelectedTaskId} />}
            {tasksQuery.data && scope !== 'today' && filteredTasks.length > 0 && view === 'kanban' && <TaskKanbanBoard tasks={filteredTasks} onSelect={setSelectedTaskId} />}
            {tasksQuery.data && scope !== 'today' && view === 'calendar' && <div className="overflow-x-auto"><TaskCalendarView tasks={filteredTasks} onSelect={setSelectedTaskId} onCreate={(dueDate) => setCreateModal({ dueDate })} /></div>}

            {tasksQuery.data && scope !== 'today' && filteredTasks.length > 0 && view === 'list' && (
              <div className="overflow-hidden rounded-b-card border border-hairline bg-white shadow-card dark:border-white/[.08] dark:bg-white/[.035]">
                <div className="hidden grid-cols-[minmax(0,1fr)_130px_125px_210px] gap-3 bg-surface-header px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[.08em] text-slate-400 sm:grid"><span>งาน</span><span>ความคืบหน้า</span><span>สถานะ / กำหนด</span><span className="text-right">จัดการ</span></div>
                <div className="divide-y divide-hairline-row dark:divide-white/[.07]">
                  {pagedTasks.map((task) => (
                    <article key={task.id} aria-selected={selectedTaskId === task.id} className={cn('grid cursor-pointer gap-3 px-4 py-3 transition hover:bg-primary-50/60 dark:hover:bg-white/[.05] sm:grid-cols-[minmax(0,1fr)_130px_125px_210px] sm:items-center', selectedTaskId === task.id && 'bg-primary-50 dark:bg-primary-900/25')} onClick={() => setSelectedTaskId((current) => current === task.id ? null : task.id)}>
                      <div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-semibold text-primary-700 dark:text-primary-300">{task.task_no}</span><h3 className="min-w-0 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{task.title}</h3><Badge variant={priorityTone[task.priority]}>{task.priority}</Badge></div><p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{taskTypeLabel[task.task_type] ?? 'งานทั่วไป'} · {task.description || task.category}</p></div>
                      <TaskProgress value={task.progress} />
                      <div><Badge variant={statusTone[task.status]}>{task.status}</Badge><div className="mt-1"><DueBadge dueDate={task.due_date} dueDays={task.due_days} /></div></div>
                      <TaskActions
                        task={task}
                        statusPending={statusMutation.isPending && statusMutation.variables?.id === task.id}
                        deletePending={deleteMutation.isPending && deleteMutation.variables === task.id}
                        onView={() => setSelectedTaskId(task.id)}
                        onEdit={() => setDetailTaskId(task.id)}
                        onStatus={(nextStatus) => changeStatus(task, nextStatus)}
                        onDelete={() => deleteTask(task)}
                      />
                    </article>
                  ))}
                </div>
              </div>
            )}

            {tasksQuery.data && scope !== 'today' && filteredTasks.length > 0 && view === 'table' && (
              <DataTable mode="server" tableId="personal-tasks" rowNumberStart={(currentPage - 1) * pageSize + 1} cardOnMobile className="w-full min-w-[950px] text-left text-xs" containerClassName="rounded-b-card">
                <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900/50 dark:text-slate-300"><tr><th className="px-4 py-3">งาน</th><th className="px-3 py-3">ประเภท</th><th className="px-3 py-3">ความสำคัญ</th><th className="px-3 py-3">ครบกำหนด</th><th className="px-3 py-3">ความคืบหน้า</th><th className="px-3 py-3">สถานะ</th><th className="px-3 py-3">จัดการ</th></tr></thead>
                <tbody>{pagedTasks.map((task) => <tr key={task.id} aria-selected={selectedTaskId === task.id} onClick={() => setSelectedTaskId((current) => current === task.id ? null : task.id)} className={cn('cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40', selectedTaskId === task.id && 'bg-primary-50 dark:bg-primary-900/25')}><td className="max-w-[360px] px-4 py-3 font-semibold text-slate-800 dark:text-slate-100"><span className="mr-2 font-mono text-[10px] text-primary-700 dark:text-primary-300">{task.task_no}</span>{task.title}</td><td className="px-3 py-3 text-slate-500">{taskTypeLabel[task.task_type] ?? 'งานทั่วไป'}</td><td className="px-3 py-3"><Badge variant={priorityTone[task.priority]}>{task.priority}</Badge></td><td className="px-3 py-3"><DueBadge dueDate={task.due_date} dueDays={task.due_days} /></td><td className="px-3 py-3"><TaskProgress value={task.progress} /></td><td className="px-3 py-3"><Badge variant={statusTone[task.status]}>{task.status}</Badge></td><td className="px-3 py-3"><TaskActions task={task} statusPending={statusMutation.isPending && statusMutation.variables?.id === task.id} deletePending={deleteMutation.isPending && deleteMutation.variables === task.id} onView={() => setSelectedTaskId(task.id)} onEdit={() => setDetailTaskId(task.id)} onStatus={(nextStatus) => changeStatus(task, nextStatus)} onDelete={() => deleteTask(task)} /></td></tr>)}</tbody>
              </DataTable>
            )}

            {tasksQuery.data && scope !== 'today' && filteredTasks.length > 0 && (view === 'list' || view === 'table') && <TablePagination page={currentPage} pageSize={pageSize} totalItems={filteredTasks.length} totalPages={pageCount} itemLabel="งาน" onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />}
          </div>

          {selectedTask && view !== 'calendar' && <TaskPreviewPane task={selectedTask} onClose={() => setSelectedTaskId(null)} onOpenDetail={() => setDetailTaskId(selectedTask.id)} />}
        </div>
      </section>

      {createModal && <CreateTaskModal initialDueDate={createModal.dueDate} onClose={() => setCreateModal(null)} onCreated={() => { setCreateModal(null); setToast({ tone: 'success', message: 'สร้างงานสำเร็จ' }); }} />}
      {detailTaskId && <TaskDetailPanel taskId={detailTaskId} onClose={() => setDetailTaskId(null)} onDeleted={() => { setSelectedTaskId(null); setToast({ tone: 'success', message: 'ลบงานสำเร็จ' }); }} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
