# Phase 0 — Migration Matrix (โมดูลเดิม ↔ ระบบใหม่)

ตามคำสั่งข้อ 5: "หากโมดูลใน Source Code จริงแตกต่างจากรายการนี้ ให้สร้างตารางเปรียบเทียบ" — ตารางนี้เปรียบเทียบ
โมดูลที่ตรวจพบจริง (43 โมดูลผู้ใช้งาน) กับสถาปัตยกรรมเป้าหมาย พร้อมเสนอชื่อ API/ตาราง PostgreSQL ใหม่

**คอลัมน์ "สถานะ"** ใช้ 4 ระดับ:
- 🟢 **ตรงสเปก** = อยู่ในรายการโมดูลเป้าหมายเดิมของคำสั่งอยู่แล้ว ย้ายตามแผน Phase 6 ปกติ
- 🟡 **ต้องออกแบบใหม่บางส่วน** = ของเดิมมีอยู่แต่โครงสร้าง/ขอบเขตต่างจากที่คำสั่งกำหนด ต้องออกแบบเพิ่ม
- 🔵 **นอกรายการเดิม-รอยืนยันขอบเขต** = โมดูลมีอยู่จริงและทำงานได้ในระบบเดิม แต่ไม่อยู่ในรายการโมดูลเป้าหมายของคำสั่ง
  เริ่มต้น (ดู R-01 ใน Risk Register) — เสนอให้รวมไว้เพื่อไม่ตัดฟังก์ชันเดิม เว้นแต่ผู้ใช้จะสั่งตัดออก
- ⚪ **ไม่มีของเดิม/โมดูลใหม่ทั้งหมด** = สิ่งที่คำสั่งขอเพิ่ม แต่ระบบเดิมไม่มี implementation

## กลุ่ม A — ภาพรวมและงานส่วนบุคคล

| โมดูลเดิม | ตาราง Sheets เดิม | โมดูลใหม่ | API ใหม่ (ตัวอย่าง) | ตาราง PostgreSQL ใหม่ | สถานะ |
|---|---|---|---|---|---|
| Dashboard | (อ่านรวม) | Dashboard | `GET /api/v1/dashboard/summary` | (materialized view/aggregation query) | 🟢 |
| Task / งานของฉัน + Checklist | PersonalTasks, TaskSubtasks, TaskProgressLogs, TaskLinks, TaskAttachments, TaskReminders | งานของฉัน / Task | `/api/v1/tasks`, `/api/v1/tasks/:id/subtasks` | `tasks`, `task_subtasks`, `task_progress_logs`, `task_links` | 🟢 |
| Calendar (รวม, read-only) | (อ่านรวมจากหลายตาราง) | Calendar | `GET /api/v1/calendar?from=&to=` | (query รวมจากตารางที่มี due date, ไม่มีตารางใหม่) | 🟢 |
| Reminder (ฝังใน Notification Engine) | NotificationQueue | Reminder (ฝังใน Notification Center) | ผ่าน Cron Trigger ภายใน | ใช้ตาราง `notifications`/`notification_queue` ร่วม | 🟢 |
| Kanban board | **ไม่มีของเดิม** | Kanban | `GET/PATCH /api/v1/tasks/board` | ใช้ตาราง `tasks` เดิม + คอลัมน์ `board_status`/`sort_order` | ⚪ โมดูลใหม่ (ใช้ข้อมูล tasks เดิม) |
| งานประจำ (recurring task) | `PersonalTasks.Recurrence*` (มีฟิลด์แต่ไม่มี UI เฉพาะ) | งานประจำ | ฝันใน `/api/v1/tasks` (`recurrence` field) | คอลัมน์ recurrence ใน `tasks` | 🟡 มีข้อมูลบางส่วน ต้องเพิ่ม UI/engine สร้างงานซ้ำอัตโนมัติ |

## กลุ่ม B — บริการไอที

