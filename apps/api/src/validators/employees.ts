import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const createEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1, 'กรุณากรอกรหัสพนักงาน').max(80),
  prefixTh: z.string().trim().max(40).optional(),
  firstNameTh: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(120),
  lastNameTh: z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(120),
  nickname: z.string().trim().max(80).optional(),
  prefixEn: z.string().trim().max(40).optional(),
  firstNameEn: z.string().trim().max(120).optional(),
  lastNameEn: z.string().trim().max(120).optional(),
  departmentId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  usernameAd: z.string().trim().max(160).optional(),
  upn: z.string().trim().max(200).optional(),
  email: z.string().trim().toLowerCase().email('รูปแบบ Email ไม่ถูกต้อง').optional().or(z.literal('')),
  notes: z.string().trim().max(1500).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const listEmployeesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  departmentId: z.string().uuid().optional(),
  ownership: z.enum(['with', 'without']).optional(),
});

export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
