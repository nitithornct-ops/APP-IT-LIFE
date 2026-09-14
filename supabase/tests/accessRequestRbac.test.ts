import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const USER_ID = '00000000-0000-0000-0000-00000000a101';
const APPROVER_ID = '00000000-0000-0000-0000-00000000a102';
const OWNER_ID = '00000000-0000-0000-0000-00000000a103';
const OPERATOR_ID = '00000000-0000-0000-0000-00000000a104';

let db: PGlite;
let systemId: string;
let itemId: string;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users(id,email) values
       ($1,'ar-user@test.local'),($2,'ar-approver@test.local'),($3,'ar-owner@test.local'),($4,'ar-operator@test.local')`,
      [USER_ID, APPROVER_ID, OWNER_ID, OPERATOR_ID],
    );
    await db.query(
      `insert into public.user_roles(user_id,role_id)
       select mapping.user_id::uuid, roles.id
       from (values ($1,'user'),($2,'approver'),($3,'user'),($4,'technician')) mapping(user_id,role_key)
       join public.roles on roles.key = mapping.role_key`,
      [USER_ID, APPROVER_ID, OWNER_ID, OPERATOR_ID],
    );
    await db.query(`update public.profiles set supervisor_id = $2 where id = $1`, [USER_ID, APPROVER_ID]);
    const system = await db.query<{ id: string }>(
      `insert into public.access_systems(name,status) values ('RBAC Test System','active') returning id`,
    );
    systemId = system.rows[0].id;
    const item = await db.query<{ id: string }>(
      `insert into public.access_control_items
        (system_id,kind,code,name,permission_actions,data_classification,privileged_access,system_owner_id,default_approver_id)
       values ($1,'role','FIN-AP-01','Finance AP Approver',array['read','approve'],'ลับ',true,$2,$3) returning id`,
      [systemId, OWNER_ID, APPROVER_ID],
    );
    itemId = item.rows[0].id;
  });
});

afterAll(async () => {
  await db?.close();
});

describe('RBAC access request controls', () => {
  it('keeps the catalog scoped to valid actions and captures a request snapshot', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.access_control_items
       (system_id,kind,code,name,permission_actions,system_owner_id)
       values ($1,'role','BAD-01','Invalid',array['execute'],$2)`, [systemId, OWNER_ID],
    ))).rejects.toThrow();

    const result = await asUser(db, USER_ID, async () => db.query<{ id: string }>(
      `insert into public.access_requests
       (requester_id,subject_user_id,system_id,access_item_id,requested_actions,temporary_access,start_at,expires_at,
        data_classification,privileged_access,reason,business_reason,request_type,approver_id,system_owner_id,lifecycle_event)
       values ($1,$1,$2,$3,array['read'],true,now(),now() + interval '2 hours','ลับ',true,'เหตุผล','เหตุผล','ขอเพิ่มสิทธิ์',$4,$5,'joiner')
       returning id`, [USER_ID, systemId, itemId, APPROVER_ID, OWNER_ID],
    ));
    expect(result.rows).toHaveLength(1);

    const snapshot = await asServiceRole(db, async () => db.query(
      `select requested_actions, data_classification, privileged_access, lifecycle_event
       from public.access_requests where id = $1`, [result.rows[0].id],
    ));
    expect(snapshot.rows).toEqual([{ requested_actions: ['read'], data_classification: 'ลับ', privileged_access: true, lifecycle_event: 'joiner' }]);
  });

  it('rejects self-approval and approver/operator reuse at the database boundary', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.access_requests
       (requester_id,subject_user_id,system_id,access_item_id,requested_actions,reason,business_reason,request_type,approver_id,system_owner_id,lifecycle_event)
       values ($1,$1,$2,$3,array['read'],'bad','bad','ขอเพิ่มสิทธิ์',$1,$4,'manual')`, [USER_ID, systemId, itemId, OWNER_ID],
    ))).rejects.toThrow(/ACCESS_REQUEST_SOD_REQUESTER_APPROVER/);

    await expect(asServiceRole(db, async () => db.query(
      `insert into public.user_access_registry
       (user_id,system_id,access_item_id,permission_actions,data_classification,privileged_access,granted_by,approved_by)
       values ($1,$2,$3,array['read'],'ลับ',true,$4,$4)`, [USER_ID, systemId, itemId, OPERATOR_ID],
    ))).rejects.toThrow(/ACCESS_REGISTRY_SOD_APPROVER_OPERATOR/);

    const valid = await asServiceRole(db, async () => db.query(
      `insert into public.user_access_registry
       (user_id,system_id,access_item_id,permission_actions,data_classification,privileged_access,granted_by,approved_by)
       values ($1,$2,$3,array['read'],'ลับ',true,$4,$5) returning id`, [USER_ID, systemId, itemId, OPERATOR_ID, APPROVER_ID],
    ));
    expect(valid.rows).toHaveLength(1);
  });

  it('requires an expiry for temporary access and enforces JML direction', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.access_requests
       (requester_id,subject_user_id,system_id,access_item_id,requested_actions,temporary_access,reason,business_reason,request_type,approver_id,system_owner_id,lifecycle_event)
       values ($1,$1,$2,$3,array['read'],true,'bad','bad','ขอเพิ่มสิทธิ์',$4,$5,'manual')`, [USER_ID, systemId, itemId, APPROVER_ID, OWNER_ID],
    ))).rejects.toThrow();

    await expect(asServiceRole(db, async () => db.query(
      `insert into public.access_requests
       (requester_id,subject_user_id,system_id,access_item_id,requested_actions,reason,business_reason,request_type,approver_id,system_owner_id,lifecycle_event)
       values ($1,$1,$2,$3,array['read'],'bad','bad','ขอเพิ่มสิทธิ์',$4,$5,'leaver')`, [USER_ID, systemId, itemId, APPROVER_ID, OWNER_ID],
    ))).rejects.toThrow();

    await asServiceRole(db, async () => db.query(
      `insert into public.user_access_registry
       (user_id,system_id,access_item_id,permission_actions,temporary_access,start_at,expires_at,granted_by,approved_by)
       values ($1,$2,$3,array['read'],true,now() - interval '2 minutes',now() - interval '1 minute',$4,$5)`, [OWNER_ID, systemId, itemId, OPERATOR_ID, APPROVER_ID],
    ));
    const expired = await asServiceRole(db, async () => db.query<{ count: number }>(`select public.expire_temporary_access() as count`));
    expect(expired.rows[0].count).toBe(1);
  });
});
