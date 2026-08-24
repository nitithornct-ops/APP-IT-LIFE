import { z } from 'zod';

/**
 * รหัสสาเหตุถูกบังคับรูปแบบไว้ที่ฐานข้อมูลด้วย check constraint อยู่แล้ว
 * ที่นี่ใช้ regex เดียวกันเพื่อให้ผู้ใช้ได้ข้อความบอกว่าผิดตรงไหนก่อนยิงถึง Postgres
 * ตัวพิมพ์ใหญ่อย่างเดียวโดยตั้งใจ — รหัสที่ต่างกันแค่ตัวพิมพ์จะกลายเป็นสองกลุ่มในรายงาน
 */
const CAUSE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

const codeField = z
  .string()
  .trim()
  .regex(CAUSE_CODE_PATTERN, 'รหัสสาเหตุต้องเป็นตัวพิมพ์ใหญ่ ตัวเลข ขีดกลางหรือขีดล่าง ยาว 2-32 ตัว');

const nameField = z.string().trim().min(2).max(120);
const descriptionField = z.string().trim().max(500).nullish();

export const listCauseCodesQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

export const createCauseCodeSchema = z.object({
  code: codeField,
  name: nameField,
  description: descriptionField,
  categoryId: z.string().uuid().nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const updateCauseCodeSchema = z
  .object({
    name: nameField.optional(),
    description: descriptionField,
    categoryId: z.string().uuid().nullish(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'ต้องระบุอย่างน้อยหนึ่งฟิลด์ที่จะแก้ไข' });

/**
 * รหัสสาเหตุแก้ไม่ได้หลังสร้าง เพราะรายงานย้อนหลังและ KB อ้างถึงรหัสนี้
 * ถ้าตั้งผิดให้ปิดใช้แล้วสร้างใหม่ ข้อมูลเดิมจะยังตีความได้ถูกต้องเสมอ
 */
export type CreateCauseCodeInput = z.infer<typeof createCauseCodeSchema>;
export type UpdateCauseCodeInput = z.infer<typeof updateCauseCodeSchema>;