| โมดูลเดิม | ตาราง Sheets เดิม | โมดูลใหม่ | API ใหม่ (ตัวอย่าง) | ตาราง PostgreSQL ใหม่ | สถานะ |
|---|---|---|---|---|---|
| Help Desk / Ticket + SLA + Worklog | Tickets, Ticket_Worklogs, TicketCategories | Help Desk / Ticket | `/api/v1/tickets`, `/api/v1/tickets/:id/worklogs` | `tickets`, `ticket_worklogs`, `ticket_categories` | 🟢 |
| หน้าแจ้งซ่อมสาธารณะ (ไม่ login) + LINE/Email OTP + KB self-service | Tickets (public path), LineUsers, LineSessions | Public Intake Portal | `/api/v1/public/tickets` (ไม่ต้อง JWT, มี rate limit) | ใช้ `tickets` ร่วม + `line_users`, `line_sessions` | 🟡 ต้องออกแบบ auth แยกทางสำหรับ public เทียบกับ authenticated |
| Service Catalog / คำขอบริการ | ServiceCatalog, ServiceRequests, ServiceRequestTasks, ServiceRequestHistory | Service Catalog | `/api/v1/service-catalog`, `/api/v1/service-requests` | `service_catalog`, `service_requests`, `service_request_tasks`, `service_request_history` | 🟢 |
| คำขอสิทธิ์ระบบ (Access Request) + UserAccessRegistry | AccessRequests, UserAccessRegistry | คำขอสิทธิ์ระบบ | `/api/v1/access-requests` | `access_requests`, `user_access_registry` | 🟢 |
| Worklog | Ticket_Worklogs | Worklog (ฝัง Ticket) | `/api/v1/tickets/:id/worklogs` | `ticket_worklogs` | 🟢 |
| File Attachment | AttachmentRegistry, AttachmentLinks, AttachmentAccessLog | File Attachment | `/api/v1/attachments`, Signed URL ผ่าน Supabase Storage | `attachments`, `attachment_links`, `attachment_access_log` | 🟢 (แนวคิดเดิมใกล้เคียงสเปกใหม่มาก — ต่อยอดได้ตรง) |
| การประเมินความพึงพอใจ (CSAT) | `Tickets.Rating/Feedback` | การประเมินความพึงพอใจ | `POST /api/v1/tickets/:id/feedback` | คอลัมน์ `rating`/`feedback` ใน `tickets` | 🟢 |
| Knowledge Base | KnowledgeBase | Knowledge Base | `/api/v1/kb/articles`, `/api/v1/public/kb` | `kb_articles` | 🟢 |

## กลุ่ม C — ปฏิบัติการไอที

