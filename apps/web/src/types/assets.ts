export const ASSET_TYPES = ['Server', 'Network Device', 'Software/License', 'Endpoint', 'Storage', 'อื่นๆ'] as const;
export const ASSET_CRITICALITIES = ['สูง', 'กลาง', 'ต่ำ'] as const;
export const ASSET_STATUSES = ['พร้อมใช้งาน', 'ใช้งานอยู่', 'ซ่อมบำรุง', 'จำหน่าย/เลิกใช้', 'สูญหาย'] as const;
export const ASSET_AUDIT_RESULTS = ['พบ/ตรงตำแหน่ง', 'พบ/ผิดตำแหน่ง', 'ไม่พบ/สูญหาย'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_LIFECYCLE_STATUSES = ['ordered', 'received', 'ready', 'checked_out', 'repair', 'returned', 'disposed'] as const;
export type AssetLifecycleStatus = (typeof ASSET_LIFECYCLE_STATUSES)[number];
export const ASSET_LIFECYCLE_LABELS: Record<AssetLifecycleStatus, string> = {
  ordered: 'สั่งซื้อ',
  received: 'รับเข้า',
  ready: 'พร้อมใช้',
  checked_out: 'เบิกจ่าย',
  repair: 'ซ่อม',
  returned: 'รับคืน',
  disposed: 'จำหน่าย',
};

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
  lifecycle_status: AssetLifecycleStatus;
  purchase_order: string | null;
  invoice_number: string | null;
  depreciation_method: 'straight_line' | 'declining_balance' | 'none';
  depreciation_rate: number | null;
  cost_center: string | null;
  barcode: string | null;
  asset_model_catalog_id: string | null;
  model_catalog: AssetModelCatalog | null;
  parent_asset_id: string | null;
  physical_verification_status: 'pending' | 'verified' | 'exception';
  physical_verified_at: string | null;
  disposed_at: string | null;
  disposal_reason: string | null;
  disposal_value: number | null;
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
  lifecycleEvents: AssetLifecycleEvent[];
  children: AssetOption[];
  configurationItem: { id: string; ci_code: string; name: string; ci_type: string; environment: string; status: string } | null;
  attachments: AssetAttachment[];
}

export interface AssetLifecycleEvent {
  id: string;
  from_status: AssetLifecycleStatus | null;
  to_status: AssetLifecycleStatus;
  event_date: string;
  notes: string | null;
  related_ticket_id: string | null;
  performed_by: string | null;
}

