import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000021';
const SUCCESS = '\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08';
const PASSED = '\u0e1c\u0e48\u0e32\u0e19';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [SUPER_ADMIN_ID, 'backup-p0@test.local']);
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = 'super_admin'`,
      [SUPER_ADMIN_ID],
    );
  });
});

afterAll(async () => {
  await db.close();
});

describe('Backup & Monitoring P0 migration', () => {
  it('captures checksum-addressable evidence for backup, recovery and DR writes', async () => {
    const ciId = '00000000-0000-0000-0000-000000000121';
    const importBatchId = '00000000-0000-0000-0000-000000000125';
    const backupId = '00000000-0000-0000-0000-000000000122';
    const recoveryId = '00000000-0000-0000-0000-000000000123';
    const bcpId = '00000000-0000-0000-0000-000000000124';

    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.configuration_items (id, ci_code, name, ci_type, environment, backup_required, backup_reference)
         values ($1, 'CI-BACKUP-P0', 'Backup P0 Test CI', 'Server', 'Production', true, 'Daily encrypted backup')`,
        [ciId],
      );
      await db.query(
        `insert into public.backup_import_batches (id, import_code, source_system, idempotency_key, total_count)
         values ($1, 'IMP-P0-001', 'P0 Test Runner', 'p0-test-batch-001', 1)`,
        [importBatchId],
      );
      await db.query(
        `insert into public.backup_policies (
           policy_code, configuration_item_id, expected_backup_policy,
           rto_target_hours, rpo_target_hours, backup_schedule,
           schedule_interval_minutes, storage_capacity_bytes, storage_used_bytes,
           owner_id, created_by, updated_by
         ) values ($1, $2, 'Daily encrypted backup', 4, 1, 'ทุกวัน', 1440, 1000000, 500000, $3, $3, $3)`,
        ['POL-BACKUP-P0', ciId, SUPER_ADMIN_ID],
      );
      await db.query(
        `insert into public.backup_logs (
           id, backup_code, system_name, configuration_item_id, backup_type, backup_date,
           result, operator_id, source_run_id, import_batch_id, backup_started_at, backup_completed_at,
           data_size_bytes, storage_used_bytes, storage_capacity_bytes,
           created_by, updated_by
         ) values ($1, 'BKP-P0-001', 'Backup P0 Test CI', $2, 'Full', current_date,
           $3, $4, 'source-run-p0-001', $5, now() - interval '10 minutes', now(),
           250000, 500000, 1000000, $4, $4)`,
        [backupId, ciId, SUCCESS, SUPER_ADMIN_ID, importBatchId],
      );
      await db.query(
        `insert into public.recovery_tests (
           id, recovery_code, backup_log_id, system_name, configuration_item_id,
           test_date, result, tester_id, restore_verified, restore_verified_at,
           restore_verification_notes, created_by, updated_by
         ) values ($1, 'REC-P0-001', $2, 'Backup P0 Test CI', $3, current_date,
           $4, $5, true, now(), 'Checksum and file hash verified', $5, $5)`,
        [recoveryId, backupId, ciId, PASSED, SUPER_ADMIN_ID],
      );
      await db.query(
        `insert into public.bcp_plans (
           id, plan_code, plan_name, owner_id, dr_exercise_schedule,
           last_dr_exercise_date, next_dr_exercise_due, dr_exercise_result,
           created_by, updated_by
         ) values ($1, 'BCP-P0-001', 'Backup P0 DR Plan', $2, 'รายปี',
           current_date - 30, current_date + 335, $3, $2, $2)`,
        [bcpId, SUPER_ADMIN_ID, PASSED],
      );
    });

    const snapshots = await db.query<{ source_table: string; source_record_id: string; checksum: string; import_batch_id: string | null }>(
      `select source_table, source_record_id, checksum, import_batch_id
       from public.backup_evidence_snapshots
       where source_record_id in ($1, $2, $3)
       order by source_table`,
      [backupId, recoveryId, bcpId],
    );

    expect(snapshots.rows).toHaveLength(3);
    expect(new Set(snapshots.rows.map((row) => row.source_table))).toEqual(
      new Set(['backup_logs', 'recovery_tests', 'bcp_plans']),
    );
    expect(snapshots.rows.find((row) => row.source_table === 'backup_logs')?.import_batch_id).toBe(importBatchId);
    expect(snapshots.rows.every((row) => row.checksum.length === 32)).toBe(true);
  });

  it('enforces source-run idempotency and protects generated evidence from browser writes', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into public.backup_logs (
             backup_code, system_name, backup_type, backup_date, result, operator_id, source_run_id
           ) values ('BKP-P0-DUP', 'Duplicate Test', 'Full', current_date, $1, $2, 'source-run-p0-001')`,
          [SUCCESS, SUPER_ADMIN_ID],
        ),
      ),
    ).rejects.toThrow();

    const visible = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query('select policy_code from public.backup_policies where policy_code = $1', ['POL-BACKUP-P0']),
    );
    expect(visible.rows).toHaveLength(1);

    await expect(
      asUser(db, SUPER_ADMIN_ID, async () =>
        db.query(
          `insert into public.backup_evidence_snapshots
             (snapshot_code, source_table, source_record_id, payload, checksum)
           values ('EVI-BROWSER-001', 'backup_logs', gen_random_uuid(), '{}'::jsonb, repeat('a', 32))`,
        ),
      ),
    ).rejects.toThrow();
  });
});
