export type SettingValueType = 'text' | 'textarea' | 'boolean' | 'number' | 'time' | 'url' | 'enum' | 'csv';
export type SettingSupportStatus = 'active' | 'prepared' | 'deferred' | 'external';
export type SettingEnvironmentKey = 'dev' | 'uat' | 'prod' | 'unknown';

export interface SystemSetting {
  key: string;
  value: string;
  description: string;
  group_key: string;
  value_type: SettingValueType;
  min_value: number | null;
  max_value: number | null;
  options: string[];
  is_editable: boolean;
  support_status: SettingSupportStatus;
  sort_order: number;
  updated_by: string | null;
  updated_at: string;
  config_version?: number;
  criticality?: 'standard' | 'critical';
  depends_on?: string[];
  requires_approval?: boolean;
}

export interface SettingChangeRequest {
  id: string;
  setting_key: string;
  requested_value: string;
  base_version: number;
  change_type: 'update' | 'restore';
  source_version: number | null;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approved_by: string | null;
  approved_at: string | null;
  approval_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingHistoryEntry {
  id: string;
  setting_key: string;
  version: number;
  value: string;
  previous_value: string | null;
  change_type: 'initial' | 'update' | 'restore';
  source_version: number | null;
  changed_by: string | null;
  environment_label: SettingEnvironmentKey;
  created_at: string;
}

export interface SettingPreviewResponse {
  key: string;
  changed: boolean;
  current: { value: string; version: number };
  proposed: { value: string; normalizedValue: string };
  criticality: 'standard' | 'critical';
  requiresApproval: boolean;
  dependencies: Array<{ key: string; status: 'satisfied' | 'unsatisfied' | 'missing'; value: string | null }>;
  impactedSettings: string[];
  warnings: string[];
}

export interface SettingHistoryResponse {
  key: string;
  currentVersion: number;
  criticality: 'standard' | 'critical';
  history: SettingHistoryEntry[];
}

export interface SettingMutationResult {
  status?: 'pending' | 'applied' | 'unchanged' | 'approved' | 'rejected';
  setting?: SystemSetting;
  request?: SettingChangeRequest;
}

export interface SettingsResponse {
  settings: SystemSetting[];
  groups: string[];
  summary: { total: number; editable: number; deferred: number; externallyManaged: number; configVersion?: number; critical?: number; pendingApprovals?: number };
  environment?: { key: SettingEnvironmentKey; label: string };
  capabilities?: { canApprove: boolean };
  pendingChanges?: SettingChangeRequest[];
  notices: { secretsStoredHere: boolean; designerDeferred: boolean; integrationMessage: string };
}

export interface BrandingSettings {
  organizationName: string;
  logoUrl: string;
}

export interface SlaImpactCounts {
  total: number;
  overdue: number;
  critical: number;
  atRisk: number;
  safe: number;
  paused: number;
  unconfigured: number;
}

export interface SlaImpactResponse {
  generatedAt: string;
  calendar: {
    start: string;
    end: string;
    businessDays: number[];
    holidays: string[];
    minutesPerDay: number;
  };
  policies: Array<{
    id: string;
    name: string;
    priority: string;
    responseHours: number;
    resolutionHours: number;
  }>;
  current: SlaImpactCounts;
  proposed: SlaImpactCounts;
  changes: {
    newlyOverdue: number;
    newlyAtRisk: number;
    deadlineChanged: number;
    preservedReopened: number;
  };
}
