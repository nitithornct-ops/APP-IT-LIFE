# Workflow, Attachment Registry, Integration และ Action Permission — v1.11

เอกสารนี้อธิบายสถาปัตยกรรม การติดตั้ง การใช้งาน การควบคุมความปลอดภัย การทดสอบ และการย้อนกลับของ P3 ใน App LIFE รุ่น 1.11

> **สถานะ ณ 21 กรกฎาคม 2569: Production deployed** — package `1.11.0`, Build `2026.07.21.1-workflow-integration` และ Schema `13` ถูก deploy เป็น Apps Script version `35` บน deployment เดิมแล้ว หลักฐาน backup, migration และ live smoke อยู่ที่ [18_PRODUCTION_ROLLOUT_v1.11.md](18_PRODUCTION_ROLLOUT_v1.11.md); authenticated transactional UAT แยกตาม role และ sandbox rollback drill ยังเป็น post-rollout acceptance ที่ต้องดำเนินการต่อ

## 1. Release identity

| รายการ | ค่า |
|---|---|
| Application | ISMS Governance System v1.11 (Workflow & Integration) |
| Package | `1.11.0` |
| Build ID | `2026.07.21.1-workflow-integration` |
| Schema | `13` |
| Migration | additive ผ่าน `setupSystem()`; ไม่ลบ/สลับ/เปลี่ยนชื่อคอลัมน์เดิม |
| Production status | **Deployed 2026-07-21 (Asia/Bangkok), deployment version 35** |

## 2. ภาพรวมสถาปัตยกรรม

```text
ผู้ใช้ / Session
      │
      ├─ Module RBAC ── Action Permission ── Row-level authorization
      │
Service Request ── Workflow Instance ── Workflow Approval / History
      │                      │
      │                      └─ Attachment Link ── Attachment Registry ── Private Drive
      │
      └─ Integration Outbox ── allowlisted adapter ── Access / Ticket / Asset / Change
                                         │
                                         └─ RecordLinks + reverse source marker
```

องค์ประกอบทั้งสี่อยู่ใน Apps Script project และ Spreadsheet เดิมแบบ Modular Monolith:

- `Module_Workflow.gs` + `Workflow.html` เป็น Workflow/Approval Engine กลาง
- `Module_AttachmentRegistry.gs` เป็นทะเบียนไฟล์ private และ download proxy
- `Module_Integration.gs` เป็น transactional outbox และตัวเชื่อมรายการข้ามโมดูล
- `Module_ActionPermission.gs` เป็นสิทธิ์ระดับ action, user override และ approval group
- `Module_ServiceCatalog.gs`, `Module_Ticket.gs` และ `Module_Task.gs` ใช้ Attachment Registry; Service Catalog ใช้ Workflow/Integration กลาง

## 3. Workflow / Approval Engine

### 3.1 Definition และ version

- Definition เก็บใน `WorkflowDefinitions`; ขั้นตอนเก็บใน `WorkflowSteps`
- ทุกการแก้ Definition สร้าง version ใหม่ และ `WorkflowSteps.DefinitionVersion` ผูกขั้นตอนกับ version ที่ commit แล้ว
- การเปลี่ยน generation ใช้ `WorkflowDefinitions.Version` เป็น commit marker: instance ใหม่เลือกเฉพาะชุดขั้นตอนที่ version ตรงกัน ขณะที่ instance เดิมใช้ snapshot ของตนเอง
- Definition รองรับช่วง `ActiveFrom`/`ActiveTo`, default ต่อโมดูล, เงื่อนไข JSON, SLA, reminder และ escalation
- รุ่นนี้รองรับ Definition mode แบบ `SEQUENTIAL`; แต่ผู้อนุมัติภายในแต่ละ step รองรับ `ANY`, `ALL` และ `QUORUM`
- ประเภทผู้อนุมัติที่รองรับ: `USER`, `SUPERVISOR`, `REQUESTER_SUPERVISOR`, `ROLE`, `DEPARTMENT_APPROVER`, `GROUP` และ `CONTEXT`

### 3.2 Transaction และหลักฐาน

