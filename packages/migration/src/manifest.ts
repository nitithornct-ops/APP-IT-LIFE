export type MigrationMode = 'transform' | 'archive' | 'deferred' | 'skip_ephemeral';

export interface ManifestEntry {
  sheet: string;
  mode: MigrationMode;
  targetTables: string[];
  legacyKey?: string[];
  sensitiveColumns?: string[];
  note?: string;
}

const transform: Record<string, string[]> = {
  Users: ['profiles', 'user_roles'],
  WorkflowDefinitions: ['workflow_definitions'], WorkflowSteps: ['workflow_steps'],
  WorkflowInstances: ['workflow_instances'], WorkflowApprovals: ['workflow_approvals'],
  WorkflowHistory: ['workflow_history'], WorkflowDelegations: ['workflow_delegations'],
  AttachmentRegistry: ['file_attachments'], AttachmentLinks: ['file_attachments'], RecordLinks: ['record_links'],
  ActionPermissions: ['permissions'], RoleActionPermissions: ['role_permissions'],
  UserPermissionOverrides: ['user_permission_overrides'], ApprovalGroups: ['approval_groups'],
  ApprovalGroupMembers: ['approval_group_members'],
  TaskAttachments: ['file_attachments'], TaskLinks: ['task_links'], TaskProgressLogs: ['task_progress_logs'],
  TaskSubtasks: ['task_subtasks'], GovernanceDocuments: ['governance_documents'],
  RegulatoryNotifications: ['regulatory_notifications'], LegalRegister: ['legal_register'],
  ComplianceObligations: ['compliance_obligations'], ComplianceAssessments: ['compliance_assessments'],
  CorrectiveActions: ['compliance_corrective_actions'], RetentionLog: ['governance_retention_runs'],
  EmployeeLifecycle: ['employee_lifecycle_events'], EmployeeAssignments: ['employee_assignments'],
  Employees: ['employees'], LineUsers: ['line_users'], AuditTrail: ['audit_logs'],
  PersonalTasks: ['personal_tasks'], Tickets: ['tickets'], TicketCategories: ['ticket_categories'],
  Ticket_Worklogs: ['ticket_worklogs'], KnowledgeBase: ['knowledge_articles'], AssetRegister: ['assets'],
  AssetCategories: ['asset_categories'], Asset_History: ['asset_movements'],
  MaintenancePlans: ['maintenance_plans'], PMChecklistTemplates: ['pm_checklist_templates'],
  Inventory: ['inventory_items'], InventoryTransactions: ['inventory_transactions'],
  SoftwareLicenses: ['software_licenses'], DataClassification: ['governance_data_assets'],
  DataDestructionRequests: ['data_destruction_requests'], AccessRequests: ['access_requests'],
  UserAccessRegistry: ['user_access_registry'], ChangeRequests: ['change_requests'], BackupLog: ['backup_logs'],
  RecoveryTests: ['recovery_tests'], BCPPlans: ['bcp_plans'], LoggingRegister: ['logging_systems'],
  LogReviews: ['log_reviews'], Incidents: ['incidents'], RiskRegister: ['governance_risks'],
  VendorRegister: ['vendors'], AIRegister: ['governance_ai_tools'], CloudRegister: ['governance_cloud_services'],
  TrainingPlans: ['governance_training_plans'], TrainingRecords: ['governance_training_records'],
  PolicyAcknowledgements: ['policy_acknowledgements'],
  Settings: ['system_settings'], PolicyMapping: ['governance_controls'], PrivacyROPA: ['privacy_ropa'],
  PrivacyConsents: ['privacy_consents'], PrivacyDSR: ['privacy_dsr'], Problems: ['problems'],
  KnownErrors: ['known_errors'], VulnerabilityFindings: ['vulnerability_findings'],
  AuditEngagements: ['audit_engagements'], AuditFindings: ['audit_findings'],
  ConfigurationItems: ['configuration_items'], CIRelationships: ['ci_relationships'],
  ServiceCatalog: ['service_catalog'], ServiceRequests: ['service_requests'],
  ServiceRequestTasks: ['service_request_tasks'], ServiceRequestHistory: ['service_request_history'],
};

