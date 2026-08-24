import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { FormModal } from '../../components/ui/Modal';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { TaskStatus } from '../../types/tasks';
import { cn } from '../../utils/cn';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_RECURRENCES, TASK_TYPES } from './taskDisplay';

const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'กรุณาระบุชื่องาน').max(300),
    description: z.string().trim().max(2000).optional(),
    taskType: z.enum(['general', 'meeting', 'follow_up', 'document', 'project', 'system_development', 'personal', 'other']),
    category: z.enum(['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ']),
    priority: z.enum(['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน']),
    startDate: z.string().optional(),
    startTime: z.string().optional(),
    dueDate: z.string().optional(),
    dueTime: z.string().optional(),
    recurrence: z.enum(['ไม่ทำซ้ำ', 'รายวัน', 'วันทำงาน', 'รายสัปดาห์', 'ทุก 2 สัปดาห์', 'รายเดือน', 'รายไตรมาส', 'ทุก 6 เดือน', 'รายปี', 'กำหนดเอง']),
    recurrenceRule: z.object({
      frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
      interval: z.coerce.number().int().min(1).max(99),
    }).optional(),
    recurrenceEndDate: z.string().optional(),
    reminderPreset: z.enum(['none', 'at_time', 'before_15m', 'before_30m', 'before_1h', 'before_1d']),
    tags: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(1500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
      ctx.addIssue({ code: 'custom', message: 'วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม', path: ['dueDate'] });
    }
    if (data.recurrence !== 'ไม่ทำซ้ำ' && !data.dueDate) {
      ctx.addIssue({ code: 'custom', message: 'งานประจำต้องระบุวันครบกำหนดรอบแรก', path: ['dueDate'] });
    }
    if (data.recurrence === 'กำหนดเอง' && !data.recurrenceRule) {
      ctx.addIssue({ code: 'custom', message: 'กรุณาระบุกฎการทำซ้ำ', path: ['recurrenceRule'] });
    }
    if (data.reminderPreset !== 'none' && !data.dueDate) {
      ctx.addIssue({ code: 'custom', message: 'การแจ้งเตือนต้องระบุวันครบกำหนด', path: ['dueDate'] });
    }
  });

type CreateTaskForm = z.infer<typeof createTaskSchema>;
type ReminderPreset = CreateTaskForm['reminderPreset'];

const REMINDER_OPTIONS: { value: ReminderPreset; label: string; minutes: number | null }[] = [
  { value: 'none', label: 'ไม่เตือน', minutes: null },
  { value: 'at_time', label: 'เมื่อครบกำหนด', minutes: 0 },
  { value: 'before_15m', label: 'ก่อน 15 นาที', minutes: 15 },
  { value: 'before_30m', label: 'ก่อน 30 นาที', minutes: 30 },
  { value: 'before_1h', label: 'ก่อน 1 ชั่วโมง', minutes: 60 },
  { value: 'before_1d', label: 'ก่อน 1 วัน', minutes: 1440 },
];

const fieldClass = 'mt-1 w-full rounded-[7px] border border-hairline-control bg-white px-3 py-2 text-sm text-slate-800 dark:border-white/[.12] dark:bg-white/[.035] dark:text-slate-100';
const labelClass = 'block text-xs font-semibold text-slate-600 dark:text-slate-300';

function reminderIso(values: CreateTaskForm) {
  const option = REMINDER_OPTIONS.find((item) => item.value === values.reminderPreset);
  if (!values.dueDate || !option || option.minutes === null) return null;
  const dueAt = Date.parse(`${values.dueDate}T${values.dueTime || '09:00'}:00+07:00`);
  return new Date(dueAt - option.minutes * 60_000).toISOString();
}