- `WorkflowInstances` เก็บ definition version, requester, source module/record, context/result และ idempotency key
- `WorkflowApprovals` เก็บผู้อนุมัติเดิม/ปัจจุบัน, สถานะ, decision, comment, due/reminder/escalation, signature hash และ attachment IDs
- `WorkflowHistory` เป็น timeline แยก public/internal; `AuditTrail` บันทึกเหตุการณ์ควบคุมอีกชั้น
- snapshot ของ definition/steps/actor ทำให้การแก้ master ภายหลังไม่เปลี่ยนกติกาของ instance ที่เริ่มแล้ว
- การตัดสินใจตรวจ exact assignee, สถานะปัจจุบัน, action permission และ Separation of Duties ฝั่ง Server ภายใน lock

### 3.3 Delegation, reminder และ escalation

- มอบหมาย approval รายการเดียวได้เมื่อ step อนุญาต และป้องกัน self-delegation, requester collision, duplicate vote และ delegation cycle
- `WorkflowDelegations` กำหนดช่วงเวลามอบหมายแทนตาม module/definition และป้องกันช่วงทับซ้อนใน scope เดียวกัน
- reminder/escalation ใช้ due time ของ approval, ป้องกันการสร้างสิทธิ์โหวตซ้ำ และส่งข้อความแบบ private
- `scheduledWorkflowAutomation_` ทำงานทุกชั่วโมงหลัง `setupSystem()`; IT Admin สั่งรันด้วย `runWorkflowAutomationNow()` ได้

### 3.4 Service Catalog compatibility

- Catalog ที่ต้องอนุมัติอ้าง `WorkflowDefinitionID`; seed เริ่มต้นคือ `WF-DEF-SERVICE-APPROVAL`
- คำขอใหม่เก็บ `WorkflowInstanceID`; adapter เดิมของ Service Catalog เรียก engine กลางโดยยังรักษาสถานะ/Timeline เดิม
- `backfillWorkflowTransactions(limit)` เลือกเฉพาะคำขอสถานะ `รออนุมัติ` ที่ยังไม่มี Workflow instance และต้องสั่งโดย IT Admin หลังตรวจรายการ
- Service Catalog ยังไม่รองรับ Return/Resubmit ดังนั้น definition ที่ใช้กับโมดูลนี้ต้องปิด `AllowReturn`

## 4. Attachment Registry

### 4.1 หลักการจัดเก็บ

- อัปโหลดไป Drive folder ส่วนตัวของแอป ไม่มี public/domain-wide sharing และไม่ส่ง `FileID`, folder ID หรือ raw Drive URL กลับ client
- ใน authenticated Service/Ticket/Task flow ที่ migrate แล้ว Client อัปโหลดเป็น `STAGED` โดยยังไม่มี record ID; Server ตรวจ lifecycle/claimability, บันทึก Registry ID เป็น durable intent ใน source field ก่อน แล้วจึงซ่อม `AttachmentLink` แบบ idempotent ที่ระบุ module, entity sheet, entity ID, field และ attachment role ตรงทั้งหมด
- ตรวจ extension, claimed/detected MIME, magic bytes, ขนาด และ SHA-256 checksum; ขนาด upload สูงสุดใน source คือ 15 MB
- download ผ่าน `downloadRegisteredAttachment()` หลังตรวจ action permission และ row-level access พร้อมตรวจ checksum ซ้ำ
- download แบบ base64 จำกัดโดย `ATTACHMENT_DOWNLOAD_MAX_MB` ช่วง 1–15 MB (ค่าเริ่มต้น 10 MB)

### 4.2 Link, audit และ lifecycle

