import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  module: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  actor: z.string().trim().max(160).optional(),
  result: z.enum(['success', 'fail', 'denied']).optional(),
  eventCategory: z.enum(['authentication', 'authorization', 'data_change', 'privileged_action', 'administration', 'access_review', 'backup', 'export', 'security', 'system']).optional(),
  privileged: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const listLoginLogsQuerySchema = paginationQuerySchema.extend({
  email: z.string().trim().max(160).optional(),
  success: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  eventType: z.enum(['login_attempt', 'logout', 'mfa_challenge', 'password_reset', 'password_change', 'session_refresh']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const auditOverviewQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const auditIntegrityQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const auditEvidencePackageQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const auditArchiveSchema = z.object({ cutoff: z.string().datetime({ offset: true }) });

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
