import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const OPERATOR_ID = '30000000-0000-0000-0000-000000000001';
const BORROWER_ID = '30000000-0000-0000-0000-000000000002';
const APPROVER_ID = '30000000-0000-0000-0000-000000000003';
const BORROWER_EMPLOYEE_ID = '30000000-0000-0000-0000-000000000011';
const APPROVER_EMPLOYEE_ID = '30000000-0000-0000-0000-000000000012';
const RECEIVER_EMPLOYEE_ID = '30000000-0000-0000-0000-000000000013';

let db: PGlite;

async function createUser(userId: string, email: string) {
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email]);
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = 'it_admin'`,
      [userId],
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
     values ($1, 'Notebook ทดสอบ', 'พร้อมใช้งาน', 'ready', 'คลัง IT') returning id`,
    [code],
  ));
  return result.rows[0].id;
}

async function createLoan(assetId: string, dueAt = '2026-07-31') {
  const result = await asUser(db, OPERATOR_ID, () => db.query<{ create_asset_loan: { loan_id: string } }>(
    `select public.create_asset_loan(
      $1, $2, $3, '2026-07-01', $4, 'นำไปติดตั้งหน้างาน',
      'เครื่องและหน้าจอปกติ', '["Adapter", "กระเป๋า"]'::jsonb, 3, true, 'ผู้ยืมทดสอบ'
    ) as create_asset_loan`,
    [assetId, BORROWER_EMPLOYEE_ID, APPROVER_EMPLOYEE_ID, dueAt],
  ));
  return result.rows[0].create_asset_loan.loan_id;
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(OPERATOR_ID, 'asset-loan-operator@test.local');
  await createUser(BORROWER_ID, 'asset-loan-borrower@test.local');
  await createUser(APPROVER_ID, 'asset-loan-approver@test.local');
  await createEmployee(BORROWER_EMPLOYEE_ID, 'EMP-BORROWER', 'ผู้ยืม');
  await createEmployee(APPROVER_EMPLOYEE_ID, 'EMP-APPROVER', 'ผู้อนุมัติ');
  await createEmployee(RECEIVER_EMPLOYEE_ID, 'EMP-RECEIVER', 'ผู้รับคืน');
});

afterAll(async () => db.close());

describe('Asset Borrow / Return register', () => {
  it('creates a complete loan and synchronizes Asset Registry atomically', async () => {
    const assetId = await createAsset('AST-LOAN-001');
    const loanId = await createLoan(assetId, '2026-09-30');

    const rows = await asServiceRole(db, () => db.query<{
      loan_status: string;
      purpose: string;
      condition_before: string;
      companion_equipment: string;
      asset_status: string;
      lifecycle_status: string;
      owner_employee_id: string;
      loan_due_date: string;
    }>(
      `select l.status as loan_status, l.purpose, l.condition_before,
              l.companion_equipment::text as companion_equipment,
              a.status as asset_status, a.lifecycle_status, a.owner_employee_id, a.loan_due_date::text as loan_due_date
       from public.asset_loans l join public.assets a on a.id = l.asset_id where l.id = $1`,
      [loanId],
    ));
    expect(rows.rows[0]).toMatchObject({
      loan_status: 'active',
      purpose: 'นำไปติดตั้งหน้างาน',
      condition_before: 'เครื่องและหน้าจอปกติ',
      asset_status: 'ใช้งานอยู่',
      lifecycle_status: 'checked_out',
      owner_employee_id: BORROWER_EMPLOYEE_ID,
      loan_due_date: '2026-09-30',
    });
    expect(rows.rows[0].companion_equipment).toContain('Adapter');
  });

  it('rejects an incomplete acknowledgement without changing the asset', async () => {
    const assetId = await createAsset('AST-LOAN-002');
    await expect(asUser(db, OPERATOR_ID, () => db.query(
      `select public.create_asset_loan(
        $1, $2, $3, '2026-07-01', '2026-07-31', 'ทดสอบ', 'ปกติ', '[]'::jsonb, 3, false, null
      )`,
      [assetId, BORROWER_EMPLOYEE_ID, APPROVER_EMPLOYEE_ID],
    ))).rejects.toThrow(/ASSET_LOAN_ACKNOWLEDGEMENT_REQUIRED/);

    const asset = await asServiceRole(db, () => db.query<{ status: string; owner_employee_id: string | null }>(
      'select status, owner_employee_id from public.assets where id = $1', [assetId],
    ));
    expect(asset.rows[0]).toEqual({ status: 'พร้อมใช้งาน', owner_employee_id: null });
  });

  it('returns a damaged asset, keeps the loan evidence, and dispatches one reminder', async () => {
    const assetId = await createAsset('AST-LOAN-003');
    const loanId = await createLoan(assetId, '2026-07-31');

    const reminder = await asServiceRole(db, () => db.query<{ count: number }>(
      `select public.dispatch_due_asset_loan_reminders('2026-07-28T02:01:00Z') as count`,
    ));
    const secondReminder = await asServiceRole(db, () => db.query<{ count: number }>(
      `select public.dispatch_due_asset_loan_reminders('2026-07-29T02:01:00Z') as count`,
    ));
    expect(reminder.rows[0].count).toBe(1);
    expect(secondReminder.rows[0].count).toBe(0);

    await asUser(db, OPERATOR_ID, () => db.query(
      `select public.return_asset_loan(
        $1, '2026-07-30', $2, 'หน้าจอแตก', 'damaged', 'หน้าจอแตกจากการขนส่ง', 'ส่งซ่อม', 'คลังซ่อม'
      )`,
      [loanId, RECEIVER_EMPLOYEE_ID],
    ));

    const result = await asServiceRole(db, () => db.query<{
      loan_status: string;
      return_outcome: string;
      asset_status: string;
      lifecycle_status: string;
      return_receiver_employee_id: string;
    }>(
      `select l.status as loan_status, l.return_outcome, a.status as asset_status,
              a.lifecycle_status, l.return_receiver_employee_id
       from public.asset_loans l join public.assets a on a.id = l.asset_id where l.id = $1`,
      [loanId],
    ));
    expect(result.rows[0]).toMatchObject({
      loan_status: 'returned',
      return_outcome: 'damaged',
      asset_status: 'ซ่อมบำรุง',
      lifecycle_status: 'repair',
      return_receiver_employee_id: RECEIVER_EMPLOYEE_ID,
    });

    const notifications = await asServiceRole(db, () => db.query<{ type: string }>(
      `select type from public.notifications where recipient_id = $1 and type = 'asset_loan_reminder'`,
      [OPERATOR_ID],
    ));
    expect(notifications.rows).toEqual([{ type: 'asset_loan_reminder' }]);
  });
});