- `AttachmentLinks` เป็นความสัมพันธ์ canonical ระหว่างไฟล์กับ record; ไฟล์หนึ่งมีได้หลาย link และแต่ละ link มี access policy, retention และ legal hold
- คู่ `moduleKey`/`recordType` ต้องเป็น canonical เท่านั้น (`serviceCatalog`↔Service Request, `task`↔Personal Task, `ticket`↔Ticket, `access`↔Access Request, `change`↔Change Request, `incident`↔Incident และ `workflow`↔Workflow); คู่ที่ขัดกันถูกปฏิเสธก่อนตรวจสิทธิ์หรือคำนวณ classification/retention
- `AttachmentAccessLog` บันทึก upload, claim/link, download, denied, soft-delete และ restore
- idempotency replay ใช้ได้เฉพาะ Registry IDs ที่อยู่ใน durable source intent เดิม; staged ID ใหม่ที่มากับ duplicate request ถูกทิ้งจากผลลัพธ์ และ STAGED ID ที่มี durable intent แล้วห้าม deduplicate/claim ให้ record อื่น
- terminal-safe repair สร้างได้เฉพาะ exact link ที่ source field/record/role ใน allowlist อ้างไว้แล้ว; Personal Task commit index+link ใน critical section เดียว และงานที่จบแล้วซ่อมได้เฉพาะ ID ใน index เดิม ไม่รับไฟล์ใหม่
- การ claim เลื่อน `IsEvidence` ได้ทางเดียวจาก No→Yes และไม่ลด classification เดิม
- การลบเป็น soft-delete/Drive trash; ปฏิเสธเมื่อมี legal hold, มี active reference อื่น หรือ Drive file เดียวกันยังถูกอ้างโดย attachment ที่ active
- legal hold ตั้ง/ปล่อยได้ผ่าน API ควบคุมโดย ITAdmin/DPO พร้อมเหตุผลบังคับ; link และ registry aggregate ถูกเขียนพร้อม verified intent/result audit ภายใน lock และ rollback เป็นค่าเดิมเมื่อ commit ไม่ครบ
- restore ตรวจสิทธิ์และสภาพการ share อีกครั้ง; รายการที่ retention ลบหรือเคยมี link `EXPIRED` ต้องใช้ `attachment.admin` พร้อมเหตุผล และได้ช่วงกู้คืนแบบใช้งานได้; commit failure มี compensation/rollback ฝั่ง file, link และ registry
- Retention ไม่หมดอายุ link ขณะ source record ยัง active; หลัง terminal ใช้วันครบกำหนดที่ช้ากว่าระหว่าง `RetainUntil` กับ terminal timestamp + policy days แล้วจึง trash เฉพาะ attachment ที่ไม่มี active link/legal hold/physical reference อื่น การ expire/trash ใช้ verified intent/result audit ภายใน lock และ rollback เมื่อ commit ไม่ครบ
- เมื่อ attachment เคยมี `AttachmentLink` จริงแล้ว link ที่ `EXPIRED`/`CANCELLED` จะปิด legacy registry-only pseudo-link fallback ทุกจุด จึงไม่สามารถทำให้ไฟล์กลับมา list/authorize/download ได้
- ไฟล์ `STAGED` ที่ยังมี durable attachment intent ใน Service Request, Service Request Task, Ticket, Task หรือ Workflow Approval จะไม่ถูกเก็บกวาดก่อนการซ่อม link; intent scan/JSON ที่ผิดพลาดต้อง fail safe และไม่ตีความไฟล์เป็น orphan ส่วน orphan ที่ตรวจได้จริงใช้ค่า `ATTACHMENT_STAGED_RETENTION_HOURS` (ค่าเริ่มต้น 72 ชั่วโมง)

### 4.3 โมดูล/ฟิลด์ที่ใช้ Registry

- Service Request: `AttachmentIDsJSON`, `CompletionAttachmentIDsJSON`
- Service Request Task: `EvidenceAttachmentIDsJSON`
- Ticket: `AttachmentIDsJSON`; worklog หลังบ้านไม่เปิดเผย raw locator
- Personal Task: `TaskAttachments.RegistryAttachmentID`
- Workflow Approval: `AttachmentIDsJSON`
- Incident ที่ยกระดับจาก Ticket: สร้าง opaque exact provenance link บทบาท `INCIDENT_EVIDENCE` โดยไม่คัดลอก raw `EvidenceLink`; legacy Ticket ที่ยังไม่ migrate ดาวน์โหลดได้เฉพาะ ITAdmin หรือ DPO ของเคสข้อมูลส่วนบุคคลผ่าน audited server proxy และไม่คืน Drive locator

authenticated flow ที่ migrate ใน v1.11 คือ Service Request submit/status/checklist evidence, internal Ticket submit/work และ Personal Task attachment; Workflow ใช้ Registry ตั้งแต่เริ่มโมดูลใหม่

