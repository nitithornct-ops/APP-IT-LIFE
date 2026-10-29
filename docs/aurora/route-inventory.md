# Aurora route and page inventory

Generated from the actual App.tsx route tree and page sources. This is a static integration audit, not evidence that every live business workflow passed. All authenticated routes inherit AppShell, index.css and system.css. Public routes inherit the same tokens through life-public/public-* and shared primitives. Document editor/print metrics remain separate.

Found 75 route declarations (including modal alternatives and redirects) and 66 page source files.

| Route | Page | Explicit route guard |
|---|---|---|
| `/login` | LoginPage | Public, inherited, or wrapper; see App.tsx |
| `/mfa` | MfaChallengePage | Public, inherited, or wrapper; see App.tsx |
| `/forgot-password` | ForgotPasswordPage | Public, inherited, or wrapper; see App.tsx |
| `/reset-password` | ResetPasswordPage | Public, inherited, or wrapper; see App.tsx |
| `/health` | HealthPage | Public, inherited, or wrapper; see App.tsx |
| `/line` | LinePortalPage | Public, inherited, or wrapper; see App.tsx |
| `/line/callback` | LineCallbackPage | Public, inherited, or wrapper; see App.tsx |
| `/vendor/forms` | VendorFormPortalPage | Public, inherited, or wrapper; see App.tsx |
| `/vendor/forms/:token` | VendorFormPortalPage | Public, inherited, or wrapper; see App.tsx |
| `/vendor/portal` | VendorPortalPage | Public, inherited, or wrapper; see App.tsx |
| `/vendor/portal/accept-invite` | VendorPortalInvitePage | Public, inherited, or wrapper; see App.tsx |
| `/` | HomePage | Yes |
| `/war-room` | WarRoomPage | Yes |
| `/profile` | ProfilePage | Public, inherited, or wrapper; see App.tsx |
| `/files/:id/view` | AttachmentImagePage | Yes |
| `/system-status` | SystemStatusPage | Yes |
| `/pdf-tools` | PdfToolsPage | Public, inherited, or wrapper; see App.tsx |
| `/my-work` | MyWorkPage | Yes |
| `/tasks` | TasksPage | Yes |
| `/incidents` | IncidentsPage | Yes |
| `/incidents/:id` | IncidentDetailPage | Yes |
| `/problems` | ProblemsPage | Yes |
| `/problems/:id` | ProblemDetailPage | Yes |
| `/changes` | ChangesPage | Yes |
| `/changes/:id` | ChangeDetailPage | Yes |
| `/vendors-contracts` | VendorContractsPage | Yes |
| `/assets` | AssetsPage | Yes |
| `/assets/:id` | AssetDetailPage | Yes |
| `/asset-borrow` | AssetBorrowPage | Yes |
| `/maintenance` | MaintenancePage | Yes |
| `/inventory-items` | InventoryPage | Yes |
| `/software-licenses` | LicensesPage | Yes |
| `/vulnerabilities` | VulnerabilitiesPage | Yes |
| `/backup-monitoring` | BackupMonitoringPage | Yes |
| `/workflows` | WorkflowsPage | Yes |
| `/knowledge` | KnowledgePage | Yes |
| `/governance` | GovernancePage | Yes |
| `/reports` | ReportCenterPage | Yes |
| `/cmdb` | CmdbPage | Yes |
| `/cmdb/relationships` | CiRelationshipsPage | Yes |
| `/cmdb/:id` | ConfigurationItemDetailPage | Yes |
| `/admin/employee-assignments` | EmployeeAssignmentsPage | Yes |
| `/forms` | FormManagementPage | Yes |
| `/tickets` | TicketsPage | Yes |
| `/tickets/:id/form` | TicketFormPage | Yes |
| `/tickets/:id` | TicketDetailPage | Yes |
| `/service-requests` | ServiceRequestsPage | Yes |
| `/service-requests/:id` | ServiceRequestDetailPage | Yes |
| `/access-requests` | AccessRequestsPage | Yes |
| `/access-requests/:id` | AccessRequestDetailPage | Yes |
| `/admin/users` | UsersPage | Yes |
| `/admin/roles` | RolesPage | Yes |
| `/admin/permission-matrix` | PermissionMatrixPage | Yes |
| `/admin/master-data` | MasterDataPage | Yes |
| `/admin/employees` | EmployeesPage | Yes |
| `/admin/service-catalog` | ServiceCatalogPage | Yes |
| `/admin/access-registry` | AccessRegistryPage | Yes |
| `/admin/approval-groups` | ApprovalGroupsPage | Yes |
| `/admin/audit-logs` | AuditLogsPage | Yes |
| `/admin/settings` | SettingsPage | Yes |
| `/admin/line-links` | LineLinksPage | Yes |
| `/admin/integrations` | IntegrationCenterPage | Yes |
| `/field/tickets/:id/close` | FieldCloseTicketPage | Yes |
| `/field/scan` | AssetVerificationPage | Yes |
| `/field/repair` | AssetScanPage | Yes |
| `/admin/technician-skills` | TechnicianSkillMatrixPage | Yes |
| `*` | NotFoundPage | Public, inherited, or wrapper; see App.tsx |
| `/tickets/:id` | TicketDetailPage | Yes |
| `/assets/:id` | AssetDetailPage | Yes |
| `/incidents/:id` | IncidentDetailPage | Yes |
| `/problems/:id` | ProblemDetailPage | Yes |
| `/changes/:id` | ChangeDetailPage | Yes |
| `/cmdb/:id` | ConfigurationItemDetailPage | Yes |
| `/service-requests/:id` | ServiceRequestDetailPage | Yes |
| `/access-requests/:id` | AccessRequestDetailPage | Yes |

