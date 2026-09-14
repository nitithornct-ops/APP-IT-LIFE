import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const submitAccessRequestSchema = z.object({
  systemId: z.string().uuid('กรุณาเลือกระบบงาน'),
  accessItemId: z.string().uuid('กรุณาเลือก Role / Profile / Group / Entitlement'),
  requestedActions: z.array(z.enum(['read', 'create', 'update', 'delete', 'approve'])).min(1, 'กรุณาเลือกสิทธิ์การทำรายการอย่างน้อย 1 รายการ'),
  temporaryAccess: z.boolean().default(false),
  startAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  businessReason: z.string().trim().min(1, 'กรุณาระบุเหตุผลทางธุรกิจ').max(1000),
  requestType: z.enum(['ขอเพิ่มสิทธิ์', 'เพิกถอนสิทธิ์']).optional(),
  lifecycleEvent: z.enum(['manual', 'joiner', 'mover', 'leaver']).default('manual'),
  subjectUserId: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if (value.temporaryAccess && !value.expiresAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Temporary Access ต้องระบุวันหมดอายุ' });
  }
  if (!value.temporaryAccess && value.expiresAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'สิทธิ์ถาวรไม่ควรมีวันหมดอายุ' });
  }
  if (value.lifecycleEvent === 'joiner' && value.requestType === 'เพิกถอนสิทธิ์') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestType'], message: 'Joiner ต้องเป็นคำขอเพิ่มสิทธิ์' });
  }
  if (value.lifecycleEvent === 'leaver' && value.requestType === 'ขอเพิ่มสิทธิ์') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestType'], message: 'Leaver ต้องเป็นคำขอเพิกถอนสิทธิ์' });
  }
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
  evidence: z.string().trim().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.success && !value.evidence) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence'], message: 'กรุณาบันทึก Evidence หลังดำเนินการสำเร็จ' });
  }
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

export const createAccessControlItemSchema = z.object({
  systemId: z.string().uuid('กรุณาเลือกระบบงาน'),
  kind: z.enum(['role', 'profile', 'group', 'entitlement']),
  code: z.string().trim().min(1, 'กรุณาระบุรหัสสิทธิ์').max(80),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อสิทธิ์').max(160),
  description: z.string().trim().max(1000).optional().nullable(),
  permissionActions: z.array(z.enum(['read', 'create', 'update', 'delete', 'approve'])).min(1, 'กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ'),
  dataClassification: z.enum(['ไม่ลับ', 'ลับ', 'ลับมาก']),
  privilegedAccess: z.boolean().default(false),
  systemOwnerId: z.string().uuid('กรุณาเลือก System Owner'),
  defaultApproverId: z.string().uuid().optional().nullable(),
});

export type CreateAccessControlItemInput = z.infer<typeof createAccessControlItemSchema>;

export const updateAccessControlItemSchema = createAccessControlItemSchema.omit({ systemId: true }).partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateAccessControlItemInput = z.infer<typeof updateAccessControlItemSchema>;
