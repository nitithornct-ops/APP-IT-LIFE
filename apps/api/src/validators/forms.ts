import { z } from 'zod';

export const FORM_TEMPLATE_STATUSES = ['Draft', 'Published', 'Archived'] as const;
export const ISSUE_FORM_STATUSES = [
  'Draft',
  'Internal Review',
  'Sent to Vendor',
  'Vendor Replied',
  'Approved',
  'Closed',
  'Cancelled',
] as const;

const contentHtml = z.string().trim().min(1, 'แบบฟอร์มต้องมีเนื้อหา').max(300_000, 'เนื้อหาแบบฟอร์มมีขนาดใหญ่เกินไป');
const pageSettings = z.object({
  size: z.enum(['A4', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  marginMm: z.coerce.number().min(5).max(50).default(20),
}).optional();

export const createFormTemplateSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อแบบฟอร์ม').max(200),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().min(1).max(100).default('IT Support'),
  contentHtml,
  pageSettings,
});

export const updateFormTemplateSchema = createFormTemplateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'ไม่มีข้อมูลที่ต้องแก้ไข',
);

export const publishFormTemplateSchema = z.object({
  changeNote: z.string().trim().max(500).optional(),
});

export const createIssueFormSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกชื่อเรื่อง').max(240),
  templateId: z.string().uuid('กรุณาเลือก Template'),
  ticketId: z.string().uuid().nullable().optional(),
});

export const updateIssueFormSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  contentHtml: contentHtml.optional(),
  formData: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(ISSUE_FORM_STATUSES).optional(),
}).refine((value) => Object.keys(value).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข');

export const sendIssueFormToVendorSchema = z.object({
  vendorId: z.string().uuid('กรุณาเลือก Vendor'),
  expiresInDays: z.coerce.number().int().min(1).max(60).default(14),
  dueDate: z.union([z.string().date(), z.literal('')]).optional(),
});

export const vendorTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/, 'ลิงก์แบบฟอร์มไม่ถูกต้อง'),
});

export const submitVendorFormSchema = z.object({
  slaCategory: z.enum(['Emergency Case', 'Minor Case', 'Other']),
  targetCompletionDate: z.union([z.string().date(), z.literal('')]).optional(),
  receivedDuration: z.string().trim().max(100).optional(),
  workaroundDuration: z.string().trim().max(100).optional(),
  analysisDuration: z.string().trim().max(100).optional(),
  resolutionDuration: z.string().trim().max(100).optional(),
  rootCause: z.string().trim().min(1, 'กรุณากรอกสาเหตุหลัก').max(5000),
  resolution: z.string().trim().min(1, 'กรุณากรอกวิธีแก้ไข').max(5000),
  prevention: z.string().trim().max(5000).optional(),
  creditType: z.enum(['none', 'manday']),
  changeTypes: z.array(z.enum(['Adjust', 'Edit', 'Add', 'Delete'])).max(4).default([]),
  creditBalanceBefore: z.coerce.number().min(0).optional(),
  mandayUsed: z.coerce.number().min(0).optional(),
  creditBalanceAfter: z.coerce.number().min(0).optional(),
  assessmentNote: z.string().trim().max(2000).optional(),
  assessorName: z.string().trim().min(1, 'กรุณากรอกชื่อผู้ประเมิน').max(160),
});

