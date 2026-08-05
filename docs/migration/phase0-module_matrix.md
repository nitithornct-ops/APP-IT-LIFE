# Phase 0 — Module Matrix (ระบบเดิม)

รวบรวมโมดูลทั้งหมดที่มีอยู่จริงใน Source Code (47 ไฟล์ .gs / 33 ไฟล์ .html) จับคู่กับไฟล์ Server, ไฟล์หน้าบ้าน,
Google Sheet ที่ใช้ และบทบาทที่เข้าถึงได้ (จาก `Config.gs > MODULE_ACCESS` ตามที่ระบุใน `docs/03`)

สัญลักษณ์สิทธิ์: ✏️ แก้ไข/ดำเนินการได้ · 👁 อ่านอย่างเดียว · ✔ ใช้งานตามบทบาท · – ไม่มีสิทธิ์
(User / Approver / ITAdmin / Executive / DPO — เรียงตามลำดับคอลัมน์)

## กลุ่ม A — ภาพรวมและงานส่วนบุคคล

| # | โมดูล | .gs | .html | Sheet หลัก | U | Ap | IT | Ex | DPO |
|---|---|---|---|---|:--:|:--:|:--:|:--:|:--:|
| A1 | Dashboard + ศูนย์แจ้งเตือน (topbar bell) | `Module_Dashboard.gs` | `Dashboard.html` | (อ่านรวมจากหลาย Sheet) | ✔ | ✔ | ✔ | ✔ | ✔ |
| A2 | Task / งานของฉัน + Checklist (Subtask) | `Module_Task.gs` | `Task.html` | `PersonalTasks`, `TaskSubtasks`, `TaskAttachments` | ✏️ เฉพาะของตน | ✏️ เฉพาะของตน | ✏️ เฉพาะของตน | ✏️ เฉพาะของตน | ✏️ เฉพาะของตน |
| A3 | Calendar (ปฏิทินรวม, read-only, config-driven) | `Module_Calendar.gs` | `Calendar.html` | อ่านรวมจากหลาย Sheet ตาม `CAL_SOURCES` | 👁 ตามสิทธิ์โมดูลต้นทาง | 👁 | 👁 | 👁 | 👁 |
| A4 | Reminder / Notification Engine (ไม่มีหน้าเฉพาะ — ฝัง Dashboard + LINE) | `Notification.gs` | (ผ่าน `NotificationSettings.html` สำหรับตั้งค่า) | `NotificationLog`, `NotificationQueue` | – | – | ✔ ตั้งค่า | – | – |
| — | งานประจำ / Kanban (**ไม่มีในระบบเดิม**) | – | – | – | – | – | – | – | – |

> **Kanban และงานประจำ (recurring task board) ไม่มี implementation แยกในระบบเดิม** — `PersonalTasks` มีฟิลด์
> `Recurrence`/`RecurrenceEndDate`/`RecurringParentID` รองรับงานประจำเชิงข้อมูลแล้ว แต่ไม่มีมุมมองแบบ Kanban board
> ถือเป็นโมดูลใหม่ที่ต้องออกแบบเพิ่มในระบบใหม่ (ไม่ใช่การย้าย)

## กลุ่ม B — บริการไอที (ITSM หลัก)