| โมดูลเดิม | ตาราง Sheets เดิม | โมดูลใหม่ | API ใหม่ (ตัวอย่าง) | ตาราง PostgreSQL ใหม่ | สถานะ |
|---|---|---|---|---|---|
| Incident Management + Risk Matrix + Regulatory Notification | Incidents, RegulatoryNotifications | Incident Management | `/api/v1/incidents` | `incidents`, `regulatory_notifications` | 🟢 |
| Problem Management + Known Error | Problems, KnownErrors | Problem Management | `/api/v1/problems`, `/api/v1/known-errors` | `problems`, `known_errors` | 🟢 |
| Change Management | ChangeRequests | Change Management | `/api/v1/changes` | `change_requests` | 🟢 |
| Asset Management + หมวดหมู่/ประวัติ/ตรวจนับ | AssetRegister, AssetCategories, Asset_History | Asset Management | `/api/v1/assets`, `/api/v1/assets/:id/history` | `assets`, `asset_categories`, `asset_history` | 🟢 |
| Borrow/ยืม-คืน (ใน ITAssetExtras) | Asset_History (`ActionType=ยืม/คืน`) | ฝันใน Asset Management | `/api/v1/assets/:id/borrow` | ใช้ `asset_history` | 🟡 ควรรวมเป็นส่วนหนึ่งของ Asset Management ไม่แยกโมดูล |
| PM / บำรุงรักษา (Preventive Maintenance) | MaintenancePlans, PMChecklistTemplates, PMSchedules, PMWorkOrders, PMChecklistResults, PMFindings, PMStatusHistory | **ไม่อยู่ในรายการเป้าหมายเดิม** — เสนอเป็นส่วนย่อยของ Asset Management | `/api/v1/maintenance/*` | `maintenance_plans`, `pm_checklist_templates`, `pm_schedules`, `pm_work_orders`, `pm_checklist_results`, `pm_findings` | 🔵 นอกรายการเดิม-รอยืนยันขอบเขต |
| Inventory (คลังอะไหล่/วัสดุ) | Inventory, InventoryTransactions | **ไม่อยู่ในรายการเป้าหมายเดิม** | `/api/v1/inventory` | `inventory_items`, `inventory_transactions` | 🔵 นอกรายการเดิม-รอยืนยันขอบเขต |
| Software License Management | SoftwareLicenses | Software License Management | `/api/v1/software-licenses` | `software_licenses` | 🟢 |
| Employee Registry + JML | Employees, EmployeeAssignments, EmployeeLifecycle | **ไม่อยู่ในรายการเป้าหมายเดิมโดยตรง** (ใกล้เคียง Master Data/User Mgmt) | `/api/v1/employees` | `employees`, `employee_assignments`, `employee_lifecycle` | 🔵 นอกรายการเดิม-รอยืนยันขอบเขต (แต่จำเป็นต่อ Asset/Ticket ผูกเจ้าของ) |
| CMDB / Relationship Map | ConfigurationItems, CIRelationships | CMDB | `/api/v1/cmdb/items`, `/api/v1/cmdb/relationships` | `configuration_items`, `ci_relationships` | 🟢 |
| Backup & Recovery + BCP/DR | BackupLog, RecoveryTests, BCPPlans | Backup & Recovery | `/api/v1/backups`, `/api/v1/recovery-tests`, `/api/v1/bcp-plans` | `backup_log`, `recovery_tests`, `bcp_plans` | 🟢 |
| Logging & Monitoring | LoggingRegister, LogReviews | Logging & Monitoring | `/api/v1/logging-register`, `/api/v1/log-reviews` | `logging_register`, `log_reviews` | 🟢 |
| Vulnerability & Patch Management | VulnerabilityFindings + `AssetRegister.PatchStatus` | Vulnerability & Patch Management | `/api/v1/vulnerabilities` | `vulnerability_findings` | 🟢 |

## กลุ่ม D — บริหารและกำกับดูแล

