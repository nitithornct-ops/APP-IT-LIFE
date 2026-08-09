import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const CHANGE_RISK_LEVELS = ['สูง', 'กลาง', 'ต่ำ'] as const;
export const CHANGE_STATUSES = ['ยื่นคำขอ', 'ผ่านการทดสอบ', 'อนุมัติแล้ว', 'ติดตั้งใช้งานแล้ว', 'ปฏิเสธ'] as const;

export const listChangesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(CHANGE_STATUSES).optional(),
  riskLevel: z.enum(CHANGE_RISK_LEVELS).optional(),
  requesterId: z.string().uuid().optional(),
});

export const createChangeSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อ').max(200),
  systemAffected: z.string().trim().min(1, 'กรุณาระบุระบบที่ได้รับผลกระทบ').max(150),
  changeType: z.string().trim().max(60).optional(),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(3000),
  impactAssessment: z.string().trim().max(2000).optional(),
  riskLevel: z.enum(CHANGE_RISK_LEVELS).default('ต่ำ'),
  rollbackPlan: z.string().trim().max(2000).optional(),
  sourceServiceRequestId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1500).optional(),
});

export const signOffChangeTestSchema = z.object({
  result: z.string().trim().min(1, 'กรุณาระบุผลการทดสอบ').max(1000),
  passed: z.boolean(),
});

export const approveChangeSchema = z.object({
  approve: z.boolean(),
  comment: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (!value.approve && !value.comment) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: 'กรุณาระบุเหตุผลการปฏิเสธ' });
});

export const deployChangeSchema = z.object({
  version: z.string().trim().min(1, 'กรุณาระบุเวอร์ชันที่ติดตั้ง').max(60),
  rollbackPlan: z.string().trim().max(2000).optional(),
});
