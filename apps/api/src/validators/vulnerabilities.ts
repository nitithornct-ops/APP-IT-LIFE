import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const VULNERABILITY_STATUSES = ['เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด'] as const;
export const VULNERABILITY_SEVERITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;

const optionalDate = z.union([z.string().date(), z.literal('')]).optional();
const optionalUuid = z.union([z.string().uuid(), z.literal('')]).optional();
const optionalHttpsUrl = z
  .union([z.string().trim().url('URL ไม่ถูกต้อง').max(500).refine((value) => value.startsWith('https://'), 'ต้องเป็น HTTPS'), z.literal('')])
  .optional();

const vulnerabilityBaseSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกชื่อช่องโหว่').max(200),
  assetId: optionalUuid,
  configurationItemId: optionalUuid,
  affectedSystem: z.string().trim().max(200).optional(),
  source: z.string().trim().max(150).optional(),
  cve: z.string().trim().max(100).optional(),
  cvss: z.coerce.number().min(0).max(10).optional(),
  severity: z.enum(VULNERABILITY_SEVERITIES).default('ปานกลาง'),
  description: z.string().trim().max(1500).optional(),
  detectedAt: z.string().date().optional(),
  ownerId: z.string().uuid().optional(),
  remediationPlan: z.string().trim().max(1500).optional(),
  patchReference: z.string().trim().max(300).optional(),
  dueDate: optionalDate,
  status: z.enum(VULNERABILITY_STATUSES).default('เปิด'),
  exceptionReason: z.string().trim().max(1000).optional(),
  exceptionExpiry: optionalDate,
  evidenceLink: optionalHttpsUrl,
  notes: z.string().trim().max(1000).optional(),
});

function addLifecycleIssues(
  data: { detectedAt?: string; dueDate?: string; exceptionReason?: string; exceptionExpiry?: string; status?: string },
  ctx: z.RefinementCtx,
) {
  if (data.detectedAt && data.dueDate && data.dueDate < data.detectedAt) {
    ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'วันครบกำหนดต้องไม่ก่อนวันที่ตรวจพบ' });
  }
  if (data.exceptionExpiry && !data.exceptionReason) {
    ctx.addIssue({ code: 'custom', path: ['exceptionReason'], message: 'กรุณาระบุเหตุผลข้อยกเว้น' });
  }
  if (data.status === 'ปิด') {
    ctx.addIssue({ code: 'custom', path: ['status'], message: 'กรุณาปิดรายการผ่านขั้นตอนตรวจยืนยัน' });
  }
}

export const createVulnerabilitySchema = vulnerabilityBaseSchema.superRefine(addLifecycleIssues);
export const updateVulnerabilitySchema = vulnerabilityBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข')
  .superRefine(addLifecycleIssues);

export const listVulnerabilitiesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(VULNERABILITY_STATUSES).optional(),
  severity: z.enum(VULNERABILITY_SEVERITIES).optional(),
  ownerId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
});

export const setVulnerabilityStatusSchema = z
  .object({
    status: z.enum(VULNERABILITY_STATUSES),
    evidenceLink: optionalHttpsUrl,
  })
  .superRefine((data, ctx) => {
    if (data.status === 'ปิด' && !data.evidenceLink) {
      ctx.addIssue({ code: 'custom', path: ['evidenceLink'], message: 'การปิดรายการต้องมีหลักฐาน HTTPS' });
    }
  });

export type CreateVulnerabilityInput = z.infer<typeof createVulnerabilitySchema>;
export type UpdateVulnerabilityInput = z.infer<typeof updateVulnerabilitySchema>;
export type SetVulnerabilityStatusInput = z.infer<typeof setVulnerabilityStatusSchema>;
