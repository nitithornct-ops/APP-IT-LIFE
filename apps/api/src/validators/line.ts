import { ticketRatingDetailsSchema } from '@itlife/shared';
import { z } from 'zod';

export const lineLoginUrlQuerySchema = z.object({
  returnMode: z.enum(['report', 'status', 'kb', 'link']).optional(),
});

export const lineProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'กรุณากรอกชื่อ–นามสกุล').max(160)
    .refine((value) => value.split(/\s+/).length >= 2, 'กรุณากรอกทั้งชื่อและนามสกุล'),
});

const ticketPriorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

const optionalRequesterPhoneSchema = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().max(40).optional(),
);

export const lineSubmitTicketSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อปัญหา').max(200),
  categoryId: z.string().uuid('กรุณาเลือกหมวดหมู่ Ticket'),
  priority: ticketPriorityEnum.optional(),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(3000),
  requesterPhone: optionalRequesterPhoneSchema,
  requesterPosition: z.string().trim().max(160).optional(),
  department: z.string().trim().max(160).optional(),
  incidentAt: z.string().trim().refine((value) => !Number.isNaN(new Date(value).getTime()), 'วันที่และเวลาที่พบปัญหาไม่ถูกต้อง').optional(),
  erpModule: z.string().trim().max(120).optional(),
  location: z.string().trim().max(160).optional(),
  assetCode: z.string().trim().max(80).optional(),
  privacyConsent: z.literal(true, { errorMap: () => ({ message: 'กรุณายอมรับประกาศการใช้ข้อมูลส่วนบุคคลก่อนส่ง Ticket' }) }),
  isSecurity: z.boolean().optional(),
});

/** ข้อความที่ผู้แจ้งส่งถึงทีม IT จากหน้า Ticket — เก็บเป็น worklog สาธารณะของใบนั้น */
export const lineTicketMessageSchema = z.object({
  message: z.string().trim().min(1, 'กรุณาพิมพ์ข้อความก่อนส่ง').max(1000, 'ข้อความยาวได้ไม่เกิน 1000 ตัวอักษร'),
});

export const lineTicketFeedbackSchema = z.object({
  ratings: ticketRatingDetailsSchema,
  comment: z.string().trim().max(1000).optional(),
});

export const lineAdminListQuerySchema = z.object({
  status: z.enum(['Pending', 'Active', 'Suspended', 'Unlinked']).optional(),
});

export const lineAdminUpdateStatusSchema = z.object({
  status: z.enum(['Active', 'Suspended']),
});

export const lineAdminUpdateLinkSchema = z.object({
  userId: z.string().uuid('ผู้ใช้ที่เลือกไม่ถูกต้อง').nullable(),
});
