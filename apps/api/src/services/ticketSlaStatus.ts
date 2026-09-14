/**
 * Shared SLA classification for list, dashboard and reports.
 *
 * A waiting Ticket is classified before looking at its due date. This is the
 * important distinction between "the deadline is in the past" and "the clock
 * is deliberately paused".
 */
export type TicketSlaState = 'paused' | 'overdue' | 'due_soon' | 'on_track' | 'unconfigured';

const TERMINAL_STATUSES = new Set([
  'เสร็จสิ้น',
  'ปิดงาน',
  'ยกเลิก',
  'ยกระดับเป็น Incident',
]);

export function ticketSlaState(
  row: { status?: unknown; due_at?: unknown; sla_paused_at?: unknown },
  now = new Date(),
): TicketSlaState {
  const status = String(row.status ?? '');
  if (TERMINAL_STATUSES.has(status)) return 'on_track';
  if (row.sla_paused_at) return 'paused';
  if (!row.due_at) return 'unconfigured';
  const dueAt = new Date(String(row.due_at));
  if (Number.isNaN(dueAt.getTime())) return 'unconfigured';
  if (dueAt.getTime() < now.getTime()) return 'overdue';
  if (dueAt.getTime() - now.getTime() <= 4 * 60 * 60 * 1000) return 'due_soon';
  return 'on_track';
}

export function ticketSlaIsPaused(row: { sla_paused_at?: unknown }): boolean {
  return Boolean(row.sla_paused_at);
}

