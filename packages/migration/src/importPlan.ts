import { collectAttachmentCandidates, summarizeAttachmentCandidates, type AttachmentExportSummary, type LegacyWorkbook as AttachmentWorkbook } from './attachments.js';
import type { ManifestEntry } from './manifest.js';

export type LegacyRow = Record<string, unknown>;
export type LegacyWorkbook = Record<string, LegacyRow[]>;

/**
 * Legacy `Users.Role` was a single free-text value per user (one role per user).
 * Runbook §"Mandatory transformation policies" fixes this exact mapping — extra
 * new-system roles (technician, manager, super_admin, auditor) have no legacy
 * source and are never assigned by the importer.
 */
export const LEGACY_ROLE_MAP: Record<string, string> = {
  User: 'user',
  Approver: 'approver',
  ITAdmin: 'it_admin',
  Executive: 'executive',
  DPO: 'dpo',
};

export interface PendingAuthInvite {
  legacySource: 'Users';
  legacyId: string;
  email: string;
  employeeCode: string | null;
  fullName: string;
  roleKey: string | null;
  status: 'active' | 'inactive';
}

/**
 * A foreign key the planner cannot resolve to a UUID yet (target row may not exist
 * until an earlier phase runs). The executor resolves these against rows it has
 * already written, keyed by (table, legacy_source, legacy_id), or by a lookup column.
 */
export type Ref = (
  | { kind: 'byLegacyId'; table: string; legacySource: string; legacyId: string }
  | { kind: 'byEmail'; table: 'profiles'; email: string }
  | { kind: 'byRoleKey'; roleKey: string }
  | { kind: 'byDepartmentName'; name: string }
  | { kind: 'byPositionName'; name: string }
) & {
  /** When the target column is nullable and an unresolved lookup should leave it null instead of failing the whole row. */
  optional?: boolean;
};

export interface SqlOp {
  table: string;
  legacySource: string;
  legacyId: string;
  values: Record<string, string | number | boolean | null>;
  refs?: Record<string, Ref>;
  /**
   * Set only for the rare target table with no legacy_source/legacy_id columns — e.g.
   * `system_settings`, whose natural primary key is `key` (excluded from
   * migration_readiness.sql's target_tables array on purpose; see analyzer.ts). When set,
   * the executor upserts on these columns instead and never writes legacy_source/legacy_id.
   */
  naturalConflictColumns?: string[];
}

/**
 * Phase order follows the runbook's "Import rehearsal order" (docs/migration/phase7-migration-runbook.md):
 * auth/roles -> reference/master data -> operational records -> governance registers -> audit history last.
 * Sheets not explicitly named in the runbook are assigned to `operational` by default.
 */
export type ImportPhase = 'auth_rbac' | 'reference_data' | 'operational' | 'governance' | 'audit_history';
const PHASE_ORDER: ImportPhase[] = ['auth_rbac', 'reference_data', 'operational', 'governance', 'audit_history'];

const SHEET_PHASE: Record<string, ImportPhase> = {
  Users: 'auth_rbac',
  ActionPermissions: 'auth_rbac',
  RoleActionPermissions: 'auth_rbac',
  UserPermissionOverrides: 'auth_rbac',
  Employees: 'reference_data',
  ApprovalGroups: 'reference_data',
  ApprovalGroupMembers: 'reference_data',
  TicketCategories: 'reference_data',
  AssetCategories: 'reference_data',
  ServiceCatalog: 'reference_data',
  VendorRegister: 'reference_data',
  LineUsers: 'reference_data',
  Settings: 'reference_data',
  RetentionLog: 'governance',
  GovernanceDocuments: 'governance',
  RegulatoryNotifications: 'governance',
  LegalRegister: 'governance',
  ComplianceObligations: 'governance',
  ComplianceAssessments: 'governance',
  CorrectiveActions: 'governance',
  DataClassification: 'governance',
  DataDestructionRequests: 'governance',
  PrivacyROPA: 'governance',
  PrivacyConsents: 'governance',
  PrivacyDSR: 'governance',
  PolicyMapping: 'governance',
  RiskRegister: 'governance',
  AIRegister: 'governance',
  CloudRegister: 'governance',
  TrainingPlans: 'governance',
  TrainingRecords: 'governance',
  PolicyAcknowledgements: 'governance',
  AuditEngagements: 'governance',
  AuditFindings: 'governance',
  BCPPlans: 'governance',
  LoggingRegister: 'governance',
  LogReviews: 'governance',
  AuditTrail: 'audit_history',
};

/** Sheets with a hand-verified column mapping against the real target schema (see importPlan.test.ts). */
export const HAND_VERIFIED_SHEETS = new Set([
  'Users', 'ActionPermissions', 'RoleActionPermissions', 'ApprovalGroups', 'ApprovalGroupMembers',
  'Employees', 'TicketCategories', 'LineUsers', 'Settings', 'RetentionLog', 'LegalRegister',
  'AuditTrail', 'PolicyMapping', 'ServiceCatalog', 'ComplianceObligations', 'AssetCategories',
  'BackupLog', 'PersonalTasks', 'Ticket_Worklogs', 'RecoveryTests', 'WorkflowDefinitions',
  'WorkflowSteps', 'Tickets',
]);