หลักฐานบังคับของ Service checklist/การปิดคำขอต้องมี Registry `Status=ACTIVE`, `IsEvidence=Yes`, exact active link และ Drive file ที่ยังอยู่/มี sharing แบบ owner-only private. ค่า legacy `EvidenceLink` grandfather ได้เฉพาะรายการเดิมที่ไม่มี Registry ID; ไม่รับ raw URL เป็นหลักฐานใหม่ใน authenticated flow ที่ migrate แล้ว

Authenticated Service/Ticket/Task DTO ส่งเพียง opaque Attachment ID และ metadata; legacy locator อยู่ Server และส่งออกเพียง boolean/unavailable notice. ผู้ใช้ Ticket role `User` เห็นเฉพาะ public worklog และไม่มี locator. Anonymous/Public/LINE Ticket create/track ยังคงเส้นทาง legacy เพื่อ compatibility และไม่ได้ถูก migrate ในรอบนี้

## 5. Integration Outbox และ RecordLinks

### 5.1 Adapter allowlist

Catalog ระบุได้เฉพาะชื่อ target ที่กำหนดใน source; ไม่มีการรันชื่อฟังก์ชันจาก JSON:

| Target | Operation | Target record | Link type |
|---|---|---|---|
| `access` | CREATE | `AccessRequests` | `FULFILLED_BY_ACCESS_REQUEST` |
| `ticket` | CREATE | `Tickets` | `FULFILLED_BY_TICKET` |
| `asset` | LINK | `AssetRegister` | `FULFILLED_WITH_ASSET` |
| `change` | CREATE | `ChangeRequests` | `FULFILLED_BY_CHANGE` |

### 5.2 Transactional behavior

- source transaction สร้าง `IntegrationOutbox` ด้วย deterministic idempotency key; retry ไม่สร้าง target ซ้ำ
- `PayloadJSON` เป็น immutable snapshot ของ mapping ณ เวลาจัดคิว
- `RecordLinks` เป็น canonical 1:N relation; `Related*ID` บน `ServiceRequests` เป็น primary-link compatibility field
- target ที่สร้างเก็บ reverse `SourceServiceRequestID`; processor ตรวจและซ่อม provenance ก่อนบันทึก side effect/commit ผล
- สถานะ outbox: `PENDING`, `PROCESSING`, `COMPLETED`, `ERROR`, `CANCELLED`
- งานสร้าง/link target ทั่วไป retry สูงสุด 5 ครั้ง ใช้ backoff 1, 5, 15, 60 และ 240 นาที; `PROCESSING` เกิน 15 นาทีถือว่า stale และนำมาประมวลผลใหม่ได้ ส่วนงานซ่อม provenance/link ของแถว `COMPLETED` คงสถานะหลักฐานเดิมและนัดซ่อมซ้ำด้วย backoff จนกว่าจะ reconcile สำเร็จ
- quota แบ่งงานใหม่กับงาน repair เพื่อไม่ให้ completed-repair ทำให้งานใหม่ starvation
- lifecycle reconciliation ใช้ persistent round-robin cursor (`INTEGRATION_LIFECYCLE_CURSOR`) เพื่อให้ active links ทุกชุดได้รับการตรวจตามรอบ
- การยกเลิก Service Request จะยกเลิกเฉพาะงาน outbox ที่ยังไม่เสร็จ; target ที่สร้างแล้วคงเป็นหลักฐานและใช้ lifecycle reconciliation แทนการลบ

### 5.3 Catalog routing ที่ setup เติมให้

`migrateServiceCatalogP3_()` เติมเฉพาะช่องว่างและเพิ่ม Catalog version โดยไม่ทับค่าที่ผู้ดูแลกำหนดเอง:

- Account/Access/VPN/Email/Shared Folder → Access Request ตามค่า `AutoCreateTarget`
- Software/Storage/IT Consult → Ticket
- IT Equipment/Equipment Borrow → Asset link (ค่าเริ่มต้นไม่ auto-create)
- Firewall Port → Change Request

รายการคำขอเก่าไม่ถูก backfill integration อัตโนมัติ

## 6. Action Permission และ Approval Group

Module RBAC ยังคงเป็นด่านแรก ส่วน v1.11 เพิ่มสิทธิ์ระดับ action เป็นด่านที่สอง:

