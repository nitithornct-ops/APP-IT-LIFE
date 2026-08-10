export type DashboardTone = 'primary' | 'teal' | 'amber' | 'danger' | 'gray';
export type DashboardMode = 'executive' | 'privacy' | 'operations' | 'personal';

export interface DashboardMetric {
  label: string;
  value: string | number;
  note: string;
  tone: DashboardTone;
  path?: string;
}

export interface DashboardCard {
  key: string;
  label: string;
  path: string;
  total: number;
  warning: number;
  overdue: number;
  tone: DashboardTone;
}

export interface DashboardDueItem {
  id: string;
  source: string;
  title: string;
  status: string;
  dueAt: string;
  daysRemaining: number;
  tone: DashboardTone;
  path: string;
}

export interface DashboardBreakdown {
  key: string;
  label: string;
  items: Array<{ label: string; value: number }>;
}

export interface DashboardSummary {
  mode: DashboardMode;
  metrics: DashboardMetric[];
  cards: DashboardCard[];
  upcoming: DashboardDueItem[];
  breakdowns: DashboardBreakdown[];
  alertCount: number;
  leadDays: number;
  generatedAt: string;
}

