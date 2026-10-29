# Changed files

| กลุ่มไฟล์ | เหตุผล |
|---|---|
| index.css, styles/system.css, tailwind.config.js | Aurora tokens, typography, glass surfaces, density และ responsive spacing |
| fonts.css และ assets/fonts | ฟอนต์ UI ที่โฮสต์เอง พร้อม licenses และเอกสารแยกจาก document fonts |
| AppShell, Sidebar, Topbar, DensityControl, PublicBrand | Shell, ความหนาแน่น, รายการโปรด, quick create และ public dark contrast |
| DataTable, data-table.css, Button, Card | ใช้ spacing/radius/row metrics กลาง โดยคง sorting/filter/export/selection logic |
| HomePage, ExecutiveServiceAnalytics | Compact dashboard และสีกราฟตาม theme tokens |
| VendorPortalPage, VendorContractsPage | เชื่อม public theme และแก้ filter overflow บนมือถือ |
| ServiceRequestsPage, WorkflowsPage, KnowledgePage, BackupMonitoringPage | Error surface พร้อม retry ผ่าน QueryError เดิม |
| Feature/page surfaces ที่เหลือ | ใส่ shared card marker ให้ container เดิม โดยรักษา handlers และข้อมูล |
| Unit/E2E/visual baselines | ตรวจพฤติกรรมใหม่, responsive/theme/font/print และทุกเมนูเมื่อบริการล้มเหลว |
| docs/aurora | Audit, inventory, ผลทดสอบ, performance timing และ screenshot evidence |

- `apps/web/e2e/__screenshots__/quality-gates.spec.ts/login-quality-390.png`
- `apps/web/e2e/__screenshots__/quality-gates.spec.ts/login-quality-768.png`
- `apps/web/e2e/quality-gates.spec.ts`
- `apps/web/e2e/shell-navigation.spec.ts`
- `apps/web/e2e/ux-system.spec.ts`
- `apps/web/src/assets/fonts/README.md`
- `apps/web/src/components/PublicBrand.tsx`
- `apps/web/src/components/shell/ShellNavigation.test.tsx`
- `apps/web/src/components/shell/Sidebar.tsx`
- `apps/web/src/components/shell/Topbar.tsx`
- `apps/web/src/components/table/DataTable.tsx`
- `apps/web/src/components/table/data-table.css`
- `apps/web/src/components/ui/Button.tsx`
- `apps/web/src/components/ui/Card.tsx`
- `apps/web/src/features/accessRequests/AccessRequestsPage.tsx`
- `apps/web/src/features/admin/EmployeesPage.tsx`
- `apps/web/src/features/admin/MasterDataPage.tsx`
- `apps/web/src/features/admin/SlaSettingsOverview.tsx`
- `apps/web/src/features/backupMonitoring/BackupMonitoringPage.tsx`
- `apps/web/src/features/dashboard/ExecutiveServiceAnalytics.tsx`
- `apps/web/src/features/fieldWork/AssetVerificationPage.tsx`
- `apps/web/src/features/forms/FieldSchemaBuilder.tsx`
- `apps/web/src/features/forms/FormEvidencePanel.tsx`
- `apps/web/src/features/forms/FormManagementPage.tsx`
- `apps/web/src/features/forms/GenericLinkPanel.tsx`
- `apps/web/src/features/inventory/InventoryPage.tsx`
- `apps/web/src/features/knowledge/KnowledgePage.tsx`
- `apps/web/src/features/licenses/LicensesPage.tsx`
- `apps/web/src/features/linePortal/LineNotificationPreferences.tsx`
- `apps/web/src/features/linePortal/LineProfileTab.tsx`
- `apps/web/src/features/linePortal/LineTicketDetail.tsx`
- `apps/web/src/features/maintenance/MaintenancePage.tsx`
- `apps/web/src/features/problems/ProblemsPage.tsx`
- `apps/web/src/features/serviceRequests/ServiceCatalogPreview.tsx`
- `apps/web/src/features/serviceRequests/ServiceRequestsPage.tsx`
- `apps/web/src/features/tasks/TaskCalendarView.tsx`
- `apps/web/src/features/tasks/TaskKanbanBoard.tsx`
- `apps/web/src/features/tasks/TaskTodayView.tsx`
- `apps/web/src/features/tasks/TasksPage.tsx`
- `apps/web/src/features/tickets/TicketDetailPage.tsx`
- `apps/web/src/features/tickets/TicketSignaturePanel.tsx`
- `apps/web/src/features/tickets/TicketsPage.tsx`
- `apps/web/src/features/vendorsContracts/VendorContractsPage.tsx`
- `apps/web/src/features/vulnerabilities/VulnerabilitiesPage.tsx`
- `apps/web/src/features/workflows/WorkflowsPage.tsx`
- `apps/web/src/index.css`
- `apps/web/src/layouts/AppShell.tsx`
- `apps/web/src/main.tsx`
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/pages/MfaChallengePage.tsx`
- `apps/web/src/pages/ProfilePage.tsx`
- `apps/web/src/pages/VendorPortalInvitePage.tsx`
- `apps/web/src/pages/VendorPortalPage.tsx`
- `apps/web/src/pages/WarRoomPage.tsx`
- `apps/web/src/styles/system.css`
- `apps/web/tailwind.config.js`

New files: density store/control/tests, aurora.spec.ts, aurora-modules.spec.ts, fonts.css, eight WOFF2 fonts with OFL licenses, and this report/inventory/screenshots/performance timing.
