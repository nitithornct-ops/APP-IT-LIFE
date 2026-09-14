import { z } from 'zod';
import { FORM_MODULE_KEYS } from '../services/formModuleService';

export const FORM_TEMPLATE_STATUSES = ['Draft', 'Published', 'Archived'] as const;
export const FORM_SOURCE_MODULES = ['ticket', 'incident', 'change', 'contract', 'audit', 'risk', 'service_request', 'asset_borrow', 'custom'] as const;
export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'acknowledgement', 'signature'] as const;
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

const fieldCondition = z.object({
  fieldKey: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,80}$/),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_empty']),
  value: z.string().max(500).optional(),
});

export const formFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,80}$/),
  label: z.string().trim().min(1).max(200),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  condition: fieldCondition.optional(),
  helpText: z.string().trim().max(500).optional(),
}).superRefine((field, ctx) => {
  if (field.type === 'select' && (!field.options || field.options.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Select field ต้องมีตัวเลือกอย่างน้อย 1 รายการ' });
  }
});

const fieldSchema = z.array(formFieldSchema).max(200).superRefine((fields, ctx) => {
  const keys = new Set<string>();
  fields.forEach((field, index) => {
    if (keys.has(field.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'key'], message: 'Field key ซ้ำกันไม่ได้' });
    keys.add(field.key);
  });
}).default([]);

const acknowledgementConfig = z.object({
  enabled: z.boolean().default(false),
  statement: z.string().trim().max(2000).default(''),
}).default({ enabled: false, statement: '' });

const approvalSignatureConfig = z.object({
  requiredRoles: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
}).default({ requiredRoles: [] });

const documentNumberRule = z.object({
  prefix: z.string().trim().regex(/^[A-Z0-9_-]{1,20}$/).default('FRM'),
  dateFormat: z.enum(['YYYY', 'YYYYMM', 'YYMM']).default('YYYYMM'),
  padding: z.coerce.number().int().min(1).max(12).default(5),
}).default({ prefix: 'FRM', dateFormat: 'YYYYMM', padding: 5 });

export const createFormTemplateSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อแบบฟอร์ม').max(200),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().min(1).max(100).default('IT Support'),
  contentHtml,
  fieldSchema,
  acknowledgementConfig,
  approvalSignatureConfig,
  documentNumberRule,
  pageSettings,
  moduleKey: z.enum(FORM_MODULE_KEYS).nullable().optional(),
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
  sourceModule: z.enum(FORM_SOURCE_MODULES).optional(),
  sourceRecordId: z.string().trim().min(1).max(120).nullable().optional(),
});

export const updateIssueFormSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  contentHtml: contentHtml.optional(),
  fieldSchema: fieldSchema.optional(),
  sourceModule: z.enum(FORM_SOURCE_MODULES).optional(),
  sourceRecordId: z.string().trim().min(1).max(120).nullable().optional(),
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

export const acknowledgeIssueFormSchema = z.object({
  partyType: z.enum(['requester', 'vendor', 'internal', 'approver']),
  partyName: z.string().trim().min(1).max(160),
  partyEmail: z.string().trim().email().max(240).optional().or(z.literal('')),
  statement: z.string().trim().min(1).max(2000),
  accepted: z.literal(true),
});

export const signIssueFormSchema = z.object({
  role: z.string().trim().min(1).max(100),
  signerName: z.string().trim().min(1).max(160),
  signerEmail: z.string().trim().email().max(240).optional().or(z.literal('')),
  signatureType: z.enum(['typed', 'drawn', 'certificate']).default('typed'),
  signatureValue: z.string().trim().min(1).max(1000),
});

export const compareFormTemplateVersionsSchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
}).refine((value) => value.from !== value.to, { message: 'ต้องเลือกคนละเวอร์ชันเพื่อเปรียบเทียบ' });

