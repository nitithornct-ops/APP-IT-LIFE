import { z } from 'zod';

const emptyToUndefined = (value: unknown) => value === '' || value === null ? undefined : value;
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
const optionalUuid = z.preprocess(emptyToUndefined, z.string().uuid().optional());
const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(20).default([])
  .transform((tags) => [...new Set(tags.map((tag) => tag.toLocaleLowerCase('th')))]);

export const listKnowledgeQuerySchema = z.object({
  search: optionalText(120),
  categoryId: optionalUuid,
  status: z.preprocess(emptyToUndefined, z.enum(['เผยแพร่', 'ร่าง']).optional()),
});

const articleFields = z.object({
  title: z.string().trim().min(1).max(200),
  categoryId: optionalUuid,
  symptom: optionalText(2000),
  solution: z.string().trim().min(1).max(10000),
  tags: tagsSchema,
  status: z.enum(['เผยแพร่', 'ร่าง']).default('เผยแพร่'),
});

export const createKnowledgeArticleSchema = articleFields;
export const updateKnowledgeArticleSchema = articleFields;
/**
 * สร้างบทความจากใบงานที่ปิดไปแล้ว — รับแค่ ticketId เพราะเนื้อหาทั้งหมดคัดมาจากใบงานฝั่งเซิร์ฟเวอร์
 * ไม่ให้ผู้เรียกส่งเนื้อหามาเอง มิฉะนั้นจะอ้างว่า "มาจากใบงานนี้" โดยเขียนอะไรก็ได้ลงไป
 */
export const createArticleFromTicketSchema = z.object({ ticketId: z.string().uuid() });

export const setKnowledgeStatusSchema = z.object({ status: z.enum(['เผยแพร่', 'ร่าง']) });
export const publicKnowledgeQuerySchema = z.object({ search: optionalText(120), categoryId: optionalUuid });
export const publicKnowledgeViewSchema = z.object({ clientId: z.string().trim().min(12).max(120).regex(/^[A-Za-z0-9._:-]+$/) });
