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
export type Ref =
  | { kind: 'byLegacyId'; table: string; legacySource: string; legacyId: string }
  | { kind: 'byEmail'; table: 'profiles'; email: string }
  | { kind: 'byRoleKey'; roleKey: string }
  | { kind: 'byDepartmentName'; name: string }
  | { kind: 'byPositionName'; name: string };

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
      ...(text(row, 'Department') ? { department_id: { kind: 'byDepartmentName', name: text(row, 'Department') } } : {}),
      ...(text(row, 'OwnerEmail') ? { owner_id: { kind: 'byEmail', table: 'profiles', email: text(row, 'OwnerEmail') } } : {}),
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
      ...(text(row, 'Department') ? { department_id: { kind: 'byDepartmentName', name: text(row, 'Department') } } : {}),
      ...(text(row, 'Position') ? { position_id: { kind: 'byPositionName', name: text(row, 'Position') } } : {}),
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
    refs: text(row, 'LinkedUserID') ? { linked_user_id: { kind: 'byLegacyId', table: 'profiles', legacySource: 'Users', legacyId: text(row, 'LinkedUserID') } } : undefined,
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
      refs: text(row, 'UpdatedBy') ? { updated_by: { kind: 'byEmail', table: 'profiles', email: text(row, 'UpdatedBy') } } : undefined,
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
    const startedAt = group.map((row) => text(row, 'RunAt')).filter(Boolean).sort()[0] ?? null;
    const detail = group.map((row) => ({
      sheetName: text(row, 'SheetName'), action: text(row, 'Action'),
      matchedRows: numOrNull(text(row, 'MatchedRows')), affectedRows: numOrNull(text(row, 'AffectedRows')), status: text(row, 'Status'),
    }));
    return {
      table: 'governance_retention_runs', legacySource: 'RetentionLog', legacyId: runId,
      values: {
        run_code: runId, mode: mapRunMode(text(group[0]!, 'Mode')), status: anyFailed ? 'FAILED' : 'COMPLETED',
        matched_count: matched, affected_count: affected, detail: JSON.stringify({ entries: detail }),
        requested_by_email: optText(group[0]!, 'RunBy'), started_at: startedAt,
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

    const phase = SHEET_PHASE[entry.sheet] ?? 'operational';
    switch (entry.sheet) {
      case 'Users': authInvites.push(...transformUsers(rows, warnings)); break;
      case 'ActionPermissions': phases[phase].push(...transformActionPermissions(rows, warnings)); break;
      case 'RoleActionPermissions': phases[phase].push(...transformRoleActionPermissions(rows)); break;
      case 'ApprovalGroups': phases[phase].push(...transformApprovalGroups(rows, warnings)); break;
      case 'ApprovalGroupMembers': phases[phase].push(...transformApprovalGroupMembers(rows, warnings)); break;
      case 'Employees': phases[phase].push(...transformEmployees(rows, warnings)); break;
      case 'TicketCategories': phases[phase].push(...transformTicketCategories(rows, warnings)); break;
      case 'LineUsers': phases[phase].push(...transformLineUsers(rows)); break;
      case 'Settings': phases[phase].push(...transformSettings(rows, options.settingsAllowlist, archived)); break;
      case 'LegalRegister': phases[phase].push(...transformLegalRegister(rows)); break;
      case 'RetentionLog': phases[phase].push(...transformRetentionLog(rows)); break;
      default:
        if (entry.targetTables.length === 0) { warnings.push(`${entry.sheet}: transform-mode entry has no target table — skipped.`); break; }
        unverifiedSheets.push(entry.sheet);
        phases[phase].push(...transformGeneric(entry.sheet, entry, rows));
    }
  }

  const attachmentCandidates = summarizeAttachmentCandidates(collectAttachmentCandidates(workbook as AttachmentWorkbook));

  return {
    generatedAt: new Date().toISOString(), authInvites, phases, archived, skipped, deferred,
    warnings, unverifiedSheets: [...new Set(unverifiedSheets)], attachmentCandidates,
  };
}

export { PHASE_ORDER };
