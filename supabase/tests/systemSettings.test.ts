import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ADMIN_ID = '00000000-0000-0000-0000-000000002201';
const AUDITOR_ID = '00000000-0000-0000-0000-000000002202';
const USER_ID = '00000000-0000-0000-0000-000000002203';
const APPROVER_ID = '00000000-0000-0000-0000-000000002204';
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users(id,email) values ($1,'settings-admin@test.local'),($2,'settings-auditor@test.local'),($3,'settings-user@test.local'),($4,'settings-approver@test.local')`, [ADMIN_ID, AUDITOR_ID, USER_ID, APPROVER_ID]);
    await db.query(
      `insert into public.user_roles(user_id,role_id)
       select mapping.user_id::uuid, roles.id
       from (values ($1,'it_admin'),($2,'auditor'),($3,'user'),($4,'approver')) mapping(user_id,role_key)
       join public.roles on roles.key = mapping.role_key`,
      [ADMIN_ID, AUDITOR_ID, USER_ID, APPROVER_ID],
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
    expect(result.rows).toEqual([{ total: 44, secret_keys: 0, deferred: 5, employee_link_settings: 0 }]);
  });

  it('grants Settings only to administrators while retaining Audit access for auditors', async () => {
    const admin = await asUser(db, ADMIN_ID, async () => db.query(`select public.has_permission('setting.view') as view, public.has_permission('setting.manage') as manage`));
    const auditor = await asUser(db, AUDITOR_ID, async () => db.query(`select public.has_permission('setting.view') as settings, public.has_permission('audit.view') as audit`));
    expect(admin.rows).toEqual([{ view: true, manage: true }]);
    expect(auditor.rows).toEqual([{ settings: false, audit: true }]);
  });

  it('enforces row policies for viewing, editing and read-only integrations', async () => {
    const settings = await asUser(db, ADMIN_ID, async () => db.query(`select count(*)::int as count from public.system_settings`));
    expect(settings.rows).toEqual([{ count: 44 }]);
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
    // Reapplying the migration adds 14 later settings keys: 44 + 14 = 58,
    // while preserving the configured ORG_NAME value.
    const result = await asServiceRole(db, async () => db.query(`select count(*)::int as count, max(value) filter (where key = 'ORG_NAME') as org_name from public.system_settings`));
    expect(result.rows).toEqual([{ count: 58, org_name: 'LIFE Test' }]);
  });

  it('keeps version history and requires a separate approver for critical changes', async () => {
    const metadata = await asServiceRole(db, async () => db.query(
      `select config_version, criticality, requires_approval, depends_on
       from public.system_settings where key = 'RETENTION_MODE'`,
    ));
    expect(metadata.rows).toEqual([{ config_version: 1, criticality: 'critical', requires_approval: true, depends_on: [] }]);

    const history = await asServiceRole(db, async () => db.query(
      `select version, value, change_type from public.system_setting_versions
       where setting_key = 'RETENTION_MODE' order by version`,
    ));
    expect(history.rows).toEqual([{ version: 1, value: 'DRY_RUN', change_type: 'initial' }]);

    const request = await asServiceRole(db, async () => db.query<{ id: string }>(
      `insert into public.system_setting_change_requests
         (setting_key, requested_value, base_version, requested_by)
       values ('RETENTION_MODE', 'ENFORCE', 1, $1)
       returning id`, [ADMIN_ID],
    ));
    const requestId = request.rows[0].id;
    const approved = await asServiceRole(db, async () => db.query<{ result: { status: string } }>(
      `select public.decide_system_setting_change($1::uuid, $2::uuid, 'approve', null, 'uat') as result`,
      [requestId, APPROVER_ID],
    ));
    expect(approved.rows[0].result.status).toBe('approved');

    const current = await asServiceRole(db, async () => db.query(
      `select value, config_version from public.system_settings where key = 'RETENTION_MODE'`,
    ));
    expect(current.rows).toEqual([{ value: 'ENFORCE', config_version: 2 }]);
    const approvedHistory = await asServiceRole(db, async () => db.query(
      `select version, value, previous_value, change_type, environment_label
       from public.system_setting_versions where setting_key = 'RETENTION_MODE' order by version`,
    ));
    expect(approvedHistory.rows).toEqual([
      { version: 1, value: 'DRY_RUN', previous_value: null, change_type: 'initial', environment_label: 'unknown' },
      { version: 2, value: 'ENFORCE', previous_value: 'DRY_RUN', change_type: 'update', environment_label: 'uat' },
    ]);
  });
});