- unknown permission key หรือ permission definition ที่ inactive ถูกปฏิเสธแบบ fail closed
- user override ที่ active มี precedence เหนือ role mapping; ถ้ามีผลขัดแย้ง `DENY` ชนะ
- เมื่อ permission key มี role mapping ในชีตแล้ว role ที่ไม่มี mapping active จะถูกปฏิเสธ; fallback ใน source ใช้เฉพาะช่วงก่อน seed/configure key นั้น
- mutation สำคัญ re-authorize ผู้ใช้ Active และ permission อีกครั้งภายใน `ScriptLock` เพื่อลด TOCTOU
- การแก้ role mapping, override, group และ member บันทึก durable audit intent/result และล้าง permission cache
- ป้องกันการระงับสมาชิกผู้ดูแลคนสุดท้าย/การทำให้ไม่มีผู้ดูแลที่ยังมีสิทธิ์ `workflow.admin`
- Approval Group รับเฉพาะผู้ใช้ Active, มี owner, priority, validity window และบทบาท `PRIMARY`, `MEMBER`, `BACKUP`

กลุ่ม permission หลัก:

- `workflow.*`: view own/assigned/all, start, approve, delegate, cancel own, manage, admin, run automation
- `attachment.*`: view, download, upload, delete own/any, manage, admin, legal hold และ legacy Incident proxy
- `integration.*`: view, enqueue, execute, retry, manage, admin

### 6.1 Public API surface

ทุกฟังก์ชันในตารางอยู่ใน API allowlist และคืน response contract กลาง; helper ที่ลงท้าย `_` เป็น internal เท่านั้น

| Service | Public functions |
|---|---|
| Workflow query/admin | `getWorkflowModuleData`, `getWorkflowInstanceDetail`, `saveWorkflowDefinition`, `setWorkflowDefinitionStatus` |
| Workflow action | `decideWorkflowApproval`, `delegateWorkflowApproval`, `createWorkflowDelegation`, `revokeWorkflowDelegation`, `cancelWorkflowInstance`, `runWorkflowAutomationNow`, `backfillWorkflowTransactions` |
| Attachment | `uploadRegisteredAttachment`, `listRecordAttachments`, `downloadRegisteredAttachment`, `softDeleteRegisteredAttachment`, `restoreRegisteredAttachment`, `setAttachmentLegalHold`, `releaseAttachmentLegalHold`, `downloadIncidentLegacyTicketEvidence` |
| Integration | `getServiceRequestIntegrations`, `processIntegrationOutboxNow`, `retryServiceRequestIntegration` |
| Permission/group admin | `getActionPermissionAdminData`, `saveRoleActionPermission`, `saveUserPermissionOverride`, `saveApprovalGroup`, `saveApprovalGroupMember`, `setApprovalGroupMemberStatus` |

## 7. Schema 13

### 7.1 ชีตใหม่ 16 ชีต

| กลุ่ม | ชีต |
|---|---|
| Workflow (6) | `WorkflowDefinitions`, `WorkflowSteps`, `WorkflowInstances`, `WorkflowApprovals`, `WorkflowHistory`, `WorkflowDelegations` |
| Attachment (3) | `AttachmentRegistry`, `AttachmentLinks`, `AttachmentAccessLog` |
| Integration (2) | `RecordLinks`, `IntegrationOutbox` |
| Action permission (3) | `ActionPermissions`, `RoleActionPermissions`, `UserPermissionOverrides` |
| Approval group (2) | `ApprovalGroups`, `ApprovalGroupMembers` |

ทุกชีตใหม่ถูก `protectSensitiveSheet_()` ระหว่าง `setupSystem()`

### 7.2 คอลัมน์ที่เพิ่มในชีตเดิม

- `ServiceCatalog`: `WorkflowDefinitionID`, `FulfillmentTarget`, `AutoCreateTarget`, `TargetMappingJSON`
- `ServiceRequests`: `WorkflowInstanceID`, `AttachmentIDsJSON`, `CompletionAttachmentIDsJSON`, `RelatedTicketID`, `RelatedAccessRequestID`, `RelatedAssetID`, `RelatedCIID`, `RelatedChangeID`, `IntegrationStatus`, `IntegrationError`, `IntegratedAt`
- `ServiceRequestTasks`: `EvidenceAttachmentIDsJSON`
- `Tickets`: `SourceServiceRequestID`, `AttachmentIDsJSON`, `IdempotencyKey`
- `AccessRequests` และ `ChangeRequests`: `SourceServiceRequestID`, `WorkflowInstanceID`
- `TaskAttachments`: `RegistryAttachmentID`

