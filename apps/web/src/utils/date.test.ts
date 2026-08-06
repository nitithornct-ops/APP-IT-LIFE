import { describe, expect, it } from 'vitest';
import { formatThaiDate, toBuddhistYear } from './date';

describe('toBuddhistYear', () => {
  it('adds 543 years to the Gregorian year', () => {
    expect(toBuddhistYear(2026)).toBe(2569);
  });
});

describe('formatThaiDate', () => {
  it('formats a date with the Thai month name and Buddhist year', () => {
    expect(formatThaiDate(new Date(2026, 7, 5))).toBe('5 สิงหาคม 2569');
  });

  it('substitutes a yyyy token in the pattern instead of appending a duplicate year', () => {
    const result = formatThaiDate(new Date(2026, 7, 6, 9, 6), 'd MMMM yyyy HH:mm');
    expect(result).toBe('6 สิงหาคม 2569 09:06');
    expect(result).not.toContain('2026');
  });
});
