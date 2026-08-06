import { z } from 'zod';

export const createDepartmentSchema = z.object({
  code: z.string().trim().min(1).max(50),
  nameTh: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  parentDepartmentId: z.string().uuid().optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const createPositionSchema = z.object({
  code: z.string().trim().min(1).max(50),
  nameTh: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
});

export type CreatePositionInput = z.infer<typeof createPositionSchema>;

export const updatePositionSchema = createPositionSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
