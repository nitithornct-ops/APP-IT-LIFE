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
    AuditTrail: [{ LogID: 'AT1', Timestamp: '2026-01-01T00:00:00Z', ActorEmail: 'itadmin@example.test', Action: 'login', Module: 'auth', Result: 'Success', Detail: 'plain text detail, not JSON' }],
    PolicyMapping: [{ MapID: 'PM1', Module: 'ticket', Feature: 'สร้าง Ticket', PolicyDocument: 'ISMS-01', PolicyClause: '5.1' }],
    ServiceCatalog: [{ CatalogID: 'SC1', ServiceCode: 'sc-1', ServiceName: 'ขอเข้าถึงระบบ', ApprovalMode: 'group', Approver: 'G1', FulfillmentGroup: 'ไอที', Owner: 'itadmin@example.test', Status: 'active' }],
    ComplianceObligations: [{ ObligationID: 'CO1', LawID: 'LW1', Requirement: 'ต้องปฏิบัติตาม' }],
    AssetCategories: [{ CategoryID: 'AC1', CategoryName: 'โน้ตบุ๊ก', CodePrefix: 'NB' }],
    BackupLog: [{ BackupID: 'BL1', SystemName: 'core-db', BackupType: 'Full', BackupDate: '2026-01-01', Result: 'สำเร็จ', Operator: 'itadmin@example.test' }],
    PersonalTasks: [{ TaskID: 'PT1', OwnerEmail: 'itadmin@example.test', Title: 'ทดสอบงาน' }],
    Tickets: [{ TicketID: 'TCK-20260101-0123456789ABCDEF', Title: 'เครื่องพิมพ์เสีย', RequesterEmail: 'itadmin@example.test', RequesterName: 'ทดสอบ ไอที', Department: 'ไอที', Description: 'เครื่องพิมพ์ใช้งานไม่ได้', Category: 'Hardware ทดสอบ', SourceChannel: 'WEB_INTERNAL' }],
    Ticket_Worklogs: [{ WorklogID: 'TW1', TicketID: 'TCK-20260101-0123456789ABCDEF', Action: 'รับเรื่อง', ActorEmail: 'itadmin@example.test', ActorName: 'ทดสอบ ไอที', ActorIdentityType: 'INTERNAL' }],
    RecoveryTests: [{ TestID: 'RT1', SystemName: 'core-db', TestDate: '2026-01-01', Result: 'ผ่าน', Tester: 'itadmin@example.test' }],
    WorkflowDefinitions: [{ DefinitionID: 'WD1', WorkflowCode: 'wf-access', WorkflowName: 'อนุมัติสิทธิ์', ModuleKey: 'ACCESS_REQUEST', Mode: 'PARALLEL', Status: 'ใช้งาน' }],
    WorkflowSteps: [{ StepID: 'WS1', DefinitionID: 'WD1', StepCode: 'step-1', StepName: 'หัวหน้าอนุมัติ', ApprovalType: 'role', ApproverValue: 'manager' }],
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

  it('writes the second batch of hand-verified sheets (added when the user asked to finish the system before real data arrives)', async () => {
    const plan = buildImportPlan(buildWorkbook(), migrationManifest, { settingsAllowlist: new Set(['MIGRATION_TEST_KEY']) });
    const result = await asServiceRole(db, async () => executeImportPlan(plan, db as unknown as Queryable, fakeAuthAdmin));
    expect(result.failed).toEqual([]);

    await asServiceRole(db, async () => {
      const audit = await db.query<{ result: string; detail: string }>(
        `select result, detail::text as detail from public.audit_logs where legacy_source = 'AuditTrail' and legacy_id = 'AT1'`,
      );
      expect(audit.rows[0]?.result).toBe('success');
      expect(JSON.parse(audit.rows[0]!.detail)).toBe('plain text detail, not JSON'); // non-JSON legacy text must not break the jsonb column

      const control = await db.query(`select 1 from public.governance_controls where legacy_source = 'PolicyMapping' and legacy_id = 'PM1'`);
      expect(control.rows).toHaveLength(1);

      const catalog = await db.query<{ approval_mode: string; approval_group_id: string; fulfillment_group_id: string }>(
        `select approval_mode, approval_group_id, fulfillment_group_id from public.service_catalog where legacy_source = 'ServiceCatalog' and legacy_id = 'SC1'`,
      );
      const approvalGroupId = (await db.query<{ id: string }>(`select id from public.approval_groups where legacy_source = 'ApprovalGroups' and legacy_id = 'G1'`)).rows[0]!.id;
      expect(catalog.rows).toEqual([{ approval_mode: 'group', approval_group_id: approvalGroupId, fulfillment_group_id: departmentId }]);

      const obligation = await db.query<{ law_id: string }>(`select law_id from public.compliance_obligations where legacy_source = 'ComplianceObligations' and legacy_id = 'CO1'`);
      const lawId = (await db.query<{ id: string }>(`select id from public.legal_register where legacy_source = 'LegalRegister' and legacy_id = 'LW1'`)).rows[0]!.id;
      expect(obligation.rows).toEqual([{ law_id: lawId }]);

      const assetCategory = await db.query(`select 1 from public.asset_categories where legacy_source = 'AssetCategories' and legacy_id = 'AC1'`);
      expect(assetCategory.rows).toHaveLength(1);

      const backup = await db.query<{ result: string; backup_type: string }>(`select result, backup_type from public.backup_logs where legacy_source = 'BackupLog' and legacy_id = 'BL1'`);
      expect(backup.rows).toEqual([{ result: 'สำเร็จ', backup_type: 'Full' }]);

      const task = await db.query(`select 1 from public.personal_tasks where legacy_source = 'PersonalTasks' and legacy_id = 'PT1'`);
      expect(task.rows).toHaveLength(1);

      const ticket = await db.query<{ id: string; ticket_no: string; requester_id: string; category_id: string; department_name_snapshot: string }>(`select id, ticket_no, requester_id, category_id, department_name_snapshot from public.tickets where legacy_source = 'Tickets' and legacy_id = 'TCK-20260101-0123456789ABCDEF'`);
      const profileId = (await db.query<{ id: string }>(`select id from public.profiles where legacy_source = 'Users' and legacy_id = 'U1'`)).rows[0]!.id;
      const categoryId = (await db.query<{ id: string }>(`select id from public.ticket_categories where legacy_source = 'TicketCategories' and legacy_id = 'TC1'`)).rows[0]!.id;
      expect(ticket.rows).toEqual([{
        id: ticket.rows[0]!.id,
        ticket_no: 'TCK-20260101-0123456789ABCDEF',
        requester_id: profileId,
        category_id: categoryId,
        department_name_snapshot: 'ไอที',
      }]);

      const worklog = await db.query<{ ticket_id: string }>(`select ticket_id from public.ticket_worklogs where legacy_source = 'Ticket_Worklogs' and legacy_id = 'TW1'`);
      expect(worklog.rows).toEqual([{ ticket_id: ticket.rows[0]!.id }]); // proves cross-sheet FK resolution within the same batch (Tickets runs before Ticket_Worklogs)

      const recovery = await db.query(`select 1 from public.recovery_tests where legacy_source = 'RecoveryTests' and legacy_id = 'RT1'`);
      expect(recovery.rows).toHaveLength(1);

      const workflowDef = await db.query<{ mode: string; module_key: string }>(`select mode, module_key from public.workflow_definitions where legacy_source = 'WorkflowDefinitions' and legacy_id = 'WD1'`);
      expect(workflowDef.rows).toEqual([{ mode: 'SEQUENTIAL', module_key: 'access_request' }]); // legacy "PARALLEL" is coerced — the engine only supports SEQUENTIAL

      const workflowStep = await db.query<{ definition_id: string; approval_type: string }>(`select definition_id, approval_type from public.workflow_steps where legacy_source = 'WorkflowSteps' and legacy_id = 'WS1'`);
      const definitionId = (await db.query<{ id: string }>(`select id from public.workflow_definitions where legacy_source = 'WorkflowDefinitions' and legacy_id = 'WD1'`)).rows[0]!.id;
      expect(workflowStep.rows).toEqual([{ definition_id: definitionId, approval_type: 'ROLE' }]);
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
