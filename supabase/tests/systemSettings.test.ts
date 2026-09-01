import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ADMIN_ID = '00000000-0000-0000-0000-000000002201';
const AUDITOR_ID = '00000000-0000-0000-0000-000000002202';
const USER_ID = '00000000-0000-0000-0000-000000002203';
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users(id,email) values ($1,'settings-admin@test.local'),($2,'settings-auditor@test.local'),($3,'settings-user@test.local')`, [ADMIN_ID, AUDITOR_ID, USER_ID]);
    await db.query(
      `insert into public.user_roles(user_id,role_id)
       select mapping.user_id::uuid, roles.id
       from (values ($1,'it_admin'),($2,'auditor'),($3,'user')) mapping(user_id,role_key)
       join public.roles on roles.key = mapping.role_key`,
      [ADMIN_ID, AUDITOR_ID, USER_ID],
    );
  });
});

afterAll(async () => { await db.close(); });

describe('Module 22 System Settings database controls', () => {
  it('seeds the allowlisted settings and organization branding without secret fields', async () => {
    const result = await asServiceRole(db, async () => db.query(
      `select count(*)::int as total,
              count(*) filter (where key ~ '(SECRET|TOKEN|API_KEY|PASSWORD)$')::int as secret_keys,
              count(*) filter (where support_status = 'deferred')::int as deferred,
              count(*) filter (where key in ('LINE_REQUIRE_EMPLOYEE_LINK', 'LINE_AUTO_APPROVE_EMPLOYEE_LINK'))::int as employee_link_settings
       from public.system_settings`,
    ));
    expect(result.rows).toEqual([{ total: 53, secret_keys: 0, deferred: 6, employee_link_settings: 0 }]);
  });

  it('grants Settings only to administrators while retaining Audit access for auditors', async () => {
    const admin = await asUser(db, ADMIN_ID, async () => db.query(`select public.has_permission('setting.view') as view, public.has_permission('setting.manage') as manage`));
    const auditor = await asUser(db, AUDITOR_ID, async () => db.query(`select public.has_permission('setting.view') as settings, public.has_permission('audit.view') as audit`));
    expect(admin.rows).toEqual([{ view: true, manage: true }]);
    expect(auditor.rows).toEqual([{ settings: false, audit: true }]);
  });

  it('enforces row policies for viewing, editing and read-only integrations', async () => {
    const settings = await asUser(db, ADMIN_ID, async () => db.query(`select count(*)::int as count from public.system_settings`));
    expect(settings.rows).toEqual([{ count: 53 }]);
    const update = await asUser(db, ADMIN_ID, async () => db.query(`update public.system_settings set value = 'LIFE Test' where key = 'ORG_NAME' returning value`));
    expect(update.rows).toEqual([{ value: 'LIFE Test' }]);
    const readOnlyUpdate = await asUser(db, ADMIN_ID, async () => db.query(`update public.system_settings set value = 'true' where key = 'NOTIFY_LINE_ENABLED' returning key`));
    expect(readOnlyUpdate.rows).toEqual([]);
    const hidden = await asUser(db, USER_ID, async () => db.query(`select count(*)::int as count from public.system_settings`));
    expect(hidden.rows).toEqual([{ count: 0 }]);
  });

  it('can be applied again safely without overwriting a configured value', async () => {
    const migration = readFileSync(resolve(process.cwd(), 'migrations/20260827100000_system_settings.sql'), 'utf8');
    await db.exec(migration);
    const result = await asServiceRole(db, async () => db.query(`select count(*)::int as count, max(value) filter (where key = 'ORG_NAME') as org_name from public.system_settings`));
    expect(result.rows).toEqual([{ count: 55, org_name: 'LIFE Test' }]);
  });
});
