import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const VULNERABILITY_STATUSES = ['เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด'] as const;
export const VULNERABILITY_SEVERITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
export const PATCH_CAMPAIGN_STATUSES = ['Draft', 'Planned', 'In Progress', 'Completed', 'Cancelled'] as const;
export const RETEST_STATUSES = ['scheduled', 'passed', 'failed', 'blocked'] as const;

const optionalDate = z.union([z.string().date(), z.literal('')]).optional();
const optionalDateTime = z.string().datetime({ offset: true }).optional();
const optionalUuid = z.union([z.string().uuid(), z.literal('')]).optional();
const optionalHttpsUrl = z
  .union([z.string().trim().url('URL ไม่ถูกต้อง').max(500).refine((value) => value.startsWith('https://'), 'ต้องเป็น HTTPS'), z.literal('')])
  .optional();
const optionalScore = z.coerce.number().min(0).max(1).optional();
const optionalBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
}, z.boolean()).optional();

const vulnerabilityBaseSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกชื่อช่องโหว่').max(200),
  assetId: optionalUuid,
  configurationItemId: optionalUuid,
  affectedSystem: z.string().trim().max(200).optional(),
  source: z.string().trim().max(150).optional(),
  scannerName: z.string().trim().max(100).optional(),
  scannerFindingId: z.string().trim().max(200).optional(),
  lastSeenAt: optionalDateTime,
  cve: z.string().trim().max(100).optional(),
  cvss: z.coerce.number().min(0).max(10).optional(),
  epssScore: optionalScore,
  epssPercentile: optionalScore,
  kevListed: z.boolean().optional(),
  internetFacing: z.boolean().optional(),
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
  exceptionOwnerId: optionalUuid,
  evidenceLink: optionalHttpsUrl,
  campaignId: optionalUuid,
  changeId: optionalUuid,
  incidentId: optionalUuid,
  problemId: optionalUuid,
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
  riskPriority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  kevListed: z.enum(['true', 'false']).optional(),
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

const scannerImportRowSchema = z.object({
  externalId: z.string().trim().max(200).optional(),
  title: z.string().trim().max(200).optional(),
  cve: z.string().trim().max(100).optional(),
  cvss: z.coerce.number().min(0).max(10).optional(),
  epssScore: optionalScore,
  epssPercentile: optionalScore,
  kevListed: optionalBoolean,
  internetFacing: optionalBoolean,
  assetCode: z.string().trim().max(100).optional(),
  ciCode: z.string().trim().max(100).optional(),
  affectedSystem: z.string().trim().max(200).optional(),
  detectedAt: z.string().date().optional(),
  lastSeenAt: optionalDateTime,
  description: z.string().trim().max(1500).optional(),
}).superRefine((row, ctx) => {
  if (!row.title && !row.cve && !row.externalId) {
    ctx.addIssue({ code: 'custom', path: ['title'], message: 'แต่ละแถวต้องมี Title, CVE หรือ External ID อย่างน้อยหนึ่งค่า' });
  }
});

export const importScannerSchema = z.object({
  scannerName: z.string().trim().min(1).max(100),
  ownerId: z.string().uuid().optional(),
  rows: z.array(scannerImportRowSchema).min(1).max(1000),
});

export const createPatchCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(1500).optional(),
  ownerId: z.string().uuid().optional(),
  targetDate: optionalDate,
  status: z.enum(PATCH_CAMPAIGN_STATUSES).default('Draft'),
  notes: z.string().trim().max(1000).optional(),
});

export const updatePatchCampaignSchema = createPatchCampaignSchema.partial().refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข');
export const assignCampaignSchema = z.object({ vulnerabilityIds: z.array(z.string().uuid()).max(1000) });

export const createVulnerabilityRetestSchema = z.object({
  status: z.enum(RETEST_STATUSES),
  testedAt: optionalDateTime,
  method: z.string().trim().min(1).max(150),
  result: z.string().trim().max(2000).optional(),
  evidenceLink: optionalHttpsUrl,
  nextRetestAt: optionalDateTime,
  notes: z.string().trim().max(1000).optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'passed' && (!data.result || !data.evidenceLink)) {
    ctx.addIssue({ code: 'custom', path: ['evidenceLink'], message: 'Retest ที่ผ่านต้องมีผลทดสอบและหลักฐาน HTTPS' });
  }
});

export const requestExceptionSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  expiresOn: z.string().date(),
  exceptionOwnerId: z.string().uuid(),
  evidenceLink: optionalHttpsUrl,
});

export const decideExceptionSchema = z.object({
  approve: z.boolean(),
  comment: z.string().trim().max(1000).optional(),
  evidenceLink: optionalHttpsUrl,
});

export type CreateVulnerabilityInput = z.infer<typeof createVulnerabilitySchema>;
export type UpdateVulnerabilityInput = z.infer<typeof updateVulnerabilitySchema>;
export type SetVulnerabilityStatusInput = z.infer<typeof setVulnerabilityStatusSchema>;
export type ImportScannerInput = z.infer<typeof importScannerSchema>;
export type CreatePatchCampaignInput = z.infer<typeof createPatchCampaignSchema>;
export type CreateVulnerabilityRetestInput = z.infer<typeof createVulnerabilityRetestSchema>;
