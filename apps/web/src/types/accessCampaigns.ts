import type { AccessPersonOption, AccessSystem } from './accessRequests';

export type AccessCertificationCampaignStatus = 'open' | 'overdue' | 'completed' | 'cancelled';
export type AccessCertificationDecisionStatus = 'pending' | 'approved' | 'revoked';

export interface AccessCertificationStats {
  totalUsers: number;
  totalEntitlements: number;
  approved: number;
  revoked: number;
  pending: number;
  completionPercentage: number;
}

export interface AccessCertificationCampaign {
  id: string;
  campaign_code: string;
  name: string;
  system_id: string | null;
  reviewer_id: string;
  due_date: string;
  status: AccessCertificationCampaignStatus;
  is_overdue: boolean;
  evidence_snapshot: Record<string, unknown>;
  signed_off_by: string | null;
  signed_off_at: string | null;
  sign_off_note: string | null;
  escalated_to: string | null;
  escalated_at: string | null;
  escalation_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  reviewer: { id: string; full_name: string; email: string } | null;
  system: { id: string; name: string } | null;
  stats: AccessCertificationStats;
}

export interface AccessCertificationItem {
  id: string;
  campaign_id: string;
  registry_id: string | null;
  user_id: string | null;
  system_id: string;
  access_item_id: string | null;
  access_level: string | null;
  permission_actions: string[];
  data_classification: string | null;
  privileged_access: boolean;
  evidence_snapshot: Record<string, unknown>;
  status: AccessCertificationDecisionStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  user: { full_name: string; email: string } | null;
  system: { name: string } | null;
  access_control_item: { kind: string; code: string; name: string } | null;
}

export interface AccessCertificationCampaignDetail extends AccessCertificationCampaign {
  items: AccessCertificationItem[];
}

export interface AccessCertificationOptions {
  systems: Array<Pick<AccessSystem, 'id' | 'name' | 'status'>>;
  reviewers: AccessPersonOption[];
}

export interface AccessCertificationDecisionResult {
  campaignId: string;
  approvedCount: number;
  revokedCount: number;
  pendingCount: number;
}

export interface AccessCertificationExportResult {
  filename: string;
  csv: string;
  rowCount: number;
}
