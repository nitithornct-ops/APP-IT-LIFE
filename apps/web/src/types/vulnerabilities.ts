export const VULNERABILITY_STATUSES = ['เปิด', 'กำลังวิเคราะห์', 'กำลังแก้ไข', 'รอตรวจยืนยัน', 'ปิด'] as const;
export const VULNERABILITY_SEVERITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;

export type VulnerabilityStatus = (typeof VULNERABILITY_STATUSES)[number];
export type VulnerabilitySeverity = (typeof VULNERABILITY_SEVERITIES)[number];

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
  asset: { id: string; asset_code: string; name: string; patch_status: string | null; patch_date: string | null } | null;
  configuration_item_id: string | null;
  configuration_item: { id: string; ci_code: string; name: string; environment: string; status: string } | null;
  affected_system: string | null;
  source: string | null;
  cve: string | null;
  cvss: number | null;
  severity: VulnerabilitySeverity;
  description: string | null;
  detected_at: string;
  owner_id: string;
  owner: VulnerabilityProfileRef | null;
  remediation_plan: string | null;
  patch_reference: string | null;
  due_date: string | null;
  status: VulnerabilityStatus;
  exception_reason: string | null;
  exception_expiry: string | null;
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
  assets: Array<{ id: string; asset_code: string; name: string; status: string }>;
  configurationItems: Array<{ id: string; ci_code: string; name: string; environment: string; status: string }>;
  users: VulnerabilityProfileRef[];
}