| # | โมดูล | .gs | .html | Sheet หลัก | U | Ap | IT | Ex | DPO |
|---|---|---|---|---|:--:|:--:|:--:|:--:|:--:|
| B1 | Help Desk / Ticket (+ SLA + Worklog) | `Module_Ticket.gs`, `Module_TicketExtras.gs` | `Ticket.html` | `Tickets`, `Ticket_Worklogs`, `TicketCategories` | ✏️ เปิด Ticket | ✏️ คัดแยก/ยกระดับ | ✏️ จัดการ | 👁 | – |
| B2 | หน้าแจ้งซ่อมสาธารณะ (ไม่ login) + LINE/Email OTP + KB self-service | (ใช้ฟังก์ชัน public ใน `Module_Ticket.gs`, `LineAuth.gs`, `Module_KB.gs`) | `PublicTicket.html`, `LineCallback.html` | `Tickets`, `LineUsers`, `LineSessions` | ทุกคน (public) | | | | |
| B3 | Service Catalog / คำขอบริการ | `Module_ServiceCatalog.gs` | `ServiceCatalog.html` | `ServiceCatalog`, `ServiceRequests`, `ServiceRequestTasks`, `ServiceRequestHistory` | ✏️ ขอ/ยืนยันของตน | ✏️ ขอ+อนุมัติเมื่อ exact assignee | ✏️ Catalog/มอบหมาย/ดำเนินการ | ✏️ ขอ/ยืนยัน+อนุมัติเมื่อ exact assignee | ✏️ ขอ/ยืนยัน+อนุมัติเมื่อ exact assignee |
| B4 | คำขอสิทธิ์ระบบ (Access Request) + RBAC Registry | `Module_AccessControl.gs` | `AccessControl.html` | `AccessRequests`, `UserAccessRegistry` | ✏️ ยื่นคำขอ | ✏️ อนุมัติ | ✏️ ดำเนินการ | 👁 | – |
| B5 | Worklog (ฝังใน Ticket, ไม่ใช่โมดูลแยก) | `Module_Ticket.gs` | `Ticket.html` | `Ticket_Worklogs` | – | – | ✏️ | 👁 | – |
| B6 | File Attachment (ดูกลุ่ม D — Attachment Registry) | `Module_AttachmentRegistry.gs` | (ฝังทุกหน้าโมดูลผ่าน `JavaScript.html`) | `AttachmentRegistry`, `AttachmentLinks`, `AttachmentAccessLog` | ตามสิทธิ์โมดูลเจ้าของ record | | | | |
| B7 | การประเมินความพึงพอใจ (CSAT) | `Module_Ticket.gs` (ฟิลด์ `Rating`/`Feedback` ใน Ticket) + `Module_TicketExtras.gs` (`getTicketAnalytics` รวม CSAT) | `Ticket.html` | `Tickets` (ฟิลด์ในตัว ไม่มี Sheet แยก) | ✏️ ให้คะแนนงานของตน | – | 👁 รายงาน | 👁 | – |
| B8 | Knowledge Base | `Module_KB.gs` | `KB.html` (+ แท็บใน `PublicTicket.html`) | `KnowledgeBase` | 👁 อ่านเผยแพร่ | 👁 | ✏️ สร้าง/แก้/เผยแพร่ | 👁 | – |

## กลุ่ม C — ปฏิบัติการไอที

