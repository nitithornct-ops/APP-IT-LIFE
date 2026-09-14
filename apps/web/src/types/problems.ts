export const PROBLEM_PRIORITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
export const PROBLEM_STATUSES = ['เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด'] as const;
export const KNOWN_ERROR_STATUSES = ['ร่าง', 'เผยแพร่', 'แก้ไขแล้ว', 'ยกเลิก'] as const;
export const RCA_METHODS = ['5 Why', 'Fishbone', 'Other'] as const;
export const CORRECTIVE_ACTION_STATUSES = ['เปิด', 'กำลังดำเนินการ', 'เสร็จสิ้น', 'ยกเลิก'] as const;

export interface ProfileRef { id: string; full_name: string | null; email: string; }
export interface IncidentRef { id: string; incident_number: string; title: string; status: string; }
export interface TicketRef { id: string; title: string; status: string; }
export interface ProblemRef { id: string; problem_number: string; title: string; status: string; }
export interface KnowledgeArticleRef { id: string; article_code: string; title: string; }
export interface ConfigurationItemRef { id: string; ci_code: string; name: string; ci_type: string; status: string; }
export interface ChangeRef { id: string; change_number: string; title: string; status: string; deploy_date?: string | null; version?: string | null; }
export interface FiveWhyStep { question: string; answer: string; }
export interface FishboneAnalysis { people: string; process: string; technology: string; environment: string; materials: string; measurement: string; }
export interface CorrectiveAction {
  id: string;
  problem_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  owner?: ProfileRef | null;
  due_date: string | null;
  status: (typeof CORRECTIVE_ACTION_STATUSES)[number];
  completed_at: string | null;
  verification_notes: string | null;
  created_at: string;
  updated_at: string;
}

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
  rca_method: (typeof RCA_METHODS)[number];
  five_why: FiveWhyStep[];
  fishbone: FishboneAnalysis;
  owner_id: string | null;
  owner?: ProfileRef | null;
  priority: (typeof PROBLEM_PRIORITIES)[number];
  status: (typeof PROBLEM_STATUSES)[number];
  review_date: string | null;
  review_meeting_at: string | null;
  review_meeting_owner_id: string | null;
  review_meeting_owner?: ProfileRef | null;
  review_meeting_notes: string | null;
  recurrence_count: number;
  change_verified_at: string | null;
  change_verified_by: string | null;
  change_verifier?: ProfileRef | null;
  change_verification_notes: string | null;
  closed_at: string | null;
  evidence_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  problem_incidents: { incident: IncidentRef }[];
  problem_tickets: { ticket: TicketRef }[];
  problem_configuration_items: { configuration_item: ConfigurationItemRef }[];
  problem_changes: { change: ChangeRef }[];
  corrective_actions: CorrectiveAction[];
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
  source_known_error_id?: string | null;
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
  knowledgeArticles: KnowledgeArticleRef[];
  configurationItems: ConfigurationItemRef[];
  changes: ChangeRef[];
}

export interface ProblemDetail {
  problem: Problem;
  knownErrors: KnownError[];
  attachments: { id: string; original_filename: string; mime_type: string; size_bytes: number; created_at: string }[];
}
