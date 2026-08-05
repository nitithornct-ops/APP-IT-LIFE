# Phase 0 — Data Dictionary เดิม (อ้างอิง)

## แหล่งข้อมูลที่แท้จริง (Ground Truth)

**`Config.gs > DB_SCHEMA` (บรรทัด 132–628) คือแหล่งข้อมูล Schema ที่ถูกต้องที่สุด** เพราะเป็นค่าที่ `setupSystem()`
ใน `Setup.gs` ใช้สร้าง/อัปเดตชีตจริงบน Production แบบ additive ทุกครั้ง

**พบว่า `docs/02_โครงสร้างฐานข้อมูล.md` (เอกสารเดิม) ไม่ครบถ้วนแล้ว** — เอกสารบันทึกไว้ 71 ทะเบียน แต่ `DB_SCHEMA`
จริงมี **93 ทะเบียน (Sheet)** ส่วนต่าง 22 ทะเบียนที่ไม่มีในเอกสารเดิมส่วนใหญ่มาจากโมดูล IT Asset Extras (Borrow/PM/
Inventory/License) และไฟล์ตั้งค่า/เครื่องมือระบบที่เพิ่มเข้ามาไม่พร้อมกับรอบอัปเดต docs/02 — **คำแนะนำ: Phase 2
(ออกแบบ ER Diagram/Migration SQL) ต้องอ่าน `DB_SCHEMA` ใน `Config.gs` โดยตรงเป็นหลัก ห้ามใช้ `docs/02` เพียงอย่างเดียว**

## รายการทะเบียนทั้งหมด 93 รายการ (ตรวจนับจริงจาก `SHEETS` constant + `DB_SCHEMA`)

จัดกลุ่มตามโดเมนธุรกิจ (ตัวหนา = **ไม่ปรากฏใน `docs/02` เดิม**):

**ผู้ใช้/บุคลากร (8):** Users, Employees, EmployeeAssignments, EmployeeLifecycle, LineUsers, LineSessions,
**FieldDefinitions**, **QATestCases**

**Audit/Governance เอกสาร (3):** AuditTrail, **GovernanceDocuments**, **PDFDesignTemplates**

**Task ส่วนบุคคล (6):** PersonalTasks, TaskSubtasks, **TaskProgressLogs**, **TaskLinks**, TaskAttachments,
**TaskReminders**

**Help Desk / Ticket (4):** Tickets, TicketCategories, Ticket_Worklogs, KnowledgeBase

**Asset / IT Operations (16):** AssetRegister, **AssetCategories**, **Asset_History**, **MaintenancePlans**,
**PMChecklistTemplates**, **PMSchedules**, **PMWorkOrders**, **PMChecklistResults**, **PMFindings**,
**PMStatusHistory**, **Inventory**, **InventoryTransactions**, **SoftwareLicenses**, ConfigurationItems,
CIRelationships

**Data Governance / PDPA (5):** DataClassification, DataDestructionRequests, PrivacyROPA, PrivacyConsents,
PrivacyDSR

**Assurance (5):** Problems, KnownErrors, VulnerabilityFindings, AuditEngagements, AuditFindings

**Service Catalog / Request (5):** ServiceCatalog, ServiceRequests, ServiceRequestTasks, ServiceRequestHistory

**Workflow Engine (6):** WorkflowDefinitions, WorkflowSteps, WorkflowInstances, WorkflowApprovals,
WorkflowHistory, WorkflowDelegations

**Attachment/Integration/Action-Permission (10):** AttachmentRegistry, AttachmentLinks, AttachmentAccessLog,
RecordLinks, IntegrationOutbox, ActionPermissions, RoleActionPermissions, UserPermissionOverrides,
ApprovalGroups, ApprovalGroupMembers

**Access / Change (3):** AccessRequests, UserAccessRegistry, ChangeRequests

**Backup/BCP (3):** BackupLog, RecoveryTests, BCPPlans

**Logging (2):** LoggingRegister, LogReviews

**Incident/Risk (2):** Incidents, RegulatoryNotifications, **RiskRegister**

**Legal/Compliance (4):** LegalRegister, ComplianceObligations, ComplianceAssessments, CorrectiveActions

