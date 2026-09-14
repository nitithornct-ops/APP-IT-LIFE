import { z } from 'zod';

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'รูปแบบวันที่ไม่ถูกต้อง');

const campaignCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'รหัส Campaign ต้องมีอย่างน้อย 2 ตัวอักษร')
  .max(80, 'รหัส Campaign ยาวเกินไป')
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'รหัส Campaign ใช้ได้เฉพาะ A-Z, 0-9, _ หรือ -');

export const createAccessCertificationCampaignSchema = z.object({
  code: campaignCode,
  name: z.string().trim().min(1, 'กรุณาระบุชื่อ Campaign').max(200),
  systemId: z.string().uuid().nullable().optional(),
  reviewerId: z.string().uuid('กรุณาเลือก Reviewer'),
  dueDate: isoDate,
});

export const accessCertificationDecisionsSchema = z.object({
  decisions: z.array(z.object({
    itemId: z.string().uuid(),
    status: z.enum(['approved', 'revoked']),
    note: z.string().trim().max(1500).optional(),
  })).min(1, 'กรุณาเลือกรายการอย่างน้อย 1 รายการ').max(1000, 'ทำรายการได้ครั้งละไม่เกิน 1,000 รายการ'),
});

export const accessCertificationSignOffSchema = z.object({
  note: z.string().trim().max(1500).optional(),
});

export const accessCertificationEscalationSchema = z.object({
  reason: z.string().trim().min(3, 'กรุณาระบุเหตุผลการ Escalation').max(1000),
});

export type CreateAccessCertificationCampaignInput = z.infer<typeof createAccessCertificationCampaignSchema>;
export type AccessCertificationDecisionsInput = z.infer<typeof accessCertificationDecisionsSchema>;
export type AccessCertificationSignOffInput = z.infer<typeof accessCertificationSignOffSchema>;
export type AccessCertificationEscalationInput = z.infer<typeof accessCertificationEscalationSchema>;