`setupSystem()` ใช้ `ensureSheetColumns_()` เพิ่มเฉพาะคอลัมน์ที่ขาดท้ายตาราง ไม่ลบหรือย้ายข้อมูลเดิม

## 8. ขั้นตอนอัปเกรดจาก v1.10

> ทำบนสำเนาหรือช่วง maintenance window ก่อน และห้ามข้าม backup gate

1. สร้าง source version backup ของ deployment ปัจจุบัน และ Drive snapshot/copy ของ Production Spreadsheet
2. บันทึก deployment ID, Apps Script version, Spreadsheet ID, จำนวนแถวสำคัญ และค่า Script Properties ที่ไม่ใช่ secret
3. Push source v1.11 ทั้งชุดพร้อมกัน; อย่าอัปโหลดเฉพาะบางไฟล์ เพราะ Server/Client build marker ต้องตรงกัน
4. รัน `setupSystem()` จาก Apps Script Editor ด้วยบัญชี owner/editor ที่ได้รับอนุญาต
5. ตรวจผล setup ว่าสร้างชีต/คอลัมน์ครบ, seed workflow/action permission/group สำเร็จ และติดตั้ง trigger `scheduledWorkflowAutomation_` ทุกชั่วโมงเพียงหนึ่งรายการ
6. เรียก `getAppBuildInfo()` และยืนยัน Build, Schema `13/13`, `schemaReady=true`, `missingSchema=[]`
7. ตรวจ Catalog ที่ถูกเติม P3 routing; ห้ามสมมติว่า routing ที่ผู้ดูแลตั้งเองถูกทับ
8. ทดสอบ Workflow และ Integration ด้วยข้อมูล non-production หรือรายการควบคุมหนึ่งรายการก่อนเปิดใช้กว้าง
9. หลังตรวจรายการค้าง จึงเลือกใช้ `backfillWorkflowTransactions(limit)` สำหรับคำขอ `รออนุมัติ` เดิม; integration เก่าไม่ backfill อัตโนมัติ
10. Deploy versioned Web App และทำ smoke/regression ตามหัวข้อ L ใน `docs/05_Test_Cases.md`

ค่าปฏิบัติการที่ควรทบทวนใน `Settings`:

- `WORKFLOW_PII_RETENTION_DAYS` (ค่าเริ่มต้น 730 วัน)
- `ATTACHMENT_STAGED_RETENTION_HOURS` (ค่าเริ่มต้น 72 ชั่วโมง)
- `ATTACHMENT_DOWNLOAD_MAX_MB` (ค่าเริ่มต้น 10, ช่วง 1–15)
- retention ของ Service Request/Ticket และโหมด `RETENTION_MODE`

## 9. Security controls

- ทุก public API อยู่ใน allowlist; helper ภายในลงท้าย `_` และไม่เปิดให้ client dispatch โดยตรง
- Backend ตรวจ module RBAC, action permission และ row ownership/assignment ทุกครั้ง; การซ่อนปุ่มไม่ใช่ security boundary
- actor/role จาก client ไม่ถูกเชื่อถือ; ระบบโหลดบัญชี Active จาก `Users` ใหม่ก่อน mutation สำคัญ
- mutation ที่เสี่ยงชนกันใช้ `ScriptLock`, reauthorization ภายใน lock, idempotency key และ verified audit intent/result
- Workflow บังคับ requester/approver SoD, exact assignee, immutable version snapshot และ duplicate-vote/delegation-cycle guard
- Attachment ใช้ private Drive, content validation, checksum, proxy download, access log, legal hold และ recoverable soft-delete
- Integration ใช้ named adapter allowlist, immutable payload, reverse source marker, deterministic idempotency และ retry ที่มีขอบเขต
- `bootstrapFirstAdmin()` เปลี่ยน credential แบบตรวจผลและ rollback ได้; `adminLogout()` invalidate session ก่อนเขียน audit เพื่อไม่ให้ audit failure ทำให้ session ยังใช้ได้
- ไม่บันทึก secret ในเอกสาร/ชีต; LINE/Gmail/pepper/session secret อยู่ใน Script Properties ตาม policy เดิม