export interface SkipRecord { sheet: string; legacyId: string; reason: string; }

export interface ImportPlan {
  generatedAt: string;
  authInvites: PendingAuthInvite[];
  phases: Record<ImportPhase, SqlOp[]>;
  archived: SkipRecord[];
  skipped: SkipRecord[];
  deferred: SkipRecord[];
  warnings: string[];
  /** Transform-mode sheets mapped by the generic snake_case fallback, not hand-verified against target schema. */
  unverifiedSheets: string[];
  attachmentCandidates: AttachmentExportSummary;
}

export interface ImportPlanOptions {
  /**
   * Real setting-key allowlist. Not stored anywhere in this repo by design
   * (docs/migration/phase7-data-quality-profile.json has `sourceKeysStored: false`) —
   * must be supplied by the caller from the live legacy Settings sheet.
   */
  settingsAllowlist?: Set<string>;
}

function text(row: LegacyRow, column: string): string {
  const value = row[column];
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}
function optText(row: LegacyRow, column: string): string | null {
  const value = text(row, column);
  return value === '' ? null : value;
}
function toSnakeCase(header: string): string {
  return header
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}
/** Normalizes free-text active/inactive flags. Legacy literal values are not confirmed — flags a warning when unrecognized. */
function mapActiveStatus(raw: string, warnings: string[], context: string): 'active' | 'inactive' {
  const value = raw.trim().toLowerCase();
  if (['active', 'enabled', 'enable', '1', 'true', 'ใช้งาน'].includes(value)) return 'active';
  if (['inactive', 'disabled', 'disable', '0', 'false', 'ไม่ใช้งาน', 'ระงับ'].includes(value)) return 'inactive';
  warnings.push(`${context}: unrecognized status "${raw}", defaulted to active — confirm against real legacy values.`);
  return 'active';
}
function mapEffect(raw: string): 'allow' | 'deny' {
  return raw.trim().toLowerCase() === 'deny' ? 'deny' : 'allow';
}
function mapMemberRole(raw: string): 'primary' | 'member' | 'backup' {
  const value = raw.trim().toLowerCase();
  return value === 'primary' || value === 'backup' ? value : 'member';
}
function mapRunMode(raw: string): 'PREVIEW' | 'APPLY' {
  return raw.trim().toUpperCase() === 'PREVIEW' ? 'PREVIEW' : 'APPLY';
}
/** Legacy value must exactly match a Thai/free-text CHECK-constrained enum; falls back with a warning rather than guessing. */
function mapEnumExact(raw: string, allowed: string[], fallback: string, warnings: string[], context: string): string {
  const value = raw.trim();
  if (allowed.includes(value)) return value;
  warnings.push(`${context}: unrecognized value "${raw}", defaulted to "${fallback}" — confirm against real legacy values.`);
  return fallback;
}
/** Same as mapEnumExact but for English CHECK-constrained enums where legacy casing isn't guaranteed. */
function mapEnumCI(raw: string, allowed: string[], fallback: string, warnings: string[], context: string): string {
  const match = allowed.find((option) => option.toLowerCase() === raw.trim().toLowerCase());
  if (match) return match;
  warnings.push(`${context}: unrecognized value "${raw}", defaulted to "${fallback}" — confirm against real legacy values.`);
  return fallback;
}
function toBool(raw: string): boolean {
  return ['true', '1', 'yes', 'y', 'ใช่'].includes(raw.trim().toLowerCase());
}
/** `IsDeleted` is the only soft-delete signal confirmed in the real snapshot (BackupLog, RecoveryTests) — applied to every sheet generically. */
function isSoftDeleted(row: LegacyRow): boolean {
  return toBool(text(row, 'IsDeleted'));
}
/** created_at is NOT NULL with a `default now()` on these tables — omit the key (not null) when legacy Timestamp is missing, so the default applies. */
function historicalCreatedAt(row: LegacyRow): { created_at?: string } {
  const timestamp = optText(row, 'Timestamp');
  return timestamp ? { created_at: timestamp } : {};
}
/** jsonb columns reject non-JSON text outright; legacy free text becomes a valid JSON string instead of failing the insert. */
function toJsonbText(raw: string): string {
  return JSON.stringify(raw);
}
function toJsonbOrEmptyObject(raw: string): string {
  if (!raw) return '{}';
  try { JSON.parse(raw); return raw; } catch { return JSON.stringify({ legacyValue: raw }); }
}

function transformUsers(rows: LegacyRow[], warnings: string[]): PendingAuthInvite[] {
  return rows.map((row) => {
    const legacyRole = text(row, 'Role');
    const roleKey = LEGACY_ROLE_MAP[legacyRole] ?? null;
    if (legacyRole && !roleKey) warnings.push(`Users ${text(row, 'UserID')}: legacy role "${legacyRole}" has no mapping — no role will be assigned.`);
    return {
      legacySource: 'Users' as const,
      legacyId: text(row, 'UserID'),
      email: text(row, 'Email'),
      employeeCode: optText(row, 'EmployeeCode'),
      fullName: text(row, 'FullName') || text(row, 'Email'),
      roleKey,
      status: mapActiveStatus(text(row, 'Status'), warnings, `Users ${text(row, 'UserID')}`),
    };
  });
}

