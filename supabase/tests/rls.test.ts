import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

const SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const REGULAR_USER_ID = '00000000-0000-0000-0000-000000000002';
const AUDITOR_ID = '00000000-0000-0000-0000-000000000003';
const SECOND_SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000004';

let db: PGlite;

async function createUserWithRole(userId: string, email: string, roleKey: string) {
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email]);
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = $2`,
      [userId, roleKey],
    );
  });
}

beforeAll(async () => {
  db = await createTestDb();

  await createUserWithRole(SUPER_ADMIN_ID, 'super-admin@test.local', 'super_admin');
  await createUserWithRole(REGULAR_USER_ID, 'user@test.local', 'user');
  await createUserWithRole(AUDITOR_ID, 'auditor@test.local', 'auditor');
  await createUserWithRole(SECOND_SUPER_ADMIN_ID, 'super-admin-2@test.local', 'super_admin');

  await asServiceRole(db, async () => {
    await db.query(
      `insert into public.audit_logs (actor_email, action, module, result)
       values ('someone@test.local', 'CREATE', 'ticket', 'success')`,
    );
  });
});

afterAll(async () => {
  await db.close();
});

describe('seed data', () => {
  it('seeds 9 roles and 23 permissions', async () => {
    const roles = await db.query('select count(*)::int as count from public.roles');
    const permissions = await db.query('select count(*)::int as count from public.permissions');
    expect((roles.rows[0] as { count: number }).count).toBe(9);
    expect((permissions.rows[0] as { count: number }).count).toBe(23);
  });
});

describe('has_permission()', () => {
  it('denies an unknown permission key (fail-closed)', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query("select public.has_permission('does.not.exist') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false);
  });

  it('grants super_admin every seeded permission', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query("select public.has_permission('role.manage') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(true);
  });

  it('denies a plain user the role.manage permission', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () =>
      db.query("select public.has_permission('role.manage') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false);
  });

  it('a user-level DENY override wins over an ALLOW from the role', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.user_permission_overrides (user_id, permission_id, effect, reason, status)
         select $1, id, 'deny', 'ทดสอบ deny override', 'active'
         from public.permissions where key = 'ticket.view'`,
        [REGULAR_USER_ID],
      );
    });

    const result = await asUser(db, REGULAR_USER_ID, async () =>
      db.query("select public.has_permission('ticket.view') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false);
  });

  it('returns false once the profile is disabled, even for super_admin', async () => {
    await asServiceRole(db, async () => {
      await db.query(`update public.profiles set status = 'inactive' where id = $1`, [SECOND_SUPER_ADMIN_ID]);
    });

    const result = await asUser(db, SECOND_SUPER_ADMIN_ID, async () =>
      db.query("select public.has_permission('role.manage') as allowed"),
    );
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false);
  });
});

describe('profiles RLS', () => {
  it('lets a user see only their own profile row', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.profiles'));
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as { id: string }).id).toBe(REGULAR_USER_ID);
  });

  it('lets super_admin (user.manage) see every profile', async () => {
    const result = await asUser(db, SUPER_ADMIN_ID, async () => db.query('select id from public.profiles'));
    expect(result.rows.length).toBeGreaterThanOrEqual(4);
  });

  it('returns no rows for an unauthenticated (anon) request', async () => {
    const result = await asAnon(db, async () => db.query('select id from public.profiles'));
    expect(result.rows).toHaveLength(0);
  });
});

