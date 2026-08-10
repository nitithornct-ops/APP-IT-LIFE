import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ADMIN_ID = '00000000-0000-0000-0000-000000001901';
const TECHNICIAN_ID = '00000000-0000-0000-0000-000000001902';
const APPROVER_ID = '00000000-0000-0000-0000-000000001903';
const AUDITOR_ID = '00000000-0000-0000-0000-000000001904';
const DPO_ID = '00000000-0000-0000-0000-000000001905';
const USER_ID = '00000000-0000-0000-0000-000000001906';
const NO_ROLE_ID = '00000000-0000-0000-0000-000000001907';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users(id,email) values
       ($1,'grc-admin@test.local'),($2,'grc-tech@test.local'),($3,'grc-approver@test.local'),
       ($4,'grc-auditor@test.local'),($5,'grc-dpo@test.local'),($6,'grc-user@test.local'),($7,'grc-none@test.local')`,
      [ADMIN_ID, TECHNICIAN_ID, APPROVER_ID, AUDITOR_ID, DPO_ID, USER_ID, NO_ROLE_ID],
    );
    await db.query(
      `insert into public.user_roles(user_id,role_id)
       select mapping.user_id::uuid, roles.id
       from (values ($1,'super_admin'),($2,'technician'),($3,'approver'),($4,'auditor'),($5,'dpo'),($6,'user')) mapping(user_id,role_key)
       join public.roles on roles.key = mapping.role_key`,
      [ADMIN_ID, TECHNICIAN_ID, APPROVER_ID, AUDITOR_ID, DPO_ID, USER_ID],
    );
  });
});

afterAll(async () => { await db.close(); });

describe('Module 19 governance scope and database controls', () => {
  it('exposes all 12 governed capability areas and keeps Designer post-Go-live ready', async () => {
    const permissions = await db.query(
      `select count(distinct module_key)::int as count from public.permissions
       where module_key in ('data_class','compliance','privacy','risk','ai_cloud','awareness','evidence',
                            'audit_management','governance_document','operations','integration')`,
    );
    expect(permissions.rows).toEqual([{ count: 11 }]);
    const template = await db.query(
      `select designer_mode,status,design_schema->>'designerDeferredUntil' as deferred
       from public.governance_document_templates where template_code = 'POST-GOLIVE-DESIGNER'`,
    );
    expect(template.rows).toEqual([{ designer_mode: 'STRUCTURED_METADATA', status: 'DEFERRED', deferred: 'post-go-live' }]);
  });

  it('lets a regular employee view approved-use registers and e-sign only for themselves', async () => {
    const permissions = await asUser(db, USER_ID, async () => db.query(
      `select public.has_permission('ai_cloud.view') as ai,
              public.has_permission('awareness.view') as awareness,
              public.has_permission('awareness.participate') as participate,
              public.has_permission('privacy.view') as privacy`,
    ));
    expect(permissions.rows).toEqual([{ ai: true, awareness: true, participate: true, privacy: false }]);

    const acknowledgement = await asUser(db, USER_ID, async () => db.query(
      `insert into public.policy_acknowledgements
       (ack_code,policy_name,policy_version,signature_name,confirmed,acknowledger_id,acknowledger_name,acknowledger_email)
       values ('ACK-TEST-USER','Acceptable Use','1.0','GRC User',true,$1,'GRC User','grc-user@test.local') returning id`,
      [USER_ID],
    ));
    expect(acknowledgement.rows).toHaveLength(1);
    await expect(asUser(db, USER_ID, async () => db.query(
      `insert into public.policy_acknowledgements
       (ack_code,policy_name,policy_version,signature_name,confirmed,acknowledger_id,acknowledger_name)
       values ('ACK-TEST-FORGE','Forged','1','GRC User',true,$1,'Other')`, [AUDITOR_ID],
    ))).rejects.toThrow();
    await expect(asUser(db, USER_ID, async () => db.query(
      `insert into public.governance_ai_tools(tool_code,tool_name,prohibited_data_types)
       values ('AIT-DENIED','Unapproved AI','ข้อมูลลับ')`,
    ))).rejects.toThrow();
  });

  it('gives DPO management of legal/privacy records without granting risk changes', async () => {
    const law = await asUser(db, DPO_ID, async () => db.query(
      `insert into public.legal_register(law_code,law_name,applicability_status)
       values ('LAW-DPO-01','PDPA Test','ใช้บังคับ') returning id`,
    ));
    expect(law.rows).toHaveLength(1);
    const ropa = await asUser(db, DPO_ID, async () => db.query(
      `insert into public.privacy_ropa(ropa_code,process_name,department,purpose,lawful_basis)
       values ('ROPA-DPO-01','Employee records','HR','บริหารพนักงาน','หน้าที่ตามกฎหมาย') returning id`,
    ));
    expect(ropa.rows).toHaveLength(1);
    await expect(asUser(db, DPO_ID, async () => db.query(
      `insert into public.governance_risks(risk_code,title,owner,likelihood,impact,risk_score)
       values ('RSK-DENIED','DPO cannot change risk','DPO',3,3,9)`,
    ))).rejects.toThrow();
  });

  it('enforces risk 5x5 and residual-score consistency in PostgreSQL', async () => {
    await asServiceRole(db, async () => db.query(
      `insert into public.governance_risks
       (risk_code,title,owner,likelihood,impact,risk_score,residual_likelihood,residual_impact,residual_score)
       values ('RSK-VALID','Valid 5x5','IT',4,5,20,2,3,6)`,
    ));
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.governance_risks(risk_code,title,owner,likelihood,impact,risk_score)
       values ('RSK-BAD-SCORE','Bad score','IT',4,5,19)`,
    ))).rejects.toThrow();
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.governance_risks(risk_code,title,owner,likelihood,impact,risk_score)
       values ('RSK-BAD-RANGE','Out of range','IT',6,5,30)`,
    ))).rejects.toThrow();
  });

  it('separates data destruction management from approval authority', async () => {
    const asset = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.governance_data_assets(data_code,data_name,system_name,classification,data_owner)
       values ('DAT-TEST-01','Customer export','CRM','ลับมาก','DPO') returning id`,
    ));
    const assetId = (asset.rows[0] as { id: string }).id;
    const request = await asUser(db, TECHNICIAN_ID, async () => db.query(
      `insert into public.data_destruction_requests
       (request_code,data_asset_id,data_name,classification,reason,requester_id,requester_email)
       values ('DST-TEST-01',$1,'Customer export','ลับมาก','ครบอายุเก็บรักษา',$2,'grc-tech@test.local') returning id`,
      [assetId, TECHNICIAN_ID],
    ));
    expect(request.rows).toHaveLength(1);
    const authority = await asUser(db, APPROVER_ID, async () => db.query(
      `select public.has_permission('data_class.approve') as approve,
              public.has_permission('data_class.manage') as manage`,
    ));
    expect(authority.rows).toEqual([{ approve: true, manage: false }]);
  });

  it('keeps Evidence health operational and does not label it legal attestation', async () => {
    const control = await asUser(db, AUDITOR_ID, async () => db.query(
      `select requirement from public.governance_controls where control_code = 'CTL-LEGAL-01'`,
    ));
    expect(control.rows).toEqual([{ requirement: 'Evidence Health ไม่ใช่คำรับรองทางกฎหมาย' }]);
    const rights = await asUser(db, AUDITOR_ID, async () => db.query(
      `select public.has_permission('evidence.export') as export,
              public.has_permission('audit_management.verify') as verify,
              public.has_permission('audit_management.manage') as manage`,
    ));
    expect(rights.rows).toEqual([{ export: true, verify: true, manage: false }]);
    await expect(asUser(db, AUDITOR_ID, async () => db.query(
      `insert into public.governance_controls(control_code,domain,title) values ('CTL-FORGE','Audit','แก้ไม่ได้')`,
    ))).rejects.toThrow();
  });

  it('enforces document HTTPS and integration idempotency/record-link uniqueness', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.governance_documents(document_code,title,version,document_url)
       values ('DOC-BAD','Unsafe link','1','http://example.test/file.pdf')`,
    ))).rejects.toThrow();
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.integration_outbox(integration_code,idempotency_key,event_type,target_module,payload)
         values ('INT-TEST-01','idem-01','CREATE_TICKET','ticket','{}')`,
      );
      await db.query(
        `insert into public.record_links(link_code,source_module,source_record_id,target_module,target_record_id,link_type)
         values ('LNK-TEST-01','risk','RSK-VALID','ticket','TKT-01','MITIGATED_BY')`,
      );
    });
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.integration_outbox(integration_code,idempotency_key,event_type,target_module,payload)
       values ('INT-TEST-02','idem-01','CREATE_TICKET','ticket','{}')`,
    ))).rejects.toThrow();
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.record_links(link_code,source_module,source_record_id,target_module,target_record_id,link_type)
       values ('LNK-TEST-02','risk','RSK-VALID','ticket','TKT-01','MITIGATED_BY')`,
    ))).rejects.toThrow();
  });

  it('requires service role and a recent preview before Retention Apply', async () => {
    await expect(asUser(db, TECHNICIAN_ID, async () => db.query(
      `select public.run_governance_retention(false,null,$1,'grc-tech@test.local')`, [TECHNICIAN_ID],
    ))).rejects.toThrow();
    const preview = await asServiceRole(db, async () => db.query(
      `select public.run_governance_retention(false,null,$1,'grc-admin@test.local') as result`, [ADMIN_ID],
    ));
    const previewId = ((preview.rows[0] as { result: { id: string } }).result).id;
    const applied = await asServiceRole(db, async () => db.query(
      `select public.run_governance_retention(true,$1,$2,'grc-admin@test.local') as result`, [previewId, ADMIN_ID],
    ));
    expect((applied.rows[0] as { result: { mode: string; affected: number } }).result).toMatchObject({ mode: 'APPLY', affected: 0 });
    await expect(asServiceRole(db, async () => db.query(
      `select public.run_governance_retention(true,null,$1,'grc-admin@test.local')`, [ADMIN_ID],
    ))).rejects.toThrow(/preview_run_id is required/);
  });

  it('hides every governance register from authenticated users without a role', async () => {
    const counts = await asUser(db, NO_ROLE_ID, async () => db.query(
      `select
        (select count(*)::int from public.governance_data_assets) as data_assets,
        (select count(*)::int from public.legal_register) as laws,
        (select count(*)::int from public.privacy_ropa) as ropa,
        (select count(*)::int from public.governance_risks) as risks,
        (select count(*)::int from public.governance_controls) as controls,
        (select count(*)::int from public.integration_outbox) as outbox`,
    ));
    expect(counts.rows).toEqual([{ data_assets: 0, laws: 0, ropa: 0, risks: 0, controls: 0, outbox: 0 }]);
  });
});