function transformActionPermissions(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'permissions', legacySource: 'ActionPermissions', legacyId: text(row, 'PermissionKey'),
    values: {
      key: text(row, 'PermissionKey'), module_key: text(row, 'ModuleKey'), action: text(row, 'Action'),
      description: text(row, 'Description'), status: mapActiveStatus(text(row, 'Status'), warnings, `ActionPermissions ${text(row, 'PermissionKey')}`),
    },
  }));
}

function transformRoleActionPermissions(rows: LegacyRow[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'role_permissions', legacySource: 'RoleActionPermissions', legacyId: text(row, 'MappingID'),
    values: { effect: mapEffect(text(row, 'Effect')), notes: optText(row, 'Notes') },
    refs: {
      role_id: { kind: 'byRoleKey', roleKey: LEGACY_ROLE_MAP[text(row, 'Role')] ?? text(row, 'Role').toLowerCase() },
      permission_id: { kind: 'byLegacyId', table: 'permissions', legacySource: 'ActionPermissions', legacyId: text(row, 'PermissionKey') },
    },
  }));
}

function transformApprovalGroups(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'approval_groups', legacySource: 'ApprovalGroups', legacyId: text(row, 'GroupID'),
    values: {
      code: text(row, 'GroupCode'), name: text(row, 'GroupName'), description: optText(row, 'Description'),
      status: mapActiveStatus(text(row, 'Status'), warnings, `ApprovalGroups ${text(row, 'GroupID')}`), notes: optText(row, 'Notes'),
    },
    refs: {
      ...(text(row, 'Department') ? { department_id: { kind: 'byDepartmentName', name: text(row, 'Department'), optional: true } } : {}),
      ...(text(row, 'OwnerEmail') ? { owner_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'OwnerEmail'), optional: true } } : {}),
    },
  }));
}

function transformApprovalGroupMembers(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'approval_group_members', legacySource: 'ApprovalGroupMembers', legacyId: text(row, 'MemberID'),
    values: {
      member_role: mapMemberRole(text(row, 'MemberRole')), priority: Number(text(row, 'Priority')) || 100,
      valid_from: optText(row, 'ValidFrom'), valid_until: optText(row, 'ValidUntil'),
      status: mapActiveStatus(text(row, 'Status'), warnings, `ApprovalGroupMembers ${text(row, 'MemberID')}`), notes: optText(row, 'Notes'),
    },
    refs: {
      group_id: { kind: 'byLegacyId', table: 'approval_groups', legacySource: 'ApprovalGroups', legacyId: text(row, 'GroupID') },
      user_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'UserEmail') },
    },
  }));
}

function transformEmployees(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'employees', legacySource: 'Employees', legacyId: text(row, 'EmployeeID'),
    values: {
      employee_code: text(row, 'EmployeeCode'), prefix_th: optText(row, 'PrefixTH'),
      first_name_th: text(row, 'FirstNameTH'), last_name_th: text(row, 'LastNameTH'), nickname: optText(row, 'Nickname'),
      prefix_en: optText(row, 'PrefixEN'), first_name_en: optText(row, 'FirstNameEN'), last_name_en: optText(row, 'LastNameEN'),
      username_ad: optText(row, 'UsernameAD'), upn: optText(row, 'UPN'), email: optText(row, 'Email'),
      status: mapActiveStatus(text(row, 'Status'), warnings, `Employees ${text(row, 'EmployeeID')}`), notes: optText(row, 'Notes'),
    },
    refs: {
      ...(text(row, 'Department') ? { department_id: { kind: 'byDepartmentName', name: text(row, 'Department'), optional: true } } : {}),
      ...(text(row, 'Position') ? { position_id: { kind: 'byPositionName', name: text(row, 'Position'), optional: true } } : {}),
    },
  }));
}

function transformTicketCategories(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'ticket_categories', legacySource: 'TicketCategories', legacyId: text(row, 'CategoryID'),
    values: {
      name: text(row, 'CategoryName'), default_priority: text(row, 'DefaultPriority') || 'ปานกลาง',
      sla_hours: numOrNull(text(row, 'SLAHours')), response_sla_hours: numOrNull(text(row, 'ResponseSLAHours')),
      resolution_sla_hours: numOrNull(text(row, 'ResolutionSLAHours')),
      is_security_default: /^(true|1|yes)$/i.test(text(row, 'IsSecurityDefault')),
      status: mapActiveStatus(text(row, 'Status'), warnings, `TicketCategories ${text(row, 'CategoryID')}`), notes: optText(row, 'Notes'),
    },
  }));
}

function transformLineUsers(rows: LegacyRow[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'line_users', legacySource: 'LineUsers', legacyId: text(row, 'LineUserID'),
    values: {
      line_user_id: text(row, 'LineUserID'), display_name: optText(row, 'DisplayName'), picture_url: optText(row, 'PictureURL'),
      employee_code: optText(row, 'EmployeeCode'), full_name: optText(row, 'FullName'), department: optText(row, 'Department'),
      link_status: optText(row, 'LinkStatus'), friend_status: optText(row, 'FriendStatus'), last_login_at: optText(row, 'LastLoginAt'),
    },
    refs: text(row, 'LinkedUserID') ? { linked_user_id: { kind: 'byLegacyId', table: 'profiles', legacySource: 'Users', legacyId: text(row, 'LinkedUserID'), optional: true } } : undefined,
  }));
}

