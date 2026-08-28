import { z } from 'zod';

const passwordSchema = z.string()
  .min(12, 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร')
  .max(128)
  .regex(/[a-z]/, 'รหัสผ่านต้องมีตัวอักษรภาษาอังกฤษตัวเล็ก')
  .regex(/[A-Z]/, 'รหัสผ่านต้องมีตัวอักษรภาษาอังกฤษตัวใหญ่')
  .regex(/[0-9]/, 'รหัสผ่านต้องมีตัวเลข');

export const vendorPortalLoginSchema = z.object({
  vendorCode: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const createVendorPortalAccountSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  fullName: z.string().trim().min(1).max(160),
  position: z.string().trim().max(160).optional(),
  password: passwordSchema,
});

export const resetVendorPortalPasswordSchema = z.object({ password: passwordSchema });

export const setVendorPortalAccountStatusSchema = z.object({
  status: z.enum(['Active', 'Inactive']),
});

const optionalLongText = z.string().trim().max(2000).optional();
const optionalDateTime = z.string().trim().refine(
  (value) => !value || !Number.isNaN(Date.parse(value)),
  'วันและเวลาไม่ถูกต้อง',
).optional();

export const submitOutsourceWorkSchema = z.object({
  vendorIssueNo: z.string().trim().max(120).optional(),
  slaCategory: z.enum(['Emergency Case', 'Minor Case', 'อื่น ๆ']),
  receivedAt: optionalDateTime,
  workStartedAt: optionalDateTime,
  workCompletedAt: optionalDateTime,
  receivedDuration: z.string().trim().max(160).optional(),
  workaroundDuration: z.string().trim().max(160).optional(),
  analysisDuration: z.string().trim().max(160).optional(),
  resolutionDuration: z.string().trim().max(160).optional(),
  rootCause: z.string().trim().min(1, 'กรุณาระบุสาเหตุของปัญหา').max(2000),
  workaround: optionalLongText,
  resolution: z.string().trim().min(1, 'กรุณาระบุวิธีแก้ไข').max(3000),
  prevention: optionalLongText,
  partsUsed: optionalLongText,
  testResult: z.string().trim().min(1, 'กรุณาระบุผลการทดสอบ').max(2000),
  notes: optionalLongText,
  assessorName: z.string().trim().min(1, 'กรุณาระบุชื่อผู้ลงนาม').max(160),
  assessorPosition: z.string().trim().max(160).optional(),
  confirmed: z.literal(true, { errorMap: () => ({ message: 'กรุณายืนยันข้อมูลก่อนลงนาม' }) }),
});

export const reviewOutsourceSubmissionSchema = z.object({
  status: z.enum(['Accepted', 'Revision Requested']),
  note: z.string().trim().max(2000).optional(),
}).superRefine((value, context) => {
  if (value.status === 'Revision Requested' && !value.note) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'กรุณาระบุสิ่งที่ต้องแก้ไข' });
  }
});

