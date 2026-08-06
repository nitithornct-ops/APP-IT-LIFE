export type ServiceRequestPriority = 'ต่ำ' | 'ปานกลาง' | 'สูง' | 'วิกฤต';

export type ServiceRequestStatus =
  | 'รออนุมัติ'
  | 'รอมอบหมาย'
  | 'กำลังดำเนินการ'
  | 'รอผู้ใช้งาน'
  | 'รอผู้ให้บริการ'
  | 'รอยืนยันผล'
  | 'ปิดงาน'
  | 'ปฏิเสธ'
  | 'ยกเลิก';

export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export type ServiceRequestTaskStatus = 'รอดำเนินการ' | 'กำลังดำเนินการ' | 'เสร็จสิ้น' | 'ข้าม';

export interface ServiceRequestListItem {
  id: string;
  service_code: string;
  service_name: string;
  requester_id: string;
  priority: ServiceRequestPriority;
  status: ServiceRequestStatus;
  approval_status: ApprovalStatus;
  assignee_id: string | null;
  due_at: string | null;
  created_at: string;
}

export interface ServiceRequestTask {
  id: string;
  request_id: string;
  sequence: number;
  task_name: string;
  task_type: string | null;
  owner_group_id: string | null;
  assignee_id: string | null;
  is_required: boolean;
  status: ServiceRequestTaskStatus;
  due_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  evidence_link: string | null;
  notes: string | null;
}

export interface ServiceRequestHistoryEntry {
  id: string;
  request_id: string;
  action: string;
  status_from: string | null;
  status_to: string | null;
  comment: string | null;
  is_public: boolean;
  actor_id: string;
  actor: { full_name: string; email: string } | null;
  created_at: string;
}

export interface ServiceRequestDetail extends ServiceRequestListItem {
  catalog_id: string | null;
  requested_for: string | null;
  summary: string;
  request_details: Record<string, unknown>;
  business_justification: string | null;
  impact: ServiceRequestPriority;
  sla_hours: number | null;
  approval_mode: 'none' | 'group';
  approval_group_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  close_mode: 'requester_confirms' | 'it_closes';
  assigned_group_id: string | null;
  fulfillment_notes: string | null;
  completion_evidence: string | null;
  requester_confirmed_at: string | null;
  requester_confirmation: boolean | null;
  completed_at: string | null;
  closed_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  service_catalog: { service_name: string; category: string | null } | null;
  requester: { full_name: string; email: string } | null;
  assignee: { full_name: string; email: string } | null;
  approval_group: { code: string; name: string } | null;
  tasks: ServiceRequestTask[];
  history: ServiceRequestHistoryEntry[];
}
