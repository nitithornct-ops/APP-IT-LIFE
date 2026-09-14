import { z } from 'zod';

const emptyToUndefined = (value: unknown) => value === '' || value === null ? undefined : value;
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
const optionalUuid = z.preprocess(emptyToUndefined, z.string().uuid().optional());
const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(20).default([])
  .transform((tags) => [...new Set(tags.map((tag) => tag.toLocaleLowerCase('th')))]);
const synonymsSchema = z.array(z.string().trim().min(1).max(80)).max(30).default([])
  .transform((items) => [...new Set(items.map((item) => item.toLocaleLowerCase('th')))]);
const relationIdsSchema = z.array(z.string().uuid()).max(100).default([])
  .transform((items) => [...new Set(items)]);
const optionalDate = z.preprocess(emptyToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

export const NOT_HELPFUL_REASONS = [
  'เนื้อหาไม่ตรงกับปัญหา',
  'ทำตามขั้นตอนไม่สำเร็จ',
  'ข้อมูลล้าสมัย',
  'อ่านหรือทำความเข้าใจยาก',
  'อื่น ๆ',
] as const;

export const listKnowledgeQuerySchema = z.object({
  search: optionalText(120),
  categoryId: optionalUuid,
  taxonomyId: optionalUuid,
  status: z.preprocess(emptyToUndefined, z.enum(['เผยแพร่', 'ร่าง']).optional()),
});

const articleFields = z.object({
  title: z.string().trim().min(1).max(200),
  categoryId: optionalUuid,
  taxonomyId: optionalUuid,
  symptom: optionalText(2000),
  solution: z.string().trim().min(1).max(10000),
  tags: tagsSchema,
  synonyms: synonymsSchema,
  articleOwnerId: optionalUuid,
  reviewerId: optionalUuid,
  reviewDueDate: optionalDate,
  expiryDate: optionalDate,
  isDeprecated: z.boolean().default(false),
  deprecatedReason: optionalText(500),
  searchRank: z.coerce.number().int().min(0).max(1000).default(0),
  incidentIds: relationIdsSchema,
  problemIds: relationIdsSchema,
  knownErrorIds: relationIdsSchema,
  serviceIds: relationIdsSchema,
  changeNote: optionalText(500),
  status: z.enum(['เผยแพร่', 'ร่าง']).default('เผยแพร่'),
}).superRefine((value, context) => {
  if (value.isDeprecated && !value.deprecatedReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deprecatedReason'], message: 'กรุณาระบุเหตุผลที่ Deprecated' });
  }
  if (value.reviewDueDate && value.expiryDate && value.expiryDate < value.reviewDueDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiryDate'], message: 'Expiry ต้องไม่ก่อน Review Due' });
  }
  if (value.status === 'เผยแพร่' && value.isDeprecated) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['isDeprecated'], message: 'บทความ Deprecated ต้องเก็บเป็นร่างก่อน' });
  }
});

export const createKnowledgeArticleSchema = articleFields;
export const updateKnowledgeArticleSchema = articleFields;
/**
 * สร้างบทความจากใบงานที่ปิดไปแล้ว — รับแค่ ticketId เพราะเนื้อหาทั้งหมดคัดมาจากใบงานฝั่งเซิร์ฟเวอร์
 * ไม่ให้ผู้เรียกส่งเนื้อหามาเอง มิฉะนั้นจะอ้างว่า "มาจากใบงานนี้" โดยเขียนอะไรก็ได้ลงไป
 */
export const createArticleFromTicketSchema = z.object({ ticketId: z.string().uuid() });

export const setKnowledgeStatusSchema = z.object({ status: z.enum(['เผยแพร่', 'ร่าง']) });
export const notHelpfulSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const publicKnowledgeQuerySchema = z.object({ search: optionalText(120), categoryId: optionalUuid, taxonomyId: optionalUuid });
export const publicKnowledgeViewSchema = z.object({ clientId: z.string().trim().min(12).max(120).regex(/^[A-Za-z0-9._:-]+$/) });
