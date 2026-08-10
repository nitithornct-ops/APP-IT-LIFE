import { describe, expect, it } from 'vitest';
import { backupSuccessPercent, daysUntilOperationsDue, isOperationsOverdue, openAnomalyCount } from './backupMonitoringDisplay';

describe('backupMonitoringDisplay', () => {
  it('calculates due days and overdue state', () => {
    const now = new Date(2026, 7, 10, 12);
    expect(daysUntilOperationsDue('2026-08-12', now)).toBe(2);
    expect(isOperationsOverdue('2026-08-09', now)).toBe(true);
  });

  it('calculates successful backup percentage', () => {
    expect(backupSuccessPercent([{ result: 'สำเร็จ' }, { result: 'ล้มเหลว' }])).toBe(50);
    expect(backupSuccessPercent([])).toBe(0);
  });

  it('counts only unresolved anomalies', () => {
    expect(openAnomalyCount([
      { anomaly_found: true, status: 'กำลังดำเนินการ' },
      { anomaly_found: true, status: 'แก้ไขแล้ว' },
      { anomaly_found: false, status: 'ปกติ' },
    ])).toBe(1);
  });
});
