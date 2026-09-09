import { listQuerySchema } from '@itlife/shared';
import { z } from 'zod';

/**
 * ชื่อผู้ใช้สำหรับบัญชีที่ไม่มีอีเมล — บังคับตัวพิมพ์เล็กตั้งแต่ชั้นนี้ให้ตรงกับ check constraint
 * profiles_username_format เพื่อไม่ให้ "Somchai" กับ "somchai" กลายเป็นคนละบัญชี และตัดอักขระที่ทำให้
 * ระบุตัวตนกำกวม (ช่องว่าง, @) ออก เพราะช่อง login เดียวกันนี้รับได้ทั้งอีเมลและชื่อผู้ใช้
 */
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดล่าง และขีดกลาง ความยาว 3-32 ตัวอักษร');

/** นโยบายรหัสผ่านเดียวกับ Vendor Portal (validators/vendorPortal.ts) เพื่อไม่ให้มีสองมาตรฐานในระบบเดียว */
const passwordSchema = z
  .string()
  .min(12, 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร')
  .max(128)
  .regex(/[a-z]/, 'รหัสผ่านต้องมีตัวอักษรภาษาอังกฤษตัวเล็ก')
  .regex(/[A-Z]/, 'รหัสผ่านต้องมีตัวอักษรภาษาอังกฤษตัวใหญ่')
  .regex(/[0-9]/, 'รหัสผ่านต้องมีตัวเลข');

export const inviteUserSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(1).max(200),
  employeeCode: z.string().trim().max(50).optional(),
  departmentId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/**
 * สร้างบัญชีให้ผู้ใช้ที่ไม่มีอีเมลองค์กร — ผู้ดูแลตั้งรหัสผ่านเริ่มต้นให้เองในฟอร์ม เพราะไม่มีกล่องจดหมาย
 * ให้ส่งลิงก์เชิญไปตั้งรหัสเองแบบ inviteUserSchema
 */
export const createLocalUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(200),
  employeeCode: z.string().trim().max(50).optional(),
  departmentId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
});

export type CreateLocalUserInput = z.infer<typeof createLocalUserSchema>;

/** ผู้ดูแลตั้งรหัสผ่านใหม่ให้ผู้ใช้ — ทางเดียวที่บัญชีแบบ username กู้รหัสผ่านได้ (ไม่มีอีเมลรับลิงก์รีเซ็ต) */
export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  // บัญชีที่เชิญด้วยอีเมลก็ตั้งชื่อผู้ใช้ไว้ login แบบสั้นได้ ไม่ต้องพิมพ์อีเมลเต็มทุกครั้ง
  username: usernameSchema.nullable().optional(),
  employeeCode: z.string().trim().max(50).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  supervisorId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const listUsersQuerySchema = listQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
