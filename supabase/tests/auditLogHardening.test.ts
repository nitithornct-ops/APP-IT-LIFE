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
});
