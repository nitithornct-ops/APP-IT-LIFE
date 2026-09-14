export const BACKUP_TYPES = ['Full', 'Incremental', 'Differential', 'System Snapshot'] as const;
export const BACKUP_RESULTS = ['สำเร็จ', 'สำเร็จบางส่วน', 'ล้มเหลว'] as const;
export const BACKUP_SCHEDULES = ['ทุก 15 นาที', 'ทุกชั่วโมง', 'ทุก 6 ชั่วโมง', 'ทุกวัน', 'ทุกสัปดาห์', 'ทุกเดือน'] as const;
export const BACKUP_POLICY_STATUSES = ['active', 'inactive'] as const;
export const RECOVERY_RESULTS = ['ผ่าน', 'ผ่านบางส่วน', 'ไม่ผ่าน'] as const;
export const BCP_STATUSES = ['ใช้งาน', 'ระงับ', 'ยกเลิก'] as const;
export const LOG_FREQUENCIES = ['รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส'] as const;
export const LOG_REVIEW_STATUSES = ['ปกติ', 'กำลังดำเนินการ', 'แก้ไขแล้ว', 'ยอมรับความเสี่ยง'] as const;

export type BackupType = (typeof BACKUP_TYPES)[number];
export type BackupResult = (typeof BACKUP_RESULTS)[number];
export type BackupSchedule = (typeof BACKUP_SCHEDULES)[number];
export type BackupPolicyStatusValue = (typeof BACKUP_POLICY_STATUSES)[number];
export type RecoveryResult = (typeof RECOVERY_RESULTS)[number];
export type BcpStatus = (typeof BCP_STATUSES)[number];
export type LogFrequency = (typeof LOG_FREQUENCIES)[number];
export type LogReviewStatus = (typeof LOG_REVIEW_STATUSES)[number];

export interface ProfileRef { id: string; full_name: string; email: string }
export interface ConfigurationItemRef { id: string; ci_code: string; name: string; rpo_hours: number | null; rto_hours: number | null }

export interface BackupLog {
  id: string; backup_code: string; system_name: string; configuration_item_id: string | null;
  backup_type: BackupType; backup_date: string; result: BackupResult; data_size: string | null;
  storage_location: string | null; operator_id: string; next_backup_due: string | null;
  evidence_link: string | null; checksum: string | null; row_count: number | null; notes: string | null;
  source_run_id?: string | null; import_batch_id?: string | null; backup_started_at?: string | null;
  backup_completed_at?: string | null; data_size_bytes?: number | null; storage_used_bytes?: number | null;
  storage_capacity_bytes?: number | null;
  operator: ProfileRef | null; configuration_item: ConfigurationItemRef | null;
}

export interface RecoveryTest {
  id: string; recovery_code: string; backup_log_id: string | null; system_name: string;
  configuration_item_id: string | null; test_date: string; scenario: string | null;
  result: RecoveryResult; rto_actual: string | null; rpo_actual: string | null; tester_id: string;
  next_test_due: string | null; evidence_link: string | null; findings: string | null; notes: string | null;
  restore_verified?: boolean; restore_verified_at?: string | null; restore_verification_notes?: string | null;
  tester: ProfileRef | null; configuration_item: ConfigurationItemRef | null; backup: Pick<BackupLog, 'id' | 'backup_code' | 'system_name'> | null;
}

export interface BcpPlan {
  id: string; plan_code: string; plan_name: string; scope: string | null; owner_id: string;
  last_review_date: string | null; next_review_due: string | null; last_invoked_date: string | null;
  invoke_reason: string | null; document_link: string | null; status: BcpStatus; notes: string | null;
  dr_exercise_schedule?: string | null; last_dr_exercise_date?: string | null; next_dr_exercise_due?: string | null;
  dr_exercise_result?: 'ผ่าน' | 'ผ่านบางส่วน' | 'ไม่ผ่าน' | 'ยังไม่ได้ทดสอบ' | null;
  owner: ProfileRef | null;
}

