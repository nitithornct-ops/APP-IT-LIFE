import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

const formFieldSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(200),
  type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox']),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});

const checklistItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  taskType: z.string().trim().max(80).optional(),
  isRequired: z.boolean().optional(),
  ownerGroupId: z.string().uuid().optional(),
});

/** null/ไม่ระบุ = ทุกคนขอได้ — ระบุแล้วต้องมีอย่างน้อย 1 เงื่อนไข (roles หรือ departmentIds) */
const eligibilitySchema = z
  .object({
    roles: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    departmentIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .refine((v) => (v.roles?.length ?? 0) + (v.departmentIds?.length ?? 0) > 0, 'ต้องระบุอย่างน้อย 1 เงื่อนไข')
  .nullable()
  .optional();

const serviceCatalogBaseFields = {
  serviceCode: z.string().trim().min(1, 'กรุณาระบุรหัสบริการ').max(80),
  serviceName: z.string().trim().min(1, 'กรุณาระบุชื่อบริการ').max(200),
  category: z.string().trim().max(120).optional(),
  description: z.string().trim().max(3000).optional(),
  eligibility: eligibilitySchema,
  formSchema: z.array(formFieldSchema).max(50).optional(),
  attachmentRequired: z.boolean().optional(),
  slaHours: z.coerce.number().positive().max(720).optional(),
  approvalMode: z.enum(['none', 'group']).optional(),
  approvalGroupId: z.string().uuid().optional(),
  fulfillmentGroupId: z.string().uuid().optional(),
  checklist: z.array(checklistItemSchema).max(50).optional(),
  closeMode: z.enum(['requester_confirms', 'it_closes']).optional(),
  closeCondition: z.string().trim().max(1000).optional(),
  ownerId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
};

export const createServiceCatalogSchema = z
  .object(serviceCatalogBaseFields)
  .refine((v) => v.approvalMode !== 'group' || !!v.approvalGroupId, {
    message: 'กรุณาเลือกกลุ่มอนุมัติเมื่อรูปแบบการอนุมัติเป็น "กลุ่มอนุมัติ"',
    path: ['approvalGroupId'],
  });

export type CreateServiceCatalogInput = z.infer<typeof createServiceCatalogSchema>;

/**
 * ไม่ใส่ .refine ข้าม approvalMode/approvalGroupId ที่นี่ เพราะ patch อาจส่งมาแค่บางฟิลด์ — route
 * จะรวมกับค่าปัจจุบันในฐานข้อมูลก่อนตรวจเงื่อนไข "group ต้องมี approvalGroupId" อีกครั้ง
 */
export const updateServiceCatalogSchema = z.object(serviceCatalogBaseFields).partial().extend({
  status: z.enum(['draft', 'active', 'suspended', 'retired']).optional(),
});

export type UpdateServiceCatalogInput = z.infer<typeof updateServiceCatalogSchema>;

export const listServiceCatalogQuerySchema = paginationQuerySchema.extend({
  status: z.string().trim().max(80).optional(),
});

export type ListServiceCatalogQuery = z.infer<typeof listServiceCatalogQuerySchema>;
