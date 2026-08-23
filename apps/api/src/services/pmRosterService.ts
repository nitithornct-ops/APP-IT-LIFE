type Row = Record<string, unknown>;

export interface PmRosterPlan {
  id: string;
  planDate: string;
  status: string;
  recurrence: string;
  assetCode: string;
  assetName: string;
  technicianId: string | null;
  technicianName: string;
  overdueDays: number;
}

export interface PmRosterResponse {
  weekStart: string;
  weekEnd: string;
  days: Array<{ date: string; label: string; total: number; unassigned: number }>;
  summary: { total: number; assigned: number; unassigned: number; completed: number; overdue: number };
  technicians: Array<{
    id: string;
    name: string;
    total: number;
    completed: number;
    inProgress: number;
    overdue: number;
    dayCounts: number[];
    plans: PmRosterPlan[];
  }>;
  unassignedPlans: PmRosterPlan[];
  overduePlans: PmRosterPlan[];
  overdueSampled: boolean;
}

const DAY_LABELS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function related(row: Row, key: string): Row | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
  return value && typeof value === 'object' ? value as Row : null;
}

function nameOf(employee: Row | null): string {
  if (!employee) return 'ยังไม่ระบุผู้รับผิดชอบ';
  return [employee.prefix_th, employee.first_name_th, employee.last_name_th].filter(Boolean).map(String).join(' ') || 'ไม่ระบุชื่อ';
}

function overdueDays(planDate: string, today: string): number {
  const due = new Date(`${planDate}T00:00:00.000Z`).getTime();
  const current = new Date(`${today}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.floor((current - due) / 86_400_000));
}

function normalizePlan(row: Row, today: string): PmRosterPlan {
  const asset = related(row, 'asset');
  const technician = related(row, 'technician');
  const planDate = String(row.plan_date ?? '');
  return {
    id: String(row.id),
    planDate,
    status: String(row.status ?? ''),
    recurrence: String(row.recurrence ?? ''),
    assetCode: String(asset?.asset_code ?? ''),
    assetName: String(asset?.name ?? 'ไม่พบข้อมูล Asset'),
    technicianId: row.technician_id ? String(row.technician_id) : null,
    technicianName: nameOf(technician),
    overdueDays: overdueDays(planDate, today),
  };
}

export function buildPmRoster(args: { weekRows: Row[]; overdueRows: Row[]; overdueTotal?: number; weekStart: string; today: string }): PmRosterResponse {
  const weekEnd = addDays(args.weekStart, 6);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(args.weekStart, index));
  const weekPlans = args.weekRows.filter((row) => String(row.status) !== 'ยกเลิก').map((row) => normalizePlan(row, args.today));
  const overduePlans = args.overdueRows.filter((row) => !['ดำเนินการแล้ว', 'ยกเลิก'].includes(String(row.status))).map((row) => normalizePlan(row, args.today));
  const overdueByTechnician = new Map<string, number>();
  for (const plan of overduePlans) {
    if (plan.technicianId) overdueByTechnician.set(plan.technicianId, (overdueByTechnician.get(plan.technicianId) ?? 0) + 1);
  }

  const technicianMap = new Map<string, PmRosterResponse['technicians'][number]>();
  for (const plan of weekPlans) {
    if (!plan.technicianId) continue;
    const entry = technicianMap.get(plan.technicianId) ?? {
      id: plan.technicianId,
      name: plan.technicianName,
      total: 0,
      completed: 0,
      inProgress: 0,
      overdue: overdueByTechnician.get(plan.technicianId) ?? 0,
      dayCounts: dates.map(() => 0),
      plans: [],
    };
    entry.total += 1;
    if (plan.status === 'ดำเนินการแล้ว') entry.completed += 1;
    if (plan.status === 'กำลังดำเนินการ') entry.inProgress += 1;
    const dayIndex = dates.indexOf(plan.planDate);
    if (dayIndex >= 0) entry.dayCounts[dayIndex] += 1;
    entry.plans.push(plan);
    technicianMap.set(plan.technicianId, entry);
  }

  // Keep technicians with overdue work visible even when they have no new PM in the selected week.
  for (const plan of overduePlans) {
    if (!plan.technicianId || technicianMap.has(plan.technicianId)) continue;
    technicianMap.set(plan.technicianId, {
      id: plan.technicianId,
      name: plan.technicianName,
      total: 0,
      completed: 0,
      inProgress: 0,
      overdue: overdueByTechnician.get(plan.technicianId) ?? 0,
      dayCounts: dates.map(() => 0),
      plans: [],
    });
  }

  const unassignedPlans = weekPlans.filter((plan) => !plan.technicianId);
  return {
    weekStart: args.weekStart,
    weekEnd,
    days: dates.map((date, index) => ({
      date,
      label: DAY_LABELS[index],
      total: weekPlans.filter((plan) => plan.planDate === date).length,
      unassigned: unassignedPlans.filter((plan) => plan.planDate === date).length,
    })),
    summary: {
      total: weekPlans.length,
      assigned: weekPlans.length - unassignedPlans.length,
      unassigned: unassignedPlans.length,
      completed: weekPlans.filter((plan) => plan.status === 'ดำเนินการแล้ว').length,
      overdue: args.overdueTotal ?? overduePlans.length,
    },
    technicians: [...technicianMap.values()].sort((a, b) => b.total - a.total || b.overdue - a.overdue || a.name.localeCompare(b.name, 'th')),
    unassignedPlans,
    overduePlans: overduePlans.sort((a, b) => b.overdueDays - a.overdueDays || a.planDate.localeCompare(b.planDate)).slice(0, 20),
    overdueSampled: (args.overdueTotal ?? overduePlans.length) > overduePlans.length,
  };
}