ข้อจำกัดที่ต้องเข้าใจ: MIME/signature/checksum validation ไม่ใช่ antivirus sandbox; ไฟล์ที่องค์กรกำหนดว่าต้องสแกน malware ต้องผ่านบริการควบคุมเพิ่มเติมก่อนนำไปใช้

## 10. Operations และการเฝ้าระวัง

- ตรวจ `IntegrationOutbox` ที่ `ERROR`, attempt ใกล้ 5 ครั้ง, `PROCESSING` stale และ completed repair ที่มี `NextAttemptAt`
- ตรวจ `ServiceRequests.IntegrationStatus/IntegrationError` เทียบกับ `RecordLinks` และ target reverse marker
- ตรวจ Workflow approvals ที่ overdue, reminder/escalation, instance `ผิดพลาด` และงาน delegation ที่หมดอายุ
- ตรวจ `AttachmentAccessLog` สำหรับ denied/integrity failure, registry ที่ `STAGED` เกินเกณฑ์, `SharingScope` ที่ไม่ private และ legal hold count
- ตรวจ trigger ซ้ำ/หายหลัง setup และตรวจ `AuditTrail` ว่ามี intent/result สำหรับ mutation สำคัญ
- เริ่ม retention ด้วย `DRY_RUN`; เปลี่ยนเป็น `ENFORCE` หลัง owner/DPO ตรวจจำนวนและ legal hold แล้ว

## 11. Test and acceptance checklist

ขั้นต่ำก่อน Production:

1. Static validation ผ่านทั้ง syntax, duplicate functions, API allowlist, schema, renderer และ security regression guards
2. `setupSystem()` บนสำเนา v1.10 สองรอบแล้ว idempotent; headers เดิมและจำนวนแถวเดิมไม่ลด
3. ทดสอบ Workflow ANY/ALL/QUORUM, approve/reject, delegation, reminder/escalation, cancel และ version snapshot
4. ทดสอบ SoD, unknown permission, explicit DENY, expired override และ last-admin protection
5. ทดสอบ upload/claim/download/checksum, row-level denial, legal hold, multiple references, soft-delete/restore และ orphan retention
6. ทดสอบ Integration target ทั้ง 4 แบบที่ใช้งานจริง, duplicate replay, retry/backoff, stale recovery, cancellation และ lifecycle reconciliation
7. ทดสอบ requester/approver/IT Admin/Executive/DPO ว่าเห็นเฉพาะ Workflow/attachment/target ที่ได้รับสิทธิ์
8. ทดสอบ regression ของ Public Ticket, authenticated Ticket, Task, Service Catalog, Access, Change, Dashboard, Calendar และ Retention
9. Live Web App แสดง Build ที่ถูกต้อง, public/admin page โหลดได้ และไม่มี client exception/console error
10. บันทึกหลักฐาน version/deployment, backup IDs, schema readiness, test result และ rollback target ใน rollout document หลัง deploy

รายละเอียด test case อยู่ใน `docs/05_Test_Cases.md` หัวข้อ L

## 12. Rollback

### 12.1 Source rollback

1. หยุดการสั่ง manual automation/integration ชั่วคราว
2. ปิด/ลบ installable trigger `scheduledWorkflowAutomation_` จากหน้า Triggers ก่อน เพราะ trigger รัน **HEAD ของ project** ไม่ได้รัน source ตาม Web App version ที่ redeploy
3. คืน remote HEAD จาก source package ของ version 33 ที่สำรองแยกไว้ แล้ว `clasp push --force` จาก package นั้น; การ redeploy Web App อย่างเดียวไม่ถือว่า rollback HEAD
4. Redeploy Apps Script version 33 ไปยัง deployment ID เดิม
5. ตรวจว่าไม่มี trigger v1.11 คงอยู่ จากนั้นตรวจ public/admin smoke และ build marker ว่ากลับเป็นรุ่นเป้าหมาย

ตัวอย่างการเตรียม rollback package ก่อน push v1.11:

```powershell
npx.cmd clasp clone 1CRv7HkefACJwd_WVrNGJQbvMZ1uoVvObSK7NWQfjq-cIzxCiGPlH4m7w 33 --rootDir C:\Users\it2\Downloads\App_LIFE_ReleaseBackups\v1.10_version_33_pre_v1.11_20260721
```

