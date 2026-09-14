import { z } from 'zod';

export const roleReviewFrequencySchema = z.enum(['monthly', 'quarterly', 'semiannual', 'annual']);

const roleMetadataFields = {
  nameTh: z.string().trim().min(1, 'กรุณากรอกชื่อบทบาท').max(200),
  nameEn: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  scope: z.string().trim().max(1000).nullable().optional(),
  ownerId: z.string().uuid('Role Owner ไม่ถูกต้อง').nullable().optional(),
  reviewFrequency: roleReviewFrequencySchema.optional(),
  sensitiveRole: z.boolean().optional(),
};

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Role key ต้องเป็นตัวพิมพ์เล็ก a-z0-9_ และขึ้นต้นด้วยตัวอักษร'),
  ...roleMetadataFields,
  reviewFrequency: roleReviewFrequencySchema.default('quarterly'),
  sensitiveRole: z.boolean().default(false),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  nameTh: roleMetadataFields.nameTh.optional(),
  nameEn: roleMetadataFields.nameEn,
  description: roleMetadataFields.description,
  scope: roleMetadataFields.scope,
  ownerId: roleMetadataFields.ownerId,
  reviewFrequency: roleReviewFrequencySchema.optional(),
  sensitiveRole: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const cloneRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Role key ต้องเป็นตัวพิมพ์เล็ก a-z0-9_ และขึ้นต้นด้วยตัวอักษร'),
  ...roleMetadataFields,
  reviewFrequency: roleReviewFrequencySchema.default('quarterly'),
  sensitiveRole: z.boolean().default(false),
});

export type CloneRoleInput = z.infer<typeof cloneRoleSchema>;

export const setRolePermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      permissionId: z.string().uuid(),
      effect: z.enum(['allow', 'deny']),
    }),
  ).superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.permissionId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'permissionId'], message: 'Permission เดียวกันซ้ำในชุดข้อมูล' });
      }
      seen.add(item.permissionId);
    });
  }),
});

export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

const rolePermissionChangeSchema = z.object({
  permissionId: z.string().uuid(),
  permissionKey: z.string().trim().min(1).max(200),
  from: z.enum(['allow', 'deny', 'none']),
  to: z.enum(['allow', 'deny', 'none']),
  isPrivileged: z.boolean(),
});

export const createRolePermissionChangeRequestSchema = z.object({
  permissions: setRolePermissionsSchema.shape.permissions,
  changes: z.array(rolePermissionChangeSchema).min(1).max(500),
  approverId: z.string().uuid(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลของการเปลี่ยนแปลงสิทธิ์').max(1500),
});

export type CreateRolePermissionChangeRequestInput = z.infer<typeof createRolePermissionChangeRequestSchema>;

export const decideRolePermissionChangeRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(1500).optional(),
});

export type DecideRolePermissionChangeRequestInput = z.infer<typeof decideRolePermissionChangeRequestSchema>;

export const compareRoleVersionsQuerySchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
}).refine((value) => value.from !== value.to, { message: 'ต้องเลือกคนละเวอร์ชัน' });
