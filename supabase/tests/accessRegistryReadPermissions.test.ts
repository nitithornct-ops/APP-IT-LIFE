import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

let db: PGlite;
const manage = '00000000-0000-4000-8000-000000009201';
const review = '00000000-0000-4000-8000-000000009202';
const audit = '00000000-0000-4000-8000-000000009203';
const outsider = '00000000-0000-4000-8000-000000009204';
const target = '00000000-0000-4000-8000-000000009205';
const system = '00000000-0000-4000-8000-000000009206';

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query("insert into auth.users(id,email) values ($1,'reg-manage@test.local'),($2,'reg-review@test.local'),($3,'reg-audit@test.local'),($4,'reg-none@test.local'),($5,'reg-target@test.local')", [manage, review, audit, outsider, target]);
    await db.query(`insert into public.user_permission_overrides(user_id,permission_id,effect,reason,end_at)
      select mapping.user_id::uuid,p.id,'allow','test',now() + interval '30 days' from
      (values ($1,'access_registry.manage'),($2,'access_registry.review'),($3,'audit.view')) as mapping(user_id,key)
      join public.permissions p on p.key = mapping.key`, [manage, review, audit]);
    await db.query("insert into public.access_systems(id,name) values ($1,'Registry permission test')", [system]);
    await db.query("insert into public.user_access_registry(user_id,system_id,access_level) values ($1,$2,'Standard')", [target, system]);
  });
});
afterAll(async () => { await db.close(); });

it.each([manage, review, audit])('allows registry read for a specifically permitted user %s', async (user) => {
  const rows = await asUser(db, user, () => db.query('select id from public.user_access_registry where user_id = $1', [target]));
  expect(rows.rows).toHaveLength(1);
});

it('does not expose another user registry to an unrelated user', async () => {
  const rows = await asUser(db, outsider, () => db.query('select id from public.user_access_registry where user_id = $1', [target]));
  expect(rows.rows).toHaveLength(0);
});
