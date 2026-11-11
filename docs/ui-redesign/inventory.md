# Route and component inventory

Base: origin/master 1653d28. Generated from App.tsx and the actual component tree.

## Routes (67)

Authenticated routes retain their ProtectedRoute declarations, permissions and API calls. Shared AppShell, PageTitle/PageHeader, controls, tables and CSS tokens propagate the console presentation. Public routes inherit life-public surfaces. Detail route modals continue sharing Modal and DetailLayout.

| Route | Presentation coverage |
|---|---|
| `/login` | Public/auth surface and shared tokens |
| `/mfa` | Public/auth surface and shared tokens |
| `/forgot-password` | Public/auth surface and shared tokens |
| `/reset-password` | Public/auth surface and shared tokens |
| `/health` | Public/auth surface and shared tokens |
| `/line` | Public/auth surface and shared tokens |
| `/line/callback` | Public/auth surface and shared tokens |
| `/vendor/forms` | Public/auth surface and shared tokens |
| `/vendor/forms/:token` | Public/auth surface and shared tokens |
| `/vendor/portal` | Public/auth surface and shared tokens |
| `/vendor/portal/accept-invite` | Public/auth surface and shared tokens |
| `/` | AppShell and shared module components |
| `/war-room` | AppShell and shared module components |
| `/profile` | AppShell and shared module components |
| `/files/:id/view` | AppShell and shared module components |
| `/system-status` | AppShell and shared module components |
| `/pdf-tools` | AppShell and shared module components |
| `/my-work` | AppShell and shared module components |
| `/tasks` | AppShell and shared module components |
| `/incidents` | AppShell and shared module components |
| `/incidents/:id` | AppShell and shared module components |
| `/problems` | AppShell and shared module components |
| `/problems/:id` | AppShell and shared module components |
| `/changes` | AppShell and shared module components |
| `/changes/:id` | AppShell and shared module components |
| `/vendors-contracts` | AppShell and shared module components |
| `/assets` | AppShell and shared module components |
| `/assets/:id` | AppShell and shared module components |
| `/asset-borrow` | AppShell and shared module components |
| `/maintenance` | AppShell and shared module components |
| `/inventory-items` | AppShell and shared module components |
| `/software-licenses` | AppShell and shared module components |
| `/vulnerabilities` | AppShell and shared module components |
| `/backup-monitoring` | AppShell and shared module components |
| `/workflows` | AppShell and shared module components |
| `/knowledge` | AppShell and shared module components |
| `/governance` | AppShell and shared module components |
| `/reports` | AppShell and shared module components |
| `/cmdb` | AppShell and shared module components |
| `/cmdb/relationships` | AppShell and shared module components |
| `/cmdb/:id` | AppShell and shared module components |
| `/admin/employee-assignments` | AppShell and shared module components |
| `/forms` | AppShell and shared module components |
| `/tickets` | AppShell and shared module components |
| `/tickets/:id/form` | AppShell and shared module components |
| `/tickets/:id` | AppShell and shared module components |
| `/service-requests` | AppShell and shared module components |
| `/service-requests/:id` | AppShell and shared module components |
| `/access-requests` | AppShell and shared module components |
| `/access-requests/:id` | AppShell and shared module components |
| `/admin/users` | AppShell and shared module components |
| `/admin/roles` | AppShell and shared module components |
| `/admin/permission-matrix` | AppShell and shared module components |
| `/admin/master-data` | AppShell and shared module components |
| `/admin/employees` | AppShell and shared module components |
| `/admin/service-catalog` | AppShell and shared module components |
| `/admin/access-registry` | AppShell and shared module components |
| `/admin/approval-groups` | AppShell and shared module components |
| `/admin/audit-logs` | AppShell and shared module components |
| `/admin/settings` | AppShell and shared module components |
| `/admin/line-links` | AppShell and shared module components |
| `/admin/integrations` | AppShell and shared module components |
| `/field/tickets/:id/close` | AppShell and shared module components |
| `/field/scan` | AppShell and shared module components |
| `/field/repair` | AppShell and shared module components |
| `/admin/technician-skills` | AppShell and shared module components |
| `*` | AppShell and shared module components |

## Shared component inventory (31)

- `apps/web/src/components/shell/CommandPalette.tsx`
- `apps/web/src/components/shell/DensityControl.tsx`
- `apps/web/src/components/shell/FontSizeControl.tsx`
- `apps/web/src/components/shell/MobileBottomNav.tsx`
- `apps/web/src/components/shell/Sidebar.tsx`
- `apps/web/src/components/shell/ThemeToggle.tsx`
- `apps/web/src/components/shell/Topbar.tsx`
- `apps/web/src/components/table/BulkAction.tsx`
- `apps/web/src/components/table/data-table.css`
- `apps/web/src/components/table/DataTable.tsx`
- `apps/web/src/components/table/ExportAllButton.tsx`
- `apps/web/src/components/table/ExportCsvButton.tsx`
- `apps/web/src/components/table/ExportSheetsButton.tsx`
- `apps/web/src/components/table/RowActions.tsx`
- `apps/web/src/components/ui/AsyncState.tsx`
- `apps/web/src/components/ui/Badge.tsx`
- `apps/web/src/components/ui/Button.tsx`
- `apps/web/src/components/ui/Card.tsx`
- `apps/web/src/components/ui/DetailLayout.tsx`
- `apps/web/src/components/ui/DetailLink.tsx`
- `apps/web/src/components/ui/EmptyState.tsx`
- `apps/web/src/components/ui/FilterBar.tsx`
- `apps/web/src/components/ui/KpiStrip.tsx`
- `apps/web/src/components/ui/Modal.tsx`
- `apps/web/src/components/ui/PageHeader.tsx`
- `apps/web/src/components/ui/PageTitle.tsx`
- `apps/web/src/components/ui/QueryError.tsx`
- `apps/web/src/components/ui/Skeleton.tsx`
- `apps/web/src/components/ui/SlaBadge.tsx`
- `apps/web/src/components/ui/StatusBadge.tsx`
- `apps/web/src/components/ui/Toast.tsx`

## Theme hardcoding audit

- index.css: translucent blue surfaces, aurora gradients, large shadows, blue active navigation and public gradient hero; replaced in their original rules with flat semantic surfaces and orange accents. Existing compatibility aliases remain for LIFE blue charts and document tooling.
- tailwind.config.js: page/header/muted surfaces, borders, heading and shadow utilities now resolve semantic variables. LIFE blue primary scale remains a brand/chart scale; action colors use their own tokens.
- Button, FilterBar, Card, DataTable, KpiStrip, AppShell, Sidebar and Topbar: migrate shared shell/surface/action treatment without changing their props, state or data ownership.
- PageTitle hero leading icon: remove the white-on-white treatment after flattening hero backgrounds.
- Existing semantic status colors stay success/warning/danger/info; LINE retains its accessible service green. No mass replacement of business status utility classes.
- Document styles (.form-document, .form-page-sheet, ticket print and report print rules) and document font definitions are preserved.
- Legacy per-page slate utility classes and prior neutral compatibility rules remain; this change removes gradients and duplicate overrides in the touched rules rather than adding a second theme stylesheet.
