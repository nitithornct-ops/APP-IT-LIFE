export type ServiceCatalogStatus = 'draft' | 'active' | 'suspended' | 'retired';
export type ApprovalMode = 'none' | 'group';
export type CloseMode = 'requester_confirms' | 'it_closes';

export interface ServiceCatalogItem {
  id: string;
  service_code: string;
  service_name: string;
  category: string | null;
  description: string | null;
  audience: string | null;
  eligibility: { roles?: string[]; departmentIds?: string[] } | null;
  form_schema: unknown[];
  attachment_required: boolean;
  sla_hours: number;
  approval_mode: ApprovalMode;
  approval_group_id: string | null;
  fulfillment_group_id: string | null;
  checklist: unknown[];
  auto_assign: boolean;
  auto_create_task: boolean;
  estimated_cost: number | null;
  dependencies: Array<{
    type: 'requester_employee' | 'requester_department' | 'requester_role';
    value?: string;
    label?: string;
  }>;
  suggested_knowledge: Array<{
    articleId?: string;
    title: string;
    summary?: string;
    url?: string;
  }>;
  close_mode: CloseMode;
  close_condition: string | null;
  status: ServiceCatalogStatus;
  version: number;
  published_at: string | null;
  owner_id: string | null;
  documentation_url: string | null;
  effective_date: string;
  review_date: string | null;
  notes: string | null;
  created_at: string;
}
