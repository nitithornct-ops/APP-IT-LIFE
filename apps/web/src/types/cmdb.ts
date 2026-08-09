export const CI_TYPES = [
  'Server', 'VM', 'Database', 'Application', 'Website', 'Network Device', 'Firewall',
  'Switch', 'Access Point', 'Domain', 'SSL Certificate', 'API', 'Cloud Service',
  'Backup Job', 'Business Service', 'Other',
] as const;
export const CI_ENVIRONMENTS = ['Production', 'UAT', 'Development', 'DR', 'Shared', 'N/A'] as const;
export const CI_CRITICALITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export const CI_DATA_CLASSIFICATIONS = ['ไม่ลับ', 'ลับ', 'ลับมาก'] as const;
export const CI_STATUSES = ['Draft', 'Active', 'Maintenance', 'Degraded', 'Retired'] as const;
export type CiStatus = (typeof CI_STATUSES)[number];

/** node type ที่มีตารางจริงให้เลือกตอนนี้ — อีก 4 ประเภทรอโมดูล Vendor/Contract/Cloud/Backup */
export const CI_NODE_TYPES_ENABLED = ['CI', 'Asset', 'Incident', 'Change'] as const;

export const RELATIONSHIP_TYPES = [
  'DEPENDS_ON', 'RUNS_ON', 'HOSTS', 'CONNECTS_TO', 'USES', 'BACKED_UP_BY',
  'SUPPLIED_BY', 'COVERED_BY_CONTRACT', 'IMPACTED_BY', 'CHANGED_BY', 'LINKED_TO',
] as const;
/** ประเภทที่มี target ให้เลือกได้จริงตอนนี้ — SUPPLIED_BY/COVERED_BY_CONTRACT รอ Vendor/Contract */
export const RELATIONSHIP_TYPES_ENABLED = ['DEPENDS_ON', 'RUNS_ON', 'HOSTS', 'CONNECTS_TO', 'USES', 'BACKED_UP_BY', 'IMPACTED_BY', 'CHANGED_BY', 'LINKED_TO'] as const;
export const RELATIONSHIP_DIRECTIONS = ['Forward', 'Bidirectional'] as const;
export const RELATIONSHIP_IMPACT_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;
export const RELATIONSHIP_STATUSES = ['Active', 'Inactive'] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

interface EmployeeRef {
  id: string;
  employee_code: string;
  first_name_th: string;
  last_name_th: string;
  nickname: string | null;
}

export interface ConfigurationItem {
  id: string;
  ci_code: string;
  name: string;
  ci_type: (typeof CI_TYPES)[number];
  environment: (typeof CI_ENVIRONMENTS)[number];
  business_service: string | null;
  owner_employee_id: string | null;
  owner: EmployeeRef | null;
  administrator_employee_id: string | null;
  administrator: EmployeeRef | null;
  criticality: (typeof CI_CRITICALITIES)[number];
  ip_address: string | null;
  url: string | null;
  version: string | null;
  vendor_name: string | null;
  contract_ref: string | null;
  asset_id: string | null;
  asset: { id: string; asset_code: string; name: string } | null;
  cloud_ref: string | null;
  data_classification: (typeof CI_DATA_CLASSIFICATIONS)[number];
  rpo_hours: number | null;
  rto_hours: number | null;
  backup_required: boolean;
  backup_reference: string | null;
  location: string | null;
  status: CiStatus;
  status_reason: string | null;
  last_verified_at: string | null;
  last_verified_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CiRelationship {
  id: string;
  source_type: string;
  source_id: string;
  sourceName: string | null;
  sourceStatus: string | null;
  target_type: string;
  target_id: string;
  targetName: string | null;
  targetStatus: string | null;
  relationship_type: (typeof RELATIONSHIP_TYPES)[number];
  direction: (typeof RELATIONSHIP_DIRECTIONS)[number];
  impact_level: (typeof RELATIONSHIP_IMPACT_LEVELS)[number];
  description: string | null;
  status: RelationshipStatus;
  status_reason: string | null;
  valid_from: string | null;
  valid_until: string | null;
  last_verified_at: string | null;
  last_verified_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigurationItemDetail {
  ci: ConfigurationItem;
  relationships: CiRelationship[];
}

export interface CiNodeOption {
  type: 'CI' | 'Asset' | 'Incident' | 'Change';
  id: string;
  label: string;
  status: string;
}

export interface CiOption {
  id: string;
  ci_code: string;
  name: string;
  ci_type: string;
  status: CiStatus;
}

export interface CmdbDataQuality {
  unverifiedCount: number;
  unverifiedSample: { id: string; ci_code: string; name: string; status: string }[];
  incompleteCount: number;
  incompleteSample: { id: string; ci_code: string; name: string; criticality: string }[];
  orphanCount: number;
  orphanSample: CiRelationship[];
  expiredCount: number;
  expiredSample: { id: string; relationship_type: string; valid_until: string | null }[];
}
