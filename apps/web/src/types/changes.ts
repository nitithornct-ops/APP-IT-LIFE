export const CHANGE_RISK_LEVELS = ['สูง', 'กลาง', 'ต่ำ'] as const;
export const CHANGE_STATUSES = ['ยื่นคำขอ', 'ผ่านการทดสอบ', 'อนุมัติแล้ว', 'ติดตั้งใช้งานแล้ว', 'ปฏิเสธ'] as const;

export interface ChangeProfileRef {
  id: string;
  full_name: string | null;
  email: string;
}

export interface ChangeServiceRequestRef {
  id: string;
  service_code: string;
  service_name: string;
  status: string;
}

export interface ChangeRequest {
  id: string;
  change_number: string;
  legacy_id: string | null;
  title: string;
  system_affected: string;
  change_type: string | null;
  description: string;
  requester_id: string;
  requester?: ChangeProfileRef;
  request_date: string;
  impact_assessment: string | null;
  risk_level: (typeof CHANGE_RISK_LEVELS)[number];
  test_result: string | null;
  test_passed: boolean | null;
  test_signoff_by: string | null;
  tester?: ChangeProfileRef | null;
  test_signoff_at: string | null;
  approver_id: string | null;
  approver?: ChangeProfileRef | null;
  approve_date: string | null;
  approve_result: 'อนุมัติ' | 'ปฏิเสธ' | null;
  approval_comment: string | null;
  deploy_date: string | null;
  deploy_by: string | null;
  deployer?: ChangeProfileRef | null;
  version: string | null;
  rollback_plan: string | null;
  status: (typeof CHANGE_STATUSES)[number];
  source_service_request_id: string | null;
  source_service_request?: ChangeServiceRequestRef | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeReferences {
  serviceRequests: ChangeServiceRequestRef[];
}

export interface ChangeDetail {
  change: ChangeRequest;
  attachments: { id: string; original_filename: string; mime_type: string; size_bytes: number; created_at: string }[];
  relationships: { id: string; source_type: string; source_id: string; target_type: string; target_id: string; relationship_type: string; status: string }[];
}
