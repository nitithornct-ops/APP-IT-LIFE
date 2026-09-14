export interface Department {
  id: string;
  code: string;
  name_th: string;
  name_en: string | null;
  parent_department_id: string | null;
  status: 'active' | 'inactive';
  effective_date?: string;
  sort_order?: number;
  created_at?: string;
}

export interface Position {
  id: string;
  code: string;
  name_th: string;
  name_en: string | null;
  status: 'active' | 'inactive';
  effective_date?: string;
  sort_order?: number;
  created_at?: string;
}

export interface UserListItem {
  id: string;
  employee_code: string | null;
  full_name: string;
  email: string;
  /** มีค่าเฉพาะบัญชีที่ login ด้วยชื่อผู้ใช้ (ไม่มีอีเมลจริง) — บัญชีที่เชิญด้วยอีเมลเป็น null */
  username: string | null;
  phone: string | null;
  department_id: string | null;
  position_id: string | null;
  supervisor_id: string | null;
  manager: { id: string; full_name: string; email: string } | null;
  status: 'active' | 'inactive';
  mfa_enabled: boolean;
  mfa_status: 'enabled' | 'disabled';
  last_login_at: string | null;
  last_password_change_at: string | null;
  account_source: 'local' | 'invite' | 'sso' | 'import' | 'unknown';
  employment_status: 'active' | 'on_leave' | 'terminated' | 'contractor' | 'retired';
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
  scope: string | null;
  owner_id: string | null;
  owner: { id: string; full_name: string; email: string } | null;
  review_frequency: 'monthly' | 'quarterly' | 'semiannual' | 'annual';
  sensitive_role: boolean;
  version: number;
  assigned_user_count: number;
  sod_conflict_count: number;
  sod_conflicts: Array<{ key: string; label: string; description: string; permission_keys: string[] }>;
  is_system: boolean;
  system_role_locked: boolean;
  status: 'active' | 'inactive';
}

export interface RoleOwner {
  id: string;
  full_name: string;
  email: string;
}

export interface RoleVersion {
  id: string;
  role_id: string;
  version_number: number;
  snapshot: {
    role?: Record<string, unknown>;
    permissions?: Array<{ permission_id: string; key: string; effect: 'allow' | 'deny' }>;
  };
  change_type: 'CREATE' | 'BASELINE' | 'UPDATE' | 'PERMISSIONS' | 'CLONE' | string;
  change_summary: string | null;
  created_at: string;
  created_by: string | null;
}

export interface RoleVersionChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

export interface RoleVersionComparison {
  from: RoleVersion;
  to: RoleVersion;
  changes: RoleVersionChange[];
}

export interface Permission {
  id: string;
  key: string;
  module_key: string;
  action: string;
  description: string | null;
  is_privileged: boolean;
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
  actor_role?: string | null;
  action: string;
  module: string;
  target_table: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  result: 'success' | 'fail' | 'denied';
  request_id?: string | null;
  correlation_id?: string | null;
  event_category?: string;
  privileged_action?: boolean;
  entry_hash?: string | null;
  hash_algorithm?: string | null;
  created_at: string;
}

export interface LoginLogItem {
  id: string;
  user_id: string | null;
  email_attempted: string;
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  mfa_used: boolean;
  event_type?: string;
  request_id?: string | null;
  correlation_id?: string | null;
  entry_hash?: string | null;
  hash_algorithm?: string | null;
  created_at: string;
}

export interface AuditOverview {
  days: number;
  auditTotal: number;
  denied: number;
  failedActions: number;
  loginTotal: number;
  failedLogins: number;
  privilegedActions?: number;
  openAlerts?: number;
  unverifiedEntries?: number;
}

export interface TicketCategory {
  id: string;
  code?: string;
  name: string;
  default_priority: 'ต่ำ' | 'ปานกลาง' | 'สูง' | 'วิกฤต';
  response_sla_hours: number | null;
  resolution_sla_hours: number | null;
  sla_hours: number | null;
  is_security_default: boolean;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
  effective_date?: string;
  sort_order?: number;
}

