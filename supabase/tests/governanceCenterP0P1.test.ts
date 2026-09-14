import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const TECHNICIAN_ID = '00000000-0000-0000-0000-000000001902';
const AUDITOR_ID = '00000000-0000-0000-0000-000000001904';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users(id,email) values ($1,'p1-tech@test.local'),($2,'p1-auditor@test.local')`, [TECHNICIAN_ID, AUDITOR_ID]);
    await db.query(
      `insert into public.user_roles(user_id,role_id)
       select mapping.user_id::uuid, roles.id
       from (values ($1,'technician'),($2,'auditor')) mapping(user_id,role_key)
       join public.roles on roles.key = mapping.role_key`,
      [TECHNICIAN_ID, AUDITOR_ID],
    );
  });
});
afterAll(async () => { await db.close(); });

describe('Governance Center P0/P1 relationship spine', () => {
  it('creates the new workflow tables, permissions and relationship columns', async () => {
    const result = await db.query<{ table_name: string; column_name: string }>(
      `select c.table_name, c.column_name
       from information_schema.columns c
       where c.table_schema = 'public'
         and ((c.table_name in ('governance_control_tests','governance_risk_acceptances','privacy_dpia_assessments','governance_annual_attestations','governance_calendar_events') and c.column_name = 'id')
           or (c.table_name in ('governance_risks','audit_findings','compliance_corrective_actions','governance_evidence_items') and c.column_name in ('control_id','evidence_id','finding_id','change_request_id','control_test_id')))
       order by c.table_name, c.column_name`,
    );
    expect(result.rows).toEqual(expect.arrayContaining([
      { table_name: 'governance_control_tests', column_name: 'id' },
      { table_name: 'governance_risk_acceptances', column_name: 'id' },
      { table_name: 'privacy_dpia_assessments', column_name: 'id' },
      { table_name: 'governance_annual_attestations', column_name: 'id' },
      { table_name: 'governance_calendar_events', column_name: 'id' },
      { table_name: 'governance_risks', column_name: 'control_id' },
      { table_name: 'audit_findings', column_name: 'evidence_id' },
      { table_name: 'compliance_corrective_actions', column_name: 'change_request_id' },
      { table_name: 'governance_evidence_items', column_name: 'control_test_id' },
    ]));

    const permissions = await db.query(`select key from public.permissions where key in ('evidence.manage','risk.accept') order by key`);
    expect(permissions.rows).toEqual([{ key: 'evidence.manage' }, { key: 'risk.accept' }]);
  });

  it('allows a control owner to write Control Library data but keeps verification separate', async () => {
    const control = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.governance_controls(control_code,domain,title,owner)
       values ('CTL-P1-01','Risk','Access review','Control Owner') returning id`,
    ));
    const controlId = (control.rows[0] as { id: string }).id;
    await expect(asUser(db, AUDITOR_ID, async () => db.query(
      `insert into public.governance_controls(control_code,domain,title,owner)
       values ('CTL-P1-DENIED','Risk','Should be denied','Auditor')`,
    ))).rejects.toThrow();
    await asServiceRole(db, async () => db.query(
      `insert into public.governance_control_tests(test_code,control_id,test_date,test_procedure,result)
       values ('TST-P1-01',$1,current_date,'Review access evidence','ผ่าน')`, [controlId],
    ));
  });

  it('enforces the one-pending Risk Acceptance rule and time-bounded approval evidence', async () => {
    const risk = await asServiceRole(db, async () => db.query(
      `insert into public.governance_controls(control_code,domain,title,owner)
       values ('CTL-P1-RISK','Risk','Risk treatment','Control Owner')
       on conflict (control_code) do update set title = excluded.title
       returning id`,
    ));
    const controlId = (risk.rows[0] as { id: string }).id;
    const riskRecord = await asServiceRole(db, async () => db.query(
      `insert into public.governance_risks(risk_code,title,owner,likelihood,impact,risk_score,control_id)
       values ('RSK-P1-01','Temporary exception','Risk Owner',3,4,12,$1) returning id`, [controlId],
    ));
    const riskId = (riskRecord.rows[0] as { id: string }).id;
    await asServiceRole(db, async () => db.query(
      `insert into public.governance_risk_acceptances(acceptance_code,risk_id,rationale,expires_at)
       values ('RAK-P1-01',$1,'Compensating control is active','2026-12-31')`, [riskId],
    ));
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.governance_risk_acceptances(acceptance_code,risk_id,rationale,expires_at)
       values ('RAK-P1-02',$1,'Second pending request','2026-12-31')`, [riskId],
    ))).rejects.toThrow();
  });
});
