import { z } from 'zod';

/** ยอมรับทั้ง yyyy-MM-dd และ ISO datetime เต็มรูปแบบ ตามแนวทางเดิมของ apParseOptionalDate_ */
const optionalDateString = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'รูปแบบวันที่ไม่ถูกต้อง')
  .optional()
  .nullable();

export const createPermissionOverrideSchema = z.object({
  userId: z.string().uuid(),
  permissionId: z.string().uuid(),
  effect: z.enum(['allow', 'deny']),
  startAt: optionalDateString,
  endAt: optionalDateString,
  temporaryAccess: z.boolean().optional(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลของ permission override').max(1000),
}).superRefine((value, ctx) => {
  if (value.temporaryAccess && !value.endAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'Temporary Access ต้องระบุวันหมดอายุ' });
  }
  if (value.startAt && value.endAt && new Date(value.endAt).getTime() < new Date(value.startAt).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'วันหมดอายุต้องไม่มาก่อนวันเริ่มต้น' });
  }
});

export type CreatePermissionOverrideInput = z.infer<typeof createPermissionOverrideSchema>;

export const updatePermissionOverrideSchema = z.object({
  effect: z.enum(['allow', 'deny']).optional(),
  startAt: optionalDateString,
  endAt: optionalDateString,
  reason: z.string().trim().min(1).max(1000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdatePermissionOverrideInput = z.infer<typeof updatePermissionOverrideSchema>;

const groupCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,79}$/, 'รหัสกลุ่มต้องมี 2-80 ตัว และใช้เฉพาะ A-Z, 0-9, _ หรือ -');

export const createApprovalGroupSchema = z.object({
  code: groupCodeSchema,
  name: z.string().trim().min(1).max(200),
  departmentId: z.string().uuid().optional(),
  description: z.string().trim().max(1500).optional(),
  ownerId: z.string().uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type CreateApprovalGroupInput = z.infer<typeof createApprovalGroupSchema>;

export const updateApprovalGroupSchema = createApprovalGroupSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateApprovalGroupInput = z.infer<typeof updateApprovalGroupSchema>;

export const createApprovalGroupMemberSchema = z.object({
  userId: z.string().uuid(),
  memberRole: z.enum(['primary', 'member', 'backup']).optional(),
  priority: z.coerce.number().int().min(1).max(999).optional(),
  validFrom: optionalDateString,
  validUntil: optionalDateString,
  notes: z.string().trim().max(1000).optional(),
});

export type CreateApprovalGroupMemberInput = z.infer<typeof createApprovalGroupMemberSchema>;

export const updateApprovalGroupMemberSchema = createApprovalGroupMemberSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateApprovalGroupMemberInput = z.infer<typeof updateApprovalGroupMemberSchema>;

const accessGroupKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,79}$/, 'Access Group key ต้องมี 2-80 ตัวอักษร และใช้ a-z, 0-9, ., _ หรือ -');

export const createAccessGroupSchema = z.object({
  key: accessGroupKeySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1500).optional(),
});

export const updateAccessGroupSchema = createAccessGroupSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export const accessGroupPermissionSchema = z.object({
  permissionId: z.string().uuid(),
  effect: z.enum(['allow', 'deny']).default('allow'),
  notes: z.string().trim().max(1000).optional(),
});

export const accessGroupMemberSchema = z.object({
  userId: z.string().uuid(),
  validFrom: optionalDateString,
  validUntil: optionalDateString,
});

export const userAccessGroupMembershipSchema = z.object({
  groupId: z.string().uuid(),
  validFrom: optionalDateString,
  validUntil: optionalDateString,
});

export type CreateAccessGroupInput = z.infer<typeof createAccessGroupSchema>;
export type UpdateAccessGroupInput = z.infer<typeof updateAccessGroupSchema>;
export type AccessGroupPermissionInput = z.infer<typeof accessGroupPermissionSchema>;
export type AccessGroupMemberInput = z.infer<typeof accessGroupMemberSchema>;
export type UserAccessGroupMembershipInput = z.infer<typeof userAccessGroupMembershipSchema>;

export const privilegedOverrideDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(1000).optional(),
});

export const userAccessReviewCreateSchema = z.object({
  reviewerId: z.string().uuid().nullable().optional(),
  dueAt: optionalDateString,
});

export const userAccessReviewDecisionSchema = z.object({
  status: z.enum(['approved', 'revoked', 'exception']),
  decisionNote: z.string().trim().max(1500).optional(),
});

export type PrivilegedOverrideDecisionInput = z.infer<typeof privilegedOverrideDecisionSchema>;
export type UserAccessReviewCreateInput = z.infer<typeof userAccessReviewCreateSchema>;
export type UserAccessReviewDecisionInput = z.infer<typeof userAccessReviewDecisionSchema>;
