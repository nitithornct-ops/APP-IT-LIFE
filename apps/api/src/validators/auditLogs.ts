import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  module: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
