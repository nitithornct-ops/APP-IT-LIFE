type Row = Record<string, unknown>;

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

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_LABELS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TERMINAL_TICKET_STATUSES = new Set(['เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident']);
const HOURS = Array.from({ length: 12 }, (_, index) => index + 8);

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function bangkokDateKey(instant: Date): string {
  const local = new Date(instant.getTime() + BANGKOK_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

function bangkokHour(instant: Date): number {
  return new Date(instant.getTime() + BANGKOK_OFFSET_MS).getUTCHours();
}

function startOfBangkokDay(instant: Date, offsetDays = 0): Date {
  const local = new Date(instant.getTime() + BANGKOK_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offsetDays) - BANGKOK_OFFSET_MS);
}

function countValues(rows: Row[], label: (row: Row) => string): Array<{ label: string; value: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = label(row) || 'ไม่ระบุ';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([entryLabel, value]) => ({ label: entryLabel, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'th'));
}

function relatedName(row: Row): string {
  const relation = row.ticket_categories;
  if (Array.isArray(relation)) return String((relation[0] as Row | undefined)?.name ?? 'ไม่ระบุ');
  if (relation && typeof relation === 'object') return String((relation as Row).name ?? 'ไม่ระบุ');
  return 'ไม่ระบุ';
}

function average(values: number[], precision = 1): number | null {
  if (!values.length) return null;
  const factor = 10 ** precision;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * factor) / factor;
}

