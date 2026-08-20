import { ticketRatingDetailsSchema } from '@itlife/shared';
import { z } from 'zod';

export const lineLoginUrlQuerySchema = z.object({
  returnMode: z.enum(['report', 'status', 'kb']).optional(),
});

export const lineLinkEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1, 'กรุณากรอกรหัสพนักงาน').max(80),
});

const ticketPriorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

export const lineSubmitTicketSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อปัญหา').max(200),
  categoryId: z.string().uuid('กรุณาเลือกหมวดหมู่ Ticket'),
  priority: ticketPriorityEnum.optional(),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(3000),
  isSecurity: z.boolean().optional(),
});

export const lineTicketFeedbackSchema = z.object({
  ratings: ticketRatingDetailsSchema,
  comment: z.string().trim().max(1000).optional(),
});

export const lineAdminListQuerySchema = z.object({
  status: z.enum(['Pending', 'Active', 'Suspended', 'Unlinked']).optional(),
});

export const lineAdminUpdateStatusSchema = z.object({
  status: z.enum(['Active', 'Suspended', 'Unlinked']),
});