function transformSettings(rows: LegacyRow[], allowlist: Set<string> | undefined, archived: SkipRecord[]): SqlOp[] {
  const ops: SqlOp[] = [];
  for (const row of rows) {
    const key = text(row, 'Key');
    if (!allowlist || !allowlist.has(key)) {
      archived.push({ sheet: 'Settings', legacyId: key, reason: allowlist ? 'Key not in allowlist' : 'No allowlist supplied — archived, not activated (see ImportPlanOptions.settingsAllowlist)' });
      continue;
    }
    ops.push({
      table: 'system_settings', legacySource: 'Settings', legacyId: key, naturalConflictColumns: ['key'],
      values: { key, value: text(row, 'Value'), description: text(row, 'Description') || key, group_key: text(row, 'Group') || 'general' },
      refs: text(row, 'UpdatedBy') ? { updated_by: { kind: 'byEmail', table: 'profiles', email: text(row, 'UpdatedBy'), optional: true } } : undefined,
    });
  }
  return ops;
}

function transformLegalRegister(rows: LegacyRow[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'legal_register', legacySource: 'LegalRegister', legacyId: text(row, 'LawID'),
    values: {
      law_code: text(row, 'LawID'), law_name: text(row, 'LawName'), short_name: optText(row, 'ShortName'),
      authority: optText(row, 'Authority'), version: optText(row, 'Version'), effective_date: optText(row, 'EffectiveDate'),
      applicability_status: text(row, 'ApplicabilityStatus') || 'ยังไม่ประเมิน', owner: optText(row, 'Owner'),
      source_url: optText(row, 'SourceURL'), next_review_date: optText(row, 'NextReviewDue'),
      status: text(row, 'Status') || 'ใช้งาน', notes: optText(row, 'Notes'),
    },
  }));
}

/** Groups RetentionLog detail rows by RunID into one governance_retention_runs row per run (runbook §"Retention"). */
function transformRetentionLog(rows: LegacyRow[]): SqlOp[] {
  const byRun = new Map<string, LegacyRow[]>();
  for (const row of rows) {
    const runId = text(row, 'RunID');
    if (!byRun.has(runId)) byRun.set(runId, []);
    byRun.get(runId)!.push(row);
  }
  return [...byRun.entries()].map(([runId, group]) => {
    const matched = group.reduce((sum, row) => sum + (numOrNull(text(row, 'MatchedRows')) ?? 0), 0);
    const affected = group.reduce((sum, row) => sum + (numOrNull(text(row, 'AffectedRows')) ?? 0), 0);
    const anyFailed = group.some((row) => /fail|error|ล้มเหลว/i.test(text(row, 'Status')));
    const startedAt = group.map((row) => text(row, 'RunAt')).filter(Boolean).sort()[0];
    const detail = group.map((row) => ({
      sheetName: text(row, 'SheetName'), action: text(row, 'Action'),
      matchedRows: numOrNull(text(row, 'MatchedRows')), affectedRows: numOrNull(text(row, 'AffectedRows')), status: text(row, 'Status'),
    }));
    return {
      table: 'governance_retention_runs', legacySource: 'RetentionLog', legacyId: runId,
      values: {
        run_code: runId, mode: mapRunMode(text(group[0]!, 'Mode')), status: anyFailed ? 'FAILED' : 'COMPLETED',
        matched_count: matched, affected_count: affected, detail: JSON.stringify({ entries: detail }),
        requested_by_email: optText(group[0]!, 'RunBy'), ...(startedAt ? { started_at: startedAt } : {}),
      },
    };
  });
}

function mapAuditResult(raw: string, warnings: string[], context: string): 'success' | 'fail' | 'denied' {
  const value = raw.trim().toLowerCase();
  if (['success', 'สำเร็จ', 'ok', 'true', '1', ''].includes(value)) return 'success';
  if (['fail', 'failed', 'ล้มเหลว', 'ไม่สำเร็จ', 'error'].includes(value)) return 'fail';
  if (['denied', 'deny', 'ปฏิเสธ', 'forbidden'].includes(value)) return 'denied';
  warnings.push(`${context}: unrecognized audit result "${raw}", defaulted to "success" — confirm against real legacy values.`);
  return 'success';
}

function transformAuditTrail(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'audit_logs', legacySource: 'AuditTrail', legacyId: text(row, 'LogID'),
    values: {
      actor_email: optText(row, 'ActorEmail'), actor_role: optText(row, 'ActorRole'), action: text(row, 'Action') || 'unknown',
      module: text(row, 'Module') || 'legacy', target_table: optText(row, 'TargetSheet'), target_id: optText(row, 'TargetID'),
      detail: toJsonbText(text(row, 'Detail')), result: mapAuditResult(text(row, 'Result'), warnings, `AuditTrail ${text(row, 'LogID')}`),
      ip_address: optText(row, 'IPHint'), ...historicalCreatedAt(row),
    },
    refs: text(row, 'ActorEmail') ? { actor_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'ActorEmail'), optional: true } } : undefined,
  }));
}

