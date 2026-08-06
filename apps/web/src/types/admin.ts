export interface Department {
  id: string;
  code: string;
  name_th: string;
  name_en: string | null;
  parent_department_id: string | null;
  status: 'active' | 'inactive';
}

export interface Position {
  id: string;
  code: string;
  name_th: string;
  name_en: string | null;
  status: 'active' | 'inactive';
}

export interface UserListItem {
  id: string;
  employee_code: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  department_id: string | null;
  position_id: string | null;
  status: 'active' | 'inactive';
  created_at: string;
}

export interface UserRoleAssignment {
  id: string;
  role_id: string;
  assigned_at: string;
  roles: { key: string; name_th: string; name_en: string | null } | null;
}

export interface Role {
  id: string;
  key: string;
  name_th: string;
  name_en: string | null;
  description: string | null;
  is_system: boolean;
  status: 'active' | 'inactive';
}

export interface Permission {
  id: string;
  key: string;
  module_key: string;
  action: string;
  description: string | null;
  status: 'active' | 'inactive';
}

export interface RolePermissionEntry {
  id: string;
  permission_id: string;
  effect: 'allow' | 'deny';
  permissions: { key: string; module_key: string; action: string; description: string | null } | null;
}

export interface AuditLogItem {
  id: string;
  actor_email: string | null;
  action: string;
  module: string;
  target_table: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  result: 'success' | 'fail' | 'denied';
  created_at: string;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}
