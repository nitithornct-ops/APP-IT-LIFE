export type AccessLevel = 'Standard' | 'Admin';
export type RequestType = 'ขอเพิ่มสิทธิ์' | 'เพิกถอนสิทธิ์';

export type AccessRequestStatus = 'รออนุมัติจากหัวหน้างาน' | 'รอส่วนงานไอทีดำเนินการ' | 'เสร็จสิ้น' | 'ปฏิเสธ';

export interface AccessSystem {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
}

export interface AccessRequestListItem {
  id: string;
  requester_id: string;
  system_id: string;
  access_level: AccessLevel;
  request_type: RequestType;
  status: AccessRequestStatus;
  approver_id: string;
  created_at: string;
  access_systems: { name: string } | null;
}

export interface AccessRequestDetail extends AccessRequestListItem {
  reason: string;
  approved_by: string | null;
  approved_at: string | null;
  approved: boolean | null;
  approval_comment: string | null;
  it_handler_id: string | null;
  it_action_at: string | null;
  it_success: boolean | null;
  it_comment: string | null;
  review_due: string | null;
  requester: { full_name: string; email: string } | null;
  approver: { full_name: string; email: string } | null;
  it_handler: { full_name: string; email: string } | null;
}

export interface AccessRegistryEntry {
  id: string;
  user_id: string;
  system_id: string;
  access_level: AccessLevel;
  grant_date: string;
  last_review_date: string | null;
  next_review_due: string | null;
  status: 'active' | 'revoked' | 'suspended';
  notes: string | null;
  access_systems: { name: string } | null;
  user: { full_name: string; email: string } | null;
}
