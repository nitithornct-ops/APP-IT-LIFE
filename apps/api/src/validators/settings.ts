import { z } from 'zod';

export const updateSystemSettingSchema = z.object({
  value: z.string().max(4000),
}).strict();

export const slaImpactQuerySchema = z.object({
  SLA_BUSINESS_START: z.string().max(5).optional(),
  SLA_BUSINESS_END: z.string().max(5).optional(),
  SLA_BUSINESS_DAYS: z.string().max(20).optional(),
  SLA_HOLIDAYS: z.string().max(4000).optional(),
}).strict();
