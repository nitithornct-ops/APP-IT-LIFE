import { z } from 'zod';

export const dashboardSummaryQuerySchema = z.object({
  leadDays: z.coerce.number().int().min(7).max(90).default(30),
});

export const myWorkSnoozeSchema = z.object({
  minutes: z.coerce.number().int().refine((value) => [15, 30, 60, 180, 1440].includes(value), 'ระยะเวลา Snooze ไม่ถูกต้อง'),
});

export const myWorkSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['all', 'approval', 'assigned', 'personal', 'overdue']).default('all'),
  sourceKind: z.string().trim().max(60).nullable().optional(),
  sortBy: z.enum(['risk_sla_due', 'due_date']).default('risk_sla_due'),
});

export type MyWorkSavedViewInput = z.infer<typeof myWorkSavedViewSchema>;
