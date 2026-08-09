export const PROBLEM_PRIORITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
export const PROBLEM_STATUSES = ['เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด'] as const;
export const KNOWN_ERROR_STATUSES = ['ร่าง', 'เผยแพร่', 'แก้ไขแล้ว', 'ยกเลิก'] as const;

export interface ProfileRef { id: string; full_name: string | null; email: string; }
export interface IncidentRef { id: string; incident_number: string; title: string; status: string; }
export interface TicketRef { id: string; title: string; status: string; }
export interface ProblemRef { id: string; problem_number: string; title: string; status: string; }

export interface Problem {
  id: string;
  problem_number: string;
  legacy_id: string | null;
  title: string;
  category: string | null;
  affected_system: string | null;
  impact: string | null;
  root_cause: string | null;
  workaround: string | null;
  permanent_fix: string | null;
  owner_id: string | null;
  owner?: ProfileRef | null;
  priority: (typeof PROBLEM_PRIORITIES)[number];
  status: (typeof PROBLEM_STATUSES)[number];
  review_date: string | null;
  closed_at: string | null;
  evidence_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  problem_incidents: { incident: IncidentRef }[];
  problem_tickets: { ticket: TicketRef }[];
}

export interface KnownError {
  id: string;
  known_error_number: string;
  problem_id: string;
  problem?: ProblemRef;
  title: string;
  symptoms: string | null;
  root_cause: string | null;
  workaround: string;
  affected_versions: string | null;
  fixed_version: string | null;
  knowledge_article_ref: string | null;
  status: (typeof KNOWN_ERROR_STATUSES)[number];
  review_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProblemReferences {
  owners: ProfileRef[];
  incidents: IncidentRef[];
  tickets: TicketRef[];
  problems: ProblemRef[];
}

export interface ProblemDetail {
  problem: Problem;
  knownErrors: KnownError[];
  attachments: { id: string; original_filename: string; mime_type: string; size_bytes: number; created_at: string }[];
}
