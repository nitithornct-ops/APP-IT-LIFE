export type FormTemplateStatus = 'Draft' | 'Published' | 'Archived';
export type IssueFormStatus = 'Draft' | 'Internal Review' | 'Sent to Vendor' | 'Vendor Replied' | 'Approved' | 'Closed' | 'Cancelled';

export interface FormTemplate {
  id: string;
  template_code: string;
  name: string;
  description: string | null;
  category: string;
  status: FormTemplateStatus;
  current_version: number;
  content_html: string;
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
  title: string;
  status: IssueFormStatus;
  template_id: string | null;
  template_version: number;
  ticket_id: string | null;
  vendor_id: string | null;
  content_html: string;
  form_data: Record<string, unknown>;
  vendor_response: VendorResponse;
  vendor_due_at: string | null;
  vendor_sent_at: string | null;
  vendor_responded_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  template?: Pick<FormTemplate, 'id' | 'template_code' | 'name'> | null;
  vendor?: Pick<FormReferenceVendor, 'id' | 'vendor_code' | 'name' | 'email' | 'contact_person'> | null;
  ticket?: Pick<FormReferenceTicket, 'id' | 'ticket_no' | 'title'> | null;
  creator?: { id: string; full_name: string } | null;
}

export interface FormReferences {
  vendors: FormReferenceVendor[];
  tickets: FormReferenceTicket[];
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
  template?: { name: string } | null;
}

