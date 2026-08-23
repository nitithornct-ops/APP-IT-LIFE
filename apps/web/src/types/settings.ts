export type SettingValueType = 'text' | 'textarea' | 'boolean' | 'number' | 'time' | 'url' | 'enum' | 'csv';
export type SettingSupportStatus = 'active' | 'prepared' | 'deferred' | 'external';

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
}

export interface SettingsResponse {
  settings: SystemSetting[];
  groups: string[];
  summary: { total: number; editable: number; deferred: number; externallyManaged: number };
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
