import { describe, expect, it } from 'vitest';
import { changeRiskTone, changeStatusTone, profileName } from './changeDisplay';

describe('Change display mappings', () => {
  it('maps every workflow status to a badge tone', () => {
    expect(Object.keys(changeStatusTone)).toEqual(['ยื่นคำขอ', 'ผ่านการทดสอบ', 'อนุมัติแล้ว', 'ติดตั้งใช้งานแล้ว', 'ปฏิเสธ']);
    expect(changeStatusTone['ติดตั้งใช้งานแล้ว']).toBe('success');
    expect(changeStatusTone.ปฏิเสธ).toBe('danger');
  });

  it('maps risk levels and formats profile fallback names', () => {
    expect(changeRiskTone.สูง).toBe('danger');
    expect(profileName({ id: '1', full_name: 'ผู้ทดสอบ', email: 'test@example.com' })).toBe('ผู้ทดสอบ');
    expect(profileName({ id: '1', full_name: null, email: 'test@example.com' })).toBe('test@example.com');
    expect(profileName(undefined)).toBe('—');
  });
});
