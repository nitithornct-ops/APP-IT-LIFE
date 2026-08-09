import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const EMPLOYEE_ASSET_CATEGORIES = [
  'Computer',
  'Notebook',
  'Monitor',
  'iPad',
  'โทรศัพท์มือถือ',
  'IP Phone Yealink',
  'Printer',
  'Scanner',
  'Software',
  'Network',
  'อื่นๆ',
] as const;
export const EMPLOYEE_ASSIGNMENT_STATUSES = ['ครอบครอง', 'คืนแล้ว', 'ส่งซ่อม', 'สูญหาย'] as const;

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (yyyy-MM-dd)');
const dateOrEmpty = z.union([isoDateString, z.literal('')]).optional();

export const createEmployeeAssignmentSchema = z.object({
  employeeId: z.string().uuid('กรุณาเลือกพนักงาน'),
  category: z.enum(EMPLOYEE_ASSET_CATEGORIES).optional(),
  itemName: z.string().trim().max(200).optional(),
  assetId: z.string().uuid().optional(),
  ipAddress: z.string().trim().max(120).optional(),
  producer: z.string().trim().max(160).optional(),
  model: z.string().trim().max(160).optional(),
  macAddress: z.string().trim().max(120).optional(),
  assetNumber: z.string().trim().max(120).optional(),
  serialNumber: z.string().trim().max(160).optional(),
  osSystem: z.string().trim().max(160).optional(),
  hardwareSpec: z.string().trim().max(1000).optional(),
  softwareName: z.string().trim().max(200).optional(),
  softwareLicense: z.string().trim().max(300).optional(),
  phoneNumber: z.string().trim().max(100).optional(),
  scanUser: z.string().trim().max(160).optional(),
  scanFolder: z.string().trim().max(500).optional(),
  status: z.enum(EMPLOYEE_ASSIGNMENT_STATUSES).optional(),
  assignedDate: dateOrEmpty,
  returnedDate: dateOrEmpty,
  notes: z.string().trim().max(1500).optional(),
});
export type CreateEmployeeAssignmentInput = z.infer<typeof createEmployeeAssignmentSchema>;

export const updateEmployeeAssignmentSchema = createEmployeeAssignmentSchema.omit({ employeeId: true }).partial();
export type UpdateEmployeeAssignmentInput = z.infer<typeof updateEmployeeAssignmentSchema>;

export const setEmployeeAssignmentStatusSchema = z.object({
  status: z.enum(EMPLOYEE_ASSIGNMENT_STATUSES),
});
export type SetEmployeeAssignmentStatusInput = z.infer<typeof setEmployeeAssignmentStatusSchema>;

export const listEmployeeAssignmentsQuerySchema = paginationQuerySchema.extend({
  employeeId: z.string().uuid().optional(),
  status: z.enum(EMPLOYEE_ASSIGNMENT_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListEmployeeAssignmentsQuery = z.infer<typeof listEmployeeAssignmentsQuerySchema>;
