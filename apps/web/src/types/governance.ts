export type GovernanceDomain =
  | 'data-classification' | 'compliance' | 'privacy' | 'risk' | 'ai-cloud'
  | 'awareness' | 'evidence' | 'audit-management' | 'documents' | 'operations' | 'integrations';

export interface GovernanceMetric {
  label: string;
  value: number | string;
  tone?: 'primary' | 'teal' | 'amber' | 'danger' | 'gray';
}

export interface GovernanceDetail { label: string; value: string | number | boolean | null }

export interface GovernanceRecord {
  id: string;
  entity: string;
  code: string;
  title: string;
  subtitle?: string | null;
  status: string;
  owner?: string | null;
  due_date?: string | null;
  score?: number | null;
  details: GovernanceDetail[];
  actions?: string[];
}

export interface GovernanceDomainData {
  domain: GovernanceDomain;
  metrics: GovernanceMetric[];
  records: GovernanceRecord[];
  canManage: boolean;
  canAct: boolean;
  generatedAt: string;
}