| Page source | Shared patterns found |
|---|---|
| apps/web/src/pages/AttachmentImagePage.tsx | PageTitle |
| apps/web/src/pages/ForgotPasswordPage.tsx | life-public |
| apps/web/src/pages/HealthPage.tsx | life-public |
| apps/web/src/pages/HomePage.tsx | Card, DataTable |
| apps/web/src/pages/LineCallbackPage.tsx | life-public |
| apps/web/src/pages/LinePortalPage.tsx | life-public |
| apps/web/src/pages/LoginPage.tsx | life-public |
| apps/web/src/pages/MfaChallengePage.tsx | life-public |
| apps/web/src/pages/NotFoundPage.tsx | Card |
| apps/web/src/pages/ProfilePage.tsx | Card |
| apps/web/src/pages/ResetPasswordPage.tsx | life-public |
| apps/web/src/pages/SystemStatusPage.tsx | PageTitle, Card |
| apps/web/src/pages/VendorFormPortalPage.tsx | Card, life-public |
| apps/web/src/pages/VendorPortalInvitePage.tsx | life-public |
| apps/web/src/pages/VendorPortalPage.tsx | life-public |
| apps/web/src/pages/WarRoomPage.tsx | Global tokens / native layout; requires individual visual review |
| apps/web/src/features/accessRequests/AccessRequestDetailPage.tsx | PageTitle, Card |
| apps/web/src/features/accessRequests/AccessRequestsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/AccessRegistryPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/ApprovalGroupsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/AuditLogsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/EmployeesPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/IntegrationCenterPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/LineLinksPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/MasterDataPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/PermissionMatrixPage.tsx | PageTitle, Card |
| apps/web/src/features/admin/RolesPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/ServiceCatalogPage.tsx | Global tokens / native layout; requires individual visual review |
| apps/web/src/features/admin/SettingsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/admin/UsersPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/assets/AssetBorrowPage.tsx | PageHeader, Card, DataTable |
| apps/web/src/features/assets/AssetDetailPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/assets/AssetsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/backupMonitoring/BackupMonitoringPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/changes/ChangeDetailPage.tsx | PageTitle, Card |
| apps/web/src/features/changes/ChangesPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/cmdb/CiRelationshipsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/cmdb/CmdbPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/cmdb/ConfigurationItemDetailPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/employeeAssignments/EmployeeAssignmentsPage.tsx | PageHeader, Card, DataTable |
| apps/web/src/features/fieldWork/AssetScanPage.tsx | PageHeader, Card |
| apps/web/src/features/fieldWork/AssetVerificationPage.tsx | PageHeader, Card |
| apps/web/src/features/fieldWork/FieldCloseTicketPage.tsx | PageHeader, Card |
| apps/web/src/features/forms/FormManagementPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/governance/GovernancePage.tsx | PageTitle, Card |
| apps/web/src/features/incidents/IncidentDetailPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/incidents/IncidentsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/inventory/InventoryPage.tsx | PageTitle, Card |
| apps/web/src/features/knowledge/KnowledgePage.tsx | PageTitle, Card |
| apps/web/src/features/licenses/LicensesPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/maintenance/MaintenancePage.tsx | PageHeader, DataTable |
| apps/web/src/features/myWork/MyWorkPage.tsx | PageHeader, Card, DataTable |
| apps/web/src/features/pdfTools/PdfToolsPage.tsx | PageHeader, Card |
| apps/web/src/features/problems/ProblemDetailPage.tsx | PageTitle, Card |
| apps/web/src/features/problems/ProblemsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/reports/ReportCenterPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/serviceRequests/ServiceRequestDetailPage.tsx | PageTitle, Card |
| apps/web/src/features/serviceRequests/ServiceRequestsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/tasks/TasksPage.tsx | PageHeader, DataTable |
| apps/web/src/features/technicianSkills/TechnicianSkillMatrixPage.tsx | PageHeader, Card |
| apps/web/src/features/tickets/TicketDetailPage.tsx | PageHeader, Card |
| apps/web/src/features/tickets/TicketFormPage.tsx | form-document, form-page-sheet |
| apps/web/src/features/tickets/TicketsPage.tsx | PageHeader, DataTable |
| apps/web/src/features/vendorsContracts/VendorContractsPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/vulnerabilities/VulnerabilitiesPage.tsx | PageTitle, Card, DataTable |
| apps/web/src/features/workflows/WorkflowsPage.tsx | PageTitle, Card, DataTable |
