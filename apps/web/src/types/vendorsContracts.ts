export const VENDOR_SERVICE_TYPES = ['ร้านซ่อม', 'ผู้ขายอุปกรณ์', 'Software', 'Internet Provider', 'ผู้ให้บริการ MA', 'Cloud', 'อื่นๆ'] as const;
export const VENDOR_STATUSES = ['Active', 'Inactive'] as const;
export const CONTRACT_TYPES = ['Service', 'Maintenance', 'Software', 'Internet', 'Cloud', 'Purchase', 'Other'] as const;
export const CONTRACT_STATUSES = ['Draft', 'Active', 'Expired', 'Terminated', 'Renewed'] as const;

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
  status: (typeof VENDOR_STATUSES)[number];
  notes: string | null;
  contracts?: VendorContractSummary[];
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
  renewal_notice_days: number;
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
}
