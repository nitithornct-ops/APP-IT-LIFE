import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const VENDOR_SERVICE_TYPES = ['ร้านซ่อม', 'ผู้ขายอุปกรณ์', 'Software', 'Internet Provider', 'ผู้ให้บริการ MA', 'Cloud', 'อื่นๆ'] as const;
export const VENDOR_STATUSES = ['Active', 'Inactive'] as const;
export const CONTRACT_TYPES = ['Service', 'Maintenance', 'Software', 'Internet', 'Cloud', 'Purchase', 'Other'] as const;
export const CONTRACT_STATUSES = ['Draft', 'Active', 'Expired', 'Terminated', 'Renewed'] as const;
export const VENDOR_CRITICALITY_TIERS = ['Low', 'Medium', 'High', 'Critical'] as const;
export const VENDOR_ASSESSMENT_STATUSES = ['Not Assessed', 'Not Required', 'Pending', 'Approved', 'Expired', 'Rejected'] as const;
export const VENDOR_NDA_STATUSES = ['Not Assessed', 'Not Required', 'Pending', 'Active', 'Expired', 'Rejected'] as const;
export const RENEWAL_DECISIONS = ['Pending', 'Renew', 'Do Not Renew', 'Renegotiate', 'Terminate'] as const;

const optionalDate = z.union([z.string().date(), z.literal('')]).optional();
const optionalEmail = z.union([z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง').max(160), z.literal('')]).optional();

const initialContractSchema = z
  .object({
    contractNumber: z.string().trim().min(1).max(100),
    name: z.string().trim().max(200).optional(),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
    message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น',
    path: ['endDate'],
  });

const vendorFields = {
  name: z.string().trim().min(1, 'กรุณากรอกชื่อผู้ให้บริการ').max(200),
  serviceType: z.enum(VENDOR_SERVICE_TYPES).default('อื่นๆ'),
  serviceScope: z.string().trim().max(1000).optional(),
  contactPerson: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  email: optionalEmail,
  contactInfo: z.string().trim().max(300).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  criticalityTier: z.enum(VENDOR_CRITICALITY_TIERS).default('Medium'),
  vendorRiskAssessment: z.string().trim().max(4000).optional(),
  securityAssessment: z.string().trim().max(4000).optional(),
  dpaStatus: z.enum(VENDOR_ASSESSMENT_STATUSES).default('Not Assessed'),
  ndaStatus: z.enum(VENDOR_NDA_STATUSES).default('Not Assessed'),
  dataAccess: z.string().trim().max(2000).optional(),
  systemsAccessed: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  sla: z.string().trim().max(2000).optional(),
  incidentContact: z.string().trim().max(300).optional(),
  escalationContact: z.string().trim().max(300).optional(),
  performanceReview: z.string().trim().max(4000).optional(),
  annualReview: z.string().trim().max(4000).optional(),
  performanceReviewDate: optionalDate,
  annualReviewDate: optionalDate,
  notes: z.string().trim().max(1000).optional(),
};

export const createVendorSchema = z.object(vendorFields).extend({ initialContract: initialContractSchema.optional() });
export const updateVendorSchema = z.object(vendorFields).partial().refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข');
export const setVendorStatusSchema = z.object({ status: z.enum(VENDOR_STATUSES) });
export const assessVendorSchema = z.object({ result: z.string().trim().min(1, 'กรุณากรอกผลการประเมิน').max(2000) });
export const listVendorsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  serviceType: z.enum(VENDOR_SERVICE_TYPES).optional(),
});

const contractFields = {
  contractNumber: z.string().trim().min(1, 'กรุณากรอกเลขที่สัญญา').max(100),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อสัญญา').max(200),
  vendorId: z.string().uuid('กรุณาเลือกผู้ให้บริการ'),
  contractType: z.enum(CONTRACT_TYPES).default('Other'),
  serviceScope: z.string().trim().max(1500).optional(),
  keyTerms: z.string().trim().max(2000).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  contractValue: z.coerce.number().min(0).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'สกุลเงินต้องเป็นรหัส 3 ตัว เช่น THB').default('THB'),
  ownerId: z.string().uuid().nullable().optional(),
  budget: z.coerce.number().min(0).optional(),
  annualCost: z.coerce.number().min(0).optional(),
  autoRenewal: z.boolean().default(false),
  renewalNoticeDays: z.coerce.number().int().refine((value) => [30, 60, 90].includes(value), 'เลือกกำหนดแจ้งเตือน 30, 60 หรือ 90 วัน').default(30),
  slaOla: z.string().trim().max(3000).optional(),
  dpaAttachmentId: z.string().uuid().nullable().optional(),
  securityClause: z.string().trim().max(3000).optional(),
  linkedAssetIds: z.array(z.string().uuid()).max(500).default([]),
  linkedLicenseIds: z.array(z.string().uuid()).max(500).default([]),
  linkedConfigurationItemIds: z.array(z.string().uuid()).max(500).default([]),
  renewalDecision: z.enum(RENEWAL_DECISIONS).default('Pending'),
  terminationChecklist: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  status: z.enum(CONTRACT_STATUSES).default('Draft'),
  notes: z.string().trim().max(1000).optional(),
};

const validDateRange = (value: { startDate?: string; endDate?: string }) =>
  !value.startDate || !value.endDate || value.endDate >= value.startDate;

export const createContractSchema = z.object(contractFields).refine(validDateRange, {
  message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น',
  path: ['endDate'],
});
export const updateContractSchema = z
  .object(contractFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข')
  .refine(validDateRange, { message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น', path: ['endDate'] });
export const setContractStatusSchema = z.object({ status: z.enum(CONTRACT_STATUSES) });
export const listContractsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  contractType: z.enum(CONTRACT_TYPES).optional(),
  vendorId: z.string().uuid().optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
});
