export const INCIDENT_CATEGORIES = [
  'มัลแวร์/ไวรัส', 'การเข้าถึงโดยไม่ได้รับอนุญาต', 'ข้อมูลรั่วไหล', 'ฟิชชิง/หลอกลวง',
  'ระบบล่ม/ใช้งานไม่ได้', 'การละเมิดนโยบาย', 'อื่นๆ',
] as const;
export const INCIDENT_SEVERITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
export const INCIDENT_STATUSES = ['เปิด', 'กำลังดำเนินการ', 'ปิดเคส'] as const;
export const BREACH_RISK_LEVELS = ['ไม่มีความเสี่ยง', 'ต่ำ', 'ปานกลาง', 'สูง'] as const;
export const REGULATORY_DECISIONS = ['Yes', 'No', 'Pending'] as const;
export const REGULATORY_DESTINATIONS = ['PDPC', 'DATA_SUBJECT', 'NCSA', 'OTHER'] as const;
export const REGULATORY_NOTIFICATION_STATUSES = ['รอแจ้ง', 'แจ้งแล้ว', 'ไม่ต้องแจ้ง', 'ยกเลิก'] as const;
export const NOTIFICATION_CLOCK_TYPES = ['PDPA', 'CYBER'] as const;
export const NOTIFICATION_CLOCK_STATUSES = ['RUNNING', 'NOTIFIED', 'NOT_REQUIRED', 'EXPIRED'] as const;
export const NOTIFICATION_TIMELINE_EVENT_TYPES = [
  'REPORT_RECEIVED', 'DPO_ACKNOWLEDGED', 'PDPA_CLOCK_STARTED', 'PDPA_NOTIFIED',
  'CYBER_CLOCK_STARTED', 'CYBER_NOTIFIED', 'DATA_SUBJECT_NOTIFIED',
  'OTHER_REGULATOR_NOTIFIED', 'NOTIFICATION_RECORDED', 'OTHER',
] as const;

export interface ProfileRef { id: string; full_name: string; email: string }

export interface IncidentCiRef {
  id: string;
  ci_code: string;
  name: string;
  ci_type: string;
  environment: string;
  criticality: string;
  status: string;
  owner: { id: string; employee_code: string; first_name_th: string; last_name_th: string; nickname: string | null } | null;
  administrator: { id: string; employee_code: string; first_name_th: string; last_name_th: string; nickname: string | null } | null;
  vendor: { id: string; vendor_code: string; name: string; status: string } | null;
  contract: { id: string; contract_number: string; name: string; status: string; end_date: string | null } | null;
  backup_required: boolean;
  backup_reference: string | null;
}

export interface IncidentCiRelationship {
  id: string;
  relationship_type: string;
  direction: string;
  impact_level: string;
  status: string;
  related_ci: { id: string; ci_code: string; name: string; criticality: string; status: string } | null;
}

export interface Incident {
  id: string;
  incident_number: string;
  legacy_id: string | null;
  title: string;
  reported_by: string;
  reporter: ProfileRef | null;
  report_date: string;
  category: (typeof INCIDENT_CATEGORIES)[number];
  severity: (typeof INCIDENT_SEVERITIES)[number] | null;
  likelihood: number | null;
  impact: number | null;
  risk_score: number | null;
  risk_level: (typeof INCIDENT_SEVERITIES)[number] | null;
  description: string;
  affected_system: string | null;
  affected_ci_id: string | null;
  affected_ci: IncidentCiRef | null;
  detection_source: string | null;
  containment: string | null;
  eradication: string | null;
  recovery: string | null;
  major_incident: boolean;
  incident_commander_id: string | null;
  incident_commander: ProfileRef | null;
  contains_personal_data: boolean;
  assignee_id: string | null;
  assignee: ProfileRef | null;
  dpo_notified_at: string | null;
  dpo_notify_note: string | null;
  dpo_notify_deadline: string | null;
  status: (typeof INCIDENT_STATUSES)[number];
  root_cause: string | null;
  resolution: string | null;
  lessons_learned: string | null;
  closed_at: string | null;
  evidence_url: string | null;
  regulatory_assessment_status: 'รอประเมิน' | 'รอตัดสินใจ' | 'ประเมินแล้ว';
  breach_risk_level: (typeof BREACH_RISK_LEVELS)[number] | null;
  pdpc_notify_required: (typeof REGULATORY_DECISIONS)[number];
  data_subject_notify_required: (typeof REGULATORY_DECISIONS)[number];
  ncsa_report_required: (typeof REGULATORY_DECISIONS)[number];
  other_regulator_required: (typeof REGULATORY_DECISIONS)[number];
  regulatory_assessment: string | null;
  regulatory_assessed_at: string | null;
  notes: string | null;
  source_ticket_id: string | null;
  source_ticket: { id: string; title: string; status: string } | null;
  created_at: string;
  updated_at: string;
}
export interface RegulatoryNotification {
  id: string;
  incident_id: string;
  destination: (typeof REGULATORY_DESTINATIONS)[number];
  agency: string;
  notification_type: string;
  required: boolean;
  legal_basis: string | null;
  deadline: string | null;
  status: (typeof REGULATORY_NOTIFICATION_STATUSES)[number];
  notified_at: string | null;
  reference_no: string | null;
  evidence_url: string | null;
  reason_not_required: string | null;
  notes: string | null;
  created_at: string;
}

export interface IncidentDetail {
  incident: Incident;
  regulatoryNotifications: RegulatoryNotification[];
  attachments: { id: string; original_filename: string; mime_type: string; size_bytes: number; created_at: string }[];
  notificationClocks: NotificationClock[];
  notificationTimeline: NotificationTimelineEvent[];
  ciRelationships: IncidentCiRelationship[];
  followUpProblems: { id: string; problem_number: string; title: string; status: string }[];
  emergencyChanges: { id: string; change_number: string; title: string; status: string; risk_level: string; source_incident_id: string }[];
}

export interface NotificationClock {
  id: string;
  incident_id: string;
  clock_type: (typeof NOTIFICATION_CLOCK_TYPES)[number];
  started_at: string;
  deadline_at: string | null;
  status: (typeof NOTIFICATION_CLOCK_STATUSES)[number];
  notified_at: string | null;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationTimelineEvent {
  id: string;
  incident_id: string;
  event_type: (typeof NOTIFICATION_TIMELINE_EVENT_TYPES)[number];
  destination: (typeof REGULATORY_DESTINATIONS)[number] | null;
  occurred_at: string;
  note: string | null;
  reference_no: string | null;
  created_at: string;
}

export interface IncidentReferences {
  configurationItems: { id: string; ci_code: string; name: string; ci_type: string; criticality: string; status: string }[];
  commanders: ProfileRef[];
}

export interface RiskMatrixCell {
  likelihood: number;
  impact: number;
  score: number;
  count: number;
  riskLevel: string;
}
