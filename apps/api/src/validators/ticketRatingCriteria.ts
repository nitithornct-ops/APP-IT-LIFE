import { z } from 'zod';

export const listTicketRatingCriteriaQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});

export const createTicketRatingCriterionSchema = z.object({
  label: z.string().trim().min(1, 'กรุณากรอกชื่อหัวข้อประเมิน').max(160),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

export const updateTicketRatingCriterionSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  status: z.enum(['active', 'inactive']).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: 'กรุณาระบุข้อมูลที่ต้องการแก้ไข',
});