เมื่อ rollback ให้เข้า directory ดังกล่าวและรัน `npx.cmd clasp push --force` ก่อน redeploy version 33 ห้ามใช้ `clasp pull --versionNumber 33` ทับ workspace ที่มีงาน v1.11 โดยตรง

ชีต/คอลัมน์ v1.11 เป็น additive จึงคงไว้ได้เมื่อ rollback source; **ห้ามลบชีตใหม่ทันที** เพราะอาจมีหลักฐาน workflow, attachment หรือ outbox ที่สร้างแล้ว

### 12.2 Data rollback

- หากยังไม่ได้เปิดรับ transaction v1.11 และ migration มีเพียงการเพิ่ม schema/seed ให้ rollback source แล้วเก็บชีตใหม่ไว้สำหรับตรวจสอบ
- หากมี transaction จริงหรือ migration ผิดพลาด ให้หยุด write, เก็บสำเนาฐานที่ผิดพลาดเป็นหลักฐาน แล้ว restore จาก pre-v1.11 Spreadsheet snapshot ตาม runbook Backup
- เปรียบเทียบจำนวนแถว/IDs ก่อนเปิดระบบ และบันทึกผู้อนุมัติการ restore
- Drive attachment ที่สร้างหลัง snapshot ต้อง reconcile แยกจาก Spreadsheet เพื่อไม่ให้เกิด orphan หรือสูญเสียไฟล์; ห้ามลบแบบถาวรระหว่าง triage

## 13. ข้อจำกัดและงานหลัง deploy

- Production backup, source version, deployment, migration และ unauthenticated public/admin live smoke เสร็จแล้วตาม [หลักฐาน rollout v1.11](18_PRODUCTION_ROLLOUT_v1.11.md)
- authenticated transactional UAT แยกตาม User/Approver/IT Admin/Executive/DPO และ sandbox rollback drill ยังไม่ได้บันทึกว่าเสร็จ ต้องดำเนินการตามหัวข้อ L โดยเก็บ account/role, record IDs, Audit Log ID และหลักฐานหน้าจอ
- Workflow definition รองรับ `SEQUENTIAL` เท่านั้น; parallelism อยู่ใน approver mode ของแต่ละ step
- Service Catalog ยังไม่รองรับ Return/Resubmit
- Integration รองรับ source `serviceCatalog` และ target allowlist 4 แบบเท่านั้น
- Action Permission/Approval Group มี seed และ allowlisted admin APIs แต่ยังไม่มีเมนู standalone แยกใน v1.11; การเปลี่ยน policy ต้องใช้ controlled admin procedure/API และห้ามแก้ protected sheets โดยตรง
- legacy attachment fields ยังต้องคงไว้เพื่อ compatibility; ต้องติดตามการ migrate เป็น Registry ID ตามโมดูล
- legacy raw locator คงอยู่เฉพาะ Server และไม่ถูกส่งกลับ authenticated UI; ต้องให้ผู้ดูแลทำ controlled migration แยกต่างหาก
- download proxy มีเพดาน 15 MB และไม่ดาวน์โหลด external URL reference

## 14. Release gate status

| Gate | สถานะ ณ 21 กรกฎาคม 2569 |
|---|---|
| Source implementation ใน workspace | Complete |
| Schema/Setup definition ใน source | Complete |
| Release documentation v1.11 | Complete |
| Final static validation/review | Complete — 47 GS, 33 HTML, 1126 server functions, 267 API allowlist entries |
| Pre-v1.11 source backup | Complete — remote version 34 + local v33 rollback clone |
| Production Spreadsheet snapshot | Complete — copy ID `1ada1m0Vra6sZh4QW7_wRBUx-es_ET06FiCKb1-__Jxk` |
| Apps Script push/version/deploy | Complete — deployment version 35 |
| Production `setupSystem()` / schema 13 | Complete — execution status Completed และตรวจ schema/seed/migration แล้ว |
| Public/Admin live smoke และ rollout evidence | Complete — ดู `docs/18_PRODUCTION_ROLLOUT_v1.11.md` |
| Authenticated per-role transactional UAT | Recommended post-rollout acceptance — ยังไม่บันทึกว่า Complete |
| Sandbox rollback drill | Recommended post-rollout acceptance — ยังไม่บันทึกว่า Complete |
