import { describe, expect, it } from 'vitest';
import { diffRows, sanitizeAuditData } from '../src/services/auditService';

/**
 * Audit log เคยเก็บเพียง payload ที่ผู้ใช้ส่งมา ซึ่งตอบคำถามของผู้ตรวจสอบไม่ได้ว่า "ค่าเดิมคืออะไร"
 * และถ้าผู้ใช้ส่งค่าเดิมกลับมาก็ยังถูกบันทึกราวกับมีการแก้ไขจริง
 * (พบตอน Pre-production QA audit 2026-08-13)
 */
describe('diffRows', () => {
  it('records the old and the new value of every field that actually changed', () => {
    const changes = diffRows(
      { id: 'a1', status: 'active', full_name: 'สมชาย ใจดี', phone: '0800000001' },
      { id: 'a1', status: 'inactive', full_name: 'สมชาย ใจดี', phone: '0899999999' },
    );
    expect(changes).toEqual({
      status: { from: 'active', to: 'inactive' },
      phone: { from: '0800000001', to: '0899999999' },
    });
  });

  it('records nothing when the submitted values match what was already stored', () => {
    const row = { id: 'a1', status: 'active', full_name: 'สมชาย ใจดี' };
    expect(diffRows(row, { ...row })).toEqual({});
  });

  it('ignores bookkeeping columns that change on every write', () => {
    const changes = diffRows(
      { id: 'a1', title: 'เดิม', updated_at: '2026-08-01T00:00:00Z', updated_by: 'u1' },
      { id: 'a1', title: 'ใหม่', updated_at: '2026-08-13T00:00:00Z', updated_by: 'u2' },
    );
    expect(changes).toEqual({ title: { from: 'เดิม', to: 'ใหม่' } });
  });

  it('treats null and undefined as the same absence of a value', () => {
    expect(diffRows({ note: null }, { note: undefined })).toEqual({});
    expect(diffRows({ note: undefined }, { note: null })).toEqual({});
  });

  it('reports a value being cleared and a value being filled in', () => {
    expect(diffRows({ note: 'มีข้อความ' }, { note: null })).toEqual({ note: { from: 'มีข้อความ', to: null } });
    expect(diffRows({ note: null }, { note: 'ข้อความใหม่' })).toEqual({ note: { from: null, to: 'ข้อความใหม่' } });
  });

  it('compares nested objects and arrays by content, not by reference', () => {
    expect(diffRows({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual({});
    expect(diffRows({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual({ tags: { from: ['a'], to: ['a', 'b'] } });
  });

  it('reports a field that only exists on one side', () => {
    expect(diffRows({ id: 'a1' }, { id: 'a1', newColumn: 'x' })).toEqual({ newColumn: { from: null, to: 'x' } });
  });

  it('returns nothing when a snapshot could not be read, instead of inventing a diff', () => {
    expect(diffRows(null, { status: 'active' })).toEqual({});
    expect(diffRows({ status: 'active' }, null)).toEqual({});
    expect(diffRows(undefined, undefined)).toEqual({});
  });

  it('ignores values that are not row objects', () => {
    expect(diffRows('not a row', { a: 1 })).toEqual({});
    expect(diffRows([{ a: 1 }], { a: 1 })).toEqual({});
  });
});

describe('sanitizeAuditData', () => {
  it('redacts credentials, PII and free-text fields recursively', () => {
    expect(sanitizeAuditData({
      status: 'active',
      email: 'person@example.com',
      detail: { phone: '0812345678', accessToken: 'secret', priority: 'HIGH' },
      notes: 'may contain personal information',
    })).toEqual({
      status: 'active',
      email: '[REDACTED]',
      detail: { phone: '[REDACTED]', accessToken: '[REDACTED]', priority: 'HIGH' },
      notes: '[REDACTED]',
    });
  });

  it('bounds long values and arrays', () => {
    const result = sanitizeAuditData({ title: 'x'.repeat(600), values: Array.from({ length: 30 }, (_, index) => index) });
    expect(String(result?.title).length).toBe(501);
    expect(result?.values).toHaveLength(20);
  });
});
