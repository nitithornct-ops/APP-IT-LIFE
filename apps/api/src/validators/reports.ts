import { z } from 'zod';

const rangeDays = z.coerce.number().int().min(0).max(3650).default(30);
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const booleanParam = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean().default(true));

export const reportFiltersSchema = z.object({
  rangeDays,
  departmentId: uuid.optional(),
  ownerId: uuid.optional(),
  from: date.optional(),
  to: date.optional(),
  comparePrevious: booleanParam,
}).strict();

export const reportRangeQuerySchema = reportFiltersSchema;
export const reportExportSchema = reportFiltersSchema;

export const reportSavedFilterQuerySchema = z.object({
  reportKey: z.string().min(1).max(80).optional(),
}).strict();

export const reportSavedFilterSchema = z.object({
  reportKey: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  filters: reportFiltersSchema.partial().default({}),
  isShared: z.boolean().default(false),
}).strict();

export const reportSnapshotSchema = reportFiltersSchema.extend({
  title: z.string().trim().min(1).max(200).optional(),
  snapshotKind: z.enum(['manual', 'monthly', 'executive_pack']).default('manual'),
}).strict();

export const reportExecutivePackQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
}).strict();
export const reportExecutivePackSnapshotSchema = reportExecutivePackQuerySchema.extend({
  title: z.string().trim().min(1).max(200).optional(),
}).strict();
export const reportExecutivePackExportSchema = reportExecutivePackQuerySchema.extend({
  saveToDrive: z.boolean().default(false),
}).strict();

const scheduleFilters = reportFiltersSchema.partial().default({});
const reportScheduleShape = z.object({
  reportKey: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  frequency: z.enum(['weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  runHour: z.number().int().min(0).max(23).default(8),
  timezone: z.string().min(1).max(64).default('Asia/Bangkok'),
  format: z.enum(['CSV', 'PDF', 'PRINT']).default('PDF'),
  saveToDrive: z.boolean().default(false),
  filters: scheduleFilters,
  enabled: z.boolean().default(true),
}).strict();

export const reportScheduleSchema = reportScheduleShape.superRefine((value, context) => {
  if (value.frequency === 'weekly' && value.dayOfWeek === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dayOfWeek'], message: 'dayOfWeek is required for weekly schedules' });
  if (value.frequency === 'monthly' && value.dayOfMonth === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dayOfMonth'], message: 'dayOfMonth is required for monthly schedules' });
});

export const reportSchedulePatchSchema = reportScheduleShape.partial().strict();

/**
 * PDF ส่งออกได้สองแบบในคำขอเดียว: ดาวน์โหลดเสมอ และ "เก็บสำเนาไว้ใน Google Drive" เมื่อผู้ใช้สั่ง
 * ต้องสั่งเองทุกครั้ง ไม่ใช่ค่าเริ่มต้น เพราะการคัดลอกรายงานออกนอกระบบเป็นการตัดสินใจของผู้ใช้
 */
export const reportPdfExportSchema = reportFiltersSchema.extend({ saveToDrive: z.boolean().default(false) }).strict();
