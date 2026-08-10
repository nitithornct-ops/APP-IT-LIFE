import { describe, expect, it } from 'vitest';
import { buildImportPlan, HAND_VERIFIED_SHEETS, type LegacyWorkbook } from './importPlan.js';
import { migrationManifest } from './manifest.js';

describe('buildImportPlan', () => {
  it('never carries PasswordHash/PasswordSalt into an auth invite', () => {
    const workbook: LegacyWorkbook = {
      Users: [{
        UserID: 'U1', EmployeeCode: 'E001', Email: 'user1@example.com', FullName: 'ทดสอบ หนึ่ง',
        Department: 'IT', Role: 'ITAdmin', Supervisor: '', Status: 'Active',
        PasswordHash: 'super-secret-hash', PasswordSalt: 'super-secret-salt',
      }],
    };
    const plan = buildImportPlan(workbook, migrationManifest);
    expect(plan.authInvites).toHaveLength(1);
    const invite = plan.authInvites[0]!;
    expect(invite).not.toHaveProperty('PasswordHash');
    expect(invite).not.toHaveProperty('PasswordSalt');
    expect(JSON.stringify(invite)).not.toContain('super-secret');
    expect(invite.roleKey).toBe('it_admin');
    expect(invite.status).toBe('active');
  });

  it('maps every documented legacy role to its new-system role key', () => {
    const rows = ['User', 'Approver', 'ITAdmin', 'Executive', 'DPO'].map((role, index) => ({
      UserID: `U${index}`, Email: `u${index}@example.com`, FullName: role, Role: role, Status: 'Active',
    }));
    const plan = buildImportPlan({ Users: rows }, migrationManifest);
    expect(plan.authInvites.map((invite) => invite.roleKey)).toEqual(['user', 'approver', 'it_admin', 'executive', 'dpo']);
  });

  it('flags an unmapped legacy role instead of guessing', () => {
    const plan = buildImportPlan({ Users: [{ UserID: 'U9', Email: 'x@example.com', FullName: 'x', Role: 'SomeUnknownRole', Status: 'Active' }] }, migrationManifest);
    expect(plan.authInvites[0]!.roleKey).toBeNull();
    expect(plan.warnings.some((w) => w.includes('SomeUnknownRole'))).toBe(true);
  });

  it('aggregates RetentionLog detail rows into one governance_retention_runs op per RunID', () => {
    const workbook: LegacyWorkbook = {
      RetentionLog: [
        { RunID: 'R1', RunAt: '2026-01-01T00:00:00Z', Mode: 'apply', SheetName: 'Tickets', Action: 'archive', MatchedRows: '10', AffectedRows: '8', Status: 'Completed', RunBy: 'admin@example.com' },
        { RunID: 'R1', RunAt: '2026-01-01T00:05:00Z', Mode: 'apply', SheetName: 'Incidents', Action: 'archive', MatchedRows: '5', AffectedRows: '5', Status: 'Completed', RunBy: 'admin@example.com' },
        { RunID: 'R2', RunAt: '2026-01-02T00:00:00Z', Mode: 'preview', SheetName: 'Tickets', Action: 'preview', MatchedRows: '3', AffectedRows: '0', Status: 'Completed', RunBy: 'admin@example.com' },
      ],
    };
    const plan = buildImportPlan(workbook, migrationManifest);
    const runs = plan.phases.governance.filter((op) => op.table === 'governance_retention_runs');
    expect(runs).toHaveLength(2);
    const r1 = runs.find((op) => op.legacyId === 'R1')!;
    expect(r1.values.matched_count).toBe(15);
    expect(r1.values.affected_count).toBe(13);
    expect(r1.values.mode).toBe('APPLY');
    expect(JSON.parse(r1.values.detail as string).entries).toHaveLength(2);
    const r2 = runs.find((op) => op.legacyId === 'R2')!;
    expect(r2.values.mode).toBe('PREVIEW');
  });

  it('imports only allowlisted Settings keys and archives the rest', () => {
    const workbook: LegacyWorkbook = {
      Settings: [
        { Key: 'MAINTENANCE_MODE', Value: 'false', Description: 'Maintenance toggle', Group: 'system', UpdatedBy: '' },
        { Key: 'LINE_CHANNEL_SECRET', Value: 'shh', Description: 'secret', Group: 'line', UpdatedBy: '' },
      ],
    };
    const plan = buildImportPlan(workbook, migrationManifest, { settingsAllowlist: new Set(['MAINTENANCE_MODE']) });
    expect(plan.phases.reference_data.filter((op) => op.table === 'system_settings')).toHaveLength(1);
    expect(plan.archived.find((a) => a.legacyId === 'LINE_CHANNEL_SECRET')).toBeTruthy();
  });

  it('archives every Settings row when no allowlist is supplied, rather than guessing which are safe', () => {
    const plan = buildImportPlan({ Settings: [{ Key: 'X', Value: '1', Description: 'd', Group: 'g', UpdatedBy: '' }] }, migrationManifest);
    expect(plan.phases.reference_data.filter((op) => op.table === 'system_settings')).toHaveLength(0);
    expect(plan.archived).toHaveLength(1);
  });

  it('routes skip_ephemeral sheets to skipped, never into a phase', () => {
    const plan = buildImportPlan({
      LineSessions: [{ SessionHash: 'abc' }],
      RateLimits: [{ RateKey: 'rk1' }],
    }, migrationManifest);
    expect(plan.skipped).toHaveLength(2);
    expect(Object.values(plan.phases).flat()).toHaveLength(0);
  });

  it('routes schema-gap PM tables to deferred (target table not built yet), never into a phase', () => {
    const plan = buildImportPlan({ PMSchedules: [{ ScheduleID: 'S1' }] }, migrationManifest);
    expect(plan.deferred).toHaveLength(1);
    expect(Object.values(plan.phases).flat()).toHaveLength(0);
  });

  it('routes Field/PDF Designer sheets to archived — cut permanently per R-05, not deferred', () => {
    const plan = buildImportPlan({
      PDFDesignTemplates: [{ TemplateID: 'T1' }],
      FieldDefinitions: [{ FieldID: 'F1' }],
    }, migrationManifest);
    expect(plan.archived).toHaveLength(2);
    expect(plan.deferred).toHaveLength(0);
    expect(Object.values(plan.phases).flat()).toHaveLength(0);
  });

  it('routes archive-mode sheets straight to archived with no Supabase write', () => {
    const plan = buildImportPlan({ NotificationLog: [{ LogID: 'L1' }] }, migrationManifest);
    expect(plan.archived).toHaveLength(1);
    expect(Object.values(plan.phases).flat()).toHaveLength(0);
  });

  it('resolves ApprovalGroupMembers by email/legacy-id refs and normalizes enum-like columns', () => {
    const plan = buildImportPlan({
      ApprovalGroups: [{ GroupID: 'G1', GroupCode: 'IT-01', GroupName: 'IT Approvers', Department: 'IT', Status: 'Active' }],
      ApprovalGroupMembers: [{ MemberID: 'M1', GroupID: 'G1', UserEmail: 'lead@example.com', MemberRole: 'Primary', Priority: '1', Status: 'Active' }],
    }, migrationManifest);
    const group = plan.phases.reference_data.find((op) => op.table === 'approval_groups')!;
    expect(group.refs?.department_id).toEqual({ kind: 'byDepartmentName', name: 'IT', optional: true });
    const member = plan.phases.reference_data.find((op) => op.table === 'approval_group_members')!;
    expect(member.values.member_role).toBe('primary');
    expect(member.refs?.group_id).toEqual({ kind: 'byLegacyId', table: 'approval_groups', legacySource: 'ApprovalGroups', legacyId: 'G1' });
    expect(member.refs?.user_id).toEqual({ kind: 'byEmail', table: 'profiles', email: 'lead@example.com' });
  });

  it('falls back to a generic snake_case mapper for sheets without a hand-verified transform, and says so', () => {
    const plan = buildImportPlan({
      RiskRegister: [{ RiskID: 'R1', RiskName: 'ความเสี่ยง', Status: 'เปิด' }],
    }, migrationManifest);
    expect(plan.unverifiedSheets).toContain('RiskRegister');
    const op = plan.phases.governance.find((o) => o.table === 'governance_risks')!;
    expect(op.values.risk_name).toBe('ความเสี่ยง');
    expect(op.values.risk_id).toBe('R1');
  });

  it('hand-verifies ComplianceObligations with a required law_id reference (LawID is NOT NULL on the target table)', () => {
    const plan = buildImportPlan({
      ComplianceObligations: [{ ObligationID: 'O1', LawID: 'L1', Requirement: 'ต้องทำ', ApplicabilityStatus: 'บังคับใช้' }],
    }, migrationManifest);
    expect(plan.unverifiedSheets).not.toContain('ComplianceObligations');
    const op = plan.phases.governance.find((o) => o.table === 'compliance_obligations')!;
    expect(op.values.requirement).toBe('ต้องทำ');
    expect(op.values.obligation_code).toBe('O1');
    expect(op.refs?.law_id).toEqual({ kind: 'byLegacyId', table: 'legal_register', legacySource: 'LegalRegister', legacyId: 'L1' });
  });

  it('archives soft-deleted rows (IsDeleted) instead of importing them, for any sheet', () => {
    const plan = buildImportPlan({
      BackupLog: [
        { BackupID: 'B1', SystemName: 'sys', BackupType: 'Full', BackupDate: '2026-01-01', Result: 'สำเร็จ', Operator: 'op@example.com' },
        { BackupID: 'B2', SystemName: 'sys', BackupType: 'Full', BackupDate: '2026-01-01', Result: 'สำเร็จ', Operator: 'op@example.com', IsDeleted: 'TRUE' },
      ],
    }, migrationManifest);
    expect(plan.phases.operational.filter((op) => op.table === 'backup_logs')).toHaveLength(1);
    expect(plan.phases.operational.find((op) => op.table === 'backup_logs')?.legacyId).toBe('B1');
    expect(plan.archived.find((a) => a.legacyId === 'B2')).toBeTruthy();
  });

  it('coerces an unsupported WorkflowDefinitions.Mode to SEQUENTIAL (the only value the engine accepts) and warns', () => {
    const plan = buildImportPlan({
      WorkflowDefinitions: [{ DefinitionID: 'D1', WorkflowCode: 'wf-1', WorkflowName: 'n', ModuleKey: 'TICKET', Mode: 'PARALLEL', Status: 'ใช้งาน' }],
    }, migrationManifest);
    const op = plan.phases.operational.find((o) => o.table === 'workflow_definitions')!;
    expect(op.values.mode).toBe('SEQUENTIAL');
    expect(op.values.workflow_code).toBe('WF-1');
    expect(op.values.module_key).toBe('ticket');
    expect(plan.warnings.some((w) => w.includes('PARALLEL'))).toBe(true);
  });

  it('resolves WorkflowSteps.definition_id as a required reference to WorkflowDefinitions', () => {
    const plan = buildImportPlan({
      WorkflowSteps: [{ StepID: 'S1', DefinitionID: 'D1', StepCode: 'step-1', StepName: 'n', ApprovalType: 'user', ApproverValue: 'x' }],
    }, migrationManifest);
    const op = plan.phases.operational.find((o) => o.table === 'workflow_steps')!;
    expect(op.refs?.definition_id).toEqual({ kind: 'byLegacyId', table: 'workflow_definitions', legacySource: 'WorkflowDefinitions', legacyId: 'D1' });
    expect(op.values.approval_type).toBe('USER');
  });

  it('hand-verifies Tickets with a required requester and optional category/assignee refs', () => {
    const plan = buildImportPlan({
      Tickets: [{ TicketID: 'T1', Title: 't', RequesterEmail: 'req@example.com', Description: 'd', Category: 'TC1', Assignee: '' }],
    }, migrationManifest);
    expect(plan.unverifiedSheets).not.toContain('Tickets');
    const op = plan.phases.operational.find((o) => o.table === 'tickets')!;
    expect(op.refs?.requester_id).toEqual({ kind: 'byEmail', table: 'profiles', email: 'req@example.com' });
    expect(op.refs?.category_id).toEqual({ kind: 'byLegacyId', table: 'ticket_categories', legacySource: 'TicketCategories', legacyId: 'TC1', optional: true });
    expect(op.refs?.assignee_id).toBeUndefined();
  });

  it('places AuditTrail in the audit_history phase, run strictly last', () => {
    const plan = buildImportPlan({
      Employees: [{ EmployeeID: 'E1', EmployeeCode: 'EMP1', FirstNameTH: 'ก', LastNameTH: 'ข', Status: 'Active' }],
      AuditTrail: [{ LogID: 'A1', UserID: 'U1', Action: 'login' }],
    }, migrationManifest);
    expect(plan.phases.audit_history.some((op) => op.table === 'audit_logs')).toBe(true);
    expect(plan.phases.reference_data.some((op) => op.table === 'employees')).toBe(true);
  });

  it('keeps the hand-verified sheet list honest against what buildImportPlan actually special-cases', () => {
    // Every sheet named here must have a dedicated transform branch in buildImportPlan,
    // not the generic fallback — this test fails loudly if the two ever drift apart.
    const workbook: LegacyWorkbook = {
      Users: [{ UserID: 'U1', Email: 'a@example.com', FullName: 'a', Role: 'User', Status: 'Active' }],
      ActionPermissions: [{ PermissionKey: 'x.view', ModuleKey: 'x', Action: 'view', Description: 'd', Status: 'Active' }],
      RoleActionPermissions: [{ MappingID: 'M1', Role: 'User', PermissionKey: 'x.view', Effect: 'Allow', Status: 'Active' }],
      ApprovalGroups: [{ GroupID: 'G1', GroupCode: 'C1', GroupName: 'n', Status: 'Active' }],
      ApprovalGroupMembers: [{ MemberID: 'MM1', GroupID: 'G1', UserEmail: 'a@example.com', MemberRole: 'member', Status: 'Active' }],
      Employees: [{ EmployeeID: 'E1', EmployeeCode: 'EMP1', FirstNameTH: 'ก', LastNameTH: 'ข', Status: 'Active' }],
      TicketCategories: [{ CategoryID: 'TC1', CategoryName: 'n', Status: 'Active' }],
      LineUsers: [{ LineUserID: 'L1' }],
      Settings: [{ Key: 'K', Value: 'v', Description: 'd', Group: 'g' }],
      RetentionLog: [{ RunID: 'R1', RunAt: '2026-01-01', Mode: 'apply', SheetName: 's', Action: 'a', MatchedRows: '1', AffectedRows: '1', Status: 'Completed' }],
      LegalRegister: [{ LawID: 'LW1', LawName: 'n', ApplicabilityStatus: 'x' }],
      AuditTrail: [{ LogID: 'AT1', Action: 'login', Module: 'auth', Result: 'Success' }],
      PolicyMapping: [{ MapID: 'PM1', Module: 'ticket', Feature: 'x', PolicyDocument: 'doc', PolicyClause: 'c1' }],
      ServiceCatalog: [{ CatalogID: 'SC1', ServiceCode: 'code1', ServiceName: 'n' }],
      ComplianceObligations: [{ ObligationID: 'CO1', LawID: 'LW1', Requirement: 'req' }],
      AssetCategories: [{ CategoryID: 'AC1', CategoryName: 'n', CodePrefix: 'PFX' }],
      BackupLog: [{ BackupID: 'BL1', SystemName: 'sys', BackupType: 'Full', BackupDate: '2026-01-01', Result: 'สำเร็จ', Operator: 'a@example.com' }],
      PersonalTasks: [{ TaskID: 'PT1', OwnerEmail: 'a@example.com', Title: 't' }],
      Ticket_Worklogs: [{ WorklogID: 'TW1', TicketID: 'T1', Action: 'update', ActorEmail: 'a@example.com' }],
      RecoveryTests: [{ TestID: 'RT1', SystemName: 'sys', TestDate: '2026-01-01', Result: 'ผ่าน', Tester: 'a@example.com' }],
      WorkflowDefinitions: [{ DefinitionID: 'WD1', WorkflowCode: 'wf-1', WorkflowName: 'n', ModuleKey: 'ticket' }],
      WorkflowSteps: [{ StepID: 'WS1', DefinitionID: 'WD1', StepCode: 'step-1', StepName: 'n', ApprovalType: 'USER', ApproverValue: 'x' }],
      Tickets: [{ TicketID: 'T1', Title: 't', RequesterEmail: 'a@example.com', Description: 'd' }],
    };
    const plan = buildImportPlan(workbook, migrationManifest, { settingsAllowlist: new Set(['K']) });
    for (const sheet of HAND_VERIFIED_SHEETS) expect(plan.unverifiedSheets).not.toContain(sheet);
  });

  it('computes attachment candidates alongside the SQL plan (planning only — bytes are never fetched here)', () => {
    const plan = buildImportPlan({
      Tickets: [{ TicketID: 'T1', EvidenceLink: 'https://drive.example/file1' }],
    }, migrationManifest);
    expect(plan.attachmentCandidates.directCandidates).toBe(1);
    expect(plan.attachmentCandidates.locatorsIncluded).toBe(false);
  });
});
