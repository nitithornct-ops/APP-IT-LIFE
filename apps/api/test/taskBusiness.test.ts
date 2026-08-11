import { describe, expect, it } from 'vitest';
import { bangkokDateKey, buildTaskDashboard, calculateChecklistProgress, daysFromBangkokToday, nextRecurrenceDate, resolveRecurrenceRule, sortTodayTasks } from '../src/utils/taskBusiness';

const now = new Date('2026-08-10T17:30:00.000Z'); // 11 Aug 2026, 00:30 in Bangkok

function task(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ต้องทำ',
    due_date: '2026-08-11',
    due_time: null,
    priority: 'ปกติ',
    progress: 0,
    updated_at: '2026-08-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('Task dashboard business rules', () => {
  it('uses Asia/Bangkok when resolving today', () => {
    expect(bangkokDateKey(now)).toBe('2026-08-11');
    expect(daysFromBangkokToday('2026-08-10', now)).toBe(-1);
    expect(daysFromBangkokToday('2026-08-11', now)).toBe(0);
  });

  it('calculates summary, today and upcoming without terminal tasks', () => {
    const dashboard = buildTaskDashboard([
      task({ due_date: '2026-08-10', priority: 'สูง', progress: 25 }),
      task({ due_date: '2026-08-11', priority: 'เร่งด่วน', progress: 50 }),
      task({ due_date: '2026-08-18', progress: 75 }),
      task({ due_date: '2026-08-11', status: 'เสร็จแล้ว', progress: 100 }),
      task({ due_date: '2026-08-10', status: 'ยกเลิก', progress: 0 }),
    ], now);

    expect(dashboard.summary).toEqual({ open: 3, today: 1, dueSoon: 1, overdue: 1, completed: 1, inProgress: 0, averageProgress: 50 });
    expect(dashboard.todayItems).toHaveLength(2);
    expect(dashboard.upcoming).toHaveLength(2);
  });

  it('sorts overdue first, then priority and time', () => {
    const sorted = sortTodayTasks([
      task({ due_date: '2026-08-11', priority: 'ต่ำ', due_time: '09:00', updated_at: '2026-08-10T09:00:00Z' }),
      task({ due_date: '2026-08-11', priority: 'เร่งด่วน', due_time: '15:00', updated_at: '2026-08-10T10:00:00Z' }),
      task({ due_date: '2026-08-10', priority: 'ต่ำ', due_time: '16:00', updated_at: '2026-08-10T11:00:00Z' }),
    ], now);
    expect(sorted.map((item) => `${item.due_date}-${item.priority}`)).toEqual([
      '2026-08-10-ต่ำ',
      '2026-08-11-เร่งด่วน',
      '2026-08-11-ต่ำ',
    ]);
  });
});

describe('Checklist progress', () => {
  it('returns null without checklist items and rounds completed ratio', () => {
    expect(calculateChecklistProgress([])).toBeNull();
    expect(calculateChecklistProgress(['เสร็จแล้ว', 'เสร็จแล้ว', 'ต้องทำ'])).toBe(67);
    expect(calculateChecklistProgress(['เสร็จแล้ว', 'เสร็จแล้ว'])).toBe(100);
  });
});

describe('Recurring task dates', () => {
  it('supports workdays and multi-period presets', () => {
    expect(nextRecurrenceDate('2026-08-14', resolveRecurrenceRule('วันทำงาน', null, '2026-08-14'))).toBe('2026-08-17');
    expect(nextRecurrenceDate('2026-08-11', resolveRecurrenceRule('ทุก 2 สัปดาห์', null, '2026-08-11'))).toBe('2026-08-25');
    expect(nextRecurrenceDate('2026-08-11', resolveRecurrenceRule('ทุก 6 เดือน', null, '2026-08-11'))).toBe('2027-02-11');
  });

  it('keeps the intended month day when a shorter month clamps an occurrence', () => {
    const rule = resolveRecurrenceRule('รายเดือน', null, '2026-01-31');
    expect(nextRecurrenceDate('2026-01-31', rule)).toBe('2026-02-28');
    expect(nextRecurrenceDate('2026-02-28', rule)).toBe('2026-03-31');
  });

  it('supports custom intervals without generating an unlimited series', () => {
    const rule = resolveRecurrenceRule('กำหนดเอง', { frequency: 'monthly', interval: 2 }, '2026-08-15');
    expect(nextRecurrenceDate('2026-08-15', rule)).toBe('2026-10-15');
  });
});
