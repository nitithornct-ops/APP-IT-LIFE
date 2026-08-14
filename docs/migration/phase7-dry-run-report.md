# Phase 7 — Migration Dry-Run Report

Generated: 2026-08-13T06:34:43.282Z

Source: ISMS_DB_SNAPSHOT_20260810_022753_AUTO_DAILY (2026-08-09T19:27:54.773Z)  
Mode: **read-only** — no Supabase writes, raw rows, PII, or secrets are included.  
Mapping strategy: **header name**, never column position.

## Summary

| Metric | Count |
|---|---:|
| Sheets | 93 |
| Source rows | 1932 |
| Populated / empty sheets | 28 / 65 |
| Manifest entries | 93 |
| Exact / reordered / additive / drifted headers | 76 / 14 / 3 / 0 |
| Target schema gaps | 6 |

## Decision gate: READY_FOR_IMPORT_REHEARSAL

### Blockers

- None

### Warnings

- PDFDesignTemplates: 1 row(s) will use mode archive.
- RateLimits: 2 row(s) will use mode skip_ephemeral.
- LineSessions: 4 row(s) will use mode skip_ephemeral.
- BackupLog: snapshot has additive columns; map or explicitly archive them.
- RecoveryTests: snapshot has additive columns; map or explicitly archive them.
- NotificationLog: 97 row(s) will use mode archive.
- QATestCases: snapshot has additive columns; map or explicitly archive them.
- QATestCases: 39 row(s) will use mode archive.
- 1 invalid JSON value(s) are confined to deferred/archive sheets.
- 4 soft-deleted row(s) must be archived, not activated.
- 5 unsupported setting row(s) must be archived, not activated.
- 8 direct attachment reference(s) require the legacy-link migration path.

## Data quality

| Check | Count |
|---|---:|
| Rows checked | 1932 |
| Blank keys / duplicate groups | 0 / 0 |
| Invalid email / date / JSON | 0 / 0 / 1 |
| Orphan foreign keys / unmapped roles | 0 / 0 |
| Soft-deleted rows | 4 |
| Unsupported / suspected-secret settings | 5 / 0 |
| Direct attachment references | 8 |


## Schema readiness

Legacy identity targets prepared: 76/76  
Missing targets: None


## Sheet manifest

