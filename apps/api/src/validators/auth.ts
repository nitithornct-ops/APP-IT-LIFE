import { z } from 'zod';

/**
 * identifier = สิ่งที่ผู้ใช้พิมพ์ในช่อง login ซึ่งเป็นได้ทั้งอีเมลและชื่อผู้ใช้ ตั้งแต่รองรับบัญชีที่ไม่มีอีเมล
 * จึงตรวจเป็น email ไม่ได้อีกต่อไป (ชื่อผู้ใช้เปล่า ๆ จะถูกปฏิเสธ 400 ทุกครั้งที่ login ไม่ผ่าน
 * ทำให้ Login Log ขาดหลักฐานความพยายามที่ล้มเหลวไปทั้งหมด) — คอลัมน์ login_logs.email_attempted
 * เป็น text ธรรมดาไม่มีข้อบังคับรูปแบบอยู่แล้ว
 */
export const loginLogSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  success: z.boolean(),
  failureReason: z.string().max(200).optional(),
});

export type LoginLogInput = z.infer<typeof loginLogSchema>;

/** ค้นอีเมลที่ Supabase Auth ใช้ จากชื่อผู้ใช้หรืออีเมลที่ผู้ใช้พิมพ์ — เรียกก่อน signInWithPassword */
export const resolveLoginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
});

export type ResolveLoginInput = z.infer<typeof resolveLoginSchema>;

export const updateOwnProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+\-() ]*$/, 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง')
    .optional()
    .or(z.literal('')),
});

export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

/**
 * ปิดคำแนะนำเริ่มต้น — dismissed = true คือกด "ข้ามไปใช้ค่าเริ่มต้น",
 * false คือดูครบแล้ว ทั้งสองอย่างทำให้การ์ดไม่แสดงอีก แต่แยกเก็บคนละคอลัมน์เพื่อให้ย้อนดูได้
 */
export const setOnboardingStateSchema = z.object({
  dismissed: z.boolean(),
});

export type SetOnboardingStateInput = z.infer<typeof setOnboardingStateSchema>;
