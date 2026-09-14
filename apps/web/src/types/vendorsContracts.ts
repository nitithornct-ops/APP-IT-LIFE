export const VENDOR_SERVICE_TYPES = ['ร้านซ่อม', 'ผู้ขายอุปกรณ์', 'Software', 'Internet Provider', 'ผู้ให้บริการ MA', 'Cloud', 'อื่นๆ'] as const;
export const VENDOR_STATUSES = ['Active', 'Inactive'] as const;
export const CONTRACT_TYPES = ['Service', 'Maintenance', 'Software', 'Internet', 'Cloud', 'Purchase', 'Other'] as const;
export const CONTRACT_STATUSES = ['Draft', 'Active', 'Expired', 'Terminated', 'Renewed'] as const;
export const VENDOR_CRITICALITY_TIERS = ['Low', 'Medium', 'High', 'Critical'] as const;
export const VENDOR_ASSESSMENT_STATUSES = ['Not Assessed', 'Not Required', 'Pending', 'Approved', 'Expired', 'Rejected'] as const;
export const VENDOR_NDA_STATUSES = ['Not Assessed', 'Not Required', 'Pending', 'Active', 'Expired', 'Rejected'] as const;
export const RENEWAL_DECISIONS = ['Pending', 'Renew', 'Do Not Renew', 'Renegotiate', 'Terminate'] as const;

export interface VendorContractProfileRef {
  id: string;
  full_name: string | null;
  email: string;
}

export interface VendorContractSummary {
  id: string;
  contract_number: string;
  name: string;
  status: string;
  end_date: string | null;
}

export interface Vendor {
  id: string;
  vendor_code: string;
  name: string;
  service_type: (typeof VENDOR_SERVICE_TYPES)[number];
  service_scope: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  contact_info: string | null;
  owner_id: string | null;
  owner?: VendorContractProfileRef | null;
  assessment_result: string | null;
  assessment_date: string | null;
  criticality_tier: (typeof VENDOR_CRITICALITY_TIERS)[number];
  vendor_risk_assessment: string | null;
  security_assessment: string | null;
  dpa_status: (typeof VENDOR_ASSESSMENT_STATUSES)[number];
  nda_status: (typeof VENDOR_NDA_STATUSES)[number];
  data_access: string | null;
  systems_accessed: string[];
  sla: string | null;
  incident_contact: string | null;
  escalation_contact: string | null;
  performance_review: string | null;
  annual_review: string | null;
  performance_review_date: string | null;
  annual_review_date: string | null;
  status: (typeof VENDOR_STATUSES)[number];
  notes: string | null;
  contracts?: VendorContractSummary[];
  created_at: string;
  updated_at: string;
}

export interface VendorPortalAccount {
  id: string;
  vendor_id: string;
  username: string;
  email: string;
  full_name: string;
  position: string | null;
  status: 'Active' | 'Inactive';
  invite_status: 'Pending' | 'Accepted' | 'Revoked';
  invited_at: string | null;
  accepted_at: string | null;
  mfa_enrolled_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractVendorRef {
  id: string;
  vendor_code: string;
  name: string;
  status: string;
}

export interface ContractOption {
  id: string;
  contract_number: string;
  name: string;
  vendor_id: string;
  status: string;
  end_date: string | null;
}

export interface Contract {
  id: string;
  contract_number: string;
  name: string;
  vendor_id: string;
  vendor?: ContractVendorRef | null;
  contract_type: (typeof CONTRACT_TYPES)[number];
  service_scope: string | null;
  key_terms: string | null;
  start_date: string | null;
  end_date: string | null;
  contract_value: number | null;
  currency: string;
  owner_id: string | null;
  owner?: VendorContractProfileRef | null;
  budget: number | null;
  annual_cost: number | null;
  auto_renewal: boolean;
  renewal_notice_days: number;
  sla_ola: string | null;
  dpa_attachment_id: string | null;
  dpa_attachment?: { id: string; original_filename: string; mime_type: string; size_bytes: number; created_at: string } | null;
  security_clause: string | null;
  renewal_decision: (typeof RENEWAL_DECISIONS)[number];
  termination_checklist: string[];
  contract_assets?: Array<{ asset: { id: string; asset_code: string; name: string } | null }>;
  contract_licenses?: Array<{ license: { id: string; software_name: string; license_type: string } | null }>;
  contract_configuration_items?: Array<{ configuration_item: { id: string; ci_code: string; name: string } | null }>;
  expiry_notified_at: string | null;
  status: (typeof CONTRACT_STATUSES)[number];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorReferences {
  owners: VendorContractProfileRef[];
}

export interface ContractReferences extends VendorReferences {
  vendors: ContractVendorRef[];
  assets?: Array<{ id: string; asset_code: string; name: string }>;
  licenses?: Array<{ id: string; software_name: string; license_type: string }>;
  configurationItems?: Array<{ id: string; ci_code: string; name: string }>;
}
