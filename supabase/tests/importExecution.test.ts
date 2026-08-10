import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildImportPlan, type LegacyWorkbook } from '../../packages/migration/src/importPlan';
import { migrationManifest } from '../../packages/migration/src/manifest';
import { executeImportPlan, type AuthAdmin, type Queryable } from '../../packages/migration/src/executor';
import { asServiceRole, createTestDb } from './testDb';

let db: PGlite;
let departmentId: string;

const fakeAuthAdmin: AuthAdmin = {
  async inviteUser({ email, fullName }) {
    const result = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
      [email, fullName],
    );
    return { id: result.rows[0]!.id };
  },
};

function buildWorkbook(): LegacyWorkbook {
  return {
    Users: [{ UserID: 'U1', EmployeeCode: 'EMP1', Email: 'itadmin@example.test', FullName: 'ทดสอบ ไอที', Role: 'ITAdmin', Status: 'Active', PasswordHash: 'x', PasswordSalt: 'y' }],
    ActionPermissions: [{ PermissionKey: 'migration_test.custom', ModuleKey: 'migration_test', Action: 'custom', Description: 'ทดสอบ', Status: 'Active' }],
    RoleActionPermissions: [{ MappingID: 'RM1', Role: 'ITAdmin', PermissionKey: 'migration_test.custom', Effect: 'Allow', Status: 'Active' }],
    Employees: [{ EmployeeID: 'E1', EmployeeCode: 'EMP2', FirstNameTH: 'สมชาย', LastNameTH: 'ใจดี', Department: 'ไอที', Status: 'Active' }],
    TicketCategories: [{ CategoryID: 'TC1', CategoryName: 'Hardware ทดสอบ', Status: 'Active' }],
    LineUsers: [{ LineUserID: 'LU1', DisplayName: 'line-test', LinkedUserID: 'U1', FullName: 'ทดสอบ ไอที', Status: 'Active' }],
    Settings: [{ Key: 'MIGRATION_TEST_KEY', Value: 'on', Description: 'ทดสอบ', Group: 'test' }],
    LegalRegister: [{ LawID: 'LW1', LawName: 'พรบ.ทดสอบ', ApplicabilityStatus: 'บังคับใช้' }],
    RetentionLog: [
      { RunID: 'RUN1', RunAt: '2026-01-01T00:00:00Z', Mode: 'Apply', SheetName: 'Tickets', Action: 'archive', MatchedRows: '4', AffectedRows: '4', Status: 'Completed', RunBy: 'itadmin@example.test' },
      { RunID: 'RUN1', RunAt: '2026-01-01T00:01:00Z', Mode: 'Apply', SheetName: 'Incidents', Action: 'archive', MatchedRows: '2', AffectedRows: '1', Status: 'Completed', RunBy: 'itadmin@example.test' },
    ],
    ApprovalGroups: [{ GroupID: 'G1', GroupCode: 'IT-TEST', GroupName: 'กลุ่มทดสอบ', Department: 'ไอที', OwnerEmail: 'itadmin@example.test', Status: 'Active' }],
    ApprovalGroupMembers: [{ MemberID: 'M1', GroupID: 'G1', UserEmail: 'itadmin@example.test', MemberRole: 'Primary', Priority: '1', Status: 'Active' }],
  };
}

beforeAll(async () => {
  db = await createTestDb();
  const department = await asServiceRole(db, async () => db.query<{ id: string }>(
    `insert into public.departments (code, name_th, name_en) values ('IT-TEST', 'ไอที', 'IT') returning id`,
  ));
  departmentId = department.rows[0]!.id;
});

afterAll(async () => { await db.close(); });

