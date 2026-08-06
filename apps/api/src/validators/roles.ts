import { z } from 'zod';

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Role key ต้องเป็นตัวพิมพ์เล็ก a-z0-9_ และขึ้นต้นด้วยตัวอักษร'),
  nameTh: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  nameTh: z.string().trim().min(1).max(200).optional(),
  nameEn: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const setRolePermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      permissionId: z.string().uuid(),
      effect: z.enum(['allow', 'deny']),
    }),
  ),
});

export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;
