import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const PROBLEM_PRIORITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
export const PROBLEM_STATUSES = ['เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด'] as const;
export const KNOWN_ERROR_STATUSES = ['ร่าง', 'เผยแพร่', 'แก้ไขแล้ว', 'ยกเลิก'] as const;
export const RCA_METHODS = ['5 Why', 'Fishbone', 'Other'] as const;
export const CORRECTIVE_ACTION_STATUSES = ['เปิด', 'กำลังดำเนินการ', 'เสร็จสิ้น', 'ยกเลิก'] as const;

const optionalDate = z.union([z.string().date(), z.literal('')]).optional();
const optionalUrl = z.union([z.string().trim().url('URL ไม่ถูกต้อง').max(1000), z.literal('')]).optional();
const idList = z.array(z.string().uuid()).max(100).default([]);
const optionalDateTime = z.union([z.string().datetime({ offset: true }), z.literal('')]).optional();
const fiveWhyStep = z.object({
  question: z.string().trim().max(100).default(''),
  answer: z.string().trim().max(1000).default(''),
});
const fishbone = z.object({
  people: z.string().trim().max(1000).default(''),
  process: z.string().trim().max(1000).default(''),
  technology: z.string().trim().max(1000).default(''),
  environment: z.string().trim().max(1000).default(''),
  materials: z.string().trim().max(1000).default(''),
  measurement: z.string().trim().max(1000).default(''),
});

export const listProblemsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(PROBLEM_STATUSES).optional(),
  priority: z.enum(PROBLEM_PRIORITIES).optional(),
  ownerId: z.string().uuid().optional(),
});

const problemFieldsSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกชื่อปัญหา').max(200),
  category: z.string().trim().max(100).optional(),
  affectedSystem: z.string().trim().max(200).optional(),
  impact: z.string().trim().max(1000).optional(),
  rootCause: z.string().trim().max(1500).optional(),
  workaround: z.string().trim().max(1500).optional(),
  permanentFix: z.string().trim().max(1500).optional(),
  rcaMethod: z.enum(RCA_METHODS).default('5 Why'),
  fiveWhy: z.array(fiveWhyStep).max(5).default([]),
  fishbone: fishbone.default({}),
  ownerId: z.string().uuid().nullable().optional(),
  priority: z.enum(PROBLEM_PRIORITIES).default('ปานกลาง'),
  status: z.enum(PROBLEM_STATUSES).default('เปิด'),
  reviewDate: optionalDate,
  reviewMeetingAt: optionalDateTime,
  reviewMeetingOwnerId: z.string().uuid().nullable().optional(),
  reviewMeetingNotes: z.string().trim().max(1500).optional(),
  recurrenceCount: z.number().int().min(0).max(100000).default(0),
  evidenceUrl: optionalUrl,
  notes: z.string().trim().max(1000).optional(),
  incidentIds: idList,
  ticketIds: idList,
  configurationItemIds: idList,
  changeIds: idList,
});

export const createProblemSchema = problemFieldsSchema.superRefine((value, ctx) => {
  if (value.permanentFix?.trim() && !value.changeIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['changeIds'], message: 'Permanent Fix ต้องผูกกับ Change อย่างน้อย 1 รายการ' });
  }
  if (value.status === 'ปิด' && !value.changeIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['changeIds'], message: 'ก่อนปิด Problem ต้องมี Change ที่เชื่อมโยง' });
  }
});

export const updateProblemSchema = problemFieldsSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข')
  .superRefine((value, ctx) => {
    if (value.permanentFix?.trim() && !value.changeIds?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['changeIds'], message: 'Permanent Fix ต้องผูกกับ Change อย่างน้อย 1 รายการ' });
    }
    if (value.status === 'ปิด' && !value.changeIds?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['changeIds'], message: 'ก่อนปิด Problem ต้องมี Change ที่เชื่อมโยง' });
    }
  });

export const listKnownErrorsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(KNOWN_ERROR_STATUSES).optional(),
  problemId: z.string().uuid().optional(),
});

export const createKnownErrorSchema = z.object({
  problemId: z.string().uuid(),
  title: z.string().trim().min(1, 'กรุณากรอกชื่อ Known Error').max(200),
  symptoms: z.string().trim().max(1500).optional(),
  rootCause: z.string().trim().max(1500).optional(),
  workaround: z.string().trim().min(1, 'กรุณากรอก Workaround').max(1500),
  affectedVersions: z.string().trim().max(500).optional(),
  fixedVersion: z.string().trim().max(200).optional(),
  knowledgeArticleRef: z.string().trim().max(80).optional(),
  status: z.enum(KNOWN_ERROR_STATUSES).default('เผยแพร่'),
  reviewDate: optionalDate,
  notes: z.string().trim().max(1000).optional(),
});

export const updateKnownErrorSchema = createKnownErrorSchema.partial().refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข');

const correctiveActionFieldsSchema = z.object({
  title: z.string().trim().min(1, 'กรุณาระบุ Corrective Action').max(200),
  description: z.string().trim().max(1500).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: optionalDate,
  status: z.enum(CORRECTIVE_ACTION_STATUSES).default('เปิด'),
  verificationNotes: z.string().trim().max(1500).optional(),
});

export const createCorrectiveActionSchema = correctiveActionFieldsSchema.superRefine((value, ctx) => {
  if (value.status === 'เสร็จสิ้น' && !value.verificationNotes?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['verificationNotes'], message: 'กรุณาระบุผลการตรวจสอบเมื่อปิด Action' });
  }
});

export const updateCorrectiveActionSchema = correctiveActionFieldsSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข');

export const verifyProblemAfterChangeSchema = z.object({
  notes: z.string().trim().min(1, 'กรุณาระบุผลการ Verify').max(1500),
});
