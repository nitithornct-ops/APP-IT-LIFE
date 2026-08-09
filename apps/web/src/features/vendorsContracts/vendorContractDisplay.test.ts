import { describe, expect, it } from 'vitest';
import { contractStatusTone, daysUntilDate, effectiveContractState, profileName, vendorStatusTone } from './vendorContractDisplay';

describe('Vendor/Contract display helpers', () => {
  it('covers every lifecycle status with a badge tone', () => {
    expect(Object.keys(vendorStatusTone)).toEqual(['Active', 'Inactive']);
    expect(Object.keys(contractStatusTone)).toEqual(['Draft', 'Active', 'Expired', 'Terminated', 'Renewed']);
  });

  it('calculates expiry against UTC calendar dates without timezone drift', () => {
    const now = new Date('2026-08-09T18:30:00+07:00');
    expect(daysUntilDate('2026-08-10', now)).toBe(1);
    expect(daysUntilDate('2026-08-08', now)).toBe(-1);
    expect(effectiveContractState({ status: 'Active', end_date: '2026-08-20' }, now)).toBe('expiring');
    expect(effectiveContractState({ status: 'Active', end_date: '2026-08-01' }, now)).toBe('expired');
  });

  it('formats owner names with safe fallbacks', () => {
    expect(profileName({ id: '1', full_name: 'เจ้าของสัญญา', email: 'owner@example.com' })).toBe('เจ้าของสัญญา');
    expect(profileName({ id: '1', full_name: null, email: 'owner@example.com' })).toBe('owner@example.com');
    expect(profileName(null)).toBe('—');
  });
});
