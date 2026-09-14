import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const TARGET_ID = '00000000-0000-0000-0000-0000000000b1';
const GROUP_ID = '00000000-0000-0000-0000-0000000000b2';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [TARGET_ID, 'access-target@test.local']);
    await db.query('insert into public.access_groups (id, key, name) values ($1, $2, $3)', [GROUP_ID, 'service-desk', 'Service Desk']);
    await db.query(
      `insert into public.access_group_permissions (group_id, permission_id, effect)
       select $1, id, 'allow' from public.permissions where key = 'dashboard.view'`,
      [GROUP_ID],
    );
    await db.query('insert into public.access_group_members (group_id, user_id) values ($1, $2)', [GROUP_ID, TARGET_ID]);
  });
});

afterAll(async () => {
  await db?.close();
});

describe('users access governance', () => {
  it('resolves group grants and reports their source', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ source: string; effective_effect: string; sources: Array<{ type: string; name: string }> }>(
        `select source, effective_effect, sources
         from public.effective_permissions_for_user($1)
         where permission_key = 'dashboard.view'`,
        [TARGET_ID],
      ),
    );

    expect(result.rows[0].effective_effect).toBe('allow');
    expect(result.rows[0].source).toBe('group');
    expect(result.rows[0].sources).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'group', name: 'Service Desk' })]));
  });

  it('requires expiry and approval for privileged ALLOW overrides', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into public.user_permission_overrides (user_id, permission_id, effect, reason)
           select $1, id, 'allow', 'break glass' from public.permissions where key = 'user.manage'`,
          [TARGET_ID],
        ),
      ),
    ).rejects.toThrow(/user_permission_overrides_privileged_expiry_check/i);

    const insert = await asServiceRole(db, async () =>
      db.query<{ id: string }>(
        `insert into public.user_permission_overrides
          (user_id, permission_id, effect, end_at, reason, is_temporary, privileged_access, approval_status, status)
         select $1, id, 'allow', now() + interval '1 day', 'approved break glass', true, true, 'pending', 'inactive'
         from public.permissions where key = 'user.manage'
         returning id`,
        [TARGET_ID],
      ),
    );

    const beforeApproval = await asUser(db, TARGET_ID, async () => db.query('select public.has_permission($1) as allowed', ['user.manage']));
    expect((beforeApproval.rows[0] as { allowed: boolean }).allowed).toBe(false);

    await asServiceRole(db, async () =>
      db.query(
        `update public.user_permission_overrides
         set approval_status = 'approved', status = 'active'
         where id = $1`,
        [insert.rows[0].id],
      ),
    );

    const afterApproval = await asUser(db, TARGET_ID, async () => db.query('select public.has_permission($1) as allowed', ['user.manage']));
    expect((afterApproval.rows[0] as { allowed: boolean }).allowed).toBe(true);
  });
});
