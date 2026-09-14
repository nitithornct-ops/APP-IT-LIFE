import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const EMPLOYMENT_STATUSES = ['active', 'on_leave', 'terminated', 'contractor', 'retired'] as const;

const employeeDate = z.string().date();

const employeeFieldsSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
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
  managerEmployeeId: z.string().uuid().nullable().optional(),
  startDate: employeeDate.optional(),
  endDate: employeeDate.optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  location: z.string().trim().max(160).optional(),
  usernameAd: z.string().trim().max(160).optional(),
  upn: z.string().trim().max(200).optional(),
  email: z.string().trim().toLowerCase().email('รูปแบบ Email ไม่ถูกต้อง').optional().or(z.literal('')),
  notes: z.string().trim().max(1500).optional(),
});

const validateEmployeeDates = (value: { startDate?: string; endDate?: string }, ctx: z.RefinementCtx) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End Date must not be before Start Date' });
  }
};

export const createEmployeeSchema = employeeFieldsSchema.superRefine(validateEmployeeDates);

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = employeeFieldsSchema.partial().superRefine(validateEmployeeDates);

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeLifecycleSchema = z.object({
  eventType: z.enum(['JOINER', 'MOVER', 'LEAVER']),
  effectiveDate: employeeDate,
  newDepartmentId: z.string().uuid().nullable().optional(),
  newPositionId: z.string().uuid().nullable().optional(),
  managerEmployeeId: z.string().uuid().nullable().optional(),
  newDepartment: z.string().trim().max(200).optional(),
  newPosition: z.string().trim().max(200).optional(),
  reason: z.string().trim().min(1, 'Reason is required').max(2000),
  notes: z.string().trim().max(2000).optional(),
});

export type EmployeeLifecycleInput = z.infer<typeof employeeLifecycleSchema>;

export const listEmployeesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  departmentId: z.string().uuid().optional(),
  ownership: z.enum(['with', 'without']).optional(),
});

export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;

export const bulkUpdateEmployeesSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, 'กรุณาเลือกพนักงานอย่างน้อย 1 คน').max(50, 'เลือกได้สูงสุด 50 คนต่อครั้ง'),
    status: z.enum(['active', 'inactive']).optional(),
    departmentId: z.string().uuid().optional(),
  })
  .refine((body) => body.status !== undefined || body.departmentId !== undefined, {
    message: 'กรุณาเลือกสิ่งที่ต้องการเปลี่ยน',
    path: ['status'],
  });

export type BulkUpdateEmployeesInput = z.infer<typeof bulkUpdateEmployeesSchema>;
