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
  it('retains dependent records when Auth soft-deletes an inactive account', async () => {
    await asServiceRole(db, async () => {
      const ticket = await db.query<{ id: string }>(
        "insert into public.tickets(title, requester_id, description) values ('Preserved history', $1, 'Deletion regression') returning id", [BLOCKED_ID],
      );
      await db.query('update auth.users set deleted_at = now() where id = $1', [BLOCKED_ID]);
      const profile = await db.query<{ status: string; account_deleted_at: string | null }>(
        'select status, account_deleted_at from public.profiles where id = $1', [BLOCKED_ID],
      );
      expect(profile.rows[0].status).toBe('inactive');
      expect(profile.rows[0].account_deleted_at).not.toBeNull();
      const records = await db.query<{ count: number }>(
        'select count(*)::integer as count from public.notifications where recipient_id = $1', [BLOCKED_ID],
      );
      expect(records.rows[0].count).toBe(1);
      expect((await db.query('select id from public.tickets where id = $1', [ticket.rows[0].id])).rows).toHaveLength(1);
      await expect(db.query("update public.profiles set status = 'active' where id = $1", [BLOCKED_ID])).rejects.toThrow(/USER_ACCOUNT_DELETED/);
      await expect(db.query('update public.profiles set account_deleted_at = null where id = $1', [BLOCKED_ID])).rejects.toThrow(/USER_ACCOUNT_DELETED/);
    });
  });

  it('rolls back Auth soft deletion of an active account', async () => {
    await asServiceRole(db, async () => {
      await expect(db.query('update auth.users set deleted_at = now() where id = $1', [ACTIVE_ID])).rejects.toThrow(/USER_MUST_BE_INACTIVE/);
      const result = await db.query<{ deleted_at: string | null }>('select deleted_at from auth.users where id = $1', [ACTIVE_ID]);
      expect(result.rows[0].deleted_at).toBeNull();
    });
  });

  it('does not let history-preserving deletion bypass the last-super-admin guard', async () => {
    const lastAdminId = '00000000-0000-0000-0000-0000000000f5';
    await asServiceRole(db, async () => {
      await db.query("insert into auth.users(id, email) values ($1, 'last-admin-delete@test.local')", [lastAdminId]);
      await db.query("update public.profiles set status = 'inactive' where id = $1", [lastAdminId]);
      await db.query("insert into public.user_roles(user_id, role_id) select $1, id from public.roles where key = 'super_admin'", [lastAdminId]);
      await expect(db.query('update auth.users set deleted_at = now() where id = $1', [lastAdminId])).rejects.toThrow(/LAST_SUPER_ADMIN/);
      expect((await db.query<{ deleted_at: string | null }>('select deleted_at from auth.users where id = $1', [lastAdminId])).rows[0].deleted_at).toBeNull();
    });
  });

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
