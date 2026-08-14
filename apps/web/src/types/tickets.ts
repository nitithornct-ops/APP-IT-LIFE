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
  created_at: string;
  outsource_name: string | null;
  ticket_categories: { name: string } | null;
  requester: { full_name: string; email: string } | null;
  assignee: { full_name: string; email: string } | null;
}

export interface TicketSummary {
  open: number;
  overdue: number;
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
  actor_id: string;
  actor: { full_name: string; email: string } | null;
  created_at: string;
}

export interface TicketDetail extends TicketListItem {
  requester_phone: string | null;
  location: string | null;
  response_sla_hours: number | null;
  resolution_sla_hours: number | null;
  response_due_at: string | null;
  description: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  closed_at: string | null;
  rating: number | null;
  feedback: string | null;
  feedback_at: string | null;
  outsource_name: string | null;
  outsource_vendor_id: string | null;
  outsource_issue_no: string | null;
  outsource_sent_at: string | null;
  notes: string | null;
  reopen_count: number;
  requester: { full_name: string; email: string } | null;
  assignee: { full_name: string; email: string } | null;
  worklogs: TicketWorklog[];
}

export interface AssignableStaff {
  id: string;
  full_name: string;
  email: string;
}
