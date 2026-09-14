export type AccessLevel = 'Standard' | 'Admin';
export type AccessItemKind = 'role' | 'profile' | 'group' | 'entitlement';
export type AccessAction = 'read' | 'create' | 'update' | 'delete' | 'approve';
export type DataClassification = 'ไม่ลับ' | 'ลับ' | 'ลับมาก';
export type LifecycleEvent = 'manual' | 'joiner' | 'mover' | 'leaver';
export type RequestType = 'ขอเพิ่มสิทธิ์' | 'เพิกถอนสิทธิ์';

export type AccessRequestStatus = 'รออนุมัติจากหัวหน้างาน' | 'รอส่วนงานไอทีดำเนินการ' | 'เสร็จสิ้น' | 'ปฏิเสธ';

export interface AccessSystem {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
  effective_date?: string;
  sort_order?: number;
  system_owner_id?: string | null;
}

export interface AccessControlItem {
  id: string;
  system_id: string;
  kind: AccessItemKind;
  code: string;
  name: string;
  description: string | null;
  permission_actions: AccessAction[];
  data_classification: DataClassification;
  privileged_access: boolean;
  system_owner_id: string;
  default_approver_id: string | null;
  status: 'active' | 'inactive';
  access_systems?: { name: string } | null;
  system_owner?: { full_name: string; email: string } | null;
  default_approver?: { full_name: string; email: string } | null;
  created_at: string;
}

export interface AccessPersonOption {
  id: string;
  full_name: string;
  email: string;
  status: 'active' | 'inactive';
}

export interface AccessRequestListItem {
  id: string;
  requester_id: string;
  subject_user_id: string;
  system_id: string;
  access_level: AccessLevel | null;
  access_item_id: string | null;
  requested_actions: AccessAction[];
  request_type: RequestType;
  lifecycle_event: LifecycleEvent;
  temporary_access: boolean;
  start_at: string;
  expires_at: string | null;
  data_classification: DataClassification | null;
  privileged_access: boolean;
  status: AccessRequestStatus;
  approver_id: string;
  created_at: string;
  access_systems: { name: string } | null;
  access_control_item: { kind: AccessItemKind; code: string; name: string } | null;
}

export interface AccessRequestDetail extends AccessRequestListItem {
  reason: string;
  business_reason: string;
  approved_by: string | null;
  approved_at: string | null;
  approved: boolean | null;
  approval_comment: string | null;
  it_handler_id: string | null;
  it_action_at: string | null;
  it_success: boolean | null;
  it_comment: string | null;
  evidence_after_grant: string | null;
  review_due: string | null;
  requester: { full_name: string; email: string } | null;
  subject_user: { full_name: string; email: string } | null;
  approver: { full_name: string; email: string } | null;
  system_owner: { full_name: string; email: string } | null;
  it_handler: { full_name: string; email: string } | null;
  access_control_item: (AccessControlItem & { permission_actions: AccessAction[] }) | null;
}

export interface AccessRegistryEntry {
  id: string;
  user_id: string;
  system_id: string;
  access_level: AccessLevel | null;
  access_item_id: string | null;
  permission_actions: AccessAction[];
  temporary_access: boolean;
  start_at: string;
  expires_at: string | null;
  data_classification: DataClassification | null;
  privileged_access: boolean;
  business_reason: string | null;
  system_owner_id: string | null;
  approved_by: string | null;
  lifecycle_event: LifecycleEvent;
  evidence_after_grant: string | null;
  grant_date: string;
  last_review_date: string | null;
  next_review_due: string | null;
  status: 'active' | 'scheduled' | 'revoked' | 'suspended';
  notes: string | null;
  access_systems: { name: string } | null;
  access_control_item: { kind: AccessItemKind; code: string; name: string } | null;
  user: { full_name: string; email: string } | null;
  system_owner?: { full_name: string; email: string } | null;
  approver?: { full_name: string; email: string } | null;
  operator?: { full_name: string; email: string } | null;
}