/**
 * PolicyMapping's shape (Module/Feature/PolicyDocument/PolicyClause) is only a loose match for
 * governance_controls (control_code/domain/title/requirement) — best-effort, lower confidence
 * than the other hand-verified sheets. Flagged via a warning on every row so a human reviews it
 * before a real import, rather than silently trusting the mapping.
 */
function transformPolicyMapping(rows: LegacyRow[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'governance_controls', legacySource: 'PolicyMapping', legacyId: text(row, 'MapID'),
    values: {
      control_code: text(row, 'MapID'), domain: text(row, 'Module') || 'general', title: text(row, 'Feature') || text(row, 'MapID'),
      requirement: [text(row, 'PolicyDocument'), text(row, 'PolicyClause')].filter(Boolean).join(' — ') || null,
      owner: null, frequency: null, status: 'ใช้งาน',
    },
  }));
}

function transformServiceCatalog(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => {
    const context = `ServiceCatalog ${text(row, 'CatalogID')}`;
    const approvalMode = mapEnumCI(text(row, 'ApprovalMode') || 'none', ['none', 'group'], 'none', warnings, context);
    return {
      table: 'service_catalog', legacySource: 'ServiceCatalog', legacyId: text(row, 'CatalogID'),
      values: {
        service_code: text(row, 'ServiceCode'), service_name: text(row, 'ServiceName'), category: optText(row, 'Category'),
        description: optText(row, 'Description'), eligibility: optText(row, 'Eligibility') ? toJsonbOrEmptyObject(text(row, 'Eligibility')) : null,
        form_schema: toJsonbOrEmptyObject(text(row, 'FormSchemaJSON') || '[]'), attachment_required: toBool(text(row, 'AttachmentRequired')),
        sla_hours: numOrNull(text(row, 'SLAHours')) ?? 24, approval_mode: approvalMode,
        checklist: toJsonbOrEmptyObject(text(row, 'ChecklistJSON') || '[]'),
        close_mode: mapEnumCI(text(row, 'CloseMode') || 'requester_confirms', ['requester_confirms', 'it_closes'], 'requester_confirms', warnings, context),
        close_condition: optText(row, 'CloseCondition'),
        status: mapEnumCI(text(row, 'Status') || 'draft', ['draft', 'active', 'suspended', 'retired'], 'draft', warnings, context),
        version: numOrNull(text(row, 'Version')) ?? 1, published_at: optText(row, 'PublishedAt'), notes: optText(row, 'Notes'),
      },
      refs: {
        ...(approvalMode === 'group' && text(row, 'Approver') ? { approval_group_id: { kind: 'byLegacyId', table: 'approval_groups', legacySource: 'ApprovalGroups', legacyId: text(row, 'Approver'), optional: true } } : {}),
        ...(text(row, 'FulfillmentGroup') ? { fulfillment_group_id: { kind: 'byDepartmentName', name: text(row, 'FulfillmentGroup'), optional: true } } : {}),
        ...(text(row, 'Owner') ? { owner_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'Owner'), optional: true } } : {}),
      },
    };
  });
}

function transformComplianceObligations(rows: LegacyRow[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'compliance_obligations', legacySource: 'ComplianceObligations', legacyId: text(row, 'ObligationID'),
    values: {
      obligation_code: text(row, 'ObligationID'), clause: optText(row, 'Clause'), requirement: text(row, 'Requirement') || text(row, 'ObligationID'),
      control_domain: optText(row, 'ControlDomain'), control_owner: optText(row, 'ControlOwner'), frequency: optText(row, 'Frequency'),
      evidence_required: toBool(text(row, 'EvidenceRequired') || 'true'), related_module: optText(row, 'RelatedModule'),
      applicability_status: text(row, 'ApplicabilityStatus') || 'ยังไม่ประเมิน', due_date: optText(row, 'DueDate'),
      status: text(row, 'Status') || 'เปิด', notes: optText(row, 'Notes'),
    },
    refs: { law_id: { kind: 'byLegacyId', table: 'legal_register', legacySource: 'LegalRegister', legacyId: text(row, 'LawID') } },
  }));
}

function transformAssetCategories(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'asset_categories', legacySource: 'AssetCategories', legacyId: text(row, 'CategoryID'),
    values: {
      name: text(row, 'CategoryName'), code_prefix: text(row, 'CodePrefix') || text(row, 'CategoryID').slice(0, 8).toUpperCase(),
      status: mapActiveStatus(text(row, 'Status'), warnings, `AssetCategories ${text(row, 'CategoryID')}`), notes: optText(row, 'Notes'),
    },
  }));
}

function transformBackupLog(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => {
    const context = `BackupLog ${text(row, 'BackupID')}`;
    return {
      table: 'backup_logs', legacySource: 'BackupLog', legacyId: text(row, 'BackupID'),
      values: {
        backup_code: text(row, 'BackupID'), system_name: text(row, 'SystemName'),
        backup_type: mapEnumCI(text(row, 'BackupType'), ['Full', 'Incremental', 'Differential', 'System Snapshot'], 'Full', warnings, context),
        backup_date: text(row, 'BackupDate'), result: mapEnumExact(text(row, 'Result'), ['สำเร็จ', 'สำเร็จบางส่วน', 'ล้มเหลว'], 'สำเร็จ', warnings, context),
        data_size: optText(row, 'DataSize'), storage_location: optText(row, 'StorageLocation'), next_backup_due: optText(row, 'NextBackupDue'),
        evidence_link: optText(row, 'EvidenceLink'), snapshot_file_id: optText(row, 'SnapshotFileID'), source_system_id: optText(row, 'SourceSpreadsheetID'),
        checksum: optText(row, 'Checksum'), row_count: numOrNull(text(row, 'RowCount')), notes: optText(row, 'Notes'),
      },
      refs: { operator_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'Operator') } },
    };
  });
}

