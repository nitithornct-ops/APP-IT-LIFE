import {
  addTicketBusinessHours,
  ticketBusinessMinutesBetween,
  type TicketBusinessCalendar,
} from './ticketSlaService';

export type SlaImpactBucket = 'overdue' | 'critical' | 'atRisk' | 'safe' | 'paused' | 'unconfigured';

export interface SlaImpactTicket {
  id: string;
  status: string;
  created_at: string;
  due_at: string | null;
  resolution_sla_hours: number | string | null;
  sla_paused_at: string | null;
  sla_paused_minutes: number | string | null;
  reopen_count: number | string | null;
}

export interface SlaImpactCounts {
  total: number;
  overdue: number;
  critical: number;
  atRisk: number;
  safe: number;
  paused: number;
  unconfigured: number;
}

export interface SlaImpactSummary {
  current: SlaImpactCounts;
  proposed: SlaImpactCounts;
  changes: {
    newlyOverdue: number;
    newlyAtRisk: number;
    deadlineChanged: number;
    preservedReopened: number;
  };
}

const TERMINAL_TICKET_STATUSES = new Set(['เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident']);

function emptyCounts(): SlaImpactCounts {
  return { total: 0, overdue: 0, critical: 0, atRisk: 0, safe: 0, paused: 0, unconfigured: 0 };
}

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function classifyDeadline(
  dueAt: Date | null,
  slaMinutes: number,
  paused: boolean,
  now: Date,
  calendar: TicketBusinessCalendar,
): SlaImpactBucket {
  if (!dueAt || slaMinutes <= 0) return 'unconfigured';
  if (paused) return 'paused';
  if (dueAt <= now) return 'overdue';

  const remaining = ticketBusinessMinutesBetween(now, dueAt, calendar);
  const progress = Math.max(0, Math.min(100, 100 - (remaining / slaMinutes) * 100));
  if (progress >= 90) return 'critical';
  if (progress >= 70) return 'atRisk';
  return 'safe';
}

function proposedDeadline(
  ticket: SlaImpactTicket,
  now: Date,
  calendar: TicketBusinessCalendar,
): { dueAt: Date | null; preservedReopened: boolean } {
  const storedDue = validDate(ticket.due_at);
  const slaHours = Number(ticket.resolution_sla_hours);
  const createdAt = validDate(ticket.created_at);
  if (!createdAt || !Number.isFinite(slaHours) || slaHours <= 0) return { dueAt: null, preservedReopened: false };

  // The legacy schema does not retain a separate timestamp for the latest reopen.
  // Keep its stored deadline instead of pretending that the original created_at is still the SLA base.
  if (Number(ticket.reopen_count ?? 0) > 0 && storedDue) return { dueAt: storedDue, preservedReopened: true };

  const historicalPauseMinutes = Math.max(0, Number(ticket.sla_paused_minutes ?? 0) || 0);
  const activePauseStart = validDate(ticket.sla_paused_at);
  const activePauseMinutes = activePauseStart
    ? ticketBusinessMinutesBetween(activePauseStart, now, calendar)
    : 0;
  return {
    dueAt: addTicketBusinessHours(createdAt, slaHours + (historicalPauseMinutes + activePauseMinutes) / 60, calendar),
    preservedReopened: false,
  };
}

export function buildSlaImpactSummary(args: {
  tickets: SlaImpactTicket[];
  currentCalendar: TicketBusinessCalendar;
  proposedCalendar: TicketBusinessCalendar;
  now?: Date;
}): SlaImpactSummary {
  const now = args.now ?? new Date();
  const current = emptyCounts();
  const proposed = emptyCounts();
  const changes = { newlyOverdue: 0, newlyAtRisk: 0, deadlineChanged: 0, preservedReopened: 0 };

  for (const ticket of args.tickets) {
    if (TERMINAL_TICKET_STATUSES.has(ticket.status)) continue;
    const slaMinutes = Math.max(0, Number(ticket.resolution_sla_hours) * 60 || 0);
    const currentDue = validDate(ticket.due_at);
    const paused = Boolean(ticket.sla_paused_at);
    const currentBucket = classifyDeadline(currentDue, slaMinutes, paused, now, args.currentCalendar);
    const preview = proposedDeadline(ticket, now, args.proposedCalendar);
    const proposedBucket = classifyDeadline(preview.dueAt, slaMinutes, paused, now, args.proposedCalendar);

    current.total += 1;
    proposed.total += 1;
    current[currentBucket] += 1;
    proposed[proposedBucket] += 1;
    if (currentBucket !== 'overdue' && proposedBucket === 'overdue') changes.newlyOverdue += 1;
    if (['safe', 'unconfigured'].includes(currentBucket) && ['atRisk', 'critical'].includes(proposedBucket)) changes.newlyAtRisk += 1;
    if (currentDue && preview.dueAt && currentDue.getTime() !== preview.dueAt.getTime()) changes.deadlineChanged += 1;
    if (preview.preservedReopened) changes.preservedReopened += 1;
  }

  return { current, proposed, changes };
}
