import { z } from 'zod';

/**
 * ระดับทักษะ 1–5 ตรงกับ check constraint ของ public.technician_skills
 * (migration 20260916100000) — ถ้าจะเพิ่มระดับต้องแก้ทั้งสองที่พร้อมกัน
 */
export const SKILL_LEVEL_VALUES = [1, 2, 3, 4, 5] as const;

const skillLevelSchema = z
  .number()
  .int('ระดับทักษะต้องเป็นจำนวนเต็ม')
  .refine((value) => (SKILL_LEVEL_VALUES as readonly number[]).includes(value), 'ระดับทักษะต้องอยู่ระหว่าง 1 ถึง 5');

export const TECHNICIAN_AVAILABILITY_VALUES = ['available', 'limited', 'unavailable'] as const;

const optionalText = (max: number, message: string) => z.string().trim().max(max, message).optional();

const certificationExpirySchema = z.string().trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'วันหมดอายุใบรับรองไม่ถูกต้อง')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  }, 'วันหมดอายุใบรับรองไม่ถูกต้อง')
  .nullable()
  .optional();

/**
 * level = null คือ "ยังไม่ประเมิน" ซึ่งแปลว่าให้ลบผลประเมินเดิมทิ้ง ไม่ใช่บันทึกระดับ 0
 * ต้องแยกจากการไม่ส่ง category นั้นมาเลย (ซึ่งแปลว่า "ไม่แตะต้องของเดิม")
 */
const skillAssessmentSchema = z.object({
  categoryId: z.string().uuid('หมวดหมู่ไม่ถูกต้อง'),
  level: skillLevelSchema.nullable(),
  skill: optionalText(160, 'ชื่อทักษะยาวเกิน 160 ตัวอักษร'),
  certification: optionalText(200, 'ใบรับรองยาวเกิน 200 ตัวอักษร'),
  certificationExpiry: certificationExpirySchema,
  productTechnology: optionalText(200, 'ผลิตภัณฑ์/เทคโนโลยียาวเกิน 200 ตัวอักษร'),
  location: optionalText(200, 'สถานที่ยาวเกิน 200 ตัวอักษร'),
  availability: z.enum(TECHNICIAN_AVAILABILITY_VALUES).optional(),
  note: z.string().trim().max(300, 'บันทึกการประเมินยาวเกิน 300 ตัวอักษร').optional(),
});

export const saveTechnicianSkillsSchema = z.object({
  skills: z
    .array(skillAssessmentSchema)
    .min(1, 'กรุณาระบุอย่างน้อยหนึ่งหมวดหมู่')
    .max(100, 'บันทึกได้ครั้งละไม่เกิน 100 หมวดหมู่')
    .refine(
      (skills) => new Set(skills.map((skill) => skill.categoryId)).size === skills.length,
      'มีหมวดหมู่ซ้ำกันในคำขอเดียวกัน',
    ),
});

export type SaveTechnicianSkillsInput = z.infer<typeof saveTechnicianSkillsSchema>;

export const technicianSkillRecommendationQuerySchema = z.object({
  categoryId: z.string().uuid('หมวดหมู่ Ticket ไม่ถูกต้อง'),
  location: z.string().trim().max(200, 'สถานที่ยาวเกิน 200 ตัวอักษร').optional(),
  productTechnology: z.string().trim().max(200, 'ผลิตภัณฑ์/เทคโนโลยียาวเกิน 200 ตัวอักษร').optional(),
  minLevel: z.coerce.number().int().min(1).max(5).default(2),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export type TechnicianSkillRecommendationQuery = z.infer<typeof technicianSkillRecommendationQuerySchema>;