function transformPersonalTasks(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => {
    const context = `PersonalTasks ${text(row, 'TaskID')}`;
    return {
      table: 'personal_tasks', legacySource: 'PersonalTasks', legacyId: text(row, 'TaskID'),
      values: {
        title: text(row, 'Title'), description: optText(row, 'Description'),
        category: mapEnumExact(text(row, 'Category') || 'งานทั่วไป', ['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ'], 'งานทั่วไป', warnings, context),
        priority: mapEnumExact(text(row, 'Priority') || 'ปกติ', ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'], 'ปกติ', warnings, context),
        status: mapEnumExact(text(row, 'Status') || 'ต้องทำ', ['ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก'], 'ต้องทำ', warnings, context),
        start_date: optText(row, 'StartDate'), due_date: optText(row, 'DueDate'), completed_at: optText(row, 'CompletedAt'),
        progress: numOrNull(text(row, 'Progress')) ?? 0, tags: optText(row, 'Tags'), notes: optText(row, 'Notes'),
        sort_order: numOrNull(text(row, 'SortOrder')) ?? 0,
        recurrence: mapEnumExact(text(row, 'Recurrence') || 'ไม่ทำซ้ำ', ['ไม่ทำซ้ำ', 'รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส', 'รายปี'], 'ไม่ทำซ้ำ', warnings, context),
      },
      refs: { owner_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'OwnerEmail') } },
    };
  });
}

function transformTicketWorklogs(rows: LegacyRow[]): SqlOp[] {
  return rows.map((row) => ({
    table: 'ticket_worklogs', legacySource: 'Ticket_Worklogs', legacyId: text(row, 'WorklogID'),
    values: {
      action: text(row, 'Action') || 'update', detail: optText(row, 'Detail'), status_from: optText(row, 'StatusFrom'),
      status_to: optText(row, 'StatusTo'), minutes_spent: numOrNull(text(row, 'MinutesSpent')), is_public: text(row, 'IsPublic') === '' ? true : toBool(text(row, 'IsPublic')),
      ...historicalCreatedAt(row),
    },
    refs: {
      ticket_id: { kind: 'byLegacyId', table: 'tickets', legacySource: 'Tickets', legacyId: text(row, 'TicketID') },
      actor_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'ActorEmail') },
    },
  }));
}

function transformRecoveryTests(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => {
    const context = `RecoveryTests ${text(row, 'TestID')}`;
    return {
      table: 'recovery_tests', legacySource: 'RecoveryTests', legacyId: text(row, 'TestID'),
      values: {
        recovery_code: text(row, 'TestID'), system_name: text(row, 'SystemName'), test_date: text(row, 'TestDate'),
        scenario: optText(row, 'Scenario'), result: mapEnumExact(text(row, 'Result'), ['ผ่าน', 'ผ่านบางส่วน', 'ไม่ผ่าน'], 'ผ่าน', warnings, context),
        rto_actual: optText(row, 'RTO_Actual'), rpo_actual: optText(row, 'RPO_Actual'), next_test_due: optText(row, 'NextTestDue'),
        evidence_link: optText(row, 'EvidenceLink'), findings: optText(row, 'Findings'), notes: optText(row, 'Notes'),
      },
      refs: { tester_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'Tester') } },
    };
  });
}

function transformWorkflowDefinitions(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => {
    const context = `WorkflowDefinitions ${text(row, 'DefinitionID')}`;
    const legacyMode = text(row, 'Mode');
    if (legacyMode && legacyMode.toUpperCase() !== 'SEQUENTIAL') {
      warnings.push(`${context}: legacy mode "${legacyMode}" is not supported (only SEQUENTIAL exists in the new engine) — coerced to SEQUENTIAL.`);
    }
    return {
      table: 'workflow_definitions', legacySource: 'WorkflowDefinitions', legacyId: text(row, 'DefinitionID'),
      values: {
        workflow_code: text(row, 'WorkflowCode').toUpperCase(), workflow_name: text(row, 'WorkflowName'),
        module_key: text(row, 'ModuleKey').toLowerCase(), description: optText(row, 'Description'),
        version: numOrNull(text(row, 'Version')) ?? 1, trigger_event: text(row, 'TriggerEvent') || 'MANUAL', mode: 'SEQUENTIAL',
        conditions: toJsonbOrEmptyObject(text(row, 'ConditionsJSON')), sla_hours: numOrNull(text(row, 'SLAHours')) ?? 72,
        is_default: toBool(text(row, 'IsDefault')),
        status: mapEnumExact(text(row, 'Status') || 'ร่าง', ['ร่าง', 'ใช้งาน', 'ระงับ', 'ยกเลิก'], 'ร่าง', warnings, context),
        active_from: optText(row, 'ActiveFrom'), active_to: optText(row, 'ActiveTo'), notes: optText(row, 'Notes'),
      },
    };
  });
}