export interface AssetCategory {
  id: string;
  code?: string;
  name: string;
  code_prefix: string;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
  effective_date?: string;
  sort_order?: number;
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
  is_temporary: boolean;
  privileged_access: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
  approval_requested_by: string | null;
  approval_requested_at: string | null;
  approved_at: string | null;
  approval_comment: string | null;
  permissions: { key: string; module_key: string; description: string | null } | null;
}

export interface UserOption {
  id: string;
  full_name: string;
  email: string;
  username: string | null;
  status: 'active' | 'inactive';
}

export interface RolePermissionChange {
  permission_id: string;
  permission_key: string;
  from: 'allow' | 'deny' | 'none';
  to: 'allow' | 'deny' | 'none';
  is_privileged: boolean;
}

export interface RolePermissionChangeRequest {
  id: string;
  role_id: string;
  requested_by: string;
  approver_id: string;
  proposed_permissions: Array<{ permission_id: string; effect: 'allow' | 'deny' }>;
  changes: RolePermissionChange[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  decided_at: string | null;
  decision_comment: string | null;
  role: { key: string; name_th: string } | null;
  requester: { id: string; full_name: string; email: string } | null;
  approver: { id: string; full_name: string; email: string } | null;
}

export interface EffectivePermission {
  permission_id: string;
  permission_key: string;
  module_key: string;
  action: string;
  description: string | null;
  effective_effect: 'allow' | 'deny';
  source: 'role' | 'group' | 'override' | 'none';
  sources: Array<{
    type: 'role' | 'group' | 'override';
    id: string;
    name: string;
    effect: 'allow' | 'deny';
    startsAt: string | null;
    endsAt: string | null;
    temporary: boolean;
    approvalStatus: 'pending' | 'approved' | 'rejected';
    reason: string | null;
  }>;
  is_privileged: boolean;
  expires_at: string | null;
}

export interface AccessGroup {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive';
}

export interface AccessGroupMembership {
  id: string;
  group_id: string;
  user_id: string;
  valid_from: string | null;
  valid_until: string | null;
  status: 'active' | 'inactive';
  access_groups: AccessGroup | null;
}

export interface UserAccessReview {
  id: string;
  user_id: string;
  reviewer_id: string | null;
  status: 'pending' | 'approved' | 'revoked' | 'exception';
  due_at: string;
  snapshot: EffectivePermission[];
  decision_note: string | null;
  requested_by: string;
  requested_at: string;
  decided_at: string | null;
  created_at: string;
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
  created_at: string;
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
  manager_employee_id: string | null;
  start_date: string | null;
  end_date: string | null;
  employment_status: 'active' | 'on_leave' | 'terminated' | 'contractor' | 'retired';
  location: string | null;
  username_ad: string | null;
  upn: string | null;
  email: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
}

/**
 * รายชื่อพนักงานแบบย่อจาก GET /api/v1/employees/options — ใช้ทำ dropdown เลือกเจ้าของ/ผู้ครอบครอง
 * ไม่มี email/upn/username_ad/notes โดยตั้งใจ เพราะเป็นข้อมูลของทะเบียนพนักงานเต็มที่ต้องใช้ employee.manage
 */
export type EmployeeOption = Pick<
  Employee,
  'id' | 'employee_code' | 'prefix_th' | 'first_name_th' | 'last_name_th' | 'nickname' | 'department_id' | 'position_id' | 'manager_employee_id' | 'status'
>;

export interface EmployeeLifecycleEvent {
  id: string;
  lifecycle_code: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  employee_email: string | null;
  event_type: 'JOINER' | 'MOVER' | 'LEAVER';
  effective_date: string;
  new_department: string | null;
  new_position: string | null;
  reason: string;
  notes: string | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  result_detail: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface EmployeeLifecycleAction {
  id: string;
  lifecycle_event_id: string;
  target_type: 'user' | 'access' | 'asset' | 'license' | 'approval_group';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  affected_count: number;
  detail: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}