| โมดูลเดิม | ตาราง Sheets เดิม | โมดูลใหม่ | API ใหม่ (ตัวอย่าง) | ตาราง PostgreSQL ใหม่ | สถานะ |
|---|---|---|---|---|---|
| Vendor Management | VendorRegister | Vendor Management | `/api/v1/vendors` | `vendors` | 🟢 |
| Contract Management | ฝังใน VendorRegister/ConfigurationItems/MaintenancePlans (ไม่มีตารางแยก) | Contract Management | `/api/v1/contracts` | `contracts` (ตารางใหม่ทั้งหมด — ต้อง consolidate จากหลายจุด) | 🟡 ต้องออกแบบใหม่ทั้งหมด (ข้อมูลเดิมกระจัดกระจาย) |
| Workflow / Approval Engine | WorkflowDefinitions, WorkflowSteps, WorkflowInstances, WorkflowApprovals, WorkflowHistory, WorkflowDelegations | Workflow / Approval | `/api/v1/workflows/*` | `workflow_definitions`, `workflow_steps`, `workflow_instances`, `workflow_approvals`, `workflow_history`, `workflow_delegations` | 🟢 (ออกแบบไว้ดีอยู่แล้ว — ใช้เป็นต้นแบบได้ตรง) |
| Knowledge Base | (ดูกลุ่ม B) | | | | |
| Report Center | กระจายในหลายโมดูล (`getTicketAnalytics`, `getAssetAnalytics` ฯลฯ) + Evidence Export | Report Center | `/api/v1/reports/*` | ใช้ view/materialized view จากตารางจริง ไม่ใช่ตารางใหม่ | 🟡 ต้องรวมศูนย์ (ของเดิมกระจาย ไม่มี Report Center เดียว) |
| Notification Center | NotificationLog, NotificationQueue | Notification Center | `/api/v1/notifications` | `notifications`, `notification_queue` | 🟢 |
| User / Role / Permission Management | Users (`Role` เดี่ยว), ActionPermissions, RoleActionPermissions, UserPermissionOverrides, ApprovalGroups, ApprovalGroupMembers | User/Role/Permission Management | `/api/v1/users`, `/api/v1/roles`, `/api/v1/permissions` | `profiles`, `roles`, `permissions`, `user_roles`, `role_permissions` | 🟡 ต้องขยายจาก single-role เป็น Configurable RBAC เต็มรูปแบบตามสเปก |
| Master Data (หมวดหมู่ Ticket/Asset ฯลฯ) | TicketCategories, AssetCategories | Master Data | `/api/v1/master-data/*` | `ticket_categories`, `asset_categories`, `departments` (**ใหม่**), `positions` (**ใหม่**) | 🟡 ต้องเพิ่มตาราง `departments`/`positions` ที่ไม่เคยมีมาก่อน |
| System Settings | Settings, FieldDefinitions | System Settings | `/api/v1/settings` | `system_settings` | 🟢 |
| Audit Log | AuditTrail | Audit Log | `/api/v1/audit-logs` (read-only, auditor เข้าถึงได้) | `audit_logs` | 🟢 |

## กลุ่ม E — GRC / ISMS / PDPA (นอกรายการโมดูลเป้าหมายเดิมทั้งกลุ่ม — ดู R-01)