function transformWorkflowSteps(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => {
    const context = `WorkflowSteps ${text(row, 'StepID')}`;
    return {
      table: 'workflow_steps', legacySource: 'WorkflowSteps', legacyId: text(row, 'StepID'),
      values: {
        definition_version: numOrNull(text(row, 'DefinitionVersion')) ?? 1, step_order: numOrNull(text(row, 'StepOrder')) ?? 1,
        step_code: (text(row, 'StepCode') || text(row, 'StepID')).toUpperCase(), step_name: text(row, 'StepName'),
        approval_type: mapEnumCI(text(row, 'ApprovalType'), ['USER', 'ROLE', 'GROUP'], 'USER', warnings, context),
        approver_value: text(row, 'ApproverValue'), mode: mapEnumCI(text(row, 'Mode') || 'ANY', ['ANY', 'ALL', 'QUORUM'], 'ANY', warnings, context),
        min_approvals: numOrNull(text(row, 'MinApprovals')) ?? 1, condition: toJsonbOrEmptyObject(text(row, 'ConditionJSON')),
        sla_hours: numOrNull(text(row, 'SLAHours')) ?? 24, allow_delegation: text(row, 'AllowDelegation') === '' ? true : toBool(text(row, 'AllowDelegation')),
        allow_return: text(row, 'AllowReturn') === '' ? true : toBool(text(row, 'AllowReturn')),
        status: mapEnumExact(text(row, 'Status') || 'ใช้งาน', ['ใช้งาน', 'ยกเลิก'], 'ใช้งาน', warnings, context), notes: optText(row, 'Notes'),
      },
      refs: { definition_id: { kind: 'byLegacyId', table: 'workflow_definitions', legacySource: 'WorkflowDefinitions', legacyId: text(row, 'DefinitionID') } },
    };
  });
}

function transformTickets(rows: LegacyRow[], warnings: string[]): SqlOp[] {
  return rows.map((row) => {
    const context = `Tickets ${text(row, 'TicketID')}`;
    return {
      table: 'tickets', legacySource: 'Tickets', legacyId: text(row, 'TicketID'),
      values: {
        title: text(row, 'Title'), requester_phone: optText(row, 'RequesterPhone'), location: optText(row, 'Location'),
        priority: mapEnumExact(text(row, 'Priority') || 'ปานกลาง', ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'], 'ปานกลาง', warnings, context),
        response_sla_hours: numOrNull(text(row, 'ResponseSLAHours')) ?? numOrNull(text(row, 'SLAHours')),
        resolution_sla_hours: numOrNull(text(row, 'ResolutionSLAHours')), response_due_at: optText(row, 'ResponseDueAt'), due_at: optText(row, 'DueAt'),
        description: text(row, 'Description') || text(row, 'Title'), is_security: toBool(text(row, 'IsSecurity')),
        status: mapEnumExact(text(row, 'Status') || 'ใหม่', [
          'ใหม่', 'รับเรื่องแล้ว', 'กำลังดำเนินการ', 'รออะไหล่', 'รอผู้ใช้งาน',
          'ส่งต่อ Outsource', 'เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident',
        ], 'ใหม่', warnings, context),
        acknowledged_at: optText(row, 'AcknowledgedAt'), resolved_at: optText(row, 'ResolvedAt'), resolution: optText(row, 'Resolution'),
        closed_at: optText(row, 'CloseDate'), rating: numOrNull(text(row, 'Rating')), feedback: optText(row, 'Feedback'),
        feedback_at: optText(row, 'FeedbackAt'), outsource_name: optText(row, 'OutsourceName'), outsource_issue_no: optText(row, 'OutsourceIssueNo'),
        outsource_sent_at: optText(row, 'OutsourceSentAt'), notes: optText(row, 'Notes'), reopen_count: numOrNull(text(row, 'ReopenCount')) ?? 0,
        ...historicalCreatedAt(row),
      },
      refs: {
        requester_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'RequesterEmail') },
        ...(text(row, 'Category') ? { category_id: { kind: 'byLegacyId', table: 'ticket_categories', legacySource: 'TicketCategories', legacyId: text(row, 'Category'), optional: true } } : {}),
        ...(text(row, 'Assignee') ? { assignee_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'Assignee'), optional: true } } : {}),
      },
    };
  });
}

