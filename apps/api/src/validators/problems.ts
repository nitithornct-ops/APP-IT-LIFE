import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const PROBLEM_PRIORITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
export const PROBLEM_STATUSES = ['เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด'] as const;
export const KNOWN_ERROR_STATUSES = ['ร่าง', 'เผยแพร่', 'แก้ไขแล้ว', 'ยกเลิก'] as const;

const optionalDate = z.union([z.string().date(), z.literal('')]).optional();
const optionalUrl = z.union([z.string().trim().url('URL ไม่ถูกต้อง').max(1000), z.literal('')]).optional();
const idList = z.array(z.string().uuid()).max(100).default([]);

export const listProblemsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(PROBLEM_STATUSES).optional(),
  priority: z.enum(PROBLEM_PRIORITIES).optional(),
  ownerId: z.string().uuid().optional(),
});

export const createProblemSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกชื่อปัญหา').max(200),
  category: z.string().trim().max(100).optional(),
  affectedSystem: z.string().trim().max(200).optional(),
  impact: z.string().trim().max(1000).optional(),
  rootCause: z.string().trim().max(1500).optional(),
  workaround: z.string().trim().max(1500).optional(),
  permanentFix: z.string().trim().max(1500).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  priority: z.enum(PROBLEM_PRIORITIES).default('ปานกลาง'),
  status: z.enum(PROBLEM_STATUSES).default('เปิด'),
  reviewDate: optionalDate,
  evidenceUrl: optionalUrl,
  notes: z.string().trim().max(1000).optional(),
  incidentIds: idList,
  ticketIds: idList,
});

export const updateProblemSchema = createProblemSchema.partial().refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข');

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
