import { z } from 'zod';

/**
 * ระดับทักษะ 1–3 ตรงกับ check constraint ของ public.technician_skills
 * (migration 20260916100000) — ถ้าจะเพิ่มระดับต้องแก้ทั้งสองที่พร้อมกัน
 */
export const SKILL_LEVEL_VALUES = [1, 2, 3] as const;

const skillLevelSchema = z
  .number()
  .int('ระดับทักษะต้องเป็นจำนวนเต็ม')
  .refine((value) => (SKILL_LEVEL_VALUES as readonly number[]).includes(value), 'ระดับทักษะต้องอยู่ระหว่าง 1 ถึง 3');

/**
 * level = null คือ "ยังไม่ประเมิน" ซึ่งแปลว่าให้ลบผลประเมินเดิมทิ้ง ไม่ใช่บันทึกระดับ 0
 * ต้องแยกจากการไม่ส่ง category นั้นมาเลย (ซึ่งแปลว่า "ไม่แตะต้องของเดิม")
 */
const skillAssessmentSchema = z.object({
  categoryId: z.string().uuid('หมวดหมู่ไม่ถูกต้อง'),
  level: skillLevelSchema.nullable(),
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
