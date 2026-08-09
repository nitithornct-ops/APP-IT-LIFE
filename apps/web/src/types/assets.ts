export const ASSET_TYPES = ['Server', 'Network Device', 'Software/License', 'Endpoint', 'Storage', 'อื่นๆ'] as const;
export const ASSET_CRITICALITIES = ['สูง', 'กลาง', 'ต่ำ'] as const;
export const ASSET_STATUSES = ['พร้อมใช้งาน', 'ใช้งานอยู่', 'ซ่อมบำรุง', 'จำหน่าย/เลิกใช้', 'สูญหาย'] as const;
export const ASSET_AUDIT_RESULTS = ['พบ/ตรงตำแหน่ง', 'พบ/ผิดตำแหน่ง', 'ไม่พบ/สูญหาย'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface EmployeeRef {
  id: string;
  employee_code: string;
  first_name_th: string;
  last_name_th: string;
  nickname: string | null;
}

export interface Asset {
  id: string;
  asset_code: string;
  name: string;
  asset_type: string;
  category_id: string | null;
  category: { id: string; name: string; code_prefix: string } | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  vendor_name: string | null;
  vendor_id: string | null;
  vendor: { id: string; vendor_code: string; name: string; status: string } | null;
  contract_id: string | null;
  contract: { id: string; contract_number: string; name: string; status: string; end_date: string | null } | null;
  purchase_date: string | null;
  warranty_expire: string | null;
  price: number | null;
  useful_life_years: number | null;
  license_no: string | null;
  license_expiry: string | null;
  location: string | null;
  department_id: string | null;
  department: { id: string; name_th: string } | null;
  owner_employee_id: string | null;
  owner: EmployeeRef | null;
  patch_status: string | null;
  patch_date: string | null;
  criticality: string | null;
  status: AssetStatus;
  qr_code_url: string | null;
  last_audit_date: string | null;
  audit_status: string | null;
  loan_date: string | null;
  loan_due_date: string | null;
  notes: string | null;
  remark: string | null;
  ageYears: number | null;
  bookValue: number | null;
  depreciationPct: number | null;
  warrantyDaysLeft: number | null;
  licenseDaysLeft: number | null;
  created_at: string;
  updated_at: string;
}

export interface AssetOption {
  id: string;
  asset_code: string;
  name: string;
  status: AssetStatus;
}

export interface AssetMovement {
  id: string;
  action_type: string;
  from_employee: { first_name_th: string; last_name_th: string } | null;
  to_employee: { first_name_th: string; last_name_th: string } | null;
  vendor_name: string | null;
  vendor_id: string | null;
  vendor: { id: string; vendor_code: string; name: string; status: string } | null;
  department: { name_th: string } | null;
  location: string | null;
  status_label: string | null;
  notes: string | null;
  due_date: string | null;
  condition: string | null;
  action_date: string;
}

export interface AssetDetail {
  asset: Asset;
  movements: AssetMovement[];
  maintenance: { id: string; plan_date: string; actual_date: string | null; status: string; result: string | null; recurrence: string }[];
  licenses: { id: string; software_name: string; license_type: string | null; expire_date: string | null; status: string }[];
}

// ===== Maintenance / PM =====
export const PM_STATUSES = ['วางแผน', 'กำลังดำเนินการ', 'ดำเนินการแล้ว', 'ยกเลิก'] as const;
export const PM_RECURRENCES = ['ครั้งเดียว', 'รายเดือน', 'รายไตรมาส', 'รายปี'] as const;
export const PM_CHECK_RESULTS = ['ผ่าน', 'ไม่ผ่าน', 'N/A'] as const;

export interface ChecklistItem {
  text: string;
  result?: 'ผ่าน' | 'ไม่ผ่าน' | 'N/A';
  note?: string;
}

export interface MaintenancePlan {
  id: string;
  asset_id: string;
  asset: { id: string; asset_code: string; name: string } | null;
  plan_date: string;
  actual_date: string | null;
  status: (typeof PM_STATUSES)[number];
  recurrence: (typeof PM_RECURRENCES)[number];
  next_due_date: string | null;
  technician_id: string | null;
  technician: EmployeeRef | null;
  vendor_id: string | null;
  vendor: { id: string; vendor_code: string; name: string; status: string } | null;
  contract_id: string | null;
  contract: { id: string; contract_number: string; name: string; status: string; end_date: string | null } | null;
  checklist_json: ChecklistItem[];
  result: string | null;
  notes: string | null;
  template_id: string | null;
  recurring_parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PmTemplate {
  id: string;
  name: string;
  category: string | null;
  items_json: ChecklistItem[];
  status: 'active' | 'inactive';
  notes: string | null;
}

// ===== Inventory =====
export interface InventoryItem {
  id: string;
  item_name: string;
  category: string | null;
  unit: string;
  stock_qty: number;
  min_qty: number;
  location: string | null;
  unit_price: number | null;
  reorder_qty: number | null;
  status: 'active' | 'inactive';
  notes: string | null;
  low: boolean;
  value: number;
}

export interface InventoryTransaction {
  id: string;
  item_id: string;
  transaction_type: 'IN' | 'OUT' | 'ADJUST';
  qty: number;
  balance_after: number;
  variance: number | null;
  notes: string | null;
  created_at: string;
}

// ===== Software License =====
export const LICENSE_STATUSES = ['Active', 'Expired', 'Inactive'] as const;

export interface SoftwareLicense {
  id: string;
  software_name: string;
  license_type: string | null;
  total_qty: number;
  used_qty: number;
  start_date: string | null;
  expire_date: string | null;
  vendor_name: string | null;
  vendor_id: string | null;
  vendor: { id: string; vendor_code: string; name: string; status: string } | null;
  contract_id: string | null;
  contract: { id: string; contract_number: string; name: string; status: string; end_date: string | null } | null;
  assigned_to: string | null;
  status: (typeof LICENSE_STATUSES)[number];
  notes: string | null;
}

// ===== Employee Assignments =====
export const EMPLOYEE_ASSET_CATEGORIES = [
  'Computer',
  'Notebook',
  'Monitor',
  'iPad',
  'โทรศัพท์มือถือ',
  'IP Phone Yealink',
  'Printer',
  'Scanner',
  'Software',
  'Network',
  'อื่นๆ',
] as const;
export const EMPLOYEE_ASSIGNMENT_STATUSES = ['ครอบครอง', 'คืนแล้ว', 'ส่งซ่อม', 'สูญหาย'] as const;

export interface EmployeeAssignment {
  id: string;
  employee_id: string;
  employee: EmployeeRef | null;
  category: (typeof EMPLOYEE_ASSET_CATEGORIES)[number];
  item_name: string;
  asset_id: string | null;
  asset: { id: string; asset_code: string; name: string } | null;
  asset_code: string | null;
  ip_address: string | null;
  producer: string | null;
  model: string | null;
  mac_address: string | null;
  asset_number: string | null;
  serial_number: string | null;
  os_system: string | null;
  hardware_spec: string | null;
  software_name: string | null;
  software_license: string | null;
  phone_number: string | null;
  scan_user: string | null;
  scan_folder: string | null;
  status: (typeof EMPLOYEE_ASSIGNMENT_STATUSES)[number];
  assigned_date: string | null;
  returned_date: string | null;
  notes: string | null;
}
