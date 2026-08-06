import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const submitAccessRequestSchema = z.object({
  systemId: z.string().uuid('กรุณาเลือกระบบงาน'),
  accessLevel: z.enum(['Standard', 'Admin']),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(1000),
  requestType: z.enum(['ขอเพิ่มสิทธิ์', 'เพิกถอนสิทธิ์']).optional(),
});

export type SubmitAccessRequestInput = z.infer<typeof submitAccessRequestSchema>;

export const listAccessRequestsQuerySchema = paginationQuerySchema.extend({
  status: z.string().trim().max(80).optional(),
  mine: z.enum(['true', 'false']).optional(),
  pendingMyApproval: z.enum(['true', 'false']).optional(),
});

export type ListAccessRequestsQuery = z.infer<typeof listAccessRequestsQuerySchema>;

export const approveAccessRequestSchema = z.object({
  approved: z.boolean(),
  comment: z.string().trim().max(500).optional(),
});

export type ApproveAccessRequestInput = z.infer<typeof approveAccessRequestSchema>;

export const processAccessRequestSchema = z.object({
  success: z.boolean(),
  comment: z.string().trim().max(500).optional(),
});

export type ProcessAccessRequestInput = z.infer<typeof processAccessRequestSchema>;

export const revokeAccessEntrySchema = z.object({
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(300),
});

export type RevokeAccessEntryInput = z.infer<typeof revokeAccessEntrySchema>;

export const deactivateEmployeeSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(200),
});

export type DeactivateEmployeeInput = z.infer<typeof deactivateEmployeeSchema>;
