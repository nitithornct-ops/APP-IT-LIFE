import type { TicketRatingDetails, TicketRatingSnapshotItem } from '@itlife/shared';

export type TicketPriority = 'ต่ำ' | 'ปานกลาง' | 'สูง' | 'วิกฤต';

export type TicketStatus =
  | 'ใหม่'
  | 'รับเรื่องแล้ว'
  | 'กำลังดำเนินการ'
  | 'รออะไหล่'
  | 'รอผู้ใช้งาน'
  | 'ส่งต่อ Outsource'
  | 'เสร็จสิ้น'
  | 'ปิดงาน'
  | 'ยกเลิก'
  | 'ยกระดับเป็น Incident';

export interface TicketListItem {
  id: string;
  ticket_no: string;
  title: string;
  requester_id: string;
  requester_name_snapshot: string | null;
  department_name_snapshot: string | null;
  guest_name: string | null;
  guest_department: string | null;
  source_channel: 'web' | 'line' | 'guest' | string;
  category_id: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assignee_id: string | null;
  assignee_name_snapshot: string | null;
  is_security: boolean;
  incident_id: string | null;
  due_at: string | null;
  sla_paused_at?: string | null;
  sla_paused_minutes?: number;
  waiting_follow_up_at?: string | null;
  waiting_since?: string | null;
  is_sla_paused?: boolean;
  sla_state?: 'paused' | 'overdue' | 'due_soon' | 'on_track' | 'unconfigured';
  created_at: string;
  outsource_name: string | null;
  ticket_categories: { name: string } | null;
  requester: { full_name: string; email: string } | null;
  assignee: { full_name: string; email: string } | null;
}

export interface TicketSummary {
  open: number;
  overdue: number;
  paused: number;
  awaitingAcceptance: number;
  security: number;
  averageRating: number | null;
  ratingCount: number;
}

export interface TicketWorklog {
  id: string;
  ticket_id: string;
  action: string;
  detail: string | null;
  status_from: TicketStatus | null;
  status_to: TicketStatus | null;
  minutes_spent: number | null;
  is_public: boolean;
  entry_type: 'timeline' | 'comment' | 'internal_note' | 'worklog';
  /** ว่างได้ — worklog ที่ผู้แจ้งแบบ guest เป็นคนสร้างไม่มีบัญชีผูกอยู่ */
  actor_id: string | null;
  /** มีค่าเมื่อผู้แจ้งทำรายการผ่าน LINE Portal ใช้บอกว่าข้อความมาจากฝั่งผู้แจ้ง */
  actor_line_user_id: string | null;
  /** ชื่อที่แสดงแทน actor สำหรับรายการที่ผู้แจ้งแบบ guest เป็นคนทำ */
  actor_label: string | null;
  actor: { full_name: string; email: string } | null;
  created_at: string;
}

export interface TicketAttachment {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploader_label: string | null;
  signed_url: string | null;
}

export interface TicketDetail extends TicketListItem {
  requester_phone: string | null;
  requester_position_snapshot: string | null;
  location: string | null;
  incident_at: string | null;
  erp_module: string | null;
  response_sla_hours: number | null;
  resolution_sla_hours: number | null;
  response_due_at: string | null;
  started_at?: string | null;
  first_response_at?: string | null;
  sla_paused_at?: string | null;
  sla_paused_minutes?: number;
  waiting_reason?: string | null;
  waiting_owner_id?: string | null;
  waiting_follow_up_at?: string | null;
  waiting_since?: string | null;
  is_sla_paused?: boolean;
  sla_state?: 'paused' | 'overdue' | 'due_soon' | 'on_track' | 'unconfigured';
  description: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  closed_at: string | null;
  rating: number | null;
  rating_details: TicketRatingDetails | null;
  rating_criteria_snapshot: TicketRatingSnapshotItem[] | null;
  feedback: string | null;
  feedback_at: string | null;
  signature_storage_path: string | null;
  signature_url: string | null;
  signature_uploaded_by: string | null;
  signature_uploaded_at: string | null;
  requester_signature_storage_path: string | null;
  requester_signature_url: string | null;
  requester_signature_uploaded_by: string | null;
  requester_signature_uploaded_at: string | null;
  outsource_name: string | null;
  outsource_vendor_id: string | null;
  outsource_issue_no: string | null;
  outsource_sent_at: string | null;
  notes: string | null;
  reopen_count: number;
  requester: { full_name: string; email: string } | null;
  assignee: { full_name: string; email: string } | null;
  attachments: TicketAttachment[];
  worklogs: TicketWorklog[];
  sla_rounds?: TicketSlaRound[];
  related_pm?: TicketRelatedPm[];
  related_pm_links?: TicketRelatedPmLink[];
  related_problems?: TicketRelatedProblem[];
}

export interface TicketSlaRound {
  id: string;
  round_no: number;
  opened_at: string;
  closed_at: string | null;
  status: string;
  response_sla_hours: number | null;
  resolution_sla_hours: number | null;
  response_due_at: string | null;
  resolution_due_at: string | null;
  paused_minutes: number;
  paused_at: string | null;
  response_met_at: string | null;
  resolved_at: string | null;
  response_sla_met: boolean | null;
  resolution_sla_met: boolean | null;
  is_inferred: boolean;
}

export interface TicketRelatedPm {
  id: string;
  status: string;
  plan_date: string;
  actual_date: string | null;
  next_due_date: string | null;
  result: string | null;
  notes: string | null;
  asset_id: string | null;
}

export interface TicketRelatedPmLink {
  ticket_id: string;
  maintenance_plan_id: string;
  relationship: 'root_cause' | 'related' | 'follow_up';
  notes: string | null;
  created_at: string;
  maintenance_plan: TicketRelatedPm | null;
}

export interface TicketRelatedProblem {
  id: string;
  problem_number: string;
  title: string;
  status: string;
  root_cause: string | null;
  workaround: string | null;
  permanent_fix: string | null;
}

export interface TicketQueueSummary {
  unassigned: number;
  nearSla: number;
  overdue: number;
  waitingFollowUp: number;
  awaitingAcceptance: number;
  paused: number;
  generatedAt: string;
}

export interface AssignableStaff {
  id: string;
  full_name: string;
  email: string;
}

export type TicketFormFlowState = 'complete' | 'current' | 'pending' | 'not_required';

export interface TicketFormDocument {
  ticketId: string;
  ticketNo: string;
  ticketStatus: TicketStatus;
  template: {
    id: string;
    code: string;
    name: string;
    version: number;
    source: 'template' | 'issue';
    updatedAt: string;
  };
  issueForm: { id: string; formNo: string; status: string } | null;
  pageSettings: { size?: 'A4' | 'Letter'; orientation?: 'portrait' | 'landscape'; marginMm?: number };
  contentHtml: string;
  checkmarks: number[];
  textValues: Record<string, string>;
  canEditCheckmarks: boolean;
  /** จัดรูปและเขียนทับเอกสารทั้งใบได้ไหม (ต้องมีสิทธิ์ ticket.update ไม่ใช่แค่เป็นผู้แจ้ง) */
  canEditContent: boolean;
  /** true เมื่อ Ticket ใบนี้ใช้เอกสารฉบับที่จัดรูปเองแล้ว ไม่ได้ตามแม่แบบอีกต่อไป */
  isCustomized: boolean;
  flow: Array<{
    section: number;
    title: string;
    state: TicketFormFlowState;
    detail: string;
  }>;
}
