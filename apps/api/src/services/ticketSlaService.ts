export interface TicketBusinessCalendar {
  startMinute: number;
  endMinute: number;
  businessDays: ReadonlySet<number>;
  holidays: ReadonlySet<string>;
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export const DEFAULT_TICKET_BUSINESS_CALENDAR: TicketBusinessCalendar = {
  startMinute: 8 * 60 + 30,
  endMinute: 17 * 60 + 30,
  businessDays: new Set([1, 2, 3, 4, 5]),
  holidays: new Set(),
};

function parseClock(value: string | undefined, fallback: number): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallback;
}

export function parseTicketBusinessCalendar(settings: Record<string, string | undefined>): TicketBusinessCalendar {
  const startMinute = parseClock(settings.SLA_BUSINESS_START, DEFAULT_TICKET_BUSINESS_CALENDAR.startMinute);
  const parsedEnd = parseClock(settings.SLA_BUSINESS_END, DEFAULT_TICKET_BUSINESS_CALENDAR.endMinute);
  const endMinute = parsedEnd > startMinute ? parsedEnd : DEFAULT_TICKET_BUSINESS_CALENDAR.endMinute;
  const days = (settings.SLA_BUSINESS_DAYS ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const holidays = (settings.SLA_HOLIDAYS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  return {
    startMinute,
    endMinute,
    businessDays: new Set(days.length ? days : DEFAULT_TICKET_BUSINESS_CALENDAR.businessDays),
    holidays: new Set(holidays),
  };
}

function bangkokParts(instant: Date) {
  const local = new Date(instant.getTime() + BANGKOK_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    date: local.getUTCDate(),
    day: local.getUTCDay(),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function bangkokInstant(year: number, month: number, date: number, minute: number): Date {
  return new Date(Date.UTC(year, month, date, Math.floor(minute / 60), minute % 60) - BANGKOK_OFFSET_MS);
}

function dateKey(year: number, month: number, date: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/** Adds Legacy Ticket SLA hours in Asia/Bangkok business time (minute precision). */
export function addTicketBusinessHours(
  start: Date,
  hours: number,
  calendar: TicketBusinessCalendar = DEFAULT_TICKET_BUSINESS_CALENDAR,
): Date {
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Ticket SLA hours must be a non-negative number');
  let remainingMinutes = Math.round(hours * 60);
  let cursor = new Date(start);
  if (remainingMinutes === 0) return cursor;

  // A practical guard against invalid calendars and accidental infinite loops.
  for (let checkedDays = 0; checkedDays < 36600; checkedDays += 1) {
    const parts = bangkokParts(cursor);
    const isBusinessDay = calendar.businessDays.has(parts.day)
      && !calendar.holidays.has(dateKey(parts.year, parts.month, parts.date));

    if (isBusinessDay) {
      const dayStart = bangkokInstant(parts.year, parts.month, parts.date, calendar.startMinute);
      const dayEnd = bangkokInstant(parts.year, parts.month, parts.date, calendar.endMinute);
      if (cursor < dayStart) cursor = dayStart;
      if (cursor < dayEnd) {
        const availableMinutes = Math.floor((dayEnd.getTime() - cursor.getTime()) / 60000);
        if (remainingMinutes <= availableMinutes) {
          return new Date(cursor.getTime() + remainingMinutes * 60000);
        }
        remainingMinutes -= availableMinutes;
      }
    }

    cursor = bangkokInstant(parts.year, parts.month, parts.date + 1, calendar.startMinute);
  }

  throw new Error('Ticket business calendar has no usable working days');
}

/** Counts elapsed Legacy SLA minutes between two instants, excluding nights, weekends and holidays. */
export function ticketBusinessMinutesBetween(
  start: Date,
  end: Date,
  calendar: TicketBusinessCalendar = DEFAULT_TICKET_BUSINESS_CALENDAR,
): number {
  if (end <= start) return 0;
  let total = 0;
  let cursor = new Date(start);

  for (let checkedDays = 0; checkedDays < 36600 && cursor < end; checkedDays += 1) {
    const parts = bangkokParts(cursor);
    const isBusinessDay = calendar.businessDays.has(parts.day)
      && !calendar.holidays.has(dateKey(parts.year, parts.month, parts.date));
    const dayStart = bangkokInstant(parts.year, parts.month, parts.date, calendar.startMinute);
    const dayEnd = bangkokInstant(parts.year, parts.month, parts.date, calendar.endMinute);

    if (isBusinessDay) {
      const segmentStart = new Date(Math.max(cursor.getTime(), dayStart.getTime()));
      const segmentEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
      if (segmentEnd > segmentStart) {
        total += Math.floor((segmentEnd.getTime() - segmentStart.getTime()) / 60000);
      }
    }
    cursor = bangkokInstant(parts.year, parts.month, parts.date + 1, calendar.startMinute);
  }
  return total;
}
