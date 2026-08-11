import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, GripVertical, Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Toast, type ToastMessage } from '../../components/ui/Toast';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Task } from '../../types/tasks';
import { formatThaiDate } from '../../utils/date';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES, TASK_TYPES, priorityTone, statusTone } from './taskDisplay';

const categoryEnum = z.enum(['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ']);
const priorityEnum = z.enum(['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน']);
const statusEnum = z.enum(['ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก']);
const recurrenceEnum = z.enum(['ไม่ทำซ้ำ', 'รายวัน', 'วันทำงาน', 'รายสัปดาห์', 'ทุก 2 สัปดาห์', 'รายเดือน', 'รายไตรมาส', 'ทุก 6 เดือน', 'รายปี', 'กำหนดเอง']);
const taskTypeEnum = z.enum(['general', 'meeting', 'follow_up', 'document', 'project', 'system_development', 'personal', 'other']);

const editSchema = z
  .object({
    title: z.string().trim().min(1, 'กรุณาระบุชื่องาน'),
    description: z.string().trim().optional(),
    taskType: taskTypeEnum,
    category: categoryEnum,
    priority: priorityEnum,
    status: statusEnum,
    startDate: z.string().optional(),
    dueDate: z.string().optional(),
    startTime: z.string().optional(),
    dueTime: z.string().optional(),
    progress: z.coerce.number().min(0).max(100).optional(),
    tags: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    recurrence: recurrenceEnum,
    recurrenceRule: z.object({
      frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
      interval: z.coerce.number().int().min(1).max(99),
    }).optional(),
    recurrenceEndDate: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
      ctx.addIssue({ code: 'custom', message: 'วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม', path: ['dueDate'] });
    }
    if (data.recurrence !== 'ไม่ทำซ้ำ' && !data.dueDate) {
      ctx.addIssue({ code: 'custom', message: 'งานประจำต้องระบุวันครบกำหนดรอบแรก', path: ['dueDate'] });
    }
  });
type EditForm = z.infer<typeof editSchema>;

function labelCls() {
  return 'mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300';
}
function inputCls() {
  return 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
}

const REMINDER_PRESETS = [
  { value: 'at_time', label: 'เวลาที่ครบกำหนด', minutes: 0 },
  { value: 'before_15m', label: 'ก่อน 15 นาที', minutes: 15 },
  { value: 'before_30m', label: 'ก่อน 30 นาที', minutes: 30 },
  { value: 'before_1h', label: 'ก่อน 1 ชั่วโมง', minutes: 60 },
  { value: 'before_3h', label: 'ก่อน 3 ชั่วโมง', minutes: 180 },
  { value: 'before_1d', label: 'ก่อน 1 วัน', minutes: 1440 },
  { value: 'before_3d', label: 'ก่อน 3 วัน', minutes: 4320 },
  { value: 'custom', label: 'กำหนดเอง', minutes: null },
] as const;

type ReminderPreset = (typeof REMINDER_PRESETS)[number]['value'];