| # | โมดูล | .gs | .html | Sheet หลัก | U | Ap | IT | Ex | DPO |
|---|---|---|---|---|:--:|:--:|:--:|:--:|:--:|
| C1 | Incident Management (+ Risk Matrix 5×5 + Regulatory Notification) | `Module_Incident.gs` | `Incident.html` | `Incidents`, `RegulatoryNotifications` | ✏️ แจ้งเหตุ | 👁 หน่วยงานตน | ✏️ จัดการ/ปิดเคส | 👁 | ✏️ เคสข้อมูลส่วนบุคคล |
| C2 | Problem Management + Known Error | `Module_Assurance.gs` | `Assurance.html` | `Problems`, `KnownErrors` | – | 👁 | ✏️ | 👁 | – |
| C3 | Change Management | `Module_Change.gs` | `Change.html` | `ChangeRequests` | – | ✏️ | ✏️ | 👁 | – |
| C4 | Asset Management (+ หมวดหมู่/ตรวจนับ/ค่าเสื่อม) | `Module_Asset.gs`, `Module_AssetExtras.gs` | `Asset.html` | `AssetRegister`, `AssetCategories` | – | – | ✏️ | 👁 | – |
| C5 | IT Asset Extras (Borrow/ยืม-คืน/PM/Inventory/License/Users/Settings/Tester-QA) | `Module_ITAssetExtras.gs`, `Module_PMExtras.gs`, `Module_InventoryExtras.gs` | `ITAssetExtras.html` | `EmployeeAssignments` และ Sheet ย่อยหลายตัว (Borrow/PM/Inventory/License ผูกกับ Asset) | – | – | ✏️ | 👁 | – |
| C6 | Employee Registry + Joiner/Mover/Leaver | `Module_Employee.gs` | `Employee.html` | `Employees`, `EmployeeAssignments`, `EmployeeLifecycle` | – | – | ✏️ | 👁 | – |
| C7 | CMDB / Relationship Map | `Module_CMDB.gs` | `CMDB.html` | `ConfigurationItems`, `CIRelationships` | – | 👁 | ✏️ | 👁 | 👁 |
| C8 | Backup & Recovery + BCP/DR | `Module_Backup.gs` | `Backup.html` | `BackupLog`, `RecoveryTests`, `BCPPlans` | – | – | ✏️ | 👁 | – |
| C9 | Logging & Monitoring | `Module_Logging.gs` | `Logging.html` | `LoggingRegister`, `LogReviews` | – | – | ✏️ | 👁 | – |
| C10 | Vulnerability & Patch Management | `Module_Assurance.gs` (Vulnerability ส่วน) + `PatchStatus/PatchDate` ใน `AssetRegister` | `Assurance.html` | `VulnerabilityFindings` | – | – | ✏️ | 👁 | 👁 |
| C11 | Software License Management | `Module_ITAssetExtras.gs` (ส่วน License) | `ITAssetExtras.html` | Sheet License (ย่อยใน ITAssetExtras schema) | – | – | ✏️ | 👁 | – |

## กลุ่ม D — บริหารและกำกับดูแล (ตรงกับรายการเป้าหมาย)

| # | โมดูล | .gs | .html | Sheet หลัก | U | Ap | IT | Ex | DPO |
|---|---|---|---|---|:--:|:--:|:--:|:--:|:--:|
| D1 | Vendor Management | `Module_Vendor.gs` | `Vendor.html` | `VendorRegister` | – | – | ✏️ | 👁 | – |
| D2 | Contract Management (**ไม่มีโมดูลแยก**) | ฝังใน `Module_Vendor.gs` (`ContractNo/ContractExpiry`) และ CMDB (`ContractRef`) | `Vendor.html` | ฟิลด์ในตัว ไม่มี Sheet `Contracts` แยก | – | – | ✏️ | 👁 | – |
| D3 | Workflow / Approval Engine กลาง | `Module_Workflow.gs` | `Workflow.html` | `WorkflowDefinitions`, `WorkflowSteps`, `WorkflowInstances`, `WorkflowApprovals`, `WorkflowHistory`, `WorkflowDelegations` | 👁 ของตน/ยกเลิกของตน | ✏️ พิจารณา/มอบหมาย | ✏️ ทุก workflow+admin | 👁 กว้างตาม action permission | 👁 ของตน |
| D4 | Knowledge Base | (ดู B8) | | | | | | | |
| D5 | Report Center (**ไม่มีโมดูลรวมศูนย์ — กระจายอยู่หลายจุด**) | `Module_TicketExtras.gs` (`getTicketAnalytics`), `Module_AssetExtras.gs` (`getAssetAnalytics`), `Module_InventoryExtras.gs`, `Module_PMExtras.gs`, `Module_Evidence.gs` (Export PDF/CSV), `Module_PDFDesigner.gs` | `Evidence.html` + ฝังในแต่ละหน้าโมดูล | อ่านรวมจากหลาย Sheet | ตามสิทธิ์โมดูลต้นทาง | | | | |
| D6 | Notification Center | `Notification.gs` | `NotificationSettings.html` + bell ใน `Index.html` | `NotificationLog`, `NotificationQueue` | ✔ รับแจ้งเตือนตามสิทธิ์ | ✔ | ✔ ตั้งค่า | ✔ | ✔ |
| D7 | User / Role / Permission Management | ส่วน "Users" ใน `Module_ITAssetExtras.gs` + `Setup.gs` (bootstrap) | `ITAssetExtras.html` | `Users` | – | – | ✏️ | – | – |
| D7b | Action Permission (สิทธิ์ระดับ action + Approval Group) | `Module_ActionPermission.gs` | ฝังใน `Workflow.html`/หน้า admin | `ActionPermissions`, `RoleActionPermissions`, `UserPermissionOverrides`, `ApprovalGroups`, `ApprovalGroupMembers` | – | – | ✏️ admin | – | – |
| D8 | Master Data (หมวดหมู่ Ticket/Asset, Field Designer) | `Module_FieldDesigner.gs`, ส่วน Categories ใน `Module_TicketExtras.gs`/`Module_AssetExtras.gs` | ฝังในหน้า Settings | `TicketCategories`, `AssetCategories`, และคำนิยาม field custom | – | – | ✏️ | – | – |
| D9 | System Settings | ส่วน "Settings" ใน `Module_ITAssetExtras.gs` + `getConfig_/setConfig_` (`Utils.gs`) | `ITAssetExtras.html` | `Settings` (key-value) | – | – | ✏️ | – | – |
| D10 | Audit Log (ดู/ค้นหา) | `Module_AuditTrail.gs` | `AuditTrail.html` | `AuditTrail` | – | – | 👁 | 👁 | – |

