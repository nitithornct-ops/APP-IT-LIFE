import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

const USER_A_ID = '00000000-0000-0000-0000-0000000000a1';
const USER_B_ID = '00000000-0000-0000-0000-0000000000a2';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();

  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
      USER_A_ID,
      'user-a@test.local',
      USER_B_ID,
      'user-b@test.local',
    ]);
  });
});

afterAll(async () => {
  await db.close();
});

describe('notifications RLS', () => {
  it('lets a user see only notifications addressed to them', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.notifications (recipient_id, type, title) values ($1, 'role_changed', 'แจ้งเตือน A')`,
        [USER_A_ID],
      );
      await db.query(
        `insert into public.notifications (recipient_id, type, title) values ($1, 'role_changed', 'แจ้งเตือน B')`,
        [USER_B_ID],
      );
    });

    const resultA = await asUser(db, USER_A_ID, async () => db.query('select title from public.notifications'));
    expect(resultA.rows).toEqual([{ title: 'แจ้งเตือน A' }]);

    const resultB = await asUser(db, USER_B_ID, async () => db.query('select title from public.notifications'));
    expect(resultB.rows).toEqual([{ title: 'แจ้งเตือน B' }]);
  });

  it('rejects a direct insert from an authenticated user (backend-only via service_role)', async () => {
    await expect(
      asUser(db, USER_A_ID, async () =>
        db.query(`insert into public.notifications (recipient_id, type, title) values ($1, 'x', 'y')`, [USER_A_ID]),
      ),
    ).rejects.toThrow();
  });

  it('lets a user mark their own notification as read but not someone else’s', async () => {
    const own = await asServiceRole(db, async () =>
      db.query(
        `insert into public.notifications (recipient_id, type, title) values ($1, 'x', 'own') returning id`,
        [USER_A_ID],
      ),
    );
    const ownId = (own.rows[0] as { id: string }).id;

    await asUser(db, USER_A_ID, async () =>
      db.query(`update public.notifications set is_read = true, read_at = now() where id = $1`, [ownId]),
    );
    const updated = await asServiceRole(db, async () =>
      db.query('select is_read from public.notifications where id = $1', [ownId]),
    );
    expect((updated.rows[0] as { is_read: boolean }).is_read).toBe(true);

    const other = await asServiceRole(db, async () =>
      db.query(
        `insert into public.notifications (recipient_id, type, title) values ($1, 'x', 'other') returning id`,
        [USER_B_ID],
      ),
    );
    const otherId = (other.rows[0] as { id: string }).id;

    const attempt = await asUser(db, USER_A_ID, async () =>
      db.query(`update public.notifications set is_read = true where id = $1`, [otherId]),
    );
    expect(attempt.affectedRows ?? 0).toBe(0);
  });

  it('returns no rows for an unauthenticated (anon) request', async () => {
    const result = await asAnon(db, async () => db.query('select id from public.notifications'));
    expect(result.rows).toHaveLength(0);
  });
});

describe('storage.objects RLS (attachments bucket)', () => {
  it('blocks all browser-direct object writes, including the caller own folder', async () => {
    await expect(
      asUser(db, USER_A_ID, async () =>
        db.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [
          `${USER_A_ID}/report.pdf`,
          USER_A_ID,
        ]),
      ),
    ).rejects.toThrow(/row-level security|policy/i);

    await expect(
      asUser(db, USER_A_ID, async () =>
        db.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [
          `${USER_B_ID}/report.pdf`,
          USER_A_ID,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('keeps storage paths private from browser sessions after API-only hardening', async () => {
    await asServiceRole(db, async () => {
      await db.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [
        `${USER_A_ID}/own.pdf`,
        USER_A_ID,
      ]);
      await db.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [
        `${USER_B_ID}/secret.pdf`,
        USER_B_ID,
      ]);
    });

    const result = await asUser(db, USER_A_ID, async () =>
      db.query("select name from storage.objects where bucket_id = 'attachments'"),
    );
    expect(result.rows).toHaveLength(0);
  });
});

describe('file_attachments RLS', () => {
  it('lets a user see only file_attachments rows they uploaded', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.file_attachments (storage_path, original_filename, mime_type, size_bytes, uploaded_by)
         values ($1, 'a.pdf', 'application/pdf', 100, $2)`,
        [`${USER_A_ID}/a.pdf`, USER_A_ID],
      );
      await db.query(
        `insert into public.file_attachments (storage_path, original_filename, mime_type, size_bytes, uploaded_by)
         values ($1, 'b.pdf', 'application/pdf', 100, $2)`,
        [`${USER_B_ID}/b.pdf`, USER_B_ID],
      );
    });

    const result = await asUser(db, USER_A_ID, async () => db.query('select original_filename from public.file_attachments'));
    expect(result.rows).toEqual([{ original_filename: 'a.pdf' }]);
  });
});