describe('Phase 7 import execution (pglite, real accumulated schema)', () => {
  it('writes every hand-verified sheet to its real target table with correctly resolved references', async () => {
    const plan = buildImportPlan(buildWorkbook(), migrationManifest, { settingsAllowlist: new Set(['MIGRATION_TEST_KEY']) });
    const result = await asServiceRole(db, async () => executeImportPlan(plan, db as unknown as Queryable, fakeAuthAdmin));

    expect(result.authFailed).toEqual([]);
    expect(result.authInvited).toBe(1);
    expect(result.failed).toEqual([]);

    await asServiceRole(db, async () => {
      const profile = await db.query<{ employee_code: string; status: string; legacy_id: string }>(
        `select employee_code, status, legacy_id from public.profiles where legacy_source = 'Users' and legacy_id = 'U1'`,
      );
      expect(profile.rows).toEqual([{ employee_code: 'EMP1', status: 'active', legacy_id: 'U1' }]);

      const role = await db.query<{ key: string }>(
        `select r.key from public.user_roles ur join public.roles r on r.id = ur.role_id
         where ur.legacy_source = 'Users' and ur.legacy_id = 'U1'`,
      );
      expect(role.rows).toEqual([{ key: 'it_admin' }]);

      const permission = await db.query<{ key: string }>(`select key from public.permissions where key = 'migration_test.custom'`);
      expect(permission.rows).toHaveLength(1);

      const rolePermission = await db.query<{ effect: string }>(
        `select rp.effect from public.role_permissions rp
         join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id
         where r.key = 'it_admin' and p.key = 'migration_test.custom'`,
      );
      expect(rolePermission.rows).toEqual([{ effect: 'allow' }]);

      const employee = await db.query<{ first_name_th: string; department_id: string }>(
        `select first_name_th, department_id from public.employees where legacy_source = 'Employees' and legacy_id = 'E1'`,
      );
      expect(employee.rows).toEqual([{ first_name_th: 'สมชาย', department_id: departmentId }]);

      const category = await db.query(`select 1 from public.ticket_categories where legacy_source = 'TicketCategories' and legacy_id = 'TC1'`);
      expect(category.rows).toHaveLength(1);

      const lineUser = await db.query<{ linked_user_id: string }>(
        `select lu.linked_user_id from public.line_users lu where lu.legacy_source = 'LineUsers' and lu.legacy_id = 'LU1'`,
      );
      const profileId = (await db.query<{ id: string }>(`select id from public.profiles where legacy_source = 'Users' and legacy_id = 'U1'`)).rows[0]!.id;
      expect(lineUser.rows).toEqual([{ linked_user_id: profileId }]);

      const setting = await db.query(`select 1 from public.system_settings where key = 'MIGRATION_TEST_KEY'`);
      expect(setting.rows).toHaveLength(1);

      const legal = await db.query(`select 1 from public.legal_register where legacy_source = 'LegalRegister' and legacy_id = 'LW1'`);
      expect(legal.rows).toHaveLength(1);

      const retention = await db.query<{ matched_count: number; affected_count: number; mode: string }>(
        `select matched_count, affected_count, mode from public.governance_retention_runs where legacy_source = 'RetentionLog' and legacy_id = 'RUN1'`,
      );
      expect(retention.rows).toEqual([{ matched_count: 6, affected_count: 5, mode: 'APPLY' }]);

      const groupMember = await db.query<{ user_id: string; group_id: string }>(
        `select user_id, group_id from public.approval_group_members where legacy_source = 'ApprovalGroupMembers' and legacy_id = 'M1'`,
      );
      expect(groupMember.rows).toEqual([{ user_id: profileId, group_id: (await db.query<{ id: string }>(`select id from public.approval_groups where legacy_source = 'ApprovalGroups' and legacy_id = 'G1'`)).rows[0]!.id }]);
    });
  });

  it('is idempotent: re-running the same plan upserts in place instead of duplicating rows', async () => {
    const plan = buildImportPlan(buildWorkbook(), migrationManifest, { settingsAllowlist: new Set(['MIGRATION_TEST_KEY']) });
    const result = await asServiceRole(db, async () => executeImportPlan(plan, db as unknown as Queryable, fakeAuthAdmin));
    expect(result.failed).toEqual([]);
    expect(result.authInvited).toBe(0); // profile already exists from the previous test's run; no second auth.users row created

    await asServiceRole(db, async () => {
      const profiles = await db.query(`select count(*)::int as count from public.profiles where legacy_source = 'Users' and legacy_id = 'U1'`);
      expect(profiles.rows).toEqual([{ count: 1 }]);
      const employees = await db.query(`select count(*)::int as count from public.employees where legacy_source = 'Employees' and legacy_id = 'E1'`);
      expect(employees.rows).toEqual([{ count: 1 }]);
      const retentionRuns = await db.query(`select count(*)::int as count from public.governance_retention_runs where legacy_source = 'RetentionLog'`);
      expect(retentionRuns.rows).toEqual([{ count: 1 }]);
    });
  });

  it('rolls back the whole batch when one operation fails, leaving no partial rows behind', async () => {
    const workbook: LegacyWorkbook = {
      TicketCategories: [
        { CategoryID: 'TC-OK', CategoryName: 'จะสำเร็จ', Status: 'Active' },
        { CategoryID: 'TC-BAD', CategoryName: 'จะล้มเหลว', DefaultPriority: 'ไม่ถูกต้อง', Status: 'Active' }, // violates the default_priority check constraint
      ],
    };
    const plan = buildImportPlan(workbook, migrationManifest);
    const result = await asServiceRole(db, async () => executeImportPlan(plan, db as unknown as Queryable, fakeAuthAdmin, { batchSize: 50 }));

    expect(result.failed).toHaveLength(2); // both rows share a batch, so both roll back together
    expect(result.failed.map((f) => f.legacyId).sort()).toEqual(['TC-BAD', 'TC-OK']);

    await asServiceRole(db, async () => {
      const survivors = await db.query(`select legacy_id from public.ticket_categories where legacy_source = 'TicketCategories' and legacy_id in ('TC-OK','TC-BAD')`);
      expect(survivors.rows).toEqual([]); // the good row must NOT have been kept — all-or-nothing per batch
    });
  });
});
