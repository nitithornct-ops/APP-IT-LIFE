export const BACKUP_TYPES = ['Full', 'Incremental', 'Differential', 'System Snapshot'] as const;
export const BACKUP_RESULTS = ['สำเร็จ', 'สำเร็จบางส่วน', 'ล้มเหลว'] as const;
export const RECOVERY_RESULTS = ['ผ่าน', 'ผ่านบางส่วน', 'ไม่ผ่าน'] as const;
export const BCP_STATUSES = ['ใช้งาน', 'ระงับ', 'ยกเลิก'] as const;
export const LOG_FREQUENCIES = ['รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส'] as const;
export const LOG_REVIEW_STATUSES = ['ปกติ', 'กำลังดำเนินการ', 'แก้ไขแล้ว', 'ยอมรับความเสี่ยง'] as const;

export type BackupType = (typeof BACKUP_TYPES)[number];
export type BackupResult = (typeof BACKUP_RESULTS)[number];
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
  operator: ProfileRef | null; configuration_item: ConfigurationItemRef | null;
}

export interface RecoveryTest {
  id: string; recovery_code: string; backup_log_id: string | null; system_name: string;
  configuration_item_id: string | null; test_date: string; scenario: string | null;
  result: RecoveryResult; rto_actual: string | null; rpo_actual: string | null; tester_id: string;
  next_test_due: string | null; evidence_link: string | null; findings: string | null; notes: string | null;
  tester: ProfileRef | null; configuration_item: ConfigurationItemRef | null; backup: Pick<BackupLog, 'id' | 'backup_code' | 'system_name'> | null;
}

export interface BcpPlan {
  id: string; plan_code: string; plan_name: string; scope: string | null; owner_id: string;
  last_review_date: string | null; next_review_due: string | null; last_invoked_date: string | null;
  invoke_reason: string | null; document_link: string | null; status: BcpStatus; notes: string | null;
  owner: ProfileRef | null;
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
}

export interface BackupMonitoringOptions {
  users: ProfileRef[];
  configurationItems: ConfigurationItemRef[];
}
