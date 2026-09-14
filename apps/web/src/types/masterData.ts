export const MASTER_DATA_KINDS = [
  'department',
  'position',
  'ticket_category',
  'asset_category',
  'access_system',
  'cause_code',
] as const;

export type MasterDataKind = (typeof MASTER_DATA_KINDS)[number];

export interface MasterDataUsage {
  key: string;
  label: string;
  count: number;
}

export interface MasterDataRegistryItem {
  id: string;
  kind: MasterDataKind;
  kind_label: string;
  source_table: string;
  source_path: string;
  permission: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  effective_date: string;
  sort_order: number;
  used_by: MasterDataUsage[];
  used_by_count: number;
  created_at: string;
}

export interface MasterDataAuditItem {
  id: string;
  action: string;
  module: string;
  target_table: string;
  target_id: string;
  actor_email: string | null;
  detail: Record<string, unknown> | null;
  result: 'success' | 'fail' | 'denied';
  request_id: string | null;
  created_at: string;
}
