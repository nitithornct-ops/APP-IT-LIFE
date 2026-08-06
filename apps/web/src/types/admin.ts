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
  supervisor_id: string | null;
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

export interface TicketCategory {
  id: string;
  name: string;
  default_priority: 'ต่ำ' | 'ปานกลาง' | 'สูง' | 'วิกฤต';
  response_sla_hours: number | null;
  resolution_sla_hours: number | null;
  sla_hours: number | null;
  is_security_default: boolean;
  status: 'active' | 'inactive';
  notes: string | null;
}

export interface AssetCategory {
  id: string;
  name: string;
  code_prefix: string;
  status: 'active' | 'inactive';
  notes: string | null;
}

export interface PermissionOverride {
  id: string;
  user_id: string;
  permission_id: string;
  effect: 'allow' | 'deny';
  start_at: string | null;
  end_at: string | null;
  reason: string;
  status: 'active' | 'inactive';
  approved_by: string | null;
  permissions: { key: string; module_key: string; description: string | null } | null;
}

export interface ApprovalGroup {
  id: string;
  code: string;
  name: string;
  department_id: string | null;
  description: string | null;
  owner_id: string | null;
  notes: string | null;
  status: 'active' | 'inactive';
}

export interface ApprovalGroupMember {
  id: string;
  group_id: string;
  user_id: string;
  member_role: 'primary' | 'member' | 'backup';
  priority: number;
  valid_from: string | null;
  valid_until: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  profiles: { full_name: string; email: string } | null;
}

export interface Employee {
  id: string;
  employee_code: string;
  prefix_th: string | null;
  first_name_th: string;
  last_name_th: string;
  nickname: string | null;
  prefix_en: string | null;
  first_name_en: string | null;
  last_name_en: string | null;
  department_id: string | null;
  position_id: string | null;
  username_ad: string | null;
  upn: string | null;
  email: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}
