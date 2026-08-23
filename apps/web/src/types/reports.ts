export type ReportKey =
  | 'service-desk'
  | 'requests-workflows'
  | 'assets-operations'
  | 'security-resilience'
  | 'governance-compliance';

export interface ReportDefinition {
  key: ReportKey;
  label: string;
  description: string;
  sourcePermissions: string[];
  sortOrder: number;
}

export interface ReportMetric {
  label: string;
  value: string | number;
  note?: string;
  tone?: 'primary' | 'teal' | 'amber' | 'danger' | 'gray';
}

export interface ReportColumn {
  key: string;
  label: string;
}

export type ReportRow = Record<string, string | number | boolean | null>;

export interface ReportBreakdownItem {
  label: string;
  value: number;
}

export interface ReportBreakdown {
  label: string;
  items: ReportBreakdownItem[];
}

export interface ReportTrendPoint {
  label: string;
  primary: number;
  secondary?: number;
}

export interface ReportOverview {
  definitions: ReportDefinition[];
  metrics: ReportMetric[];
  alerts: string[];
  rangeDays: number;
  generatedAt: string;
}

export interface ReportDataset {
  definition: ReportDefinition;
  metrics: ReportMetric[];
  alerts: string[];
  breakdowns: ReportBreakdown[];
  trend: ReportTrendPoint[];
  trendLabels?: { primary: string; secondary?: string };
  columns: ReportColumn[];
  rows: ReportRow[];
  totalRows: number;
  rangeDays: number;
  generatedAt: string;
  csat?: {
    average: number | null;
    responseCount: number;
    distribution: Array<{ score: number; count: number; percentage: number }>;
    weeklyTrend: Array<{ label: string; average: number | null; responses: number }>;
    categories: Array<{ label: string; average: number; responses: number }>;
    technicians: Array<{ label: string; average: number; responses: number }>;
    followUpCount: number;
    followUps: Array<{ id: string; code: string; title: string; rating: number; feedback: string; submittedAt: string; owner: string }>;
    mentions: Array<{ label: string; count: number }>;
  };
}
