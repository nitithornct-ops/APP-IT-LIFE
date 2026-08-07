import { z } from 'zod';

export const TASK_STATUSES = ['ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก'] as const;
export const TASK_PRIORITIES = ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'] as const;
export const TASK_CATEGORIES = ['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ'] as const;
export const TASK_RECURRENCES = ['ไม่ทำซ้ำ', 'รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส', 'รายปี'] as const;

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (yyyy-MM-dd)');

const dateOrEmpty = z.union([isoDateString, z.literal('')]).optional();

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'กรุณาระบุชื่องาน').max(300),
    description: z.string().trim().max(2000).optional(),
    category: z.enum(TASK_CATEGORIES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    startDate: dateOrEmpty,
    dueDate: dateOrEmpty,
    progress: z.coerce.number().min(0).max(100).optional(),
    tags: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(1500).optional(),
    recurrence: z.enum(TASK_RECURRENCES).optional(),
    recurrenceEndDate: dateOrEmpty,
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
      ctx.addIssue({ code: 'custom', message: 'วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม', path: ['dueDate'] });
    }
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const setTaskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES),
});
export type SetTaskStatusInput = z.infer<typeof setTaskStatusSchema>;

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
