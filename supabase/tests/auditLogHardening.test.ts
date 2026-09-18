import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, createTestDb } from './testDb';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

describe('audit log hardening', () => {
  it('creates an alert, blocks mutation, and archives without deleting source evidence', async () => {
    const auditId = '00000000-0000-0000-0000-000000000901';
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.audit_logs (
           id, actor_email, action, module, result, request_id, correlation_id,
           event_category, privileged_action, entry_hash, hash_algorithm, created_at
         ) values ($1, 'auditor@test.local', 'EXPORT_EVIDENCE_PACKAGE', 'audit', 'success',
           'req-hardening-1', 'corr-hardening-1', 'export', true, 'hash-1', 'sha256', now() - interval '2 days')`,
        [auditId],
      );
    });

    const alert = await db.query<{ alert_type: string; event_count: number }>(
      `select alert_type, event_count from public.audit_activity_alerts where last_event_id = $1`,
      [auditId],
    );
    expect(alert.rows).toEqual([{ alert_type: 'PRIVILEGED_ACTION', event_count: 1 }]);

    await expect(asServiceRole(db, async () => db.query(`update public.audit_logs set action = 'TAMPERED' where id = $1`, [auditId]))).rejects.toThrow('AUDIT_LOG_IMMUTABLE');

    await asServiceRole(db, async () => {
      const result = await db.query<{ audit_archived: number; login_archived: number }>(
        `select * from public.archive_audit_history(now() - interval '1 day')`,
      );
      expect(result.rows[0]?.audit_archived).toBe(1);
    });

    const source = await db.query(`select id from public.audit_logs where id = $1`, [auditId]);
    const archive = await db.query(`select source_id, payload->>'request_id' as request_id from public.audit_log_archive where source_id = $1`, [auditId]);
    expect(source.rows).toHaveLength(1);
    expect(archive.rows).toEqual([{ source_id: auditId, request_id: 'req-hardening-1' }]);
  });

  it('keeps actor identity in immutable evidence when the profile is deleted', async () => {
    const profileId = '00000000-0000-0000-0000-000000000902';
    await asServiceRole(db, async () => {
      await db.query(`insert into auth.users (id, email) values ($1, 'deleted-actor@test.local')`, [profileId]);
      await db.query(
        `insert into public.audit_logs (actor_id, actor_email, action, module, result)
         values ($1, 'deleted-actor@test.local', 'TEST_DELETE_PROFILE', 'audit', 'success')`,
        [profileId],
      );
      await db.query(
        `insert into public.login_logs (user_id, email_attempted, success)
         values ($1, 'deleted-actor@test.local', true)`,
        [profileId],
      );
      await db.query(`delete from public.profiles where id = $1`, [profileId]);
    });

    const evidence = await db.query<{ actor_id: string; user_id: string }>(
      `select a.actor_id, l.user_id
       from public.audit_logs a
       cross join public.login_logs l
       where a.action = 'TEST_DELETE_PROFILE'
         and l.email_attempted = 'deleted-actor@test.local'`,
    );
    expect(evidence.rows).toEqual([{ actor_id: profileId, user_id: profileId }]);
  });
});
