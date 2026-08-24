import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const TECHNICIAN_ID = '00000000-0000-0000-0000-000000002001';
const AUDITOR_ID = '00000000-0000-0000-0000-000000002002';
const USER_ID = '00000000-0000-0000-0000-000000002003';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users(id,email) values
       ($1,'report-tech@test.local'),($2,'report-auditor@test.local'),($3,'report-user@test.local')`,
      [TECHNICIAN_ID, AUDITOR_ID, USER_ID],
    );
    await db.query(
      `insert into public.user_roles(user_id,role_id)
       select mapping.user_id::uuid, roles.id
       from (values ($1,'technician'),($2,'auditor'),($3,'user')) mapping(user_id,role_key)
       join public.roles on roles.key = mapping.role_key`,
      [TECHNICIAN_ID, AUDITOR_ID, USER_ID],
    );
  });
});

afterAll(async () => { await db.close(); });

describe('Module 20 Report Center controls', () => {
  it('seeds six governed standard reports', async () => {
    const result = await db.query('select key,status from public.report_definitions order by sort_order');
    expect(result.rows).toHaveLength(6);
    expect(result.rows.map((row) => (row as { key: string }).key)).toEqual([
      'service-desk', 'requests-workflows', 'assets-operations', 'asset-custody', 'security-resilience', 'governance-compliance',
    ]);
    expect(result.rows.every((row) => (row as { status: string }).status === 'active')).toBe(true);
  });

  it('grants operational/reporting roles access but denies a regular employee', async () => {
    const technician = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `select public.has_permission('report.view') as view,
              public.has_permission('report.export') as export`,
    ));
    expect(technician.rows).toEqual([{ view: true, export: true }]);

    const regular = await asUser(db, USER_ID, async () => db.query(
      `select public.has_permission('report.view') as view,
              public.has_permission('report.export') as export`,
    ));
    expect(regular.rows).toEqual([{ view: false, export: false }]);
  });

  it('protects definitions with report.view RLS', async () => {
    const visible = await asUser(db, TECHNICIAN_ID, async () => db.query('select key from public.report_definitions'));
    expect(visible.rows).toHaveLength(6);
    const hidden = await asUser(db, USER_ID, async () => db.query('select key from public.report_definitions'));
    expect(hidden.rows).toHaveLength(0);
  });

  it('keeps export evidence service-written, user-readable and append-only', async () => {
    await asServiceRole(db, async () => db.query(
      `insert into public.report_exports(export_code,report_key,format,row_count,actor_id,actor_email)
       values ('RPT-TECH-01','service-desk','CSV',12,$1,'report-tech@test.local'),
              ('RPT-AUDIT-01','governance-compliance','PRINT',4,$2,'report-auditor@test.local')`,
      [TECHNICIAN_ID, AUDITOR_ID],
    ));

    const own = await asUser(db, TECHNICIAN_ID, async () => db.query('select export_code from public.report_exports order by export_code'));
    expect(own.rows).toEqual([{ export_code: 'RPT-TECH-01' }]);

    const all = await asUser(db, AUDITOR_ID, async () => db.query('select export_code from public.report_exports'));
    expect(all.rows).toHaveLength(2);

    await expect(asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.report_exports(export_code,report_key,format,actor_id)
       values ('RPT-FORGED','service-desk','CSV',$1)`, [TECHNICIAN_ID],
    ))).rejects.toThrow();
    const update = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `update public.report_exports set row_count = 999 where export_code = 'RPT-TECH-01' returning id`,
    ));
    expect(update.rows).toHaveLength(0);
  });

  it('accepts the PDF export format (R-13: Cloudflare Browser Rendering, migration 20260830100000) alongside CSV/PRINT, and still rejects anything else', async () => {
    const pdf = await asServiceRole(db, async () => db.query<{ format: string }>(
      `insert into public.report_exports(export_code,report_key,format,row_count,actor_id,actor_email)
       values ('RPT-PDF-01','service-desk','PDF',3,$1,'report-tech@test.local') returning format`,
      [TECHNICIAN_ID],
    ));
    expect(pdf.rows).toEqual([{ format: 'PDF' }]);

    await expect(asServiceRole(db, async () => db.query(
      `insert into public.report_exports(export_code,report_key,format,actor_id) values ('RPT-BAD','service-desk','XLSX',$1)`,
      [TECHNICIAN_ID],
    ))).rejects.toThrow();
  });
});