const schemaGap: Record<string, string[]> = {
  PMSchedules: ['pm_schedules'], PMWorkOrders: ['pm_work_orders'],
  PMChecklistResults: ['pm_checklist_results'], PMFindings: ['pm_findings'],
  PMStatusHistory: ['pm_status_history'], TaskReminders: ['task_reminders'],
};

const archive: Record<string, string> = {
  AttachmentAccessLog: 'Preserve as a read-only export; there is no runtime target table.',
  IntegrationOutbox: 'Do not replay historical integration events.',
  NotificationQueue: 'Do not replay queued messages from the legacy system.',
  NotificationLog: 'Preserve delivery history as a read-only export; do not create new in-app notifications.',
  QATestCases: 'Superseded by source-controlled automated tests.',
};

const deferred: Record<string, string> = {
  PDFDesignTemplates: 'Designer is explicitly deferred until after go-live.',
  FieldDefinitions: 'Designer metadata is explicitly deferred until after go-live.',
};

export const migrationManifest: ManifestEntry[] = [
  ...Object.entries(transform).map(([sheet, targetTables]) => ({
    sheet, mode: 'transform' as const, targetTables,
    ...(sheet === 'Users' ? { sensitiveColumns: ['PasswordHash', 'PasswordSalt'] } : {}),
    ...(sheet === 'RetentionLog' ? { legacyKey: ['RunID', 'SheetName', 'Action'] } : {}),
  })),
  ...Object.entries(schemaGap).map(([sheet, targetTables]) => ({
    sheet, mode: 'deferred' as const, targetTables,
    note: 'Target table is not present. Import must stop if this sheet becomes populated.',
  })),
  ...Object.entries(archive).map(([sheet, note]) => ({ sheet, mode: 'archive' as const, targetTables: [], note })),
  ...Object.entries(deferred).map(([sheet, note]) => ({ sheet, mode: 'deferred' as const, targetTables: [], note })),
  { sheet: 'LineSessions', mode: 'skip_ephemeral', targetTables: [], note: 'Never migrate legacy session hashes.' },
  { sheet: 'RateLimits', mode: 'skip_ephemeral', targetTables: [], note: 'Recreate counters in the new runtime.' },
];

export const knownTargetTables = new Set([
  'access_requests', 'approval_group_members', 'approval_groups', 'asset_categories', 'asset_movements', 'assets',
  'audit_engagements', 'audit_findings', 'audit_logs', 'backup_logs', 'bcp_plans', 'change_requests',
  'ci_relationships', 'compliance_assessments', 'compliance_corrective_actions', 'compliance_obligations',
  'configuration_items', 'data_destruction_requests', 'employee_assignments', 'employee_lifecycle_events', 'employees',
  'file_attachments', 'governance_ai_tools', 'governance_cloud_services', 'governance_controls', 'governance_data_assets',
  'governance_documents', 'governance_retention_runs', 'governance_risks', 'governance_training_plans',
  'governance_training_records', 'incidents', 'inventory_items', 'inventory_transactions', 'knowledge_articles',
  'known_errors', 'legal_register', 'line_users', 'log_reviews', 'logging_systems', 'maintenance_plans', 'notifications',
  'permissions', 'personal_tasks', 'pm_checklist_templates', 'policy_acknowledgements', 'privacy_consents',
  'privacy_dsr', 'privacy_ropa', 'problems', 'profiles', 'record_links', 'recovery_tests',
  'regulatory_notifications', 'role_permissions', 'service_catalog', 'service_request_history',
  'service_request_tasks', 'service_requests', 'software_licenses', 'system_settings', 'task_links',
  'task_progress_logs', 'task_subtasks', 'ticket_categories', 'ticket_worklogs', 'tickets',
  'user_access_registry', 'user_permission_overrides', 'user_roles', 'vendors', 'vulnerability_findings',
  'workflow_approvals', 'workflow_definitions', 'workflow_delegations', 'workflow_history', 'workflow_instances',
  'workflow_steps',
]);
