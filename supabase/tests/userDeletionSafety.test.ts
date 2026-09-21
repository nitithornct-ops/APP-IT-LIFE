import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ACTOR_ID = '00000000-0000-0000-0000-0000000000f1';
const ACTIVE_ID = '00000000-0000-0000-0000-0000000000f2';
const DELETABLE_ID = '00000000-0000-0000-0000-0000000000f3';
const BLOCKED_ID = '00000000-0000-0000-0000-0000000000f4';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email)
       values
         ($1, 'user-delete-actor@test.local'),
         ($2, 'user-delete-active@test.local'),
         ($3, 'user-delete-safe@test.local'),
         ($4, 'user-delete-blocked@test.local')`,
      [ACTOR_ID, ACTIVE_ID, DELETABLE_ID, BLOCKED_ID],
    );
    await db.query(`update public.profiles set status = 'inactive' where id in ($1, $2)`, [DELETABLE_ID, BLOCKED_ID]);
    await db.query(
      `insert into public.notifications (recipient_id, type, title)
       values ($1, 'security', 'Deletion safety test')`,
      [BLOCKED_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('assert_user_deletion_safe()', () => {
  it('rejects active accounts before any destructive operation', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `select public.assert_user_deletion_safe($1)`,
      [ACTIVE_ID],
    ))).rejects.toThrow(/USER_MUST_BE_INACTIVE/);
  });

  it('rejects accounts that would cascade or violate a business-record foreign key', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `select public.assert_user_deletion_safe($1)`,
      [BLOCKED_ID],
    ))).rejects.toThrow(/USER_HAS_DEPENDENCIES/);
  });

  it('allows an inactive account with no dependent business records', async () => {
    const result = await asServiceRole(db, async () => db.query<{ assert_user_deletion_safe: { safe: boolean } }>(
      `select public.assert_user_deletion_safe($1)`,
      [DELETABLE_ID],
    ));
    expect(result.rows[0].assert_user_deletion_safe).toEqual({ safe: true });
  });

  it('is unavailable to authenticated browser sessions', async () => {
    await expect(asUser(db, ACTOR_ID, async () => db.query(
      `select public.assert_user_deletion_safe($1)`,
      [DELETABLE_ID],
    ))).rejects.toThrow(/permission denied/i);
  });
});
