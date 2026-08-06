import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

const priorityEnum = z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']);

export const submitServiceRequestSchema = z.object({
  catalogId: z.string().uuid('กรุณาเลือกบริการ'),
  requestedFor: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(300).optional(),
  answers: z.record(z.unknown()).optional(),
  businessJustification: z.string().trim().max(2000).optional(),
  priority: priorityEnum.optional(),
  impact: priorityEnum.optional(),
  idempotencyKey: z.string().trim().max(160).optional(),
});

export type SubmitServiceRequestInput = z.infer<typeof submitServiceRequestSchema>;

export const listServiceRequestsQuerySchema = paginationQuerySchema.extend({
  status: z.string().trim().max(80).optional(),
  assigneeId: z.string().uuid().optional(),
  mine: z.enum(['true', 'false']).optional(),
  pendingMyApproval: z.enum(['true', 'false']).optional(),
});

export type ListServiceRequestsQuery = z.infer<typeof listServiceRequestsQuerySchema>;

/**
 * Endpoint เดียวรองรับทั้ง มอบหมาย/บันทึกการดำเนินงาน/ส่งรอผู้ใช้-ผู้ให้บริการ/ส่งรอยืนยันผล/
 * ปิดงาน/ผู้ขอยืนยันผล-ส่งกลับแก้ไข/ยกเลิก — ดู routes/serviceRequests.ts สำหรับ state machine
 * และสิทธิ์ต่อประเภทการเปลี่ยนแปลง (แนวทางเดียวกับ routes/tickets.ts ใน Module 4)
 */
export const updateServiceRequestSchema = z.object({
  status: z.string().trim().max(80).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  assignedGroupId: z.string().uuid().nullable().optional(),
  priority: priorityEnum.optional(),
  note: z.string().trim().max(2000).optional(),
  fulfillmentNotes: z.string().trim().max(2000).optional(),
  completionEvidence: z.string().trim().max(1000).optional(),
  cancelReason: z.string().trim().max(1000).optional(),
});

export type UpdateServiceRequestInput = z.infer<typeof updateServiceRequestSchema>;

export const approveServiceRequestSchema = z.object({
  approved: z.boolean(),
  comment: z.string().trim().max(1000).optional(),
});

export type ApproveServiceRequestInput = z.infer<typeof approveServiceRequestSchema>;

export const updateServiceRequestTaskSchema = z.object({
  status: z.enum(['รอดำเนินการ', 'กำลังดำเนินการ', 'เสร็จสิ้น', 'ข้าม']),
  assigneeId: z.string().uuid().nullable().optional(),
  evidenceLink: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type UpdateServiceRequestTaskInput = z.infer<typeof updateServiceRequestTaskSchema>;
