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
});
