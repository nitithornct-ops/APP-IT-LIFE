import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const TECHNICIAN_ID = '00000000-0000-0000-0000-000000007101';
const MANAGER_ID = '00000000-0000-0000-0000-000000007102';
const USER_ID = '00000000-0000-0000-0000-000000007103';
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users(id,email) values
       ($1,'form-tech@test.local'),($2,'form-manager@test.local'),($3,'form-user@test.local')`,
      [TECHNICIAN_ID, MANAGER_ID, USER_ID],
    );
    await db.query(
      `insert into public.user_roles(user_id,role_id)
       select mapping.user_id::uuid, roles.id
       from (values ($1,'technician'),($2,'manager'),($3,'user')) mapping(user_id,role_key)
       join public.roles on roles.key = mapping.role_key`,
      [TECHNICIAN_ID, MANAGER_ID, USER_ID],
    );
  });
});

afterAll(async () => { await db?.close(); });

describe('Form Studio database controls', () => {
  it('seeds the source Word template and its first immutable version', async () => {
    const templates = await asUser(db, TECHNICIAN_ID, async () => db.query<{ template_code: string; current_version: number }>(
      `select template_code, current_version from public.form_templates where template_code = 'IT-ERP-ISSUE'`,
    ));
    const versions = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `select version from public.form_template_versions where template_id = (select id from public.form_templates where template_code = 'IT-ERP-ISSUE')`,
    ));
    expect(templates.rows).toEqual([{ template_code: 'IT-ERP-ISSUE', current_version: 1 }]);
    expect(versions.rows).toEqual([{ version: 1 }]);
  });

  it('grants edit/send/close to technicians and read-only access to managers', async () => {
    const technician = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `select public.has_permission('form.view') as view,
              public.has_permission('form.manage') as manage,
              public.has_permission('form.vendor_send') as vendor_send,
              public.has_permission('form.close') as close`,
    ));
    const manager = await asUser(db, MANAGER_ID, async () => db.query(
      `select public.has_permission('form.view') as view,
              public.has_permission('form.manage') as manage`,
    ));
    expect(technician.rows).toEqual([{ view: true, manage: true, vendor_send: true, close: true }]);
    expect(manager.rows).toEqual([{ view: true, manage: false }]);
  });

  it('creates a version-pinned issue form and hides Form Studio from regular users', async () => {
    const created = await asUser(db, TECHNICIAN_ID, async () => db.query<{ form_no: string; template_version: number }>(
      `insert into public.issue_forms(title, template_id, template_version, content_html, created_by)
       select 'ทดสอบแบบฟอร์ม ERP', id, current_version, content_html, $1
       from public.form_templates where template_code = 'IT-ERP-ISSUE'
       returning form_no, template_version`,
      [TECHNICIAN_ID],
    ));
    const hidden = await asUser(db, USER_ID, async () => db.query('select id from public.issue_forms'));
    expect(created.rows[0].form_no).toMatch(/^FRM-\d{6}-\d{5}$/);
    expect(created.rows[0].template_version).toBe(1);
    expect(hidden.rows).toHaveLength(0);
  });
});