| Legacy sheet | Rows | Mode | Legacy key | Target table(s) | Headers | Target ready |
|---|---:|---|---|---|---|---|
| Users | 1 | transform | UserID | profiles, user_roles | reordered | yes |
| WorkflowDefinitions | 1 | transform | DefinitionID | workflow_definitions | exact | yes |
| WorkflowSteps | 1 | transform | StepID | workflow_steps | exact | yes |
| WorkflowInstances | 0 | transform | InstanceID | workflow_instances | exact | yes |
| WorkflowApprovals | 0 | transform | ApprovalID | workflow_approvals | exact | yes |
| WorkflowHistory | 0 | transform | HistoryID | workflow_history | exact | yes |
| WorkflowDelegations | 0 | transform | DelegationID | workflow_delegations | exact | yes |
| AttachmentRegistry | 0 | transform | AttachmentID | file_attachments | exact | yes |
| AttachmentLinks | 0 | transform | LinkID | file_attachments | exact | yes |
| AttachmentAccessLog | 0 | archive | AccessLogID | — | exact | yes |
| RecordLinks | 0 | transform | LinkID | record_links | exact | yes |
| IntegrationOutbox | 0 | archive | IntegrationID | — | exact | yes |
| ActionPermissions | 25 | transform | PermissionKey | permissions | exact | yes |
| RoleActionPermissions | 66 | transform | MappingID | role_permissions | exact | yes |
| UserPermissionOverrides | 0 | transform | OverrideID | user_permission_overrides | exact | yes |
| ApprovalGroups | 1 | transform | GroupID | approval_groups | exact | yes |
| ApprovalGroupMembers | 1 | transform | MemberID | approval_group_members | exact | yes |
| PMSchedules | 0 | deferred | ScheduleID | pm_schedules | exact | no |
| PMWorkOrders | 0 | deferred | WorkOrderID | pm_work_orders | exact | no |
| PMChecklistResults | 0 | deferred | ResultID | pm_checklist_results | exact | no |
| PMFindings | 0 | deferred | FindingID | pm_findings | exact | no |
| PMStatusHistory | 0 | deferred | HistoryID | pm_status_history | exact | no |
| TaskReminders | 0 | deferred | ReminderID | task_reminders | exact | no |
| TaskAttachments | 0 | transform | AttachmentID | file_attachments | reordered | yes |
| TaskLinks | 0 | transform | LinkID | task_links | exact | yes |
| TaskProgressLogs | 0 | transform | ProgressLogID | task_progress_logs | exact | yes |
| TaskSubtasks | 0 | transform | SubtaskID | task_subtasks | exact | yes |
| PDFDesignTemplates | 1 | archive | TemplateID | — | exact | yes |
| GovernanceDocuments | 0 | transform | DocumentID | governance_documents | exact | yes |
| RegulatoryNotifications | 0 | transform | NotificationID | regulatory_notifications | exact | yes |
| LegalRegister | 6 | transform | LawID | legal_register | exact | yes |
| ComplianceObligations | 9 | transform | ObligationID | compliance_obligations | exact | yes |
| ComplianceAssessments | 0 | transform | AssessmentID | compliance_assessments | exact | yes |
| CorrectiveActions | 0 | transform | ActionID | compliance_corrective_actions | exact | yes |
| RateLimits | 2 | skip_ephemeral | RateKey | — | exact | yes |
| NotificationQueue | 0 | archive | QueueID | — | exact | yes |
| RetentionLog | 862 | transform | RunID + SheetName + Action | governance_retention_runs | exact | yes |
| EmployeeLifecycle | 0 | transform | LifecycleID | employee_lifecycle_events | exact | yes |
| EmployeeAssignments | 0 | transform | AssignmentID | employee_assignments | exact | yes |
| Employees | 3 | transform | EmployeeID | employees | exact | yes |
| LineUsers | 1 | transform | LineUserID | line_users | exact | yes |
| LineSessions | 4 | skip_ephemeral | SessionHash | — | exact | yes |
| AuditTrail | 690 | transform | LogID | audit_logs | exact | yes |
| PersonalTasks | 3 | transform | TaskID | personal_tasks | reordered | yes |
| Tickets | 1 | transform | TicketID | tickets | reordered | yes |
| TicketCategories | 7 | transform | CategoryID | ticket_categories | reordered | yes |
| Ticket_Worklogs | 3 | transform | WorklogID | ticket_worklogs | exact | yes |
| KnowledgeBase | 0 | transform | ArticleID | knowledge_articles | exact | yes |
| AssetRegister | 0 | transform | AssetID | assets | reordered | yes |
| AssetCategories | 7 | transform | CategoryID | asset_categories | exact | yes |
| Asset_History | 0 | transform | MovementID | asset_movements | exact | yes |
| MaintenancePlans | 0 | transform | MaintenanceID | maintenance_plans | reordered | yes |
| PMChecklistTemplates | 0 | transform | TemplateID | pm_checklist_templates | reordered | yes |
| Inventory | 0 | transform | ItemID | inventory_items | exact | yes |
| InventoryTransactions | 0 | transform | TransactionID | inventory_transactions | exact | yes |
| SoftwareLicenses | 0 | transform | LicenseID | software_licenses | exact | yes |
| DataClassification | 0 | transform | DataID | governance_data_assets | exact | yes |
| DataDestructionRequests | 0 | transform | ReqID | data_destruction_requests | exact | yes |
| AccessRequests | 0 | transform | ReqID | access_requests | reordered | yes |
| UserAccessRegistry | 0 | transform | AccessID | user_access_registry | exact | yes |
| ChangeRequests | 0 | transform | ChangeID | change_requests | reordered | yes |
| BackupLog | 5 | transform | BackupID | backup_logs | additive | yes |
| RecoveryTests | 2 | transform | TestID | recovery_tests | additive | yes |
| BCPPlans | 0 | transform | PlanID | bcp_plans | exact | yes |
| LoggingRegister | 0 | transform | LogSysID | logging_systems | exact | yes |
| LogReviews | 0 | transform | ReviewID | log_reviews | exact | yes |
| Incidents | 0 | transform | IncidentID | incidents | reordered | yes |
| RiskRegister | 0 | transform | RiskID | governance_risks | exact | yes |
| VendorRegister | 0 | transform | VendorID | vendors | exact | yes |
| AIRegister | 0 | transform | AIID | governance_ai_tools | exact | yes |
| CloudRegister | 0 | transform | CloudID | governance_cloud_services | exact | yes |
| TrainingPlans | 0 | transform | PlanID | governance_training_plans | exact | yes |
| TrainingRecords | 0 | transform | RecID | governance_training_records | exact | yes |
| PolicyAcknowledgements | 0 | transform | AckID | policy_acknowledgements | exact | yes |
| NotificationLog | 97 | archive | NotifyID | — | exact | yes |
| Settings | 57 | transform | Key | system_settings | exact | yes |
| FieldDefinitions | 0 | archive | FieldID | — | exact | yes |
| QATestCases | 39 | archive | CaseID | — | additive | yes |
| PolicyMapping | 25 | transform | MapID | governance_controls | exact | yes |
| PrivacyROPA | 0 | transform | RopaID | privacy_ropa | exact | yes |
| PrivacyConsents | 0 | transform | ConsentID | privacy_consents | exact | yes |
| PrivacyDSR | 0 | transform | RequestID | privacy_dsr | exact | yes |
| Problems | 0 | transform | ProblemID | problems | exact | yes |
| KnownErrors | 0 | transform | KnownErrorID | known_errors | exact | yes |
| VulnerabilityFindings | 0 | transform | VulnerabilityID | vulnerability_findings | exact | yes |
| AuditEngagements | 0 | transform | AuditID | audit_engagements | exact | yes |
| AuditFindings | 0 | transform | FindingID | audit_findings | exact | yes |
| ConfigurationItems | 0 | transform | CIID | configuration_items | exact | yes |
| CIRelationships | 0 | transform | RelationshipID | ci_relationships | exact | yes |
| ServiceCatalog | 12 | transform | CatalogID | service_catalog | reordered | yes |
| ServiceRequests | 0 | transform | RequestID | service_requests | reordered | yes |
| ServiceRequestTasks | 0 | transform | TaskID | service_request_tasks | reordered | yes |
| ServiceRequestHistory | 0 | transform | HistoryID | service_request_history | exact | yes |
