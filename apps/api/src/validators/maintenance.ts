import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const PM_STATUSES = ['วางแผน', 'กำลังดำเนินการ', 'ดำเนินการแล้ว', 'ยกเลิก'] as const;
export const PM_RECURRENCES = ['ครั้งเดียว', 'รายเดือน', 'รายไตรมาส', 'รายปี'] as const;
export const PM_CHECK_RESULTS = ['ผ่าน', 'ไม่ผ่าน', 'N/A'] as const;
/** ชนิดงานสำหรับแยกสีในปฏิทิน (design handoff 3c) — ตรงกับ check constraint ใน migration 20260919100000 */
export const PM_WORK_TYPES = ['PM', 'ลงพื้นที่', 'Change window'] as const;

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (yyyy-MM-dd)');
const dateOrEmpty = z.union([isoDateString, z.literal('')]).optional();

const checklistItemSchema = z.object({ text: z.string().trim().min(1).max(200) });
const checklistResultSchema = z.object({
  text: z.string().trim().min(1).max(200),
  result: z.enum(PM_CHECK_RESULTS).optional(),
  note: z.string().trim().max(300).optional(),
});

export const createMaintenancePlanSchema = z.object({
  assetId: z.string().uuid('กรุณาเลือกทรัพย์สิน'),
  planDate: isoDateString,
  workType: z.enum(PM_WORK_TYPES).optional(),
  recurrence: z.enum(PM_RECURRENCES).optional(),
  technicianId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  checklistItems: z.array(checklistItemSchema).max(50).optional(),
  notes: z.string().trim().max(1500).optional(),
});
export type CreateMaintenancePlanInput = z.infer<typeof createMaintenancePlanSchema>;

export const listMaintenancePlansQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PM_STATUSES).optional(),
  workType: z.enum(PM_WORK_TYPES).optional(),
  assetId: z.string().uuid().optional(),
});
export type ListMaintenancePlansQuery = z.infer<typeof listMaintenancePlansQuerySchema>;

export const pmRosterQuerySchema = z.object({ weekStart: isoDateString });

export const startMaintenanceSchema = z.object({
  technicianId: z.string().uuid().optional(),
});
export type StartMaintenanceInput = z.infer<typeof startMaintenanceSchema>;

export const recordMaintenanceResultSchema = z.object({
  status: z.enum(PM_STATUSES),
  actualDate: dateOrEmpty,
  checklistResults: z.array(checklistResultSchema).max(50).optional(),
  notes: z.string().trim().max(1500).optional(),
});
export type RecordMaintenanceResultInput = z.infer<typeof recordMaintenanceResultSchema>;

export const rescheduleMaintenanceSchema = z.object({
  planDate: isoDateString,
  reason: z.string().trim().max(300).optional(),
});
export type RescheduleMaintenanceInput = z.infer<typeof rescheduleMaintenanceSchema>;

export const cancelMaintenanceSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});
export type CancelMaintenanceInput = z.infer<typeof cancelMaintenanceSchema>;

// ===== PM Checklist Templates =====

export const createPmTemplateSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อเทมเพลต').max(150),
  category: z.string().trim().max(80).optional(),
  items: z.array(z.string().trim().min(1).max(200)).min(1, 'ต้องมีอย่างน้อย 1 รายการ').max(50),
  notes: z.string().trim().max(500).optional(),
});
export type CreatePmTemplateInput = z.infer<typeof createPmTemplateSchema>;

export const updatePmTemplateSchema = createPmTemplateSchema.partial();
export type UpdatePmTemplateInput = z.infer<typeof updatePmTemplateSchema>;

export const setPmTemplateStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});
export type SetPmTemplateStatusInput = z.infer<typeof setPmTemplateStatusSchema>;
