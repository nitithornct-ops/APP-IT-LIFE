import { z } from 'zod';

export const inviteUserSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(1).max(200),
  employeeCode: z.string().trim().max(50).optional(),
  departmentId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(30).optional(),
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

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