**Vendor/AI/Cloud (3):** VendorRegister, AIRegister, CloudRegister

**Awareness (3):** TrainingPlans, TrainingRecords, PolicyAcknowledgements

**Notification/Ops (5):** NotificationLog, NotificationQueue, RetentionLog, **RateLimits**, Settings

**Reference (1):** PolicyMapping

## ข้อสังเกตเชิงโครงสร้างที่สำคัญต่อการออกแบบ PostgreSQL (Phase 2)

1. **ไม่มี Foreign Key จริง** — ทุกความสัมพันธ์ (เช่น `AssetID` ใน `Tickets`, `CatalogID` ใน `ServiceRequests`,
   `LawID` ใน `ComplianceObligations`) เป็น text field ที่ตรวจสอบด้วยโค้ดฝั่ง Server เท่านั้น ต้องออกแบบ FK constraint
   จริงในระบบใหม่ และวางแผน data cleansing ก่อน migrate เพราะอาจมี orphaned reference สะสมมาจากระบบเดิม
2. **`Users.Role` เป็นค่าเดียว ไม่ใช่ many-to-many** (`Role: Enum` ค่าเดียวต่อผู้ใช้ 1 คน, มี 5 ค่า: User/Approver/
   ITAdmin/Executive/DPO) — ต้อง migrate เป็นระบบ `user_roles` (many-to-many) ตามสเปกใหม่ พร้อม mapping 5 role เดิม
   ไปยัง role ใหม่ที่กำหนดไว้ (ดู [`phase0-migration_matrix.md`](phase0-migration_matrix.md))
3. **`Users` เก็บ `PasswordHash`/`PasswordSalt` เอง** — **ห้าม migrate ค่านี้ไปยัง Supabase Auth โดยตรงเด็ดขาด**
   (Supabase ใช้ bcrypt ของตัวเอง ไม่ compatible กับ hash เดิม) ต้องใช้กระบวนการ "IT Admin เชิญผู้ใช้ตั้งรหัสผ่านใหม่"
   ตามสเปกที่กำหนดไว้แล้วในคำสั่ง (ปิด Public Sign-up + Admin เป็นผู้เชิญ) — นี่คือจุดที่สเปกใหม่สอดคล้องกับความจำเป็น
   ทางเทคนิคพอดี
4. **`Department` เป็น Free-text ทุกที่** (`Users.Department`, `Employees.Department`, `Tickets.Department`,
   `AssetRegister.Department` ฯลฯ) — **ไม่มีตาราง `Departments`/`Positions` แยกในระบบเดิม** ต้องสร้างตาราง Master
   ใหม่ตามสเปก (ข้อ 4) แล้วเขียน mapping/dedup จากค่าที่มีอยู่จริงในข้อมูล (คาดว่าจะพบชื่อหน่วยงานสะกดต่างกันหลายแบบ
   — ต้อง Data Cleansing ก่อน Import)
5. **ไม่มีตาราง `Contracts` แยก** — ข้อมูลสัญญาฝังอยู่ใน `VendorRegister` (`ContractNo/ContractStart/ContractExpiry`)
   และ `ConfigurationItems.ContractRef` / `MaintenancePlans.ContractNo` — Contract Management ในสเปกใหม่ (ข้อ 5)
   ต้องออกแบบตาราง `contracts` ใหม่แล้วดึงข้อมูลจากหลายจุดมารวม ไม่ใช่การย้าย 1:1
6. **มี JSON blob columns จำนวนมาก** ที่เก็บโครงสร้างข้อมูลแบบ dynamic (เช่น `FormSchemaJSON`, `ChecklistJSON`,
   `WorkflowJSON`, `ContextJSON`, `ResultJSON`, `DetailJSON`, `ItemsJSON`, `ChecklistSnapshotJSON`,
   `RequestDetailsJSON`, `DesignJSON`, `EvidenceLinksJSON`, `AttachmentIDsJSON`, `TargetMappingJSON`) — เป็น
   candidate ที่เหมาะกับคอลัมน์ `jsonb` ใน PostgreSQL โดยตรง (ไม่ต้อง normalize ทั้งหมด) แต่ต้อง validate ด้วย Zod
   schema ฝั่ง Backend ก่อนเขียนทุกครั้งตามที่สเปกกำหนด