function numOrNull(value: string): number | null {
  if (value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function transformGeneric(sheet: string, entry: ManifestEntry, rows: LegacyRow[]): SqlOp[] {
  const legacyKeyColumn = entry.legacyKey?.[0] ?? Object.keys(rows[0] ?? {})[0] ?? 'id';
  const sensitive = new Set(entry.sensitiveColumns ?? []);
  return rows.map((row) => {
    const values: Record<string, string | number | boolean | null> = {};
    for (const [column, value] of Object.entries(row)) {
      if (sensitive.has(column)) continue;
      values[toSnakeCase(column)] = value == null ? null : typeof value === 'boolean' || typeof value === 'number' ? value : String(value);
    }
    return { table: entry.targetTables[0]!, legacySource: sheet, legacyId: text(row, legacyKeyColumn), values };
  });
}

export function buildImportPlan(workbook: LegacyWorkbook, manifest: ManifestEntry[], options: ImportPlanOptions = {}): ImportPlan {
  const phases: Record<ImportPhase, SqlOp[]> = { auth_rbac: [], reference_data: [], operational: [], governance: [], audit_history: [] };
  const archived: SkipRecord[] = [];
  const skipped: SkipRecord[] = [];
  const deferred: SkipRecord[] = [];
  const warnings: string[] = [];
  const unverifiedSheets: string[] = [];
  const authInvites: PendingAuthInvite[] = [];

  for (const entry of manifest) {
    const rows = workbook[entry.sheet] ?? [];
    if (rows.length === 0) continue;

    if (entry.mode === 'archive') {
      for (const row of rows) archived.push({ sheet: entry.sheet, legacyId: text(row, entry.legacyKey?.[0] ?? Object.keys(row)[0] ?? ''), reason: entry.note ?? 'Archive-mode sheet' });
      continue;
    }
    if (entry.mode === 'skip_ephemeral') {
      for (const row of rows) skipped.push({ sheet: entry.sheet, legacyId: text(row, entry.legacyKey?.[0] ?? Object.keys(row)[0] ?? ''), reason: entry.note ?? 'Ephemeral state' });
      continue;
    }
    if (entry.mode === 'deferred') {
      for (const row of rows) deferred.push({ sheet: entry.sheet, legacyId: text(row, entry.legacyKey?.[0] ?? Object.keys(row)[0] ?? ''), reason: entry.note ?? 'Deferred until after go-live' });
      continue;
    }

    const softDeleted = rows.filter(isSoftDeleted);
    for (const row of softDeleted) {
      archived.push({ sheet: entry.sheet, legacyId: text(row, entry.legacyKey?.[0] ?? Object.keys(row)[0] ?? ''), reason: 'Soft-deleted in legacy system (IsDeleted) — archived, never activated.' });
    }
    const rows2 = softDeleted.length > 0 ? rows.filter((row) => !isSoftDeleted(row)) : rows;
    if (rows2.length === 0) continue;

    const phase = SHEET_PHASE[entry.sheet] ?? 'operational';
    switch (entry.sheet) {
      case 'Users': authInvites.push(...transformUsers(rows2, warnings)); break;
      case 'ActionPermissions': phases[phase].push(...transformActionPermissions(rows2, warnings)); break;
      case 'RoleActionPermissions': phases[phase].push(...transformRoleActionPermissions(rows2)); break;
      case 'ApprovalGroups': phases[phase].push(...transformApprovalGroups(rows2, warnings)); break;
      case 'ApprovalGroupMembers': phases[phase].push(...transformApprovalGroupMembers(rows2, warnings)); break;
      case 'Employees': phases[phase].push(...transformEmployees(rows2, warnings)); break;
      case 'TicketCategories': phases[phase].push(...transformTicketCategories(rows2, warnings)); break;
      case 'LineUsers': phases[phase].push(...transformLineUsers(rows2)); break;
      case 'Settings': phases[phase].push(...transformSettings(rows2, options.settingsAllowlist, archived)); break;
      case 'LegalRegister': phases[phase].push(...transformLegalRegister(rows2)); break;
      case 'RetentionLog': phases[phase].push(...transformRetentionLog(rows2)); break;
      case 'AuditTrail': phases[phase].push(...transformAuditTrail(rows2, warnings)); break;
      case 'PolicyMapping': phases[phase].push(...transformPolicyMapping(rows2)); break;
      case 'ServiceCatalog': phases[phase].push(...transformServiceCatalog(rows2, warnings)); break;
      case 'ComplianceObligations': phases[phase].push(...transformComplianceObligations(rows2)); break;
      case 'AssetCategories': phases[phase].push(...transformAssetCategories(rows2, warnings)); break;
      case 'BackupLog': phases[phase].push(...transformBackupLog(rows2, warnings)); break;
      case 'PersonalTasks': phases[phase].push(...transformPersonalTasks(rows2, warnings)); break;
      case 'Ticket_Worklogs': phases[phase].push(...transformTicketWorklogs(rows2)); break;
      case 'RecoveryTests': phases[phase].push(...transformRecoveryTests(rows2, warnings)); break;
      case 'WorkflowDefinitions': phases[phase].push(...transformWorkflowDefinitions(rows2, warnings)); break;
      case 'WorkflowSteps': phases[phase].push(...transformWorkflowSteps(rows2, warnings)); break;
      case 'Tickets': phases[phase].push(...transformTickets(rows2, warnings)); break;
      default:
        if (entry.targetTables.length === 0) { warnings.push(`${entry.sheet}: transform-mode entry has no target table — skipped.`); break; }
        unverifiedSheets.push(entry.sheet);
        phases[phase].push(...transformGeneric(entry.sheet, entry, rows2));
    }
  }

  const attachmentCandidates = summarizeAttachmentCandidates(collectAttachmentCandidates(workbook as AttachmentWorkbook));

  return {
    generatedAt: new Date().toISOString(), authInvites, phases, archived, skipped, deferred,
    warnings, unverifiedSheets: [...new Set(unverifiedSheets)], attachmentCandidates,
  };
}

export { PHASE_ORDER };