export function buildExecutiveServiceAnalytics(args: {
  tickets: Row[];
  periodDays: number;
  sampled?: boolean;
  now?: Date;
}): ExecutiveServiceAnalytics {
  const now = args.now ?? new Date();
  const periodStart = startOfBangkokDay(now, -(args.periodDays - 1));
  const recent = args.tickets.filter((row) => {
    const createdAt = validDate(row.created_at);
    return createdAt && createdAt >= periodStart && createdAt <= now;
  });
  const open = args.tickets.filter((row) => !TERMINAL_TICKET_STATUSES.has(String(row.status ?? '')));

  const heatmapDays = Array.from({ length: 7 }, (_, index) => {
    const day = startOfBangkokDay(now, index - 6);
    const local = new Date(day.getTime() + BANGKOK_OFFSET_MS);
    return { key: bangkokDateKey(day), label: DAY_LABELS[local.getUTCDay()], total: 0, values: HOURS.map(() => 0) };
  });
  const dayMap = new Map(heatmapDays.map((day) => [day.key, day]));
  for (const row of args.tickets) {
    const createdAt = validDate(row.created_at);
    if (!createdAt || createdAt > now) continue;
    const day = dayMap.get(bangkokDateKey(createdAt));
    const hour = bangkokHour(createdAt);
    if (!day || hour < HOURS[0] || hour > HOURS[HOURS.length - 1]) continue;
    day.values[hour - HOURS[0]] += 1;
    day.total += 1;
  }
  let maximum = 0;
  let peak: ExecutiveServiceAnalytics['heatmap']['peak'] = null;
  for (const day of heatmapDays) {
    day.values.forEach((count, index) => {
      if (count > maximum) {
        maximum = count;
        peak = { dayLabel: day.label, hour: HOURS[index], count };
      }
    });
  }

  const resolvedInPeriod = args.tickets.filter((row) => {
    const resolvedAt = validDate(row.resolved_at ?? row.closed_at);
    return resolvedAt && resolvedAt >= periodStart && resolvedAt <= now && !['ยกเลิก', 'ยกระดับเป็น Incident'].includes(String(row.status ?? ''));
  });
  const slaEligible = resolvedInPeriod.filter((row) => validDate(row.due_at));
  const slaMet = slaEligible.filter((row) => validDate(row.resolved_at ?? row.closed_at)!.getTime() <= validDate(row.due_at)!.getTime()).length;
  const responseMinutes = recent.flatMap((row) => {
    const createdAt = validDate(row.created_at);
    const acknowledgedAt = validDate(row.acknowledged_at);
    return createdAt && acknowledgedAt && acknowledgedAt >= createdAt ? [(acknowledgedAt.getTime() - createdAt.getTime()) / 60_000] : [];
  });
  const resolutionHours = resolvedInPeriod.flatMap((row) => {
    const createdAt = validDate(row.created_at);
    const resolvedAt = validDate(row.resolved_at ?? row.closed_at);
    return createdAt && resolvedAt && resolvedAt >= createdAt ? [(resolvedAt.getTime() - createdAt.getTime()) / 3_600_000] : [];
  });
  const ratings = args.tickets.flatMap((row) => {
    const rating = Number(row.rating);
    const ratedAt = validDate(row.feedback_at ?? row.resolved_at ?? row.closed_at);
    return Number.isFinite(rating) && rating >= 1 && rating <= 5 && ratedAt && ratedAt >= periodStart && ratedAt <= now ? [rating] : [];
  });

  const nowDay = startOfBangkokDay(now);
  const ageValues = { under1: 0, days1to3: 0, days4to7: 0, over7: 0 };
  for (const row of open) {
    const createdAt = validDate(row.created_at);
    if (!createdAt) continue;
    const ageDays = Math.max(0, Math.floor((nowDay.getTime() - startOfBangkokDay(createdAt).getTime()) / 86_400_000));
    if (ageDays < 1) ageValues.under1 += 1;
    else if (ageDays <= 3) ageValues.days1to3 += 1;
    else if (ageDays <= 7) ageValues.days4to7 += 1;
    else ageValues.over7 += 1;
  }

  const technicianMap = new Map<string, { closed: number; slaEligible: number; slaMet: number; ratings: number[] }>();
  for (const row of resolvedInPeriod) {
    const name = String(row.assignee_name_snapshot ?? '').trim();
    if (!name) continue;
    const entry = technicianMap.get(name) ?? { closed: 0, slaEligible: 0, slaMet: 0, ratings: [] };
    entry.closed += 1;
    const resolvedAt = validDate(row.resolved_at ?? row.closed_at);
    const dueAt = validDate(row.due_at);
    if (resolvedAt && dueAt) {
      entry.slaEligible += 1;
      if (resolvedAt <= dueAt) entry.slaMet += 1;
    }
    const rating = Number(row.rating);
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) entry.ratings.push(rating);
    technicianMap.set(name, entry);
  }

  return {
    periodDays: args.periodDays,
    sampled: Boolean(args.sampled),
    kpis: {
      received: recent.length,
      slaClosedPercent: slaEligible.length ? Math.round(slaMet / slaEligible.length * 1000) / 10 : null,
      averageResponseMinutes: average(responseMinutes, 0),
      averageResolutionHours: average(resolutionHours, 1),
      csatAverage: average(ratings, 2),
      csatResponses: ratings.length,
    },
    heatmap: { hours: HOURS, days: heatmapDays, maximum, peak },
    openByStatus: countValues(open, (row) => String(row.status ?? 'ไม่ระบุ')),
    backlogAge: [
      { key: 'under1', label: '<1 วัน', value: ageValues.under1 },
      { key: 'days1to3', label: '1–3 วัน', value: ageValues.days1to3 },
      { key: 'days4to7', label: '4–7 วัน', value: ageValues.days4to7 },
      { key: 'over7', label: '>7 วัน', value: ageValues.over7 },
    ],
    categories: countValues(recent, relatedName).slice(0, 5),
    technicians: [...technicianMap].map(([name, entry]) => ({
      name,
      closed: entry.closed,
      slaPercent: entry.slaEligible ? Math.round(entry.slaMet / entry.slaEligible * 1000) / 10 : null,
      averageRating: average(entry.ratings, 1),
    })).sort((a, b) => b.closed - a.closed || (b.slaPercent ?? -1) - (a.slaPercent ?? -1) || a.name.localeCompare(b.name, 'th')).slice(0, 5),
  };
}