## กลุ่ม E — GRC / ISMS / PDPA (พบในระบบเดิม แต่ไม่อยู่ในรายการโมดูลเป้าหมายของคำสั่งเริ่มต้น)

> **สำคัญ:** กลุ่มนี้คือแก่นของระบบเดิม (ชื่อระบบคือ "ISMS Governance System") ตามกฎข้อ 4 "ห้ามตัดฟังก์ชันเดิมออกโดยไม่ได้รับอนุญาต"
> จึงนับรวมไว้ในขอบเขต Migration ทั้งหมด เว้นแต่ผู้ใช้จะยืนยันให้ตัดออกอย่างชัดเจน (ดู R-01 ใน Risk Register)

| # | โมดูล | .gs | .html | Sheet หลัก | U | Ap | IT | Ex | DPO |
|---|---|---|---|---|:--:|:--:|:--:|:--:|:--:|
| E1 | Data Classification + workflow ทำลายข้อมูล | `Module_DataClass.gs` | `DataClass.html` | `DataClassification`, `DataDestructionRequests` | – | – | ✏️ | 👁 | 👁 |
| E2 | Legal Compliance (กฎหมาย/ข้อกำหนด/Assessment/CAPA) | `Module_Compliance.gs` | `Compliance.html` | `LegalRegister`, `ComplianceObligations`, `ComplianceAssessments`, `CorrectiveActions` | – | 👁 | ✏️ | 👁 | ✏️ |
| E3 | Privacy / PDPA (RoPA/Consent/DSR) | `Module_Privacy.gs` | `Privacy.html` | `PrivacyROPA`, `PrivacyConsents`, `PrivacyDSR` | – | – | ✏️ | 👁 | ✏️ |
| E4 | Risk Register (ISO 27001 6.1.2/6.1.3/8.2/8.3) | `Module_Risk.gs` | `Risk.html` | (Sheet Risk register — นิยามใน `DB_SCHEMA`) | – | – | ✏️ | 👁 | 👁 |
| E5 | AI Register + Cloud Register | `Module_AI_Cloud.gs` | `AICloud.html` | `AIRegister`, `CloudRegister` | 👁 | 👁 | ✏️ | 👁 | 👁 |
| E6 | Awareness Training (แผนอบรม/Quiz/e-sign) | `Module_Awareness.gs` | `Awareness.html` | `TrainingPlans`, `TrainingRecords`, `PolicyAcknowledgements` | ✏️ ลงชื่อ/ทำแบบทดสอบ | ✔ | ✏️ จัดการ | 👁 | ✔ |
| E7 | Audit Evidence Center (สุขภาพมาตรการควบคุม + Export) | `Module_Evidence.gs` | `Evidence.html` | อ่านรวมจาก `PolicyMapping` + หลายโมดูล | – | – | ✔ | ✔ | – |
| E8 | Audit Management (Engagement/Finding) | `Module_Assurance.gs` | `Assurance.html` | `AuditEngagements`, `AuditFindings` | – | – | ✏️ | 👁 | 👁 |
| E9 | Governance Documents (คลังเอกสารธรรมาภิบาล) | `Module_GovernanceDocuments.gs` | (ฝังใน `Evidence.html`) | `GovernanceDocuments` | – | – | ✏️ | 👁 | – |
| E10 | PDF Designer / Document Designer (Word-like) | `Module_PDFDesigner.gs` | ฝังในหน้า Settings/Evidence | Template เก็บใน `Settings` (JSON) | – | – | ✏️ | – | – |
| E11 | Operations Hardening (SLA เวลาทำการ, Retention/PDPA enforcement, JML, Live health) | `Module_OperationsHardening.gs` | ฝังใน `Backup.html`/`Employee.html` | `RetentionLog`, `EmployeeLifecycle`, `Settings` (`SLA_*`) | – | – | ✔ | – | – |
| E12 | Integration Outbox (เชื่อม Service Request → Access/Ticket/Asset/Change) | `Module_Integration.gs` | ฝังใน `Workflow.html`/`ServiceCatalog.html` | `IntegrationOutbox`, `RecordLinks` | – | – | ✏️ admin | – | – |

