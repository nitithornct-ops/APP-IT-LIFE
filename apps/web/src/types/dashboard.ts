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
  /** ยอดรวมจริงจากฐานข้อมูล ไม่ใช่จำนวนแถวที่ API ดึงมาคำนวณ */
  total: number;
  warning: number;
  overdue: number;
  /** true เมื่อข้อมูลมากกว่าเพดานที่สแกนได้ — warning/overdue จึงนับได้ไม่ครบ */
  truncated: boolean;
  /** จำนวนแถวที่นำมาคำนวณ warning/overdue จริง */
  scanned: number;
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

export interface ExecutiveServiceAnalytics {
  periodDays: number;
  sampled: boolean;
  kpis: {
    received: number;
    slaClosedPercent: number | null;
    averageResponseMinutes: number | null;
    averageResolutionHours: number | null;
    csatAverage: number | null;
    csatResponses: number;
  };
  heatmap: {
    hours: number[];
    days: Array<{ key: string; label: string; total: number; values: number[] }>;
    maximum: number;
    peak: { dayLabel: string; hour: number; count: number } | null;
  };
  openByStatus: Array<{ label: string; value: number }>;
  backlogAge: Array<{ key: 'under1' | 'days1to3' | 'days4to7' | 'over7'; label: string; value: number }>;
  categories: Array<{ label: string; value: number }>;
  technicians: Array<{ name: string; closed: number; slaPercent: number | null; averageRating: number | null }>;
}

export interface DashboardSummary {
  mode: DashboardMode;
  metrics: DashboardMetric[];
  cards: DashboardCard[];
  upcoming: DashboardDueItem[];
  breakdowns: DashboardBreakdown[];
  executiveAnalytics: ExecutiveServiceAnalytics | null;
  alertCount: number;
  leadDays: number;
  generatedAt: string;
}

export interface MyWorkItem {
  id: string;
  kind: 'ticket' | 'service_request' | 'task' | 'service_approval' | 'access_approval' | 'access_fulfillment' | 'workflow_approval';
  source: string;
  title: string;
  status: string;
  priority: string | null;
  dueAt: string | null;
  path: string;
  action: string;
}

export interface MyWorkResponse {
  items: MyWorkItem[];
  summary: { total: number; overdue: number; approvals: number; assigned: number };
  generatedAt: string;
}

