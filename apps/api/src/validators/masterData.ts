import { partialObject } from '@itlife/shared';
import { z } from 'zod';

const masterCode = z
  .string()
  .trim()
  .min(2, 'รหัสต้องมีอย่างน้อย 2 ตัวอักษร')
  .max(50, 'รหัสยาวเกินไป')
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'รหัสใช้ได้เฉพาะ A-Z, ตัวเลข, _ หรือ -');

const effectiveDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่มีผลต้องเป็นรูปแบบ YYYY-MM-DD');
const sortOrder = z.coerce.number().int().min(0).max(9999);

export const createDepartmentSchema = z.object({
  code: z.string().trim().min(1).max(50),
  nameTh: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  parentDepartmentId: z.string().guid().optional(),
  effectiveDate: effectiveDate.optional(),
  sortOrder: sortOrder.optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = partialObject(createDepartmentSchema).extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const createPositionSchema = z.object({
  code: z.string().trim().min(1).max(50),
  nameTh: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  effectiveDate: effectiveDate.optional(),
  sortOrder: sortOrder.optional(),
});

export type CreatePositionInput = z.infer<typeof createPositionSchema>;

export const updatePositionSchema = partialObject(createPositionSchema).extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;

const ticketPriorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

export const createTicketCategorySchema = z.object({
  code: masterCode.optional(),
  name: z.string().trim().min(1).max(200),
  defaultPriority: ticketPriorityEnum.optional(),
  responseSlaHours: z.coerce.number().positive().optional(),
  resolutionSlaHours: z.coerce.number().positive().optional(),
  slaHours: z.coerce.number().positive().optional(),
  isSecurityDefault: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
  effectiveDate: effectiveDate.optional(),
  sortOrder: sortOrder.optional(),
});

export type CreateTicketCategoryInput = z.infer<typeof createTicketCategorySchema>;

export const updateTicketCategorySchema = partialObject(createTicketCategorySchema).extend({
  responseSlaHours: z.union([z.coerce.number().positive(), z.null()]).optional(),
  resolutionSlaHours: z.union([z.coerce.number().positive(), z.null()]).optional(),
  slaHours: z.union([z.coerce.number().positive(), z.null()]).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateTicketCategoryInput = z.infer<typeof updateTicketCategorySchema>;

export const createAssetCategorySchema = z.object({
  code: masterCode.optional(),
  name: z.string().trim().min(1).max(200),
  codePrefix: z.string().trim().min(1).max(20),
  notes: z.string().trim().max(2000).optional(),
  effectiveDate: effectiveDate.optional(),
  sortOrder: sortOrder.optional(),
});

export type CreateAssetCategoryInput = z.infer<typeof createAssetCategorySchema>;

export const updateAssetCategorySchema = partialObject(createAssetCategorySchema).extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateAssetCategoryInput = z.infer<typeof updateAssetCategorySchema>;

export const createAccessSystemSchema = z.object({
  code: masterCode.optional(),
  name: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
  effectiveDate: effectiveDate.optional(),
  sortOrder: sortOrder.optional(),
});

export type CreateAccessSystemInput = z.infer<typeof createAccessSystemSchema>;

export const updateAccessSystemSchema = partialObject(createAccessSystemSchema).extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateAccessSystemInput = z.infer<typeof updateAccessSystemSchema>;
