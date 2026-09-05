import type { TicketRatingCriterion, TicketRatingDetails, TicketRatingSnapshotItem } from '@itlife/shared';
import type { TicketPriority, TicketStatus } from '../../types/tickets';

export interface LinePortalProfile {
  displayName: string;
  pictureUrl: string;
  fullName: string;
  department: string;
  linkStatus: string;
  friendStatus: string;
  linkedToSystemAccount: boolean;
  employeeCode: string | null;
}

export interface LineBootstrap {
  configured: boolean;
  enabled: boolean;
  message: string;
  authenticated: boolean;
  profile: LinePortalProfile | null;
}

export interface LineTicketCategory {
  id: string;
  name: string;
  default_priority: TicketPriority | null;
  response_sla_hours: number | null;
  resolution_sla_hours: number | null;
  sla_hours: number | null;
}

export interface LineTicketSummary {
  id: string;
  ticket_no: string;
  title: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  updated_at: string | null;
  response_due_at: string | null;
  due_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  rating: number | null;
  location: string | null;
  assignee_name_snapshot: string | null;
  asset_name_snapshot: string | null;
  category: { name: string } | null;
}

export interface LineTicketWorklog {
  id?: string;
  /** 'comment' คือสายสนทนากับทีม IT ส่วนที่เหลือคือความเคลื่อนไหวของงานบนไทม์ไลน์ */
  entry_type: 'timeline' | 'comment' | 'internal_note' | 'worklog';
  action: string;
  detail: string | null;
  status_from: TicketStatus | null;
  status_to: TicketStatus | null;
  created_at: string;
  /** มีค่าเมื่อผู้แจ้งเป็นคนบันทึกเอง — ใช้แยกฝั่งของข้อความในหน้าคุยกับทีม IT */
  actor_line_user_id: string | null;
  actor_label: string | null;
  actor: { full_name: string | null } | null;
}

export interface LineTicketAttachment {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  signed_url: string | null;
}

export interface LineTicketDetail {
  ticket: LineTicketSummary & {
    description: string;
    resolution: string | null;
    requester_name_snapshot: string | null;
    requester_position_snapshot: string | null;
    department_name_snapshot: string | null;
    requester_phone: string | null;
    incident_at: string | null;
    erp_module: string | null;
    source_channel: string | null;
    rating_details: TicketRatingDetails | null;
    rating_criteria_snapshot: TicketRatingSnapshotItem[] | null;
    signature_url: string | null;
    requester_signature_url: string | null;
    requester_signature_uploaded_at: string | null;
  };
  ratingCriteria: TicketRatingCriterion[];
  worklogs: LineTicketWorklog[];
  attachments: LineTicketAttachment[];
}

export interface LineNotification {
  id: string;
  ticket_id: string;
  ticket_no: string;
  ticket_title: string;
  action: string;
  detail: string | null;
  status_to: TicketStatus | null;
  created_at: string;
}

export interface LineKnowledgeData {
  articles: Array<{
    id: string;
    article_code: string;
    title: string;
    category: string | null;
    symptom: string | null;
    solution: string;
    tags: string[];
    views: number;
    helpful: number;
  }>;
  categories: Array<{ id: string; name: string }>;
}

export type LinePortalTab = 'home' | 'tickets' | 'knowledge' | 'notifications' | 'profile';
