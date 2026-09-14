import { describe, expect, it } from 'vitest';
import { buildBackupMonitoringDashboard, buildBackupPolicyStatus } from '../src/services/backupMonitoringService';

const policy = {
  id: 'policy-erp',
  configuration_item_id: 'ci-erp',
  expected_backup_policy: 'Full ทุกคืน',
  rto_target_hours: 4,
  rpo_target_hours: 1,
  backup_schedule: 'ทุกวัน',
  schedule_interval_minutes: 1440,
  storage_capacity_bytes: 1000,
  storage_used_bytes: 800,
  storage_alert_threshold_percent: 80,
  restore_verification_required: true,
  alerts_enabled: true,
  missed_backup_alert: true,
  failure_alert: true,
  auto_create_incident: true,
  owner_id: null,
  status: 'active' as const,
  configuration_item: { id: 'ci-erp', ci_code: 'CI-ERP', name: 'ERP' },
};

describe('backup monitoring automation metrics', () => {
  it('derives Backup Age, last success and missed state from policy schedule', () => {
    const result = buildBackupPolicyStatus(policy, [{
      id: 'log-1', system_name: 'ERP', configuration_item_id: 'ci-erp', result: 'สำเร็จ', backup_date: '2026-09-10', backup_completed_at: '2026-09-10T23:00:00Z',
    }], [], new Date('2026-09-12T00:00:00Z'));

    expect(result.last_successful_backup_at).toBe('2026-09-10T23:00:00.000Z');
    expect(result.backup_age_hours).toBe(25);
    expect(result.backup_missed).toBe(true);
    expect(result.storage_usage_percent).toBe(80);
    expect(result.restore_verification_status).toBe('due');
  });

  it('builds the audit-friendly dashboard labels and affected-system lists', () => {
    const result = buildBackupMonitoringDashboard({
      policies: [policy],
      backups: [
        { id: 'log-ok', system_name: 'ERP', configuration_item_id: 'ci-erp', result: 'สำเร็จ', backup_date: '2026-09-11' },
        { id: 'log-fail', system_name: 'ERP', configuration_item_id: 'ci-erp', result: 'ล้มเหลว', backup_date: '2026-09-12' },
      ],
      recoveries: [],
      bcpPlans: [],
      openAlertCount: 1,
    }, new Date('2026-09-12T12:00:00Z'));

    expect(result.dashboard.success_label).toBe('0/1');
    expect(result.dashboard.failure_items).toEqual([{ system_name: 'ERP', count: 1, latest_date: '2026-09-12', result: 'ล้มเหลว' }]);
    expect(result.dashboard.recovery_due_items[0]).toMatchObject({ system_name: 'ERP', reason: 'ยังไม่มี Recovery Test' });
    expect(result.dashboard.open_alert_count).toBe(1);
  });
});
