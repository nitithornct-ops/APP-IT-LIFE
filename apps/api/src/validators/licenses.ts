import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const LICENSE_STATUSES = ['Active', 'Expired', 'Inactive'] as const;

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (yyyy-MM-dd)');
const dateOrEmpty = z.union([isoDateString, z.literal('')]).optional();

const licenseBaseSchema = z.object({
  softwareName: z.string().trim().min(1, 'กรุณากรอกชื่อซอฟต์แวร์').max(150),
  licenseType: z.string().trim().max(80).optional(),
  totalQty: z.coerce.number().min(0).optional(),
  usedQty: z.coerce.number().min(0).optional(),
  startDate: dateOrEmpty,
  expireDate: dateOrEmpty,
  vendorName: z.string().trim().max(150).optional(),
  assignedTo: z.string().trim().max(200).optional(),
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

export const listLicensesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(LICENSE_STATUSES).optional(),
});
export type ListLicensesQuery = z.infer<typeof listLicensesQuerySchema>;