export function CreateTaskModal({ initialDueDate, onClose, onCreated }: { initialDueDate?: string; onClose: () => void; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskInput, setSubtaskInput] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateTaskForm>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: {
      title: '',
      description: '',
      taskType: 'general',
      category: 'งานทั่วไป',
      priority: 'ปกติ',
      startDate: '',
      startTime: '',
      dueDate: initialDueDate ?? '',
      dueTime: '',
      recurrence: 'ไม่ทำซ้ำ',
      recurrenceRule: { frequency: 'weekly', interval: 1 },
      recurrenceEndDate: '',
      reminderPreset: 'none',
      tags: '',
      notes: '',
    },
  });
  const priority = watch('priority');
  const recurrence = watch('recurrence');

  const mutation = useMutation({
    mutationFn: async ({ values, status }: { values: CreateTaskForm; status: TaskStatus }) => {
      const { reminderPreset, ...payload } = values;
      void reminderPreset;
      const created = await apiFetch<{ id: string }>('/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify({ ...payload, status }),
      }, { silent: true });

      const childRequests = subtasks
        .map((title) => title.trim())
        .filter(Boolean)
        .map((title) => apiFetch(`/api/v1/tasks/${created.id}/subtasks`, {
          method: 'POST',
          body: JSON.stringify({ title }),
        }, { silent: true }));

      const remindAt = reminderIso(values);
      if (remindAt) {
        childRequests.push(apiFetch(`/api/v1/tasks/${created.id}/reminder`, {
          method: 'PUT',
          body: JSON.stringify({ remindAt, preset: values.reminderPreset }),
        }, { silent: true }));
      }
      await Promise.all(childRequests);
      return created;
    },
    onSuccess: () => {
      setServerError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-dashboard'] });
      onCreated();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'),
  });

  const submit = (status: TaskStatus) => handleSubmit((values) => mutation.mutate({ values, status }))();
  const addSubtask = () => {
    const title = subtaskInput.trim();
    if (!title) return;
    setSubtasks((current) => [...current, title]);
    setSubtaskInput('');
  };

  return (
    <FormModal
      title="สร้างงานใหม่"
      description="ระบุรายละเอียด กำหนดเวลา และสิ่งที่ต้องติดตามให้ครบในครั้งเดียว"
      size="lg"
      closeDisabled={mutation.isPending}
      onClose={onClose}
      testId="task-create-modal"
      footer={<>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
        <Button type="button" variant="outline" isLoading={mutation.isPending && mutation.variables?.status === 'ต้องทำ'} onClick={() => void submit('ต้องทำ')} data-testid="task-create-draft">บันทึกร่าง</Button>
        <Button type="button" isLoading={mutation.isPending && mutation.variables?.status === 'กำลังทำ'} onClick={() => void submit('กำลังทำ')} data-testid="task-create-start">บันทึกและเริ่มงาน</Button>
      </>}
    >
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={(event) => event.preventDefault()}>
        <label className={`${labelClass} sm:col-span-2`}>ชื่องาน <span className="text-red-600">*</span>
          <input autoFocus aria-label="ชื่องาน" {...register('title')} className={fieldClass} placeholder="ระบุชื่องานที่ต้องดำเนินการ" />
          {errors.title && <span className="mt-1 block text-xs font-normal text-red-600">{errors.title.message}</span>}
        </label>

        <label className={`${labelClass} sm:col-span-2`}>รายละเอียด
          <textarea aria-label="รายละเอียดงาน" rows={3} {...register('description')} className={fieldClass} placeholder="อธิบายสิ่งที่ต้องทำ ผลลัพธ์ที่คาดหวัง และเงื่อนไขสำคัญ" />
        </label>

        <label className={labelClass}>ประเภทงาน
          <select aria-label="ประเภทงาน" {...register('taskType')} className={fieldClass}>{TASK_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </label>
        <label className={labelClass}>หมวดหมู่
          <select aria-label="หมวดหมู่" {...register('category')} className={fieldClass}>{TASK_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
        </label>

        <fieldset className="sm:col-span-2">
          <legend className={labelClass}>ความสำคัญ</legend>
          <div className="mt-1 grid grid-cols-4 overflow-hidden rounded-[7px] border border-hairline-control dark:border-white/[.12]">
            {TASK_PRIORITIES.map((item) => <button key={item} type="button" aria-pressed={priority === item} onClick={() => setValue('priority', item, { shouldDirty: true })} className={cn('min-h-10 border-r border-hairline-control px-2 text-xs font-semibold last:border-r-0 dark:border-white/[.12]', priority === item ? 'bg-primary-700 text-white' : 'bg-white text-slate-600 hover:bg-primary-50 dark:bg-white/[.035] dark:text-slate-300')}>{item}</button>)}
          </div>
        </fieldset>

        <fieldset>
          <legend className={labelClass}>เริ่มงาน</legend>
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_110px] gap-2">
            <input aria-label="วันที่เริ่มงาน" type="date" {...register('startDate')} className={`${fieldClass} mt-0`} />
            <input aria-label="เวลาเริ่มงาน" type="time" {...register('startTime')} className={`${fieldClass} mt-0`} />
          </div>
        </fieldset>
        <fieldset>
          <legend className={labelClass}>ครบกำหนด <span className="text-red-600">*</span></legend>
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_110px] gap-2">
            <input aria-label="วันครบกำหนด" type="date" {...register('dueDate')} className={`${fieldClass} mt-0`} />
            <input aria-label="เวลาครบกำหนด" type="time" {...register('dueTime')} className={`${fieldClass} mt-0`} />
          </div>
          {errors.dueDate && <span className="mt-1 block text-xs font-normal text-red-600">{errors.dueDate.message}</span>}
        </fieldset>

        <label className={labelClass}>ทำซ้ำ
          <select aria-label="การทำซ้ำ" {...register('recurrence')} className={fieldClass}>{TASK_RECURRENCES.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label className={labelClass}>การแจ้งเตือน
          <select aria-label="การแจ้งเตือน" {...register('reminderPreset')} className={fieldClass}>{REMINDER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </label>

        {recurrence === 'กำหนดเอง' && <div className="grid grid-cols-[100px_1fr] gap-2 sm:col-span-2">
          <label className={labelClass}>ทุก ๆ<input aria-label="ช่วงการทำซ้ำ" type="number" min={1} max={99} {...register('recurrenceRule.interval')} className={fieldClass} /></label>
          <label className={labelClass}>หน่วย<select aria-label="หน่วยการทำซ้ำ" {...register('recurrenceRule.frequency')} className={fieldClass}><option value="daily">วัน</option><option value="weekly">สัปดาห์</option><option value="monthly">เดือน</option><option value="yearly">ปี</option></select></label>
        </div>}
        {recurrence !== 'ไม่ทำซ้ำ' && <label className={`${labelClass} sm:col-span-2`}>ทำซ้ำถึงวันที่<input aria-label="ทำซ้ำถึงวันที่" type="date" {...register('recurrenceEndDate')} className={fieldClass} /></label>}

        <label className={`${labelClass} sm:col-span-2`}>แท็ก
          <input aria-label="แท็ก" {...register('tags')} className={fieldClass} placeholder="#meeting #steering" />
        </label>

        <section className="sm:col-span-2" aria-label="งานย่อย">
          <h3 className={labelClass}>งานย่อย</h3>
          {subtasks.length > 0 && <ul className="mt-2 divide-y divide-hairline-row rounded-[7px] border border-hairline dark:divide-white/[.07] dark:border-white/[.1]">{subtasks.map((title, index) => <li key={`${title}-${index}`} className="flex min-h-10 items-center gap-2 px-3 text-sm text-slate-700 dark:text-slate-200"><span className="h-3.5 w-3.5 rounded-sm border border-slate-300 dark:border-slate-600" /><span className="min-w-0 flex-1">{title}</span><button type="button" onClick={() => setSubtasks((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid h-8 w-8 place-items-center text-slate-400 hover:text-red-600" aria-label={`ลบงานย่อย ${title}`}><X className="h-4 w-4" /></button></li>)}</ul>}
          <div className="mt-2 flex gap-2">
            <input aria-label="เพิ่มงานย่อย" value={subtaskInput} onChange={(event) => setSubtaskInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSubtask(); } }} className={`${fieldClass} mt-0 flex-1`} placeholder="เพิ่มงานย่อย แล้วกด Enter" />
            <Button type="button" variant="outline" onClick={addSubtask} disabled={!subtaskInput.trim()} aria-label="เพิ่มรายการงานย่อย"><Plus className="h-4 w-4" /></Button>
          </div>
        </section>

        <label className={`${labelClass} sm:col-span-2`}>บันทึกเพิ่มเติม
          <textarea aria-label="บันทึกเพิ่มเติม" rows={2} {...register('notes')} className={fieldClass} placeholder="ข้อมูลประกอบที่ช่วยให้ทำงานต่อได้สะดวก" />
        </label>

        {serverError && <p role="alert" className="rounded-[7px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:col-span-2 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{serverError}</p>}
      </form>
    </FormModal>
  );
}
