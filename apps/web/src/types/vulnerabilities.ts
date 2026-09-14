export const VULNERABILITY_STATUSES = ['เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด'] as const;
export const VULNERABILITY_SEVERITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;

export type VulnerabilityStatus = (typeof VULNERABILITY_STATUSES)[number];
export type VulnerabilitySeverity = (typeof VULNERABILITY_SEVERITIES)[number];
export type VulnerabilityRiskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type VulnerabilityExceptionStatus = 'not_requested' | 'pending' | 'approved' | 'rejected' | 'expired';

export interface VulnerabilityProfileRef {
  id: string;
  full_name: string;
  email: string;
}

export interface VulnerabilityFinding {
  id: string;
  vulnerability_code: string;
  title: string;
  asset_id: string | null;
  asset: { id: string; asset_code: string; name: string; patch_status: string | null; patch_date: string | null; criticality: string | null } | null;
  configuration_item_id: string | null;
  configuration_item: { id: string; ci_code: string; name: string; environment: string; criticality: string; status: string } | null;
  affected_system: string | null;
  source: string | null;
  scanner_name: string | null;
  scanner_finding_id: string | null;
  last_seen_at: string | null;
  cve: string | null;
  cve_normalized: string | null;
  cvss: number | null;
  epss_score: number | null;
  epss_percentile: number | null;
  kev_listed: boolean;
  internet_facing: boolean;
  asset_criticality: 'Low' | 'Medium' | 'High' | 'Critical' | 'Unknown' | null;
  criticality_source: 'CMDB' | 'Asset' | 'Manual' | 'Unknown';
  risk_score: number | null;
  risk_priority: VulnerabilityRiskPriority;
  risk_factors: { reasons?: string[] } | null;
  risk_calculated_at: string | null;
  severity: VulnerabilitySeverity;
  description: string | null;
  detected_at: string;
  owner_id: string;
  owner: VulnerabilityProfileRef | null;
  remediation_plan: string | null;
  patch_reference: string | null;
  due_date: string | null;
  sla_due_date: string | null;
  sla_policy_days: number | null;
  sla_breached_at: string | null;
  status: VulnerabilityStatus;
  exception_reason: string | null;
  exception_expiry: string | null;
  exception_status: VulnerabilityExceptionStatus;
  exception_owner_id: string | null;
  exception_owner: VulnerabilityProfileRef | null;
  exception_requested_by: string | null;
  exception_approved_by: string | null;
  exception_approved_at: string | null;
  change_id: string | null;
  change: { id: string; change_number: string; title: string; status: string } | null;
  incident_id: string | null;
  incident: { id: string; incident_number: string; title: string; status: string } | null;
  problem_id: string | null;
  problem: { id: string; problem_number: string; title: string; status: string } | null;
  campaign_id: string | null;
  campaign: { id: string; campaign_code: string; name: string; status: string; target_date: string | null } | null;
  remediated_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verifier: VulnerabilityProfileRef | null;
  evidence_link: string | null;
  notes: string | null;
  legacy_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VulnerabilityOptions {
  assets: Array<{ id: string; asset_code: string; name: string; status: string; criticality: string | null }>;
  configurationItems: Array<{ id: string; ci_code: string; name: string; environment: string; criticality: string; status: string }>;
  users: VulnerabilityProfileRef[];
  campaigns: Array<{ id: string; campaign_code: string; name: string; status: string; target_date: string | null }>;
  changes: Array<{ id: string; change_number: string; title: string; status: string }>;
  incidents: Array<{ id: string; incident_number: string; title: string; status: string }>;
  problems: Array<{ id: string; problem_number: string; title: string; status: string }>;
}

export interface VulnerabilityRetest {
  id: string;
  vulnerability_id: string;
  attempt_no: number;
  status: 'scheduled' | 'passed' | 'failed' | 'blocked';
  tested_at: string;
  tested_by: string;
  method: string;
  result: string | null;
  evidence_link: string | null;
  next_retest_at: string | null;
  notes: string | null;
  tester?: VulnerabilityProfileRef | null;
}

export interface VulnerabilityExceptionApproval {
  id: string;
  vulnerability_id: string;
  requested_by: string;
  exception_owner_id: string;
  reason: string;
  expires_on: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approved_by: string | null;
  approved_at: string | null;
  approval_comment: string | null;
  evidence_link: string | null;
  requester?: VulnerabilityProfileRef | null;
  exception_owner?: VulnerabilityProfileRef | null;
  approver?: VulnerabilityProfileRef | null;
  created_at?: string;
}
