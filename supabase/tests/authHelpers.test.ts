import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000101';
const REGULAR_USER_ID = '00000000-0000-0000-0000-000000000102';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();

  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
      SUPER_ADMIN_ID,
      'super-admin@test.local',
      REGULAR_USER_ID,
      'user@test.local',
    ]);
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = 'super_admin'`,
      [SUPER_ADMIN_ID],
    );
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = 'user'`,
      [REGULAR_USER_ID],
    );
  });
});

afterAll(async () => {
  await db.close();
});

describe('my_roles()', () => {
  it("returns the caller's own roles only", async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select role_key from public.my_roles()'));
    expect(result.rows).toEqual([{ role_key: 'user' }]);
  });
});

describe('my_permissions()', () => {
  it('matches has_permission() for every seeded permission key (single source of truth)', async () => {
    const viaHelper = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select permission_key from public.my_permissions() order by permission_key'),
    );
    const allKeys = await db.query('select key from public.permissions order by key');

    const viaDirectCheck: string[] = [];
    for (const row of allKeys.rows as { key: string }[]) {
      const res = await asUser(db, REGULAR_USER_ID, async () =>
        db.query('select public.has_permission($1) as allowed', [row.key]),
      );
      if ((res.rows[0] as { allowed: boolean }).allowed) {
        viaDirectCheck.push(row.key);
      }
    }

    expect((viaHelper.rows as { permission_key: string }[]).map((r) => r.permission_key)).toEqual(
      viaDirectCheck.sort(),
    );
    expect(viaDirectCheck).toEqual([
      'access_request.create',
      'access_request.view',
      'dashboard.view',
      'service_request.create',
      'service_request.view',
      'ticket.create',
      'ticket.view',
    ]);
  });

  it('returns the full permission catalog for super_admin', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () => db.query('select permission_key from public.my_permissions()'));
    const total = await db.query("select count(*)::int as count from public.permissions where status = 'active'");
    expect(result.rows.length).toBe((total.rows[0] as { count: number }).count);
  });
});
