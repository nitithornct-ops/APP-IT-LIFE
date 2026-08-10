import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  module: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  actor: z.string().trim().max(160).optional(),
  result: z.enum(['success', 'fail', 'denied']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const listLoginLogsQuerySchema = paginationQuerySchema.extend({
  email: z.string().trim().max(160).optional(),
  success: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const auditOverviewQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
