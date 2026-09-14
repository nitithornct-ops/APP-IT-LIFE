import { z } from 'zod';

export const updateSystemSettingSchema = z.object({
  value: z.string().max(4000),
}).strict();

export const settingPreviewSchema = z.object({
  key: z.string().trim().min(3).max(80),
  value: z.string().max(4000),
}).strict();

export const restoreSystemSettingSchema = z.object({
  version: z.coerce.number().int().min(1),
}).strict();

export const settingDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(1000).optional(),
}).strict();

export const slaImpactQuerySchema = z.object({
  SLA_BUSINESS_START: z.string().max(5).optional(),
  SLA_BUSINESS_END: z.string().max(5).optional(),
  SLA_BUSINESS_DAYS: z.string().max(20).optional(),
  SLA_HOLIDAYS: z.string().max(4000).optional(),
}).strict();
