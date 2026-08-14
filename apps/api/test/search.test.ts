import { describe, expect, it } from 'vitest';
import { cleanSearch } from '../src/utils/search';

/**
 * ตัวกรอง `.or()` ของ PostgREST ถูกประกอบเป็นสตริง อักขระที่เป็นไวยากรณ์ของตัวมันเอง (จุลภาค วงเล็บ)
 * และไวลด์การ์ดของ SQL LIKE (% _ \) จึงต้องถูกทำให้เป็นกลางก่อนเสมอ
 * เคสจริงที่พบตอน audit: ผู้ใช้พิมพ์ชื่อที่มีจุลภาค แล้วได้ HTTP 400 แทนผลการค้นหา
 */
describe('cleanSearch', () => {
  it('keeps ordinary Thai and English text untouched', () => {
    expect(cleanSearch('เครื่องพิมพ์ HP LaserJet')).toBe('เครื่องพิมพ์ HP LaserJet');
    expect(cleanSearch('NB-001')).toBe('NB-001');
  });

  it('neutralises the comma that used to turn a search into HTTP 400', () => {
    expect(cleanSearch('สมชาย, สมหญิง')).toBe('สมชาย สมหญิง');
  });

  it('neutralises parentheses used for grouping in an or() expression', () => {
    expect(cleanSearch('สำนักงาน (ชั้น 3)')).toBe('สำนักงาน ชั้น 3');
  });

  it('neutralises SQL LIKE wildcards so a search stays literal', () => {
    expect(cleanSearch('100%')).toBe('100');
    expect(cleanSearch('a_b')).toBe('a b');
    expect(cleanSearch('back\\slash')).toBe('back slash');
  });

  it('neutralises double quotes that PostgREST treats as value quoting', () => {
    expect(cleanSearch('เครื่อง "หลัก"')).toBe('เครื่อง หลัก');
  });

  it('collapses the whitespace it introduces instead of gluing words together', () => {
    expect(cleanSearch('ก,,,ข')).toBe('ก ข');
    expect(cleanSearch('  ค   ง  ')).toBe('ค ง');
  });

  it('returns an empty string when nothing searchable is left, so callers can skip the filter', () => {
    expect(cleanSearch('%%%')).toBe('');
    expect(cleanSearch('   ')).toBe('');
    expect(cleanSearch(',()')).toBe('');
  });

  it('leaves dots alone because they are valid inside a PostgREST filter value', () => {
    expect(cleanSearch('192.168.1.1')).toBe('192.168.1.1');
    expect(cleanSearch('name@company.co.th')).toBe('name@company.co.th');
  });
});
