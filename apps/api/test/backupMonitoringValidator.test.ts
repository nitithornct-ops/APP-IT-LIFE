import { describe, expect, it } from 'vitest';
import { createBackupImportSchema, createBackupPolicySchema, createBackupSchema, createBcpSchema, createLogReviewSchema, createRecoverySchema } from '../src/validators/backupMonitoring';

describe('backup and monitoring validators', () => {
  it('accepts a valid backup and rejects an earlier next due date', () => {
    expect(createBackupSchema.safeParse({ systemName: 'ERP', backupType: 'Full', backupDate: '2026-08-10', result: 'สำเร็จ', nextBackupDue: '2026-08-11' }).success).toBe(true);
    expect(createBackupSchema.safeParse({ systemName: 'ERP', backupType: 'Full', backupDate: '2026-08-10', result: 'สำเร็จ', nextBackupDue: '2026-08-09' }).success).toBe(false);
  });

  it('requires HTTPS evidence', () => {
    expect(createRecoverySchema.safeParse({ systemName: 'ERP', testDate: '2026-08-10', result: 'ผ่าน', evidenceLink: 'http://example.com' }).success).toBe(false);
  });

  it('validates BCP review dates', () => {
    expect(createBcpSchema.safeParse({ planName: 'DR Plan', status: 'ใช้งาน', lastReviewDate: '2026-08-10', nextReviewDue: '2026-08-09' }).success).toBe(false);
  });

  it('requires anomaly detail and a non-normal status', () => {
    const base = { loggingSystemId: '4c81d775-3f63-4127-ae0f-62e7c88cbd5d', reviewDate: '2026-08-10', period: 'August', anomalyFound: true, status: 'กำลังดำเนินการ' };
    expect(createLogReviewSchema.safeParse(base).success).toBe(false);
    expect(createLogReviewSchema.safeParse({ ...base, anomalyDetail: 'Repeated failed login' }).success).toBe(true);
    expect(createLogReviewSchema.safeParse({ ...base, anomalyDetail: 'x', status: 'ปกติ' }).success).toBe(false);
  });

  it('validates per-CI policy targets and storage capacity', () => {
    const base = { configurationItemId: '4c81d775-3f63-4127-ae0f-62e7c88cbd5d', expectedBackupPolicy: 'Full ทุกคืน', backupSchedule: 'ทุกวัน', scheduleIntervalMinutes: 1440, status: 'active' };
    expect(createBackupPolicySchema.safeParse({ ...base, storageCapacityBytes: 100, storageUsedBytes: 101 }).success).toBe(false);
    expect(createBackupPolicySchema.safeParse({ ...base, rtoTargetHours: 4, rpoTargetHours: 1, storageCapacityBytes: 100, storageUsedBytes: 80 }).success).toBe(true);
  });

  it('accepts idempotent import batches with a source run id', () => {
    expect(createBackupImportSchema.safeParse({ sourceSystem: 'Veeam', idempotencyKey: 'veeam:2026-08-10', items: [{ sourceRunId: 'run-1', ciCode: 'CI-ERP', result: 'ล้มเหลว' }] }).success).toBe(true);
    expect(createBackupImportSchema.safeParse({ sourceSystem: 'Veeam', idempotencyKey: 'batch', items: [] }).success).toBe(false);
  });
});
