export interface VendorPortalProfile {
  accountId: string;
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  email: string;
  fullName: string;
  position: string | null;
}

export interface VendorPortalSubmission {
  id: string;
  ticket_id: string;
  revision: number;
  response: Record<string, unknown>;
  signer_name: string;
  signer_position: string | null;
  submitted_at: string;
  review_status: 'Submitted' | 'Revision Requested' | 'Accepted';
  reviewed_at: string | null;
  review_note: string | null;
  signature_url?: string | null;
}

export interface VendorPortalTicket {
  id: string;
  ticket_no: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  location: string | null;
  created_at: string;
  outsource_issue_no: string | null;
  outsource_sent_at: string | null;
  ticket_categories?: { name: string | null } | null;
  latest_submission?: Pick<VendorPortalSubmission, 'ticket_id' | 'revision' | 'submitted_at' | 'review_status' | 'review_note'> | null;
}

export interface VendorPortalTicketDetail {
  ticket: VendorPortalTicket;
  submission: VendorPortalSubmission | null;
}