| โมดูลเดิม | ตาราง Sheets เดิม | โมดูลใหม่ที่เสนอ | API ใหม่ (ตัวอย่าง) | ตาราง PostgreSQL ใหม่ | สถานะ |
|---|---|---|---|---|---|
| Data Classification + ทำลายข้อมูล | DataClassification, DataDestructionRequests | Data Classification | `/api/v1/data-classification` | `data_classification`, `data_destruction_requests` | 🔵 |
| Legal Compliance | LegalRegister, ComplianceObligations, ComplianceAssessments, CorrectiveActions | Legal Compliance | `/api/v1/compliance/*` | `legal_register`, `compliance_obligations`, `compliance_assessments`, `corrective_actions` | 🔵 |
| Privacy / PDPA | PrivacyROPA, PrivacyConsents, PrivacyDSR | Privacy / PDPA | `/api/v1/privacy/*` | `privacy_ropa`, `privacy_consents`, `privacy_dsr` | 🔵 |
| Risk Register (ISO 27001) | RiskRegister | Risk Management | `/api/v1/risks` | `risk_register` | 🔵 |
| AI Register + Cloud Register | AIRegister, CloudRegister | AI/Cloud Register | `/api/v1/registers/ai`, `/api/v1/registers/cloud` | `ai_register`, `cloud_register` | 🔵 |
| Awareness Training | TrainingPlans, TrainingRecords, PolicyAcknowledgements | Awareness Training | `/api/v1/awareness/*` | `training_plans`, `training_records`, `policy_acknowledgements` | 🔵 |
| Audit Evidence Center | (อ่านรวม + PolicyMapping) | Audit Evidence Center | `/api/v1/audit-evidence` | ใช้ view รวม + `policy_mapping` | 🔵 |
| Audit Management | AuditEngagements, AuditFindings | Audit Management | `/api/v1/audit-engagements` | `audit_engagements`, `audit_findings` | 🔵 |
| Governance Documents | GovernanceDocuments | Governance Documents | `/api/v1/governance-documents` | `governance_documents` | 🔵 |
| PDF/Document Designer | PDFDesignTemplates | PDF/Document Designer | `/api/v1/pdf-templates` | `pdf_design_templates` | 🔵 (ความซับซ้อนสูง — ประเมิน Phase 4 ว่าจะ build ใหม่หรือใช้บริการภายนอก) |
| Operations Hardening (SLA เวลาทำการ, Retention, JML, Live health) | RetentionLog, EmployeeLifecycle, Settings(`SLA_*`) | ฝังเป็น Cross-cutting Service | Cron Job ภายใน + `/api/v1/settings` | `retention_log` + logic ใน Workers Cron | 🔵 (เป็นรากฐานสำคัญของ SLA/Compliance ทั้งระบบ ควรคงไว้) |
| Integration Outbox + RecordLinks | IntegrationOutbox, RecordLinks | Cross-module Integration (internal) | ไม่มี endpoint ตรง — เป็นกลไกภายใน Backend | `integration_outbox`, `record_links` | 🔵 (เป็น pattern เชื่อมโมดูล ควรคงไว้เป็น internal service) |
| Action Permission + Approval Group | ActionPermissions, RoleActionPermissions, UserPermissionOverrides, ApprovalGroups, ApprovalGroupMembers | รวมเข้ากับ RBAC ใหม่ | ผูกกับ `/api/v1/permissions`, `/api/v1/approval-groups` | รวมกับ `role_permissions`/`user_permission_overrides`, ตารางใหม่ `approval_groups`, `approval_group_members` | 🟡 แนวคิดตรงกับ Configurable RBAC ใหม่อยู่แล้ว — ต่อยอดโดยตรง |
| Field Designer (custom field ในหน้า Settings) | FieldDefinitions | **พิจารณาตัดออกหรือเลื่อนไปหลัง Go-live** | – | `field_definitions` (ถ้าคงไว้) | 🔵 (ความซับซ้อนสูง เทียบกับประโยชน์ — แนะนำ Migration Matrix ระบุ "เลื่อน" ใน Risk Register R-05) |
| Tester / QA (Release Checklist) | QATestCases | ไม่ใช่โมดูล runtime — เป็นเครื่องมือ QA ภายใน | – | แทนที่ด้วย GitHub Actions PR workflow (ข้อ 12) | ⚪ แทนที่ด้วยกระบวนการ CI/CD ใหม่ ไม่ต้อง migrate ข้อมูล |

## สรุปตัวเลข

| สถานะ | จำนวนโมดูล |
|---|---|
| 🟢 ตรงสเปก ย้ายตามแผนปกติ | 24 |
| 🟡 ต้องออกแบบใหม่บางส่วน | 8 |
| 🔵 นอกรายการเดิม-รอยืนยันขอบเขต | 15 |
| ⚪ ไม่มีของเดิม/แทนที่ด้วยกระบวนการใหม่ | 3 |

**ข้อเสนอ:** เนื่องจากกลุ่ม 🔵 (15 โมดูล) คือแก่นของระบบ ISMS Governance เดิมและมีข้อมูล Production จริงอยู่แล้ว
(Legal Compliance, Privacy/PDPA, Risk, Awareness ฯลฯ ผ่านการใช้งานจริงมาหลาย Phase) การไม่ย้ายจะทำให้กองทุนฯ
เสียความสามารถ ISMS/PDPA compliance ที่มีอยู่แล้วไปทันที **จึงแนะนำให้รวมโมดูลกลุ่ม E ทั้งหมดไว้ในขอบเขต Migration**
และขยายรายการ Phase 6 (ย้ายทีละโมดูล) ให้ครอบคลุม — รายละเอียดอยู่ใน [`phase0-migration_roadmap.md`](phase0-migration_roadmap.md)
