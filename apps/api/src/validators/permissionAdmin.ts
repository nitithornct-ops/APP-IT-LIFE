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
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลของ permission override').max(1000),
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