export interface BackupPolicy {
  id: string; policy_code: string; configuration_item_id: string; expected_backup_policy: string;
  rto_target_hours: number | null; rpo_target_hours: number | null; backup_schedule: BackupSchedule;
  schedule_interval_minutes: number; storage_capacity_bytes: number | null; storage_used_bytes: number | null;
  storage_alert_threshold_percent: number; restore_verification_required: boolean; alerts_enabled: boolean;
  missed_backup_alert: boolean; failure_alert: boolean; auto_create_incident: boolean; owner_id: string | null;
  status: BackupPolicyStatusValue; notes: string | null; configuration_item: ConfigurationItemRef | null;
  owner: ProfileRef | null;
  system_name: string; last_backup_result: string | null; last_successful_backup_at: string | null;
  backup_age_hours: number | null; backup_missed: boolean; storage_usage_percent: number | null;
  restore_verification_due: boolean; restore_verification_status: 'verified' | 'due' | 'not_required';
  latest_recovery_test_date: string | null;
}

export interface BackupAlert {
  id: string; alert_key: string; alert_type: 'MISSED_BACKUP' | 'BACKUP_FAILURE' | 'STORAGE_CAPACITY' | 'RESTORE_VERIFICATION' | 'DR_EXERCISE';
  status: 'OPEN' | 'RESOLVED'; severity: 'ปานกลาง' | 'สูง' | 'วิกฤต'; title: string; message: string;
  observed_at: string; resolved_at: string | null; incident_id: string | null;
}

export interface BackupEvidenceSnapshot {
  id: string; snapshot_code: string; source_table: 'backup_logs' | 'recovery_tests' | 'bcp_plans';
  source_record_id: string; captured_at: string; checksum: string; generated: boolean;
}

export interface BackupDashboardSummary {
  total_systems: number; successful_systems: number; success_label: string; failure_count: number;
  failure_items: Array<{ system_name: string; count: number; latest_date: string; result: string }>;
  recovery_due_items: Array<{ system_name: string; reason: string; next_test_due: string | null }>;
  dr_due_items: Array<{ plan_name: string; next_dr_exercise_due: string }>;
  storage: { systems_over_threshold: number; total_capacity_bytes: number; total_used_bytes: number; usage_percent: number | null };
  open_alert_count: number; generated_at: string;
}

export interface LoggingSystem {
  id: string; log_system_code: string; system_name: string; configuration_item_id: string | null;
  log_type: string | null; log_location: string | null; review_frequency: LogFrequency;
  responsible_id: string; last_review_date: string | null; next_review_due: string;
  retention_period: string | null; status: 'ใช้งาน' | 'ระงับ'; notes: string | null;
  responsible: ProfileRef | null; configuration_item: ConfigurationItemRef | null;
}

export interface LogReview {
  id: string; review_code: string; logging_system_id: string; review_date: string; reviewer_id: string;
  period: string; anomaly_found: boolean; anomaly_detail: string | null; action_taken: string | null;
  status: LogReviewStatus; evidence_link: string | null; notes: string | null;
  reviewer: ProfileRef | null; logging_system: Pick<LoggingSystem, 'id' | 'log_system_code' | 'system_name' | 'review_frequency'> | null;
}

export interface BackupMonitoringOverview {
  backups: BackupLog[];
  recoveries: RecoveryTest[];
  bcpPlans: BcpPlan[];
  loggingSystems: LoggingSystem[];
  logReviews: LogReview[];
  policies: BackupPolicy[];
  alerts: BackupAlert[];
  evidenceSnapshots: BackupEvidenceSnapshot[];
  backupDashboard: BackupDashboardSummary;
}

export interface BackupMonitoringOptions {
  users: ProfileRef[];
  configurationItems: ConfigurationItemRef[];
}