7. **Snapshot/Versioning pattern ที่มีอยู่แล้วควรคงไว้** — `WorkflowDefinitions.Version` +
   `WorkflowSteps.DefinitionVersion`, `ServiceCatalog.Version` + `ServiceRequests.CatalogVersion`,
   `ServiceRequests.ChecklistSnapshotJSON` เป็นรูปแบบ "immutable snapshot ณ เวลาที่ทำรายการ" ที่ออกแบบไว้ดีอยู่แล้ว
   — ระบบใหม่ควรคงหลักการเดียวกันไว้เมื่อออกแบบตาราง `workflow_definitions`/`workflow_instances`
8. **Idempotency key มีอยู่แล้วหลายจุด** (`Tickets.IdempotencyKey`, `ServiceRequests.IdempotencyKey`,
   `IntegrationOutbox.IdempotencyKey`, `PMWorkOrders.IdempotencyKey`, `WorkflowInstances.IdempotencyKey`) —
   เป็น pattern ที่ดีอยู่แล้ว ควรคงไว้ในการออกแบบ API ใหม่ (unique constraint ในตาราง PostgreSQL)
9. **คอลัมน์มาตรฐาน 4 คอลัมน์** (`Timestamp/CreatedBy/LastUpdatedBy/LastUpdatedAt`) มีเกือบทุก Sheet ยกเว้น
   `AuditTrail`, `NotificationLog`, `Settings`, `PolicyMapping` — ตรงกับ `created_at/updated_at/created_by/
   updated_by` ที่สเปกใหม่กำหนดไว้แล้ว (map ตรงตัวได้)
10. **Soft-delete แบบรวมศูนย์** (`IsDeleted/DeletedAt/DeletedBy` เติมท้ายทุก Sheet โดย `DeleteService.gs` เมื่อใช้งาน
    ครั้งแรก) — ต้องตรวจสอบเป็นรายตารางว่าตารางไหนมีคอลัมน์นี้จริงแล้วบ้างก่อน migrate (ไม่ใช่ทุก Sheet จะมีคอลัมน์นี้
    ตั้งแต่ต้น เพราะเป็น lazy-migration) สอดคล้องกับสเปกใหม่ข้อ "ใช้ Soft Delete เฉพาะข้อมูลที่จำเป็น"
11. **`Settings` เป็น key-value แบบเดียว** (`Key, Value, Description, Group, UpdatedAt, UpdatedBy`) — ครอบคลุมทั้ง
    ค่า config ทั่วไปและค่าที่ผูกกับ business logic (เช่น `SLA_*`, `WORKFLOW_PII_RETENTION_DAYS`,
    `ATTACHMENT_RETENTION_DAYS`) ระบบใหม่ควรแยกเป็น `system_settings` table หรือ environment variable ตามความ
    เหมาะสมของแต่ละค่า (ค่าที่กระทบ business logic ควรอยู่ในตารางที่ตรวจสอบ audit ได้ ไม่ใช่ env var ตายตัว)
12. **`RateLimits` เก็บใน Sheet** — เป็นการ workaround ข้อจำกัดของ Apps Script (`PropertiesService` ชน quota)
    ระบบใหม่ไม่ต้องมีตารางนี้เลย ใช้ Cloudflare Rate Limiting API หรือ Workers KV/Durable Objects แทนได้ดีกว่ามาก

## ตารางอ้างอิงคอลัมน์แบบเต็ม

ดูคอลัมน์ครบทุกทะเบียนที่ `docs/02_โครงสร้างฐานข้อมูล.md` (71 ทะเบียนแรก, คำอธิบายภาษาไทยครบ) ร่วมกับ
`Config.gs` บรรทัด 132–628 (`DB_SCHEMA`, ทุกทะเบียนรวม 93 รายการ, เป็น Ground Truth) — Phase 2 จะแปลงเป็น
`supabase/migrations/*.sql` และ `docs/database.md` ฉบับสมบูรณ์ของระบบใหม่ต่อไป
