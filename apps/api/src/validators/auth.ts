import { z } from 'zod';

export const loginLogSchema = z.object({
  email: z.string().email(),
  success: z.boolean(),
  failureReason: z.string().max(200).optional(),
});

export type LoginLogInput = z.infer<typeof loginLogSchema>;

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
