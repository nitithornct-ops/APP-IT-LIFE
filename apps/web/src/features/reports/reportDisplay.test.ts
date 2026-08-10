import { describe, expect, it } from 'vitest';
import { breakdownWidth, reportCell, reportSearchText } from './reportDisplay';

describe('report display helpers', () => {
  it('formats empty values and booleans for Thai reports', () => {
    expect(reportCell(null)).toBe('—');
    expect(reportCell(true)).toBe('ใช่');
    expect(reportCell(false)).toBe('ไม่ใช่');
  });

  it('normalizes breakdown bars against the largest value', () => {
    const items = [{ label: 'A', value: 2 }, { label: 'B', value: 10 }];
    expect(breakdownWidth(items[0], items)).toBe(20);
    expect(breakdownWidth(items[1], items)).toBe(100);
  });

  it('builds a case-insensitive row search string', () => {
    expect(reportSearchText({ code: 'INC-001', owner: 'Somchai', closed: false })).toContain('somchai');
  });
});
