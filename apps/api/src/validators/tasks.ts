import { z } from 'zod';

export const TASK_STATUSES = ['ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก'] as const;
export const TASK_PRIORITIES = ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'] as const;
export const TASK_CATEGORIES = ['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ'] as const;
export const TASK_RECURRENCES = ['ไม่ทำซ้ำ', 'รายวัน', 'วันทำงาน', 'รายสัปดาห์', 'ทุก 2 สัปดาห์', 'รายเดือน', 'รายไตรมาส', 'ทุก 6 เดือน', 'รายปี', 'กำหนดเอง'] as const;
export const TASK_TYPES = ['general', 'meeting', 'follow_up', 'document', 'project', 'system_development', 'personal', 'other'] as const;
export const TASK_REMINDER_PRESETS = ['at_time', 'before_15m', 'before_30m', 'before_1h', 'before_3h', 'before_1d', 'before_3d', 'custom'] as const;

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (yyyy-MM-dd)');

const dateOrEmpty = z.union([isoDateString, z.literal('')]).optional();
const timeOrEmpty = z.union([
  z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'รูปแบบเวลาไม่ถูกต้อง (HH:mm)'),
  z.literal(''),
]).optional();

export const taskRecurrenceRuleSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.coerce.number().int().min(1).max(99),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
  monthOfYear: z.coerce.number().int().min(1).max(12).optional(),
});

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'กรุณาระบุชื่องาน').max(300),
    description: z.string().trim().max(2000).optional(),
    taskType: z.enum(TASK_TYPES).optional(),
    category: z.enum(TASK_CATEGORIES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    startDate: dateOrEmpty,
    dueDate: dateOrEmpty,
    startTime: timeOrEmpty,
    dueTime: timeOrEmpty,
    progress: z.coerce.number().min(0).max(100).optional(),
    tags: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(1500).optional(),
    recurrence: z.enum(TASK_RECURRENCES).optional(),
    recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
    recurrenceEndDate: dateOrEmpty,
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
      ctx.addIssue({ code: 'custom', message: 'วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม', path: ['dueDate'] });
    }
    if (data.recurrence === 'กำหนดเอง' && !data.recurrenceRule) {
      ctx.addIssue({ code: 'custom', message: 'กรุณาระบุกฎการทำซ้ำแบบกำหนดเอง', path: ['recurrenceRule'] });
    }
    if (data.recurrence && data.recurrence !== 'ไม่ทำซ้ำ' && !data.dueDate) {
      ctx.addIssue({ code: 'custom', message: 'งานประจำต้องระบุวันครบกำหนดรอบแรก', path: ['dueDate'] });
    }
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  taskType: z.enum(TASK_TYPES).optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  search: z.string().trim().max(200).optional(),
  dueFrom: dateOrEmpty,
  dueTo: dateOrEmpty,
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const setTaskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES),
});
export type SetTaskStatusInput = z.infer<typeof setTaskStatusSchema>;

export const setTaskPrioritySchema = z.object({
  priority: z.enum(TASK_PRIORITIES),
});
export type SetTaskPriorityInput = z.infer<typeof setTaskPrioritySchema>;

export const setTaskBoardStateSchema = z.object({
  status: z.enum(TASK_STATUSES),
  sortOrder: z.coerce.number(),
});
export type SetTaskBoardStateInput = z.infer<typeof setTaskBoardStateSchema>;

export const setTaskDueDateSchema = z.object({
  dueDate: z.union([isoDateString, z.literal('')]),
});
export type SetTaskDueDateInput = z.infer<typeof setTaskDueDateSchema>;

export const addTaskProgressLogSchema = z.object({
  progress: z.coerce.number().min(0).max(100).optional(),
  note: z.string().trim().min(1, 'กรุณาระบุบันทึกความคืบหน้า').max(1500),
});
export type AddTaskProgressLogInput = z.infer<typeof addTaskProgressLogSchema>;

export const addTaskLinkSchema = z.object({
  label: z.string().trim().max(200).optional(),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => /^https:\/\//i.test(v), 'ลิงก์ต้องขึ้นต้นด้วย https://'),
});
export type AddTaskLinkInput = z.infer<typeof addTaskLinkSchema>;

export const addTaskSubtaskSchema = z.object({
  title: z.string().trim().min(1, 'กรุณาระบุชื่อรายการย่อย').max(300),
  dueDate: dateOrEmpty,
  notes: z.string().trim().max(800).optional(),
});
export type AddTaskSubtaskInput = z.infer<typeof addTaskSubtaskSchema>;

export const setTaskSubtaskStatusSchema = z.object({
  status: z.enum(['ต้องทำ', 'เสร็จแล้ว']),
});
export type SetTaskSubtaskStatusInput = z.infer<typeof setTaskSubtaskStatusSchema>;

export const updateTaskSubtaskSchema = z
  .object({
    title: z.string().trim().min(1, 'กรุณาระบุชื่อรายการย่อย').max(300).optional(),
    dueDate: dateOrEmpty,
    notes: z.string().trim().max(800).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'กรุณาระบุข้อมูลที่ต้องการแก้ไข');
export type UpdateTaskSubtaskInput = z.infer<typeof updateTaskSubtaskSchema>;

export const reorderTaskSubtaskSchema = z.object({
  sortOrder: z.coerce.number().int().nonnegative(),
});
export type ReorderTaskSubtaskInput = z.infer<typeof reorderTaskSubtaskSchema>;

export const setTaskReminderSchema = z.object({
  remindAt: z.string().datetime({ offset: true }),
  preset: z.enum(TASK_REMINDER_PRESETS),
});
export type SetTaskReminderInput = z.infer<typeof setTaskReminderSchema>;

export const snoozeTaskReminderSchema = z.object({
  minutes: z.coerce.number().int().refine((value) => [15, 30, 60, 180, 1440].includes(value), 'ระยะเวลา Snooze ไม่ถูกต้อง'),
});
export type SnoozeTaskReminderInput = z.infer<typeof snoozeTaskReminderSchema>;
