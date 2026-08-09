import { describe, expect, it } from 'vitest';
import { daysUntilLicenseExpiry, licenseHealth, remainingSeats, utilizationPercent } from './licenseDisplay';

const now = new Date('2026-08-09T12:00:00Z');

describe('license display helpers', () => {
  it('classifies expiry health consistently', () => {
    expect(licenseHealth({ status: 'Active', expire_date: '2026-08-19' }, now)).toBe('expiring');
    expect(licenseHealth({ status: 'Active', expire_date: '2026-08-08' }, now)).toBe('expired');
    expect(licenseHealth({ status: 'Active', expire_date: null }, now)).toBe('unlimited');
    expect(licenseHealth({ status: 'Inactive', expire_date: '2026-08-19' }, now)).toBe('inactive');
  });

  it('calculates whole-day distance in UTC', () => {
    expect(daysUntilLicenseExpiry('2026-08-09', now)).toBe(0);
    expect(daysUntilLicenseExpiry('2026-08-10', now)).toBe(1);
    expect(daysUntilLicenseExpiry(null, now)).toBeNull();
  });

  it('calculates utilization and remaining seats safely', () => {
    expect(utilizationPercent(9, 10)).toBe(90);
    expect(utilizationPercent(4, 0)).toBe(0);
    expect(utilizationPercent(12, 10)).toBe(100);
    expect(remainingSeats(7, 10)).toBe(3);
    expect(remainingSeats(12, 10)).toBe(0);
  });
});
