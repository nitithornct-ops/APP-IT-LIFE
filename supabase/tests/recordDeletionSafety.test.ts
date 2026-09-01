import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ACTOR_ID = '00000000-0000-0000-0000-0000000000e1';
const APPROVER_ID = '00000000-0000-0000-0000-0000000000e2';
const UNKNOWN_ACTOR_ID = '00000000-0000-0000-0000-0000000000ef';

const IDS = {
  incident: '10000000-0000-0000-0000-000000000001',
  notification: '10000000-0000-0000-0000-000000000002',
  change: '20000000-0000-0000-0000-000000000001',
  definition: '30000000-0000-0000-0000-000000000001',
  step: '30000000-0000-0000-0000-000000000002',
  instance: '30000000-0000-0000-0000-000000000003',
  approval: '30000000-0000-0000-0000-000000000004',
  backup: '40000000-0000-0000-0000-000000000001',
  recovery: '40000000-0000-0000-0000-000000000002',
  bcp: '40000000-0000-0000-0000-000000000003',
  loggingSystem: '40000000-0000-0000-0000-000000000004',
  logReview: '40000000-0000-0000-0000-000000000005',
  rollbackTarget: '50000000-0000-0000-0000-000000000001',
} as const;

let db: PGlite;

async function mutate(resource: string, id: string, requestId: string, actorId = ACTOR_ID) {
  return asServiceRole(db, async () => db.query<{ result: { id: string; resource: string; mode: string } }>(
    `select public.mutate_record_deletion($1, $2, $3, $4, $5, $6) as result`,
    [resource, id, actorId, 'archive-actor@test.local', 'หมดความจำเป็นในงานปัจจุบัน', requestId],
  ));
}

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email)
       values ($1, 'archive-actor@test.local'), ($2, 'archive-approver@test.local')`,
      [ACTOR_ID, APPROVER_ID],
    );
    await db.query(
      `insert into public.user_roles (user_id, role_id, assigned_by)
       select $1, id, $1 from public.roles where key = 'super_admin'`,
      [ACTOR_ID],
    );

    await db.query(
      `insert into public.incidents
       (id, incident_number, title, reported_by, category, description, created_by, updated_by)
       values ($1, 'INC-ARCHIVE-001', 'ทดสอบเก็บ Incident', $2, 'อื่นๆ', 'รายละเอียดสำหรับทดสอบ', $2, $2)`,
      [IDS.incident, ACTOR_ID],
    );
    await db.query(
      `insert into public.regulatory_notifications
       (id, incident_id, destination, agency, notification_type, required, status, created_by, updated_by)
       values ($1, $2, 'PDPC', 'สคส.', 'ทดสอบ', true, 'รอแจ้ง', $3, $3)`,
      [IDS.notification, IDS.incident, ACTOR_ID],
    );
    await db.query(
      `insert into public.change_requests
       (id, change_number, title, system_affected, description, requester_id, risk_level, created_by, updated_by)
       values ($1, 'CHG-ARCHIVE-001', 'ทดสอบเก็บ Change', 'ERP', 'รายละเอียดสำหรับทดสอบ', $2, 'ต่ำ', $2, $2)`,
      [IDS.change, ACTOR_ID],
    );

    await db.query(
      `insert into public.workflow_definitions
       (id, workflow_code, workflow_name, module_key, status, is_default, created_by, updated_by)
       values ($1, 'WF_ARCHIVE_001', 'แบบทดสอบ', 'change', 'ใช้งาน', true, $2, $2)`,
      [IDS.definition, ACTOR_ID],
    );
    await db.query(
      `insert into public.workflow_steps
       (id, definition_id, definition_version, step_order, step_code, step_name,
        approval_type, approver_value, mode, min_approvals, status, created_by, updated_by)
       values ($1, $2, 1, 1, 'APPROVE', 'อนุมัติ', 'USER', $3, 'ANY', 1, 'ใช้งาน', $4, $4)`,
      [IDS.step, IDS.definition, APPROVER_ID, ACTOR_ID],
    );
    await db.query(
      `insert into public.workflow_instances
       (id, instance_code, definition_id, definition_version, module_key, record_id,
        record_label, requester_id, current_step_order, status, created_by, updated_by)
       values ($1, 'WFI-ARCHIVE-001', $2, 1, 'change', $3, 'CHG-ARCHIVE-001', $4, 1,
        'กำลังดำเนินการ', $4, $4)`,
      [IDS.instance, IDS.definition, IDS.change, ACTOR_ID],
    );
    await db.query(
      `insert into public.workflow_approvals
       (id, instance_id, step_id, step_order, approver_id, original_approver_id,
        status, created_by, updated_by)
       values ($1, $2, $3, 1, $4, $4, 'รอพิจารณา', $5, $5)`,
      [IDS.approval, IDS.instance, IDS.step, APPROVER_ID, ACTOR_ID],
    );

    await db.query(
      `insert into public.backup_logs
       (id, backup_code, system_name, backup_type, backup_date, result, operator_id, checksum, created_by, updated_by)
       values ($1, 'BKP-ARCHIVE-001', 'ERP', 'Full', '2026-08-01', 'สำเร็จ', $2, 'sha256:test', $2, $2)`,
      [IDS.backup, ACTOR_ID],
    );
    await db.query(
      `insert into public.recovery_tests
       (id, recovery_code, backup_log_id, system_name, test_date, result, tester_id, created_by, updated_by)
       values ($1, 'RCV-ARCHIVE-001', $2, 'ERP', '2026-08-02', 'ผ่าน', $3, $3, $3)`,
      [IDS.recovery, IDS.backup, ACTOR_ID],
    );
    await db.query(
      `insert into public.bcp_plans
       (id, plan_code, plan_name, owner_id, status, created_by, updated_by)
       values ($1, 'BCP-ARCHIVE-001', 'ERP DR', $2, 'ใช้งาน', $2, $2)`,
      [IDS.bcp, ACTOR_ID],
    );
    await db.query(
      `insert into public.logging_systems
       (id, log_system_code, system_name, review_frequency, responsible_id, next_review_due, status, created_by, updated_by)
       values ($1, 'LOG-ARCHIVE-001', 'ERP SIEM', 'รายวัน', $2, '2026-09-01', 'ใช้งาน', $2, $2)`,
      [IDS.loggingSystem, ACTOR_ID],
    );
    await db.query(
      `insert into public.log_reviews
       (id, review_code, logging_system_id, review_date, reviewer_id, period, anomaly_found, status, created_by, updated_by)
       values ($1, 'LGR-ARCHIVE-001', $2, '2026-08-03', $3, 'Aug 2026', false, 'ปกติ', $3, $3)`,
      [IDS.logReview, IDS.loggingSystem, ACTOR_ID],
    );
    await db.query(
      `insert into public.access_systems (id, name, created_by)
       values ($1, 'Atomic rollback target', $2)`,
      [IDS.rollbackTarget, ACTOR_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('mutate_record_deletion()', () => {
  it('is unavailable to authenticated browser sessions, including a super admin', async () => {
    await expect(asUser(db, ACTOR_ID, async () => db.query(
      `select public.mutate_record_deletion('incidents', $1, $2, 'x@test.local', 'เหตุผลทดสอบ', 'browser')`,
      [IDS.incident, ACTOR_ID],
    ))).rejects.toThrow(/permission denied/i);
  });

  it('rejects a missing reason without changing the target or writing an audit', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `select public.mutate_record_deletion('incidents', $1, $2, 'x@test.local', '  ', 'invalid-reason')`,
      [IDS.incident, ACTOR_ID],
    ))).rejects.toThrow(/RECORD_DELETION_REASON_INVALID/);

    const state = await asServiceRole(db, async () => db.query<{ archived_at: string | null }>(
      `select archived_at from public.incidents where id = $1`, [IDS.incident],
    ));
    const audit = await asServiceRole(db, async () => db.query(
      `select id from public.audit_logs where request_id = 'invalid-reason'`,
    ));
    expect(state.rows[0].archived_at).toBeNull();
    expect(audit.rows).toHaveLength(0);
  });

  it('archives governed records, preserves evidence and commits one audit per mutation', async () => {
    const resources: Array<[string, string]> = [
      ['workflow-instances', IDS.instance],
      ['workflow-definitions', IDS.definition],
      ['incidents', IDS.incident],
      ['changes', IDS.change],
      ['backup-logs', IDS.backup],
      ['recovery-tests', IDS.recovery],
      ['bcp-plans', IDS.bcp],
      ['logging-systems', IDS.loggingSystem],
      ['log-reviews', IDS.logReview],
    ];

    for (const [resource, id] of resources) {
      const result = await mutate(resource, id, `archive-${resource}`);
      expect(result.rows[0].result).toMatchObject({ id, resource, mode: 'archive' });
    }

    await asServiceRole(db, async () => {
      for (const [table, id] of [
        ['incidents', IDS.incident], ['change_requests', IDS.change],
        ['workflow_definitions', IDS.definition], ['workflow_instances', IDS.instance],
        ['backup_logs', IDS.backup], ['recovery_tests', IDS.recovery], ['bcp_plans', IDS.bcp],
        ['logging_systems', IDS.loggingSystem], ['log_reviews', IDS.logReview],
      ]) {
        const row = await db.query<{ archived_at: string | null; archive_reason: string | null }>(
          `select archived_at, archive_reason from public.${table} where id = $1`, [id],
        );
        expect(row.rows, table).toHaveLength(1);
        expect(row.rows[0].archived_at, table).not.toBeNull();
        expect(row.rows[0].archive_reason, table).toBe('หมดความจำเป็นในงานปัจจุบัน');
      }

      const notification = await db.query(`select id from public.regulatory_notifications where id = $1`, [IDS.notification]);
      const recovery = await db.query<{ backup_log_id: string | null }>(`select backup_log_id from public.recovery_tests where id = $1`, [IDS.recovery]);
      const logReview = await db.query<{ logging_system_id: string }>(`select logging_system_id from public.log_reviews where id = $1`, [IDS.logReview]);
      const workflow = await db.query<{ status: string }>(`select status from public.workflow_instances where id = $1`, [IDS.instance]);
      const approval = await db.query<{ status: string }>(`select status from public.workflow_approvals where id = $1`, [IDS.approval]);
      const history = await db.query<{ action: string }>(`select action from public.workflow_history where instance_id = $1 and action = 'CANCEL_AND_ARCHIVE'`, [IDS.instance]);
      const definitions = await db.query<{ status: string; is_default: boolean }>(`select status, is_default from public.workflow_definitions where id = $1`, [IDS.definition]);
      const bcp = await db.query<{ status: string }>(`select status from public.bcp_plans where id = $1`, [IDS.bcp]);
      const logging = await db.query<{ status: string }>(`select status from public.logging_systems where id = $1`, [IDS.loggingSystem]);
      const audits = await db.query<{ detail: { mode: string; reason: string } }>(
        `select detail from public.audit_logs where request_id like 'archive-%' order by request_id`,
      );

      expect(notification.rows).toHaveLength(1);
      expect(recovery.rows[0].backup_log_id).toBe(IDS.backup);
      expect(logReview.rows[0].logging_system_id).toBe(IDS.loggingSystem);
      expect(workflow.rows[0].status).toBe('ยกเลิก');
      expect(approval.rows[0].status).toBe('ยกเลิก');
      expect(history.rows).toHaveLength(1);
      expect(definitions.rows[0]).toEqual({ status: 'ยกเลิก', is_default: false });
      expect(bcp.rows[0].status).toBe('ยกเลิก');
      expect(logging.rows[0].status).toBe('ระงับ');
      expect(audits.rows).toHaveLength(resources.length);
      expect(audits.rows.every((row) => row.detail.mode === 'archive' && Boolean(row.detail.reason))).toBe(true);
    });
  });

  it('rolls a hard delete back when the audit insert cannot commit', async () => {
    await expect(mutate('access-systems', IDS.rollbackTarget, 'forced-audit-failure', UNKNOWN_ACTOR_ID))
      .rejects.toThrow();

    const target = await asServiceRole(db, async () => db.query(
      `select id from public.access_systems where id = $1`, [IDS.rollbackTarget],
    ));
    const audit = await asServiceRole(db, async () => db.query(
      `select id from public.audit_logs where request_id = 'forced-audit-failure'`,
    ));
    expect(target.rows).toHaveLength(1);
    expect(audit.rows).toHaveLength(0);
  });

  it('denies direct browser DELETE even when the user has manage permissions', async () => {
    await expect(asUser(db, ACTOR_ID, async () => db.query(
      `delete from public.logging_systems where id = $1`, [IDS.loggingSystem],
    ))).rejects.toThrow(/permission denied/i);
    await expect(asUser(db, ACTOR_ID, async () => db.query(
      `delete from public.workflow_definitions where id = $1`, [IDS.definition],
    ))).rejects.toThrow(/permission denied/i);
  });
});
