import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const LICENSE_STATUSES = ['Active', 'Expired', 'Inactive'] as const;
export const LICENSE_MODELS = ['SaaS', 'Device', 'Concurrent'] as const;
export const LICENSE_ALLOCATION_TYPES = ['user', 'device'] as const;
export const LICENSE_RENEWAL_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (yyyy-MM-dd)');
const dateOrEmpty = z.union([isoDateString, z.literal('')]).optional();

/**
 * ราคาต่อสิทธิ์ — ห้ามใช้ z.coerce.number() ตรง ๆ เพราะ Number('') = 0 ช่องว่างในฟอร์มจะกลายเป็น
 * "ของฟรี" ทันที แล้วการ์ดสรุปเงินจะนับรายการนั้นเข้าไปเป็นศูนย์บาทโดยไม่มีใครรู้ว่าแค่ยังไม่ได้กรอก
 * ช่องว่างจึงต้องแปลงเป็น null ซึ่งแปลว่า "ยังไม่ได้บันทึกราคา"
 */
const unitPriceOrEmpty = z
  .union([z.coerce.number().min(0).max(99_999_999), z.literal('').transform(() => null), z.null()])
  .optional();

const licenseBaseSchema = z.object({
  productName: z.string().trim().max(150).optional(),
  edition: z.string().trim().max(100).optional(),
  version: z.string().trim().max(80).optional(),
  publisher: z.string().trim().max(150).optional(),
  licenseModel: z.enum(LICENSE_MODELS).default('SaaS'),
  softwareName: z.string().trim().min(1, 'กรุณากรอกชื่อซอฟต์แวร์').max(150),
  licenseType: z.string().trim().max(80).optional(),
  totalQty: z.coerce.number().min(0).optional(),
  usedQty: z.coerce.number().min(0).optional(),
  startDate: dateOrEmpty,
  expireDate: dateOrEmpty,
  vendorName: z.string().trim().max(150).optional(),
  vendorId: z.union([z.string().uuid(), z.literal('')]).optional(),
  contractId: z.union([z.string().uuid(), z.literal('')]).optional(),
  assignedTo: z.string().trim().max(200).optional(),
  unitPrice: unitPriceOrEmpty,
  expiryNoticeDays: z.coerce.number().int().min(0).max(3650).default(30),
  notes: z.string().trim().max(500).optional(),
});

export const createLicenseSchema = licenseBaseSchema.superRefine((data, ctx) => {
  if ((data.usedQty ?? 0) > (data.totalQty ?? 0)) {
    ctx.addIssue({ code: 'custom', message: 'จำนวนที่ใช้ต้องไม่เกินจำนวนทั้งหมด', path: ['usedQty'] });
  }
  if (data.startDate && data.expireDate && data.expireDate < data.startDate) {
    ctx.addIssue({ code: 'custom', message: 'วันหมดอายุต้องไม่ก่อนวันเริ่มต้น', path: ['expireDate'] });
  }
});
export type CreateLicenseInput = z.infer<typeof licenseBaseSchema>;

export const updateLicenseSchema = licenseBaseSchema
  .partial()
  .extend({ status: z.enum(LICENSE_STATUSES).optional() })
  .superRefine((data, ctx) => {
    if (data.usedQty !== undefined && data.totalQty !== undefined && data.usedQty > data.totalQty) {
      ctx.addIssue({ code: 'custom', message: 'จำนวนที่ใช้ต้องไม่เกินจำนวนทั้งหมด', path: ['usedQty'] });
    }
    if (data.startDate && data.expireDate && data.expireDate < data.startDate) {
      ctx.addIssue({ code: 'custom', message: 'วันหมดอายุต้องไม่ก่อนวันเริ่มต้น', path: ['expireDate'] });
    }
  });
export type UpdateLicenseInput = z.infer<typeof updateLicenseSchema>;

export const setLicenseStatusSchema = z.object({
  status: z.enum(LICENSE_STATUSES),
});
export type SetLicenseStatusInput = z.infer<typeof setLicenseStatusSchema>;

export const createLicenseAllocationSchema = z.object({
  assigneeType: z.enum(LICENSE_ALLOCATION_TYPES),
  employeeId: z.union([z.string().uuid(), z.literal('')]).optional(),
  assetId: z.union([z.string().uuid(), z.literal('')]).optional(),
  notes: z.string().trim().max(500).optional(),
}).superRefine((data, ctx) => {
  const hasEmployee = Boolean(data.employeeId);
  const hasAsset = Boolean(data.assetId);
  if (data.assigneeType === 'user' && (!hasEmployee || hasAsset)) {
    ctx.addIssue({ code: 'custom', message: 'กรุณาเลือก User ที่จะได้รับสิทธิ์', path: ['employeeId'] });
  }
  if (data.assigneeType === 'device' && (!hasAsset || hasEmployee)) {
    ctx.addIssue({ code: 'custom', message: 'กรุณาเลือก Device ที่จะได้รับสิทธิ์', path: ['assetId'] });
  }
});
export type CreateLicenseAllocationInput = z.infer<typeof createLicenseAllocationSchema>;

export const reclaimLicenseAllocationSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});
export type ReclaimLicenseAllocationInput = z.infer<typeof reclaimLicenseAllocationSchema>;

export const renewalApprovalSchema = z.object({
  status: z.enum(LICENSE_RENEWAL_APPROVAL_STATUSES),
  notes: z.string().trim().max(500).optional(),
});
export type RenewalApprovalInput = z.infer<typeof renewalApprovalSchema>;

export const listLicensesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(LICENSE_STATUSES).optional(),
});
export type ListLicensesQuery = z.infer<typeof listLicensesQuerySchema>;
