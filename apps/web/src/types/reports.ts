export type ReportKey =
  | 'service-desk'
  | 'requests-workflows'
  | 'assets-operations'
  | 'asset-custody'
  | 'asset-verification'
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

export interface ReportFilters {
  rangeDays: number;
  departmentId?: string;
  ownerId?: string;
  from?: string;
  to?: string;
  comparePrevious?: boolean;
}

export interface ReportFreshness {
  source: string;
  lastUpdatedAt: string | null;
  status: 'fresh' | 'stale' | 'unknown';
}

export interface ReportComparison {
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  deltaPercentage: number | null;
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
  summary?: { total: number; open: number; overdue: number; critical: number };
  filters?: ReportFilters;
  freshness?: ReportFreshness[];
  comparison?: ReportComparison[];
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

export interface ReportOption {
  id: string;
  label: string;
  departmentId?: string | null;
}

export interface ReportOptions {
  departments: ReportOption[];
  owners: ReportOption[];
}

export interface SavedReportFilter {
  id: string;
  reportKey: ReportKey | 'executive-pack';
  name: string;
  filters: Partial<ReportFilters>;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSchedule {
  id: string;
  reportKey: ReportKey | 'executive-pack';
  name: string;
  frequency: 'weekly' | 'monthly';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  runHour: number;
  timezone: string;
  format: 'CSV' | 'PDF' | 'PRINT';
  saveToDrive: boolean;
  filters: Partial<ReportFilters>;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
}

export interface ReportSnapshotSummary {
  id: string;
  reportKey: ReportKey | 'executive-pack';
  snapshotKind: 'manual' | 'monthly' | 'scheduled' | 'executive_pack';
  title: string;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string;
  createdAt: string;
}

export interface ExecutivePackSection {
  key: ReportKey;
  label: string;
  totalRows: number;
  metrics: ReportMetric[];
  alerts: string[];
}

export interface ExecutivePack {
  reportKey: 'executive-pack';
  title: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  metrics: ReportMetric[];
  comparison: ReportComparison[];
  freshness: ReportFreshness[];
  sections: ExecutivePackSection[];
  kpis: Array<{ key: string; label: string; description: string; formula: string; unit: string; target: number | null; direction: string }>;
}