describe('audit_logs RLS (immutable, restricted read)', () => {
  it('hides audit_logs from a plain user without audit.view', async () => {
    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.audit_logs'));
    expect(result.rows).toHaveLength(0);
  });

  it('lets an auditor read audit_logs', async () => {
    const result = await asUser(db, AUDITOR_ID, async () => db.query('select id from public.audit_logs'));
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a direct insert into audit_logs from an authenticated user (backend-only via service_role)', async () => {
    await expect(
      asUser(db, SUPER_ADMIN_ID, async () =>
        db.query(
          `insert into public.audit_logs (actor_email, action, module, result) values ($1, 'CREATE', 'ticket', 'success')`,
          ['super-admin@test.local'],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('ticket_categories / asset_categories RLS (Master Data, Phase 6)', () => {
  it('lets any authenticated user read ticket_categories and asset_categories', async () => {
    await asServiceRole(db, async () => {
      await db.query(`insert into public.ticket_categories (name) values ('เครือข่าย') on conflict do nothing`);
      await db.query(
        `insert into public.asset_categories (name, code_prefix) values ('โน้ตบุ๊ก', 'NB') on conflict do nothing`,
      );
    });

    const categories = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select name from public.ticket_categories'),
    );
    expect(categories.rows.length).toBeGreaterThanOrEqual(1);

    const assetCategories = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select name from public.asset_categories'),
    );
    expect(assetCategories.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a plain user writing to ticket_categories/asset_categories without the manage permission', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.ticket_categories (name) values ('ทดสอบ-rejected')`),
      ),
    ).rejects.toThrow();

    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.asset_categories (name, code_prefix) values ('ทดสอบ-rejected', 'RJ')`),
      ),
    ).rejects.toThrow();
  });

  it('lets super_admin (has ticket_category.manage/asset_category.manage) write to both tables', async () => {
    const insertedTicketCategory = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`insert into public.ticket_categories (name) values ('ฮาร์ดแวร์') returning id`),
    );
    expect(insertedTicketCategory.rows).toHaveLength(1);

    const insertedAssetCategory = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(`insert into public.asset_categories (name, code_prefix) values ('เดสก์ท็อป', 'PC') returning id`),
    );
    expect(insertedAssetCategory.rows).toHaveLength(1);
  });

  it('rejects an invalid default_priority value outside the 4-level scale (ต่ำ/ปานกลาง/สูง/วิกฤต)', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into public.ticket_categories (name, default_priority) values ('ทดสอบ-invalid', 'ด่วนสุด')`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('user_permission_overrides uniqueness (Phase 6 Module 2)', () => {
  it('rejects a second override row for the same user + permission (one governed row per key)', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.user_permission_overrides (user_id, permission_id, effect, reason, status)
         select $1, id, 'allow', 'ทดสอบ unique ครั้งที่ 1', 'active'
         from public.permissions where key = 'asset.view'`,
        [AUDITOR_ID],
      );
    });

    await expect(
      asServiceRole(db, async () => {
        await db.query(
          `insert into public.user_permission_overrides (user_id, permission_id, effect, reason, status)
           select $1, id, 'deny', 'ทดสอบ unique ครั้งที่ 2', 'active'
           from public.permissions where key = 'asset.view'`,
          [AUDITOR_ID],
        );
      }),
    ).rejects.toThrow();
  });
});

describe('approval_groups / approval_group_members RLS (Phase 6 Module 2)', () => {
  let groupId: string;

  it('lets any authenticated user read approval_groups', async () => {
    await asServiceRole(db, async () => {
      const inserted = await db.query(
        `insert into public.approval_groups (code, name) values ('IT-CHANGE', 'กลุ่มอนุมัติ Change ฝ่ายไอที') returning id`,
      );
      groupId = (inserted.rows[0] as { id: string }).id;
    });

    const result = await asUser(db, REGULAR_USER_ID, async () => db.query('select id from public.approval_groups'));
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a plain user writing to approval_groups without approval_group.manage', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () =>
        db.query(`insert into public.approval_groups (code, name) values ('REJECT-1', 'ทดสอบ-rejected')`),
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid approval_groups.code format', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(`insert into public.approval_groups (code, name) values ('bad code!', 'รูปแบบรหัสไม่ถูกต้อง')`),
      ),
    ).rejects.toThrow();
  });

  it('lets super_admin (has approval_group.manage) add a member and read it back', async () => {
    const inserted = await asUser(db, SUPER_ADMIN_ID, async () =>
      db.query(
        `insert into public.approval_group_members (group_id, user_id, member_role, priority)
         values ($1, $2, 'primary', 10) returning id`,
        [groupId, REGULAR_USER_ID],
      ),
    );
    expect(inserted.rows).toHaveLength(1);

    const readBack = await asUser(db, REGULAR_USER_ID, async () =>
      db.query('select id from public.approval_group_members where group_id = $1', [groupId]),
    );
    expect(readBack.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a duplicate member (same user twice in the same group)', async () => {
    await expect(
      asUser(db, SUPER_ADMIN_ID, async () =>
        db.query(
          `insert into public.approval_group_members (group_id, user_id) values ($1, $2)`,
          [groupId, REGULAR_USER_ID],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('role management RLS', () => {
  it('rejects a plain user trying to grant themselves a role', async () => {
    await expect(
      asUser(db, REGULAR_USER_ID, async () => {
        const superAdminRole = await db.query("select id from public.roles where key = 'super_admin'");
        await db.query('insert into public.user_roles (user_id, role_id) values ($1, $2)', [
          REGULAR_USER_ID,
          (superAdminRole.rows[0] as { id: string }).id,
        ]);
      }),
    ).rejects.toThrow();
  });

  it('blocks removing the last active super_admin (last-admin guard)', async () => {
    // ปิดใช้งาน super_admin คนที่ 2 ก่อน เพื่อให้ SUPER_ADMIN_ID เหลือเป็นคนสุดท้ายที่ Active
    await asServiceRole(db, async () => {
      await db.query(`update public.profiles set status = 'inactive' where id = $1`, [SUPER_ADMIN_ID]);
      await db.query(`update public.profiles set status = 'active' where id = $1`, [SECOND_SUPER_ADMIN_ID]);
      await db.query(`update public.profiles set status = 'active' where id = $1`, [SUPER_ADMIN_ID]);
      await db.query(`update public.profiles set status = 'inactive' where id = $1`, [SECOND_SUPER_ADMIN_ID]);
    });

    await expect(
      asServiceRole(db, async () => {
        await db.query(
          `delete from public.user_roles
           where user_id = $1 and role_id = (select id from public.roles where key = 'super_admin')`,
          [SUPER_ADMIN_ID],
        );
      }),
    ).rejects.toThrow(/last-admin guard/);
  });
});
