import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ACTOR_ID = '00000000-0000-0000-0000-0000000000c1';
const ASSIGNED_USER_ID = '00000000-0000-0000-0000-0000000000c2';

let db: PGlite;
let createdRoleId = '';

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email)
       values ($1, 'role-owner@test.local'), ($2, 'role-assignee@test.local')`,
      [ACTOR_ID, ASSIGNED_USER_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('Role Governance P1', () => {
  it('creates versioned custom roles and records metadata changes', async () => {
    const created = await asServiceRole(db, async () => db.query<{ role: { id: string; version: number; scope: string; sensitive_role: boolean } }>(
      `select public.create_role_with_version(
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      ) as role`,
      ['role_governance_test', 'Role Governance Test', 'Role Governance Test', 'Initial description', 'Finance only', ACTOR_ID, 'quarterly', true, ACTOR_ID],
    ));
    createdRoleId = created.rows[0].role.id;
    expect(created.rows[0].role).toMatchObject({ version: 1, scope: 'Finance only', sensitive_role: true });

    const baseline = await asServiceRole(db, async () => db.query<{ version_number: number; change_type: string }>(
      `select version_number, change_type from public.role_versions where role_id = $1`, [createdRoleId],
    ));
    expect(baseline.rows).toEqual([{ version_number: 1, change_type: 'CREATE' }]);

    await asServiceRole(db, async () => db.query(
      `select public.update_role_with_version(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )`,
      [createdRoleId, 'Role Governance Test v2', 'Role Governance Test', 'Updated description', 'Finance and audit', ACTOR_ID, 'semiannual', false, 'active', ACTOR_ID, 'ปรับ scope และรอบทบทวน'],
    ));

    const updated = await asServiceRole(db, async () => db.query<{ version: number; scope: string; review_frequency: string; sensitive_role: boolean }>(
      `select version, scope, review_frequency, sensitive_role from public.roles where id = $1`, [createdRoleId],
    ));
    expect(updated.rows[0]).toEqual({ version: 2, scope: 'Finance and audit', review_frequency: 'semiannual', sensitive_role: false });
    const versions = await asServiceRole(db, async () => db.query<{ version_number: number; change_summary: string }>(
      `select version_number, change_summary from public.role_versions where role_id = $1 order by version_number`, [createdRoleId],
    ));
    expect(versions.rows).toEqual([
      { version_number: 1, change_summary: 'สร้างบทบาท' },
      { version_number: 2, change_summary: 'ปรับ scope และรอบทบทวน' },
    ]);
  });

  it('versions Permission Matrix changes atomically and blocks deletion while assigned', async () => {
    const permissionIds = await asServiceRole(db, async () => db.query<{ id: string; key: string }>(
      `select id, key from public.permissions where key in ('change.create', 'change.approve') order by key`,
    ));
    const permissions = permissionIds.rows.map((permission) => ({ permissionId: permission.id, effect: 'allow' }));
    await asServiceRole(db, async () => db.query(
      `select public.set_role_permissions_with_version($1, $2::jsonb, $3, $4)`,
      [createdRoleId, JSON.stringify(permissions), ACTOR_ID, 'เพิ่ม Permission Matrix'],
    ));

    const versionedPermissions = await asServiceRole(db, async () => db.query<{ version: number; permission_count: number }>(
      `select r.version, count(rp.id)::int as permission_count
       from public.roles r left join public.role_permissions rp on rp.role_id = r.id
       where r.id = $1 group by r.version`, [createdRoleId],
    ));
    expect(versionedPermissions.rows[0]).toEqual({ version: 3, permission_count: 2 });

    await asServiceRole(db, async () => db.query(
      `insert into public.user_roles (user_id, role_id, assigned_by) values ($1, $2, $3)`,
      [ASSIGNED_USER_ID, createdRoleId, ACTOR_ID],
    ));
    await expect(asServiceRole(db, async () => db.query(`delete from public.roles where id = $1`, [createdRoleId]))).rejects.toThrow(/ROLE_HAS_ASSIGNED_USERS/);

    await asServiceRole(db, async () => db.query(`delete from public.user_roles where user_id = $1 and role_id = $2`, [ASSIGNED_USER_ID, createdRoleId]));
    await asServiceRole(db, async () => db.query(`delete from public.roles where id = $1`, [createdRoleId]));
    const deleted = await asServiceRole(db, async () => db.query(`select id from public.roles where id = $1`, [createdRoleId]));
    expect(deleted.rows).toHaveLength(0);
  });

  it('locks system roles for metadata, matrix and deletion writes', async () => {
    const systemRole = await asServiceRole(db, async () => db.query<{ id: string }>(`select id from public.roles where key = 'it_admin'`));
    await expect(asServiceRole(db, async () => db.query(`update public.roles set description = 'unsafe' where id = $1`, [systemRole.rows[0].id]))).rejects.toThrow(/SYSTEM_ROLE_LOCKED/);
    await expect(asServiceRole(db, async () => db.query(`delete from public.roles where id = $1`, [systemRole.rows[0].id]))).rejects.toThrow(/SYSTEM_ROLE_LOCKED/);

    await asServiceRole(db, async () => db.query(
      `insert into public.user_roles (user_id, role_id, assigned_by)
       select $1, id, $1 from public.roles where key = 'super_admin'`, [ACTOR_ID],
    ));
    const beforeCount = await asServiceRole(db, async () => db.query<{ count: number }>(`select count(*)::int as count from public.role_permissions where role_id = $1`, [systemRole.rows[0].id]));
    await asUser(db, ACTOR_ID, async () => db.query(`delete from public.role_permissions where role_id = $1`, [systemRole.rows[0].id]));
    const afterCount = await asServiceRole(db, async () => db.query<{ count: number }>(`select count(*)::int as count from public.role_permissions where role_id = $1`, [systemRole.rows[0].id]));
    expect(afterCount.rows[0].count).toBe(beforeCount.rows[0].count);
  });
});