export interface AssetAttachment {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface AssetModelCatalog {
  id: string;
  model_code: string;
  name: string;
  asset_type: string;
  brand: string | null;
  model: string | null;
  default_useful_life_years: number | null;
  default_warranty_months: number | null;
  depreciation_method: 'straight_line' | 'declining_balance' | 'none';
  default_cost_center: string | null;
  specs: Record<string, unknown>;
  status: 'active' | 'inactive';
  notes: string | null;
}

export interface AssetBorrowSummary {
  available: number;
  active: number;
  dueSoon: number;
  overdue: number;
}

export interface ActiveAssetLoan {
  id: string;
  asset_code: string;
  name: string;
  status: AssetStatus;
  location: string | null;
  loan_date: string | null;
  loan_due_date: string | null;
  owner: EmployeeRef | null;
  department: { id: string; name_th: string } | null;
  loan: AssetLoanSummary | null;
}

export interface AssetLoanSummary {
  id: string;
  status: 'active' | 'returned' | 'cancelled';
  borrowed_at: string;
  due_at: string;
  purpose: string;
  condition_before: string;
  companion_equipment: string[];
  borrower_acknowledged: boolean;
  borrower_acknowledged_at: string | null;
  borrower_acknowledgement_name: string | null;
  approver_employee_id: string;
  return_outcome: 'good' | 'damaged' | 'lost';
}

export interface AssetLoanAttachment {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  asset_loan_stage: 'before' | 'after' | null;
  created_at: string;
}

export interface AssetLoan extends AssetLoanSummary {
  asset_id: string;
  borrower_employee_id: string;
  approver_employee_id: string;
  reminder_recipient_id: string | null;
  reminder_days_before: number;
  returned_at: string | null;
  return_receiver_employee_id: string | null;
  condition_after: string | null;
  damage_notes: string | null;
  return_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  asset: { id: string; asset_code: string; name: string; status: AssetStatus; lifecycle_status: AssetLifecycleStatus } | null;
  borrower: EmployeeRef | null;
  approver: EmployeeRef | null;
  return_receiver: EmployeeRef | null;
  attachments: AssetLoanAttachment[];
}

export interface AssetBorrowMovement extends AssetMovement {
  asset: { id: string; asset_code: string; name: string } | null;
}

// ===== Maintenance / PM =====
/** ชนิดงานในปฏิทินบำรุงรักษา (design handoff 3c) — ตรงกับ migration 20260919100000 */
export const PM_WORK_TYPES = ['PM', 'ลงพื้นที่', 'Change window'] as const;

export const PM_STATUSES = ['วางแผน', 'กำลังดำเนินการ', 'ดำเนินการแล้ว', 'ยกเลิก'] as const;
export const PM_RECURRENCES = ['ครั้งเดียว', 'รายเดือน', 'รายไตรมาส', 'รายปี'] as const;
export const PM_RESULT_STATUSES = ['กำลังดำเนินการ', 'ดำเนินการแล้ว'] as const;
export const PM_CHECK_RESULTS = ['ยังไม่ตรวจ', 'ผ่าน', 'ไม่ผ่าน', 'N/A'] as const;
export const PM_RECURRENCE_BASES = ['กำหนดเดิม', 'วันทำเสร็จ'] as const;

export interface ChecklistItem {
  text: string;
  required?: boolean;
  result?: 'ยังไม่ตรวจ' | 'ผ่าน' | 'ไม่ผ่าน' | 'N/A';
  note?: string;
}

export interface MaintenancePlan {
  id: string;
  asset_id: string;
  asset: { id: string; asset_code: string; name: string } | null;
  plan_date: string;
  actual_date: string | null;
  status: (typeof PM_STATUSES)[number];
  work_type: (typeof PM_WORK_TYPES)[number];
  recurrence: (typeof PM_RECURRENCES)[number];
  recurrence_basis: (typeof PM_RECURRENCE_BASES)[number];
  original_plan_date: string;
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

export interface PmRosterPlan {
  id: string;
  planDate: string;
  status: string;
  recurrence: string;
  assetCode: string;
  assetName: string;
  technicianId: string | null;
  technicianName: string;
  overdueDays: number;
}

export interface PmRosterResponse {
  weekStart: string;
  weekEnd: string;
  days: Array<{ date: string; label: string; total: number; unassigned: number }>;
  summary: { total: number; assigned: number; unassigned: number; completed: number; overdue: number };
  technicians: Array<{
    id: string;
    name: string;
    total: number;
    completed: number;
    inProgress: number;
    overdue: number;
    dayCounts: number[];
    plans: PmRosterPlan[];
  }>;
  unassignedPlans: PmRosterPlan[];
  overduePlans: PmRosterPlan[];
  overdueSampled: boolean;
}

// ===== Inventory =====
export interface InventoryItem {
  id: string;
  item_name: string;
  category: string | null;
  unit: string;
  stock_qty: number;
  min_qty: number;
  reorder_point: number;
  location: string | null;
  warehouse_id: string | null;
  bin_id: string | null;
  barcode: string | null;
  vendor_id: string | null;
  unit_price: number | null;
  last_purchase_price: number | null;
  reorder_qty: number | null;
  low_stock_notification_enabled: boolean;
  valuation_method: 'STANDARD' | 'MOVING_AVERAGE';
  status: 'active' | 'inactive';
  notes: string | null;
  reserved_qty: number;
  available_qty: number;
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
  ticket_id: string | null;
  task_id: string | null;
  purchase_receipt_id: string | null;
  created_at: string;
}

export interface InventoryRequest {
  id: string;
  request_no: string;
  requester_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED' | 'CANCELLED';
  reference_ticket_id: string | null;
  reference_task_id: string | null;
  purpose: string | null;
  approval_comment: string | null;
  created_at: string;
}

export interface InventoryReservation {
  id: string;
  item_id: string;
  reserved_qty: number;
  status: 'ACTIVE' | 'RELEASED' | 'FULFILLED' | 'CANCELLED';
  reserved_by: string;
  source_request_id: string | null;
  reference_ticket_id: string | null;
  reference_task_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface InventoryAdjustmentRequest {
  id: string;
  item_id: string;
  current_qty: number;
  counted_qty: number;
  variance: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_by: string;
  reason: string | null;
  created_at: string;
}

export interface InventoryPurchaseReceipt {
  id: string;
  receipt_no: string;
  vendor_id: string | null;
  purchase_order_no: string | null;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  received_at: string;
  total_amount: number;
  notes: string | null;
}

export interface InventoryCycleCountCampaign {
  id: string;
  campaign_code: string;
  name: string;
  scheduled_date: string;
  warehouse_id: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

export interface InventoryCycleCountLine {
  id: string;
  campaign_id: string;
  item_id: string;
  system_qty: number;
  counted_qty: number | null;
  variance: number | null;
  status: 'PENDING' | 'SUBMITTED' | 'ADJUSTMENT_PENDING';
  notes: string | null;
}

// ===== Software License =====
export const LICENSE_STATUSES = ['Active', 'Expired', 'Inactive'] as const;
export const LICENSE_MODELS = ['SaaS', 'Device', 'Concurrent'] as const;
export const LICENSE_ALLOCATION_TYPES = ['user', 'device'] as const;
export const LICENSE_RENEWAL_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

export interface SoftwareLicense {
  id: string;
  license_code: string;
  product_name: string;
  software_name: string;
  edition: string | null;
  version: string | null;
  publisher: string | null;
  license_model: (typeof LICENSE_MODELS)[number];
  license_type: string | null;
  total_qty: number;
  used_qty: number;
  /** ราคาต่อสิทธิ์ (บาท) — null = ยังไม่ได้บันทึกราคา ไม่ใช่ของฟรี */
  unit_price: number | null;
  start_date: string | null;
  expire_date: string | null;
  vendor_name: string | null;
  vendor_id: string | null;
  vendor: { id: string; vendor_code: string; name: string; status: string } | null;
  contract_id: string | null;
  contract: { id: string; contract_number: string; name: string; status: string; end_date: string | null } | null;
  assigned_to: string | null;
  expiry_notice_days: number;
  expiry_notified_at: string | null;
  legacy_id: string | null;
  renewal_approval_status: (typeof LICENSE_RENEWAL_APPROVAL_STATUSES)[number];
  renewal_approved_by: string | null;
  renewal_approved_at: string | null;
  renewal_approval_notes: string | null;
  assigned_qty?: number;
  available_qty?: number;
  reclaimed_qty?: number;
  usage_pct?: number;
  total_cost?: number | null;
  cost_per_user?: number | null;
  reclaimable_cost?: number | null;
  under_utilized?: boolean;
  over_allocation?: boolean;
  compliance_risk?: boolean;
  renewal_recommendation?: 'renew_current' | 'renew_reduced' | 'true_up' | 'review' | 'do_not_renew' | 'monitor';
  status: (typeof LICENSE_STATUSES)[number];
  notes: string | null;
}

export interface SoftwareLicenseAllocation {
  id: string;
  license_id: string;
  assignee_type: (typeof LICENSE_ALLOCATION_TYPES)[number];
  employee_id: string | null;
  asset_id: string | null;
  status: 'assigned' | 'reclaimed';
  assigned_at: string;
  assigned_by: string | null;
  reclaimed_at: string | null;
  reclaimed_by: string | null;
  notes: string | null;
  employee: { id: string; employee_code: string; prefix_th: string | null; first_name_th: string; last_name_th: string; nickname: string | null } | null;
  asset: { id: string; asset_code: string; name: string; status: string } | null;
}

export interface SoftwareLicenseOptions {
  employees: Array<{ id: string; employee_code: string; prefix_th: string | null; first_name_th: string; last_name_th: string; nickname: string | null; status: string }>;
  assets: Array<{ id: string; asset_code: string; name: string; status: string }>;
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
  owner_employee_id: string | null;
  owner: EmployeeRef | null;
  custodian_employee_id: string | null;
  custodian: EmployeeRef | null;
  assigned_user_employee_id: string | null;
  assigned_user: EmployeeRef | null;
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
  checkout_date: string | null;
  return_date: string | null;
  accessories: string[];
  manager_approval_status: 'pending' | 'approved' | 'rejected';
  manager_approved_by: string | null;
  manager_approved_at: string | null;
  manager_approval_notes: string | null;
  handover_document_id: string | null;
  handover_document_name: string | null;
  return_reason: string | null;
  returned_by: string | null;
  assignment_batch_id: string | null;
  notes: string | null;
}

export interface EmployeeAssignmentAttachment {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

/** ตรงกับ apps/api/src/services/licenseCostService.ts */
export interface LicenseCostSummary {
  reclaimableAmount: number;
  reclaimableSeats: number;
  pricedCount: number;
  unpricedCount: number;
  topOpportunities: Array<{ id: string; softwareName: string; unusedSeats: number; unitPrice: number; reclaimableAmount: number }>;
}
