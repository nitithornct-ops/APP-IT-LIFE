export const TASK_TERMINAL_STATUSES = new Set(['เสร็จแล้ว', 'ยกเลิก']);

export interface SummaryTask {
  status: string;
  due_date: string | null;
  due_time?: string | null;
  priority: string;
  progress: number;
  updated_at: string;
}

export function bangkokDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDaysToDateKey(dateKey: string, amount: number): string {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return bangkokDateKey(date);
}

export function daysFromBangkokToday(dueDate: string | null, now = new Date()): number | null {
  if (!dueDate) return null;
  const today = bangkokDateKey(now);
  const due = Date.parse(`${dueDate}T12:00:00+07:00`);
  const base = Date.parse(`${today}T12:00:00+07:00`);
  return Math.round((due - base) / 86_400_000);
}

const PRIORITY_RANK: Record<string, number> = { เร่งด่วน: 0, สูง: 1, ปกติ: 2, ต่ำ: 3 };

export function sortTodayTasks<T extends SummaryTask>(tasks: T[], now = new Date()): T[] {
  return [...tasks].sort((a, b) => {
    const daysA = daysFromBangkokToday(a.due_date, now) ?? 999_999;
    const daysB = daysFromBangkokToday(b.due_date, now) ?? 999_999;
    if (daysA !== daysB) return daysA - daysB;
    const priority = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (priority !== 0) return priority;
    const time = (a.due_time ?? '23:59').localeCompare(b.due_time ?? '23:59');
    if (time !== 0) return time;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function buildTaskDashboard<T extends SummaryTask>(tasks: T[], now = new Date()) {
  const today = bangkokDateKey(now);
  const next7 = addDaysToDateKey(today, 7);
  const openTasks = tasks.filter((task) => !TASK_TERMINAL_STATUSES.has(task.status));
  const todayItems = sortTodayTasks(
    openTasks.filter((task) => task.due_date === today || (task.due_date !== null && task.due_date < today)),
    now,
  );
  const upcoming = sortTodayTasks(
    openTasks.filter((task) => task.due_date !== null && task.due_date >= today && task.due_date <= next7),
    now,
  );

  return {
    generatedAt: now.toISOString(),
    timezone: 'Asia/Bangkok' as const,
    summary: {
      open: openTasks.length,
      today: openTasks.filter((task) => task.due_date === today).length,
      dueSoon: openTasks.filter((task) => {
        const days = daysFromBangkokToday(task.due_date, now);
        return days !== null && days >= 0 && days <= 3;
      }).length,
      overdue: openTasks.filter((task) => task.due_date !== null && task.due_date < today).length,
      completed: tasks.filter((task) => task.status === 'เสร็จแล้ว').length,
      inProgress: tasks.filter((task) => task.status === 'กำลังทำ').length,
      averageProgress: tasks.length
        ? Math.round(tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / tasks.length)
        : 0,
    },
    todayItems,
    upcoming,
  };
}

export function calculateChecklistProgress(statuses: string[]): number | null {
  if (statuses.length === 0) return null;
  const completed = statuses.filter((status) => status === 'เสร็จแล้ว').length;
  return Math.round((completed / statuses.length) * 100);
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TaskRecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays?: number[];
  dayOfMonth?: number;
  monthOfYear?: number;
}

const PRESET_RECURRENCE_RULES: Record<string, TaskRecurrenceRule> = {
  รายวัน: { frequency: 'daily', interval: 1 },
  วันทำงาน: { frequency: 'daily', interval: 1, weekdays: [1, 2, 3, 4, 5] },
  รายสัปดาห์: { frequency: 'weekly', interval: 1 },
  'ทุก 2 สัปดาห์': { frequency: 'weekly', interval: 2 },
  รายเดือน: { frequency: 'monthly', interval: 1 },
  รายไตรมาส: { frequency: 'monthly', interval: 3 },
  'ทุก 6 เดือน': { frequency: 'monthly', interval: 6 },
  รายปี: { frequency: 'yearly', interval: 1 },
};

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day };
}

function toDateKey(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day, 12)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function resolveRecurrenceRule(
  recurrence: string,
  suppliedRule: TaskRecurrenceRule | null | undefined,
  baseDate?: string | null,
): TaskRecurrenceRule | null {
  if (recurrence === 'ไม่ทำซ้ำ') return null;
  const preset = recurrence === 'กำหนดเอง' ? suppliedRule : PRESET_RECURRENCE_RULES[recurrence];
  if (!preset) return null;
  const rule = { ...preset, weekdays: preset.weekdays ? [...preset.weekdays] : undefined };
  if (baseDate) {
    const { month, day } = parseDateKey(baseDate);
    if (rule.frequency === 'monthly' && !rule.dayOfMonth) rule.dayOfMonth = day;
    if (rule.frequency === 'yearly') {
      if (!rule.dayOfMonth) rule.dayOfMonth = day;
      if (!rule.monthOfYear) rule.monthOfYear = month;
    }
  }
  return rule;
}

export function nextRecurrenceDate(dateKey: string | null, rule: TaskRecurrenceRule | null): string | null {
  if (!dateKey || !rule) return null;
  const interval = Math.max(1, Math.trunc(rule.interval));
  const { year, month, day } = parseDateKey(dateKey);

  if (rule.frequency === 'daily') {
    let next = new Date(Date.UTC(year, month - 1, day + interval, 12));
    if (rule.weekdays?.length) {
      const allowed = new Set(rule.weekdays);
      while (!allowed.has(next.getUTCDay())) next = new Date(next.getTime() + 86_400_000);
    }
    return next.toISOString().slice(0, 10);
  }

  if (rule.frequency === 'weekly') return toDateKey(year, month - 1, day + (7 * interval));

  if (rule.frequency === 'monthly') {
    const targetMonthIndex = (month - 1) + interval;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
    const targetDay = Math.min(rule.dayOfMonth ?? day, daysInMonth(targetYear, normalizedMonth));
    return toDateKey(targetYear, normalizedMonth, targetDay);
  }

  const targetYear = year + interval;
  const targetMonth = Math.min(12, Math.max(1, rule.monthOfYear ?? month));
  const targetDay = Math.min(rule.dayOfMonth ?? day, daysInMonth(targetYear, targetMonth - 1));
  return toDateKey(targetYear, targetMonth - 1, targetDay);
}