function bangkokDateTimeInput(iso: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function reminderDateTimeForPreset(task: Task, preset: ReminderPreset) {
  if (!task.due_date) return '';
  const config = REMINDER_PRESETS.find((item) => item.value === preset);
  if (!config || config.minutes === null) return '';
  const dueAt = Date.parse(`${task.due_date}T${task.due_time?.slice(0, 5) ?? '09:00'}:00+07:00`);
  return bangkokDateTimeInput(new Date(dueAt - (config.minutes * 60_000)).toISOString());
}

function EditTaskForm({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      title: task.title,
      description: task.description ?? '',
      taskType: task.task_type,
      category: task.category,
      priority: task.priority,
      status: task.status,
      startDate: task.start_date ?? '',
      dueDate: task.due_date ?? '',
      startTime: task.start_time?.slice(0, 5) ?? '',
      dueTime: task.due_time?.slice(0, 5) ?? '',
      progress: task.progress,
      tags: task.tags ?? '',
      notes: task.notes ?? '',
      recurrence: task.recurrence,
      recurrenceRule: task.recurrence_rule ?? { frequency: 'daily', interval: 1 },
      recurrenceEndDate: task.recurrence_end_date ?? '',
    },
  });
  const recurrence = watch('recurrence');

  const mutation = useMutation({
    mutationFn: (values: EditForm) => apiFetch(`/api/v1/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => {
      setServerError(null);
      setToast({ tone: 'success', message: 'อัปเดตงานสำเร็จ' });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'บันทึกการแก้ไขไม่สำเร็จ'),
  });

  return (
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="sm:col-span-2">
        <label htmlFor="td-title" className={labelCls()}>
          ชื่องาน
        </label>
        <input id="td-title" className={inputCls()} {...register('title')} />
        {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
      </div>

      <div>
        <label htmlFor="td-task-type" className={labelCls()}>
          ประเภทงาน
        </label>
        <select id="td-task-type" className={inputCls()} {...register('taskType')}>
          {TASK_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="td-description" className={labelCls()}>
          รายละเอียด
        </label>
        <textarea id="td-description" rows={2} className={inputCls()} {...register('description')} />
      </div>

      <div>
        <label htmlFor="td-category" className={labelCls()}>
          หมวดหมู่
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
        <label htmlFor="td-start-time" className={labelCls()}>
          เวลาเริ่ม
        </label>
        <input id="td-start-time" type="time" className={inputCls()} {...register('startTime')} />
      </div>

      <div>
        <label htmlFor="td-due-time" className={labelCls()}>
          เวลาครบกำหนด
        </label>
        <input id="td-due-time" type="time" className={inputCls()} {...register('dueTime')} />
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

      {recurrence === 'กำหนดเอง' && (
        <div className="grid grid-cols-[90px_1fr] gap-2 sm:col-span-2">
          <div>
            <label htmlFor="td-recurrence-interval" className={labelCls()}>
              ทุก ๆ
            </label>
            <input id="td-recurrence-interval" type="number" min={1} max={99} className={inputCls()} {...register('recurrenceRule.interval')} />
          </div>
          <div>
            <label htmlFor="td-recurrence-frequency" className={labelCls()}>
              หน่วย
            </label>
            <select id="td-recurrence-frequency" className={inputCls()} {...register('recurrenceRule.frequency')}>
              <option value="daily">วัน</option>
              <option value="weekly">สัปดาห์</option>
              <option value="monthly">เดือน</option>
              <option value="yearly">ปี</option>
            </select>
          </div>
        </div>
      )}

      {recurrence !== 'ไม่ทำซ้ำ' && (
        <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
          ระบบจะสร้างงานรอบถัดไปเมื่อรอบปัจจุบันเสร็จแล้วเท่านั้น และจะคัดลอก Checklist โดยรีเซ็ตสถานะให้เริ่มใหม่
        </p>
      )}

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
        <Button type="submit" size="sm" isLoading={mutation.isPending} disabled={mutation.isPending} data-testid="td-save">
          บันทึกการแก้ไข
        </Button>
      </div>
    </form>
  );
}

function ReminderSection({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const current = task.reminders.find((reminder) => reminder.status !== 'cancelled');
  const [preset, setPreset] = useState<ReminderPreset>(current?.preset ?? 'before_30m');
  const [remindAt, setRemindAt] = useState(() => current ? bangkokDateTimeInput(current.snoozed_until ?? current.remind_at) : reminderDateTimeForPreset(task, 'before_30m'));
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
  };

  useEffect(() => {
    const reminder = task.reminders.find((item) => item.status !== 'cancelled');
    setPreset(reminder?.preset ?? 'before_30m');
    setRemindAt(reminder ? bangkokDateTimeInput(reminder.snoozed_until ?? reminder.remind_at) : reminderDateTimeForPreset(task, 'before_30m'));
  }, [task]);

  const saveMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/reminder`, {
      method: 'PUT',
      body: JSON.stringify({ remindAt: new Date(`${remindAt}:00+07:00`).toISOString(), preset }),
    }),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'บันทึกการแจ้งเตือนไม่สำเร็จ'),
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/reminder`, { method: 'DELETE' }),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'ยกเลิกการแจ้งเตือนไม่สำเร็จ'),
  });

  const statusLabel = current?.status === 'sent' ? 'แจ้งแล้ว' : current?.status === 'snoozed' ? 'Snooze อยู่' : current ? 'รอแจ้ง' : 'ยังไม่ตั้งเตือน';
  const disabled = task.status === 'เสร็จแล้ว' || task.status === 'ยกเลิก';

  return (
    <section className="rounded-lg border border-primary-100 bg-primary-50/50 p-3 dark:border-primary-900 dark:bg-primary-950/20">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><BellRing className="h-4 w-4 text-primary-600" /> การแจ้งเตือน</h3>
        <Badge variant={current?.status === 'sent' ? 'success' : current ? 'warning' : 'secondary'}>{statusLabel}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ช่วงเวลา
          <select value={preset} disabled={disabled} onChange={(event) => { const value = event.target.value as ReminderPreset; setPreset(value); const calculated = reminderDateTimeForPreset(task, value); if (calculated) setRemindAt(calculated); }} className={`${inputCls()} mt-1`}>
            {REMINDER_PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">แจ้งเมื่อ
          <input type="datetime-local" value={remindAt} disabled={disabled} onChange={(event) => { setPreset('custom'); setRemindAt(event.target.value); }} className={`${inputCls()} mt-1`} />
        </label>
      </div>
      {!task.due_date && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Preset ต้องมีวันครบกำหนดก่อน หรือเลือก “กำหนดเอง” แล้วระบุเวลา</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" isLoading={saveMutation.isPending} disabled={disabled || !remindAt} onClick={() => saveMutation.mutate()}>บันทึกการเตือน</Button>
        {current && <Button type="button" size="sm" variant="outline" isLoading={cancelMutation.isPending} disabled={disabled} onClick={() => cancelMutation.mutate()}>ยกเลิกการเตือน</Button>}
      </div>
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">ส่งเข้า Notification Center ภายในระบบตามเวลา Asia/Bangkok</p>
    </section>
  );
}

function DeleteTaskSection({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
      onDeleted();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'ไม่สามารถลบงานได้ กรุณาลองใหม่อีกครั้ง'),
  });

  if (task.status === 'ยกเลิก') return null;

  return (
    <section className="rounded-lg border border-red-100 bg-red-50/70 p-3 dark:border-red-900 dark:bg-red-950/20">
      {!confirming ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-red-700 dark:text-red-300">ลบงาน</h3>
            <p className="text-xs text-red-600/80 dark:text-red-300/80">งานจะถูกย้ายเป็นสถานะยกเลิกและยังสามารถกู้คืนได้</p>
          </div>
          <Button type="button" size="sm" variant="danger" onClick={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> ลบงาน
          </Button>
        </div>
      ) : (
        <div role="alertdialog" aria-labelledby="delete-task-title">
          <h3 id="delete-task-title" className="text-sm font-bold text-red-700 dark:text-red-300">ยืนยันลบ “{task.title}”?</h3>
          <p className="mt-1 text-xs text-red-600/80 dark:text-red-300/80">การดำเนินการนี้จะซ่อนงานจากรายการงานที่เปิดอยู่</p>
          {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => setConfirming(false)}>ไม่ลบ</Button>
            <Button type="button" size="sm" variant="danger" isLoading={mutation.isPending} onClick={() => mutation.mutate()}>ยืนยันลบงาน</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SubtasksSection({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
  };

  const addMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/subtasks`, { method: 'POST', body: JSON.stringify({ title }) }),
    onSuccess: () => {
      setTitle('');
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'เพิ่มรายการย่อยไม่สำเร็จ'),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ต้องทำ' | 'เสร็จแล้ว' }) =>
      apiFetch(`/api/v1/tasks/subtasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'อัปเดตรายการย่อยไม่สำเร็จ'),
  });
  const editMutation = useMutation({
    mutationFn: ({ id, nextTitle }: { id: string; nextTitle: string }) => apiFetch(`/api/v1/tasks/subtasks/${id}/detail`, { method: 'PATCH', body: JSON.stringify({ title: nextTitle }) }),
    onSuccess: () => {
      setEditingId(null);
      setEditingTitle('');
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'แก้ไขรายการย่อยไม่สำเร็จ'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/tasks/subtasks/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'ลบรายการย่อยไม่สำเร็จ'),
  });
  const reorderMutation = useMutation({
    mutationFn: ({ sourceId, sourceOrder, targetId, targetOrder }: { sourceId: string; sourceOrder: number; targetId: string; targetOrder: number }) => Promise.all([
      apiFetch(`/api/v1/tasks/subtasks/${sourceId}/reorder`, { method: 'POST', body: JSON.stringify({ sortOrder: targetOrder }) }),
      apiFetch(`/api/v1/tasks/subtasks/${targetId}/reorder`, { method: 'POST', body: JSON.stringify({ sortOrder: sourceOrder }) }),
    ]),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'เรียงลำดับรายการย่อยไม่สำเร็จ'),
  });

  const visible = task.subtasks.filter((s) => s.status !== 'ยกเลิก').sort((a, b) => a.sort_order - b.sort_order);
  const done = visible.filter((s) => s.status === 'เสร็จแล้ว').length;
  const progress = visible.length ? Math.round((done / visible.length) * 100) : 0;
  const busy = toggleMutation.isPending || deleteMutation.isPending || editMutation.isPending || reorderMutation.isPending;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
        Checklist ({done}/{visible.length})
      </h3>
      {visible.length > 0 && (
        <div className="flex items-center gap-2" aria-label={`ความคืบหน้า Checklist ${progress}%`}>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-primary-600 transition-all" style={{ width: `${progress}%` }} /></div>
          <span className="w-9 text-right text-xs font-semibold text-slate-500">{progress}%</span>
        </div>
      )}
      {visible.length > 0 && (
        <ul className="flex flex-col gap-1">
          {visible.map((s) => (
            <li
              key={s.id}
              draggable={!busy && editingId !== s.id}
              onDragStart={(event) => event.dataTransfer.setData('text/task-subtask-id', s.id)}
              onDragOver={(event) => { event.preventDefault(); setDragOverId(s.id); }}
              onDragLeave={() => setDragOverId((id) => id === s.id ? null : id)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOverId(null);
                const sourceId = event.dataTransfer.getData('text/task-subtask-id');
                const source = visible.find((item) => item.id === sourceId);
                if (source && source.id !== s.id) reorderMutation.mutate({ sourceId: source.id, sourceOrder: source.sort_order, targetId: s.id, targetOrder: s.sort_order });
              }}
              className={`flex min-h-9 items-center gap-2 rounded-lg border px-2 text-sm transition ${dragOverId === s.id ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/30' : 'border-transparent hover:border-slate-200 dark:hover:border-slate-700'}`}
            >
              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-300" aria-hidden="true" />
              <input
                type="checkbox"
                checked={s.status === 'เสร็จแล้ว'}
                disabled={busy}
                aria-label={`ทำรายการย่อย ${s.title} ให้เสร็จ`}
                onChange={(e) => toggleMutation.mutate({ id: s.id, status: e.target.checked ? 'เสร็จแล้ว' : 'ต้องทำ' })}
              />
              {editingId === s.id ? (
                <input aria-label={`แก้ไขรายการย่อย ${s.title}`} value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && editingTitle.trim()) editMutation.mutate({ id: s.id, nextTitle: editingTitle.trim() }); if (event.key === 'Escape') setEditingId(null); }} className="h-8 min-w-0 flex-1 rounded-md border border-primary-300 px-2 dark:border-primary-700 dark:bg-slate-900" autoFocus />
              ) : (
                <span className={s.status === 'เสร็จแล้ว' ? 'min-w-0 flex-1 text-slate-400 line-through' : 'min-w-0 flex-1 text-slate-700 dark:text-slate-200'}>{s.title}</span>
              )}
              {editingId === s.id ? (
                <button type="button" title="บันทึกรายการย่อย" aria-label={`บันทึกรายการย่อย ${s.title}`} disabled={!editingTitle.trim() || editMutation.isPending} onClick={() => editMutation.mutate({ id: s.id, nextTitle: editingTitle.trim() })} className="grid h-7 w-7 place-items-center rounded text-primary-700 hover:bg-primary-50 disabled:opacity-50"><Save className="h-3.5 w-3.5" /></button>
              ) : (
                <button type="button" title="แก้ไขรายการย่อย" aria-label={`แก้ไขรายการย่อย ${s.title}`} disabled={busy} onClick={() => { setEditingId(s.id); setEditingTitle(s.title); }} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-primary-600 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
              )}
              <button type="button" title="ลบรายการย่อย" aria-label={`ลบรายการย่อย ${s.title}`} disabled={busy} onClick={() => deleteMutation.mutate(s.id)} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50">
                {deleteMutation.isPending && deleteMutation.variables === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
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
  const [error, setError] = useState<string | null>(null);
  const hasChecklist = task.subtasks.some((item) => item.status !== 'ยกเลิก');

  useEffect(() => setProgress(task.progress), [task.progress]);

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${task.id}/progress-logs`, { method: 'POST', body: JSON.stringify({ progress: hasChecklist ? undefined : progress, note }) }),
    onSuccess: () => {
      setNote('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'บันทึกความคืบหน้าไม่สำเร็จ'),
  });

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">บันทึกความคืบหน้า</h3>
      {hasChecklist && <p className="rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-700 dark:bg-primary-950/30 dark:text-primary-200">ความคืบหน้า {task.progress}% คำนวณอัตโนมัติจาก Checklist</p>}
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
            disabled={hasChecklist}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="flex-1 disabled:cursor-not-allowed disabled:opacity-50"
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
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
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

export function TaskDetailPanel({ taskId, onClose, onDeleted }: { taskId: string; onClose: () => void; onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const taskQuery = useQuery({
    queryKey: ['tasks', taskId],
    queryFn: () => apiFetch<Task>(`/api/v1/tasks/${taskId}`),
  });

  const restoreMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tasks/${taskId}/restore`, { method: 'POST' }),
    onMutate: () => setRestoreError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
    },
    onError: (e) => setRestoreError(e instanceof ApiError ? e.message : 'กู้คืนงานไม่สำเร็จ'),
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

        {taskQuery.isError && <p role="alert" className="px-4 py-6 text-sm text-red-600">โหลดรายละเอียดงานไม่สำเร็จ กรุณาปิดแล้วลองใหม่</p>}

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
            {restoreError && <p role="alert" className="text-xs text-red-600">{restoreError}</p>}

            <EditTaskForm task={task} />
            <ReminderSection task={task} />
            <DeleteTaskSection task={task} onDeleted={() => { onClose(); onDeleted?.(); }} />
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
