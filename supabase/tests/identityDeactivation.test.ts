import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ACTOR_ID = '00000000-0000-0000-0000-0000000000d1';
const TARGET_ID = '00000000-0000-0000-0000-0000000000d2';
const SYSTEM_ID = '00000000-0000-0000-0000-0000000000d3';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();

  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email)
       values ($1, 'deactivate-actor@test.local'), ($2, 'deactivate-target@test.local')`,
      [ACTOR_ID, TARGET_ID],
    );
    await db.query(
      `insert into public.access_systems (id, name, created_by)
       values ($1, 'Deactivation test system', $2)`,
      [SYSTEM_ID, ACTOR_ID],
    );
    await db.query(
      `insert into public.user_access_registry
        (user_id, system_id, access_level, status, created_by)
       values
        ($1, $2, 'Standard', 'active', $3),
        ($1, $2, 'Admin', 'revoked', $3)`,
      [TARGET_ID, SYSTEM_ID, ACTOR_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('deactivate_user_access()', () => {
  it('cannot be called directly by an authenticated browser session', async () => {
    await expect(
      asUser(db, ACTOR_ID, async () =>
        db.query(
          `select public.deactivate_user_access($1, $2, $3, $4, $5)`,
          [TARGET_ID, ACTOR_ID, 'actor@test.local', 'ทดสอบ', 'browser-attempt'],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('deactivates the profile, suspends only active grants and writes an atomic audit', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ result: { suspendedCount: number } }>(
        `select public.deactivate_user_access($1, $2, $3, $4, $5) as result`,
        [TARGET_ID, ACTOR_ID, 'actor@test.local', 'พ้นสภาพพนักงาน', 'deactivate-request'],
      ),
    );

    expect(result.rows[0].result).toEqual({ suspendedCount: 1 });

    await asServiceRole(db, async () => {
      const profile = await db.query<{ status: string }>(
        `select status from public.profiles where id = $1`,
        [TARGET_ID],
      );
      const grants = await db.query<{ status: string; notes: string | null }>(
        `select status, notes from public.user_access_registry where user_id = $1 order by access_level`,
        [TARGET_ID],
      );
      const audit = await db.query<{ detail: { suspendedCount: number } }>(
        `select detail from public.audit_logs where request_id = 'deactivate-request'`,
      );

      expect(profile.rows[0].status).toBe('inactive');
      expect(grants.rows).toEqual([
        { status: 'revoked', notes: null },
        { status: 'suspended', notes: 'พ้นสภาพ: พ้นสภาพพนักงาน' },
      ]);
      expect(audit.rows).toEqual([{ detail: { suspendedCount: 1 } }]);
    });
  });
});