## กลุ่ม F — Platform / Cross-cutting (ไม่ใช่ "โมดูลผู้ใช้" แต่เป็นรากฐานที่ต้องย้ายเสมอ)

| # | รายการ | ไฟล์ | หน้าที่ |
|---|---|---|---|
| F1 | Routing/Entry point | `Code.gs` | `doGet`, build/schema version check |
| F2 | Config กลาง | `Config.gs` | Roles, `SHEETS`, `DB_SCHEMA`, `MODULE_ACCESS` |
| F3 | Auth/Session | `Auth.gs` | login, session, MFA, `requireModule`/`requireRole` |
| F4 | LINE Login | `LineAuth.gs`, `LineCallback.html` | OAuth/OIDC + PKCE สำหรับผู้แจ้งภายนอก |
| F5 | Utilities กลาง | `Utils.gs` | อ่าน/เขียน Sheet, `LockService`, validation, `writeAudit_`, `include_` |
| F6 | Setup/Migration | `Setup.gs` | additive schema setup, seed, trigger install |
| F7 | Soft-delete กลาง | `DeleteService.gs` (+ placeholder `Module_Delete.gs`) | mark-as-deleted แบบรวมศูนย์ |
| F8 | Drive (legacy) | `Drive.gs` | อัปโหลด/จัดโฟลเดอร์หลักฐานรุ่นเดิม |
| F9 | Frontend shell + shared CSS/JS | `Index.html`, `Styles.html`, `JavaScript.html`, `AccessDenied.html` | Layout, design system, `callServer()` wrapper |

---

**สรุปจำนวน:** 10 โมดูลกลุ่ม A/B (ตรงกับรายการเป้าหมายกลุ่ม "ภาพรวม+บริการไอที"), 11 โมดูลกลุ่ม C (ปฏิบัติการไอที),
10 โมดูลกลุ่ม D (บริหาร/กำกับดูแล — ตรงรายการเป้าหมาย), **12 โมดูลกลุ่ม E ที่อยู่นอกรายการเป้าหมายเดิมของคำสั่ง**
รวมทั้งหมด **~43 โมดูลผู้ใช้งาน** + 9 ไฟล์ Platform กลาง
