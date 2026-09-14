export type DashboardTone = 'primary' | 'teal' | 'amber' | 'danger' | 'gray';
export type DashboardMode = 'executive' | 'privacy' | 'operations' | 'personal';

export interface DashboardMetric {
  /** stable identifier used for per-user KPI pinning */
  key?: string;
  label: string;
  value: string | number;
  note: string;
  tone: DashboardTone;
  path?: string;
}

export interface DashboardDecision {
  id: string;
  source: string;
  title: string;
  reason: string;
  path: string;
}

export interface DashboardTrend {
  label: string;
  current: number;
  previous: number;
  delta: number;
  percent: number | null;
  sampled: boolean;
}

export interface DashboardCard {
  key: string;
  label: string;
  path: string;
  /** ยอดรวมจริงจากฐานข้อมูล ไม่ใช่จำนวนแถวที่ API ดึงมาคำนวณ */
  total: number;
  warning: number;
  overdue: number;
  /** งานที่หยุดนาฬิกา SLA อยู่ ไม่ถูกรวมใน overdue */
  paused?: number;
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
  decisions?: DashboardDecision[];
  trend?: DashboardTrend;
  alertCount: number;
  leadDays: number;
  generatedAt: string;
}

export interface MyWorkItem {
  id: string;
  kind: 'ticket' | 'service_request' | 'task' | 'service_approval' | 'access_approval' | 'access_fulfillment' | 'workflow_approval'
    | 'incident' | 'problem' | 'change_test' | 'change_approval' | 'vulnerability' | 'backup' | 'recovery_test' | 'log_review'
    | 'contract_renewal' | 'license_renewal' | 'governance_capa' | 'risk_treatment' | 'audit_finding';
  source: string;
  title: string;
  status: string;
  priority: string | null;
  dueAt: string | null;
  slaPaused?: boolean;
  riskScore: number | null;
  slaState: 'overdue' | 'due_soon' | 'on_track' | 'paused' | 'none';
  slaRemainingSeconds: number | null;
  isOverdue: boolean;
  snoozedUntil: string | null;
  path: string;
  action: string;
}

export interface MyWorkQueueItem {
  id: string;
  kind: MyWorkItem['kind'];
  source: string;
  title: string;
  status: string;
  priority: string | null;
  dueAt: string | null;
  riskScore: number | null;
  path: string;
}

export interface MyWorkSavedView {
  id: string;
  name: string;
  scope: 'all' | 'approval' | 'assigned' | 'personal' | 'overdue';
  sourceKind: string | null;
  sortBy: 'risk_sla_due' | 'due_date';
  updatedAt: string;
}

export interface MyWorkResponse {
  items: MyWorkItem[];
  snoozedItems: Array<{ id: string; kind: MyWorkItem['kind']; title: string; snoozedUntil: string | null }>;
  teamQueue: MyWorkQueueItem[];
  savedViews: MyWorkSavedView[];
  summary: { total: number; overdue: number; approvals: number; assigned: number; snoozed: number; teamQueue: number };
  generatedAt: string;
}

