export type FormTemplateStatus = 'Draft' | 'Published' | 'Archived';
export type IssueFormStatus = 'Draft' | 'Internal Review' | 'Sent to Vendor' | 'Vendor Replied' | 'Approved' | 'Closed' | 'Cancelled';
export type FormModuleKey = 'ticket' | 'incident' | 'change' | 'contract' | 'audit' | 'risk' | 'service_request' | 'asset_borrow' | 'custom';

export type FormFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'acknowledgement' | 'signature';

export interface FormFieldCondition {
  fieldKey: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_empty';
  value?: string;
}

export interface FormFieldDefinition {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  condition?: FormFieldCondition;
  helpText?: string;
}

export interface FormAcknowledgementConfig { enabled: boolean; statement: string }
export interface FormApprovalSignatureConfig { requiredRoles: string[] }
export interface FormDocumentNumberRule { prefix: string; dateFormat: 'YYYY' | 'YYYYMM' | 'YYMM'; padding: number }

export const FORM_MODULES: ReadonlyArray<{ key: FormModuleKey; label: string; description: string }> = [
  { key: 'incident', label: 'Incident / เหตุการณ์', description: 'แบบฟอร์มสำหรับ Incident' },
  { key: 'change', label: 'Change / การเปลี่ยนแปลง', description: 'แบบฟอร์มสำหรับ Change Request' },
  { key: 'contract', label: 'Contract / สัญญา', description: 'แบบฟอร์มสำหรับ Contract' },
  { key: 'audit', label: 'Audit / การตรวจสอบ', description: 'แบบฟอร์มสำหรับ Audit' },
  { key: 'risk', label: 'Risk / ความเสี่ยง', description: 'แบบฟอร์มสำหรับ Governance Risk' },
  { key: 'service_request', label: 'Service Request / คำขอบริการ', description: 'แบบฟอร์มสำหรับ Service Request' },
  { key: 'custom', label: 'Custom / Generic', description: 'แบบฟอร์มกลางที่ผูกกับ Record ใดก็ได้' },
  { key: 'ticket', label: 'Ticket / งานแจ้งซ่อม', description: 'แบบฟอร์มหลักที่เติมข้อมูลจาก Ticket และใช้พิมพ์เอกสารงาน' },
  { key: 'asset_borrow', label: 'ยืม / คืน Asset', description: 'แบบฟอร์มหลักสำหรับรายการยืมทรัพย์สิน' },
];

export interface FormTemplate {
  id: string;
  template_code: string;
  name: string;
  description: string | null;
  category: string;
  module_key?: FormModuleKey | null;
  status: FormTemplateStatus;
  current_version: number;
  content_html: string;
  field_schema: FormFieldDefinition[];
  acknowledgement_config: FormAcknowledgementConfig;
  approval_signature_config: FormApprovalSignatureConfig;
  document_number_rule: FormDocumentNumberRule;
  page_settings: { size?: 'A4' | 'Letter'; orientation?: 'portrait' | 'landscape'; marginMm?: number };
  published_at: string | null;
  created_at: string;
  updated_at: string;
  creator?: { id: string; full_name: string } | null;
  updater?: { id: string; full_name: string } | null;
}

export interface FormReferenceVendor {
  id: string;
  vendor_code: string;
  name: string;
  email: string | null;
  contact_person: string | null;
  status: string;
}

export interface FormReferenceTicket {
  id: string;
  ticket_no: string;
  title: string;
  status: string;
}

export interface VendorResponse {
  slaCategory?: string;
  targetCompletionDate?: string;
  receivedDuration?: string;
  workaroundDuration?: string;
  analysisDuration?: string;
  resolutionDuration?: string;
  rootCause?: string;
  resolution?: string;
  prevention?: string;
  creditType?: 'none' | 'manday';
  changeTypes?: string[];
  creditBalanceBefore?: number;
  mandayUsed?: number;
  creditBalanceAfter?: number;
  assessmentNote?: string;
  assessorName?: string;
  submittedAt?: string;
}

export interface IssueForm {
  id: string;
  form_no: string;
  document_number: string | null;
  title: string;
  status: IssueFormStatus;
  template_id: string | null;
  template_version: number;
  ticket_id: string | null;
  source_module: FormModuleKey;
  source_record_id: string | null;
  vendor_id: string | null;
  content_html: string;
  field_schema: FormFieldDefinition[];
  form_data: Record<string, unknown>;
  immutable_snapshot: Record<string, unknown> | null;
  snapshot_hash: string | null;
  issued_at: string | null;
  vendor_response: VendorResponse;
  vendor_due_at: string | null;
  vendor_sent_at: string | null;
  vendor_responded_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  template?: Pick<FormTemplate, 'id' | 'template_code' | 'name' | 'acknowledgement_config' | 'approval_signature_config' | 'document_number_rule'> | null;
  vendor?: Pick<FormReferenceVendor, 'id' | 'vendor_code' | 'name' | 'email' | 'contact_person'> | null;
  ticket?: Pick<FormReferenceTicket, 'id' | 'ticket_no' | 'title'> | null;
  creator?: { id: string; full_name: string } | null;
}

export interface FormReferences {
  vendors: FormReferenceVendor[];
  tickets: FormReferenceTicket[];
  sources?: Record<string, Array<Record<string, string | null>>>;
}

export interface VendorFormPortalData {
  id: string;
  form_no: string;
  title: string;
  status: IssueFormStatus;
  content_html: string;
  vendor_due_at: string | null;
  vendor_response: VendorResponse;
  vendor_access_expires_at: string;
  vendor?: { id: string; name: string } | null;
  ticket?: { ticket_no: string; title: string } | null;
  template?: { name: string; acknowledgement_config?: FormAcknowledgementConfig } | null;
}

