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

const ticketPriorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

export const createTicketCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  defaultPriority: ticketPriorityEnum.optional(),
  responseSlaHours: z.coerce.number().positive().optional(),
  resolutionSlaHours: z.coerce.number().positive().optional(),
  slaHours: z.coerce.number().positive().optional(),
  isSecurityDefault: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateTicketCategoryInput = z.infer<typeof createTicketCategorySchema>;

export const updateTicketCategorySchema = createTicketCategorySchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateTicketCategoryInput = z.infer<typeof updateTicketCategorySchema>;

export const createAssetCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  codePrefix: z.string().trim().min(1).max(20),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateAssetCategoryInput = z.infer<typeof createAssetCategorySchema>;

export const updateAssetCategorySchema = createAssetCategorySchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateAssetCategoryInput = z.infer<typeof updateAssetCategorySchema>;
