import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const OPERATOR_ID = '40000000-0000-0000-0000-000000000001';
const OWNER_ID = '40000000-0000-0000-0000-000000000011';
const CUSTODIAN_ID = '40000000-0000-0000-0000-000000000012';
const ASSIGNED_USER_ID = '40000000-0000-0000-0000-000000000013';
const APPROVER_ID = '40000000-0000-0000-0000-000000000014';

let db: PGlite;

async function createUser() {
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [OPERATOR_ID, 'employee-assignment-operator@test.local']);
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = 'it_admin'`,
      [OPERATOR_ID],
    );
  });
}

async function createEmployee(id: string, code: string, firstName: string) {
  await asServiceRole(db, () => db.query(
    `insert into public.employees (id, employee_code, first_name_th, last_name_th, status)
     values ($1, $2, $3, 'ทดสอบ', 'active')`,
    [id, code, firstName],
  ));
}

async function createAsset(code: string) {
  const result = await asServiceRole(db, () => db.query<{ id: string }>(
    `insert into public.assets (asset_code, name, status, lifecycle_status, location)
     values ($1, 'Notebook สำหรับพนักงานใหม่', 'พร้อมใช้งาน', 'ready', 'คลัง IT') returning id`,
    [code],
  ));
  return result.rows[0].id;
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser();
  await createEmployee(OWNER_ID, 'EMP-OWNER', 'เจ้าของ');
  await createEmployee(CUSTODIAN_ID, 'EMP-CUSTODIAN', 'ผู้ถือครอง');
  await createEmployee(ASSIGNED_USER_ID, 'EMP-USER', 'ผู้ใช้งาน');
  await createEmployee(APPROVER_ID, 'EMP-MANAGER', 'ผู้อนุมัติ');
});

afterAll(async () => db.close());

describe('Employee Asset Assignment', () => {
  it('bulk assigns assets with separate roles and returns them as one batch', async () => {
    const firstAssetId = await createAsset('AST-EA-001');
    const secondAssetId = await createAsset('AST-EA-002');

    const assigned = await asUser(db, OPERATOR_ID, () => db.query<{
      bulk_assign_employee_assets: { batchId: string; assignmentIds: string[]; count: number };
    }>(
      `select public.bulk_assign_employee_assets(
        $1, ARRAY[$2, $3]::uuid[], '2026-09-01', $4, $5, $6, $7,
        'อนุมัติสำหรับพนักงานใหม่', '["Adapter", "กระเป๋า"]'::jsonb, 'ชุดเริ่มงาน'
      ) as bulk_assign_employee_assets`,
      [ASSIGNED_USER_ID, firstAssetId, secondAssetId, OWNER_ID, CUSTODIAN_ID, ASSIGNED_USER_ID, APPROVER_ID],
    ));

    const assignmentIds = assigned.rows[0].bulk_assign_employee_assets.assignmentIds;
    expect(assignmentIds).toHaveLength(2);
    expect(assigned.rows[0].bulk_assign_employee_assets.count).toBe(2);

    const detail = await asServiceRole(db, () => db.query<{
      owner_employee_id: string;
      custodian_employee_id: string;
      assigned_user_employee_id: string;
      checkout_date: string;
      manager_approval_status: string;
      accessories: string;
      status: string;
    }>(
      `select owner_employee_id, custodian_employee_id, assigned_user_employee_id,
              checkout_date::text, manager_approval_status, accessories::text, status
       from public.employee_assignments where id = any($1::uuid[]) order by id`,
      [assignmentIds],
    ));
    expect(detail.rows).toHaveLength(2);
    expect(detail.rows[0]).toMatchObject({
      owner_employee_id: OWNER_ID,
      custodian_employee_id: CUSTODIAN_ID,
      assigned_user_employee_id: ASSIGNED_USER_ID,
      checkout_date: '2026-09-01',
      manager_approval_status: 'approved',
      status: 'ครอบครอง',
    });
    expect(detail.rows[0].accessories).toContain('Adapter');

    const assets = await asServiceRole(db, () => db.query<{ status: string; lifecycle_status: string; owner_employee_id: string }>(
      'select status, lifecycle_status, owner_employee_id from public.assets where id = $1', [firstAssetId],
    ));
    expect(assets.rows[0]).toEqual({ status: 'ใช้งานอยู่', lifecycle_status: 'checked_out', owner_employee_id: CUSTODIAN_ID });

    const returned = await asUser(db, OPERATOR_ID, () => db.query<{
      bulk_return_employee_assets: { assignmentCount: number; assetCount: number };
    }>(
      `select public.bulk_return_employee_assets($1, '2026-09-10', null, 'พ้นสภาพ') as bulk_return_employee_assets`,
      [ASSIGNED_USER_ID],
    ));
    expect(returned.rows[0].bulk_return_employee_assets).toMatchObject({ assignmentCount: 2, assetCount: 2 });

    const returnedAssignment = await asServiceRole(db, () => db.query<{ status: string; return_date: string; return_reason: string }>(
      `select status, return_date::text, return_reason
       from public.employee_assignments where id = $1`,
      [assignmentIds[0]],
    ));
    expect(returnedAssignment.rows[0]).toEqual({ status: 'คืนแล้ว', return_date: '2026-09-10', return_reason: 'พ้นสภาพ' });

    const returnedAsset = await asServiceRole(db, () => db.query<{ status: string; lifecycle_status: string; owner_employee_id: string | null }>(
      'select status, lifecycle_status, owner_employee_id from public.assets where id = $1', [firstAssetId],
    ));
    expect(returnedAsset.rows[0]).toEqual({ status: 'พร้อมใช้งาน', lifecycle_status: 'returned', owner_employee_id: null });
  });

  it('automatically returns current assignments when an employee becomes inactive', async () => {
    const employeeId = '40000000-0000-0000-0000-000000000015';
    await createEmployee(employeeId, 'EMP-LEAVER', 'พ้นสภาพ');
    const assetId = await createAsset('AST-EA-003');

    await asUser(db, OPERATOR_ID, () => db.query(
      `select public.bulk_assign_employee_assets(
        $1, ARRAY[$2]::uuid[], '2026-09-05', null, $1, $1, $3,
        'อนุมัติ', '[]'::jsonb, null
      )`,
      [employeeId, assetId, APPROVER_ID],
    ));

    await asUser(db, OPERATOR_ID, () => db.query(
      `update public.employees set status = 'inactive' where id = $1`,
      [employeeId],
    ));

    const result = await asServiceRole(db, () => db.query<{ status: string; return_date: string }>(
      `select ea.status, ea.return_date::text
       from public.employee_assignments ea where ea.employee_id = $1`,
      [employeeId],
    ));
    expect(result.rows[0].status).toBe('คืนแล้ว');
    expect(result.rows[0].return_date).toBe(new Date().toISOString().slice(0, 10));

    const asset = await asServiceRole(db, () => db.query<{ status: string; lifecycle_status: string }>(
      'select status, lifecycle_status from public.assets where id = $1', [assetId],
    ));
    expect(asset.rows[0]).toEqual({ status: 'พร้อมใช้งาน', lifecycle_status: 'returned' });
  });
});
