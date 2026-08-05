# Change Log

## 1.11.0 — 2026-07-21

- เพิ่ม Workflow/Approval Engine กลาง: definition/step versioning, immutable transaction snapshot, sequential definition พร้อม ANY/ALL/QUORUM ต่อ step, condition, SLA, reminder, escalation, delegation และ timeline
- เพิ่มหน้าจอ **Workflow / งานอนุมัติ** สำหรับงานของฉัน/คำขอ/รายการที่มองเห็น, decision, delegation, definition administration, automation และ controlled backfill ของ Service Request เดิม
- ทำ atomic workflow definition generation โดยใช้ `WorkflowDefinitions.Version` เป็น commit marker และ `WorkflowSteps.DefinitionVersion` ป้องกัน instance ใหม่เลือกชุดขั้นตอนปะปนระหว่างบันทึก
- บังคับ exact assignee, requester/approver Separation of Duties, active-user check, duplicate-vote/delegation-cycle guard และ reauthorization ภายใน `ScriptLock`
- เพิ่ม Attachment Registry กลาง: private Drive storage, STAGED→exact record claim, MIME/magic-byte/size/SHA-256 validation, server download proxy, access log, row-level authorization, legal hold, graph-aware retention และ recoverable soft-delete/restore
- migrate authenticated attachment flow ของ Service Request submit/status/checklist, internal Ticket submit/work และ Personal Task ไปใช้ STAGED→durable intent→exact link repair; duplicate replay ใช้เฉพาะ IDs ใน source intent เดิม
- คง legacy fields ไว้ฝั่ง Server, ส่ง authenticated DTO เป็น opaque Registry metadata เท่านั้น และไม่ยอมรับ raw URL เป็นหลักฐานใหม่ในเส้นทางที่ migrate; Anonymous/Public/LINE Ticket เดิมยังคง compatibility
- เพิ่ม Transactional Integration Outbox สำหรับ Service Request → Access/Ticket/Asset/Change ด้วย named adapter allowlist, immutable payload, deterministic idempotency, retry/backoff, stale recovery และ cancellation
- เพิ่ม `RecordLinks` เป็นความสัมพันธ์ canonical 1:N พร้อม primary-link compatibility, reverse `SourceServiceRequestID`, provenance repair และ lifecycle reconciliation แบบ persistent round-robin cursor
- เพิ่ม Action Permission ระดับ action และ Approval Group: unknown/inactive key fail closed, user override precedence, `DENY` wins, validity window, cache invalidation, durable audit intent/result และ last-admin protection
- เพิ่ม seed แบบ idempotent สำหรับ Workflow มาตรฐาน, action-permission role mapping และกลุ่ม IT Admin; เพิ่ม Catalog routing P3 เฉพาะช่องว่างโดยไม่ทับค่าที่ผู้ดูแลกำหนดเอง
- เพิ่ม trigger `scheduledWorkflowAutomation_` ทุกชั่วโมงเพื่อ reminder/escalation และประมวลผล Integration ตาม quota
- เพิ่ม 16 ชีตแบบ additive: `WorkflowDefinitions`, `WorkflowSteps`, `WorkflowInstances`, `WorkflowApprovals`, `WorkflowHistory`, `WorkflowDelegations`, `AttachmentRegistry`, `AttachmentLinks`, `AttachmentAccessLog`, `RecordLinks`, `IntegrationOutbox`, `ActionPermissions`, `RoleActionPermissions`, `UserPermissionOverrides`, `ApprovalGroups`, `ApprovalGroupMembers`
- เพิ่มคอลัมน์เชื่อม Workflow/Attachment/Integration ใน Service Catalog, Service Request, Ticket, Access Request, Change Request และ Task Attachment โดยไม่ลบ/สลับคอลัมน์เดิม
- เพิ่ม Policy Mapping `MAP-022`–`MAP-024`, RBAC/API allowlist, sensitive-sheet protection และ regression guards สำหรับ P3
- harden bootstrap/logout ของ Admin: credential mutation แบบตรวจผล/rollback และ invalidate session ก่อน logout audit
- อัปเดตเป็น Schema `13`, Build `2026.07.21.1-workflow-integration` และ package version `1.11.0`

### Release gate v1.11

- Production rollout สำเร็จเมื่อ 21 กรกฎาคม 2569 (Asia/Bangkok): deployment `AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA` เปลี่ยนจาก version `33` เป็น release version `35`; remote source backup คือ version `34`
- สร้าง pre-migration Spreadsheet copy `App-Life-It_PRE_v1.11_20260721_140001` แล้ว และเก็บ local v33 rollback clone พร้อม source SHA-256 สำหรับตรวจความตรงกัน
- `setupSystem()` บน Production สถานะ Completed; ตรวจ Schema `13`, ชีต P3 16 ชีต, seed/permission/group/policy mapping, Catalog migration และ operational triggers ครบตาม release gate
- `npm.cmd run validate` ผ่าน: 47 GS, 33 HTML, 1126 server functions และ 267 API allowlist entries
- Live smoke ผ่าน: public form และ Admin login โหลดได้โดยไม่พบ application error; server รายงาน Build `2026.07.21.1-workflow-integration`, Schema `13/13`, ready และไม่มี missing schema
- หลักฐานฉบับเต็มอยู่ที่ `docs/18_PRODUCTION_ROLLOUT_v1.11.md`; authenticated transactional UAT แยกตาม role และ sandbox rollback drill ยังเป็น post-rollout acceptance ที่แนะนำ และไม่ได้ถูกบันทึกว่าเสร็จแล้ว

## 1.10.0 — 2026-07-20

- เพิ่ม CMDB สำหรับ Configuration Item พร้อม Criticality, Environment, Data Classification, RPO/RTO, Backup reference, owner/administrator และการตรวจยืนยันข้อมูล
- เพิ่ม typed relationship map เชื่อม `CI`, `Asset`, `Vendor`, `Contract`, `Cloud`, `Backup`, `Incident` และ `Change` พร้อม validation ของปลายทาง, duplicate/self-link guard และป้องกัน dependency cycle
- เพิ่ม lifecycle guard: สถานะ CI เป็น Draft/Active/Maintenance/Degraded/Retired และห้าม Retire CI ที่ยังมีความสัมพันธ์ Active
- เพิ่ม Service Catalog แบบกำหนด dynamic form, eligibility, SLA, approval mode, fulfillment group, checklist, workflow และ close mode พร้อม versioning
- เพิ่ม Request Fulfilment ตั้งแต่ยื่นคำขอ → อนุมัติ → มอบหมาย → ดำเนินการ/พักรอ → ส่งมอบ → ผู้ขอยืนยันหรือ IT ปิดงาน พร้อม snapshot นิยามบริการต่อคำขอ
- บังคับ Separation of Duties สำหรับการอนุมัติ, ผู้รับผิดชอบต้องเป็น ITAdmin ที่ Active, Checklist บังคับ/หลักฐานต้องครบก่อนส่งมอบ และใช้ idempotency key ป้องกันคำขอซ้ำ
- เพิ่ม Service Request KPI, งานรออนุมัติ/เกิน SLA ในศูนย์แจ้งเตือน, รายการ DueAt ในปฏิทินรวม และตัวเลขในรายงานผู้บริหารรายเดือน โดยไม่ส่งข้อมูลฟอร์ม/PII ออกทาง LINE alert
- เพิ่ม row-level filter ให้ Reports สำหรับ Service Request, ส่ง LINE รายบุคคลโดยไม่ fallback ข้อมูลส่วนบุคคลไปกลุ่มกลาง และผูกการอัปโหลดหลักฐานกับสิทธิ์โมดูล/ชนิด MIME ที่อนุญาต
- เพิ่ม `SERVICE_REQUEST_PII_RETENTION_DAYS` เพื่อ anonymize คำขอ Checklist และ Timeline ที่พ้นอายุ พร้อมล้าง/ทิ้งลิงก์หลักฐานตามนโยบาย
- Hardening Service Request: ปิด Universal PDF row-level IDOR, Eligibility fail-closed, strict calendar date, trusted Drive attachment พร้อม orphan cleanup, idempotent child repair และ workflow snapshot ที่จำกัด transition ได้
- Hardening CMDB: ป้องกัน CI ID ว่าง, ปฏิเสธ Active relationship ไป endpoint ที่ Retired/Inactive และตรวจวันที่ความสัมพันธ์แบบ strict
- Retention ล้าง Task/History ก่อน parent เพื่อ retry ได้เมื่อเกิด partial failure และเพิ่มค่า retention ในหน้า Settings
- เพิ่มรายการบริการตั้งต้น 12 รายการแบบ idempotent ครอบคลุมบัญชี/สิทธิ์, Software, อุปกรณ์, Network, Storage, Email และคำปรึกษา IT
- เพิ่ม 6 ชีตผ่าน additive migration: `ConfigurationItems`, `CIRelationships`, `ServiceCatalog`, `ServiceRequests`, `ServiceRequestTasks`, `ServiceRequestHistory`; ทุกชีตถูกกำหนดเป็น Sensitive Sheet
- เพิ่ม RBAC และ API allowlist สำหรับ CMDB/Service Catalog; การอ่าน/เขียนทุกจุดตรวจสิทธิ์ฝั่ง Server และบันทึก Audit Trail
- อัปเดตเป็น Schema `12`, Build `2026.07.20.4-cmdb-service-catalog` และ package version `1.10.0`

### ผลตรวจรับในเครื่อง v1.10

- `npm.cmd run validate`: ผ่าน — 43 GS, 32 HTML, 742 server functions และ 239 API allowlist entries

## 1.9.0 — 2026-07-20

- เพิ่ม Problem Management และ Known Error Database เชื่อม Ticket/Incident/KB ด้วยรหัสอ้างอิง
- เพิ่ม Vulnerability lifecycle: CVE/CVSS, asset/system, remediation, due date, exception และ verification
- เพิ่ม Audit Management: engagement, scope/criteria, finding, root cause, action plan และ closure verification
- บังคับ independent verification: เจ้าของ remediation/action plan ห้ามตรวจยืนยันปิดรายการตนเอง
- เพิ่ม 5 ชีตผ่าน additive migration; ไม่มีการลบหรือเปลี่ยนชื่อคอลัมน์เดิม
- เพิ่ม RBAC, API allowlist, Audit Trail, HTTPS evidence validation และ regression guards
- รองรับ additive migration ผ่าน Google Sheets API โดยใช้ schema/header จริงเป็น readiness source
  เมื่อ `APP_SCHEMA_VERSION` ใน Script Properties ยังไม่ได้อัปเดตจาก Editor
- ทำ Production migration แบบ additive ครบ 8 ชีต (Privacy 3 + Assurance 5) หลังสร้าง
  pre-migration snapshot และตรวจ header/format ของทุกชีต
- สร้าง source backup version 30 และ release version 31; อัปเดต versioned deployments ทั้งสองรายการเป็น v31
- Live smoke test ผ่านทั้ง HTTP และ headless browser: Public Helpdesk โหลดฟอร์มครบ, Admin login แสดงผล,
  build marker ถูกต้อง และไม่พบ JavaScript exception/console error ของแอป
- เพิ่ม `scripts/live-browser-check.mjs` สำหรับทดสอบ Apps Script sandbox iframe ผ่าน Chrome DevTools Protocol

## 1.8.0 — 2026-07-20

- เพิ่มโมดูล Privacy / PDPA สำหรับ RoPA, Consent evidence และ Data Subject Request
- เพิ่มชีต `PrivacyROPA`, `PrivacyConsents`, `PrivacyDSR` ด้วย additive migration ผ่าน `setupSystem()`
- เพิ่ม RBAC: IT Admin และ DPO แก้ไขได้; Executive อ่านได้
- เพิ่ม Audit Log สำหรับสร้าง/แก้ RoPA, consent/withdrawal และ DSR lifecycle
- เพิ่ม SLA due date, identity verification, decision, evidence และสถานะปิด/ปฏิเสธของ DSR
- เพิ่มการป้องกัน Privacy sheets และ schema/build readiness checks
- ไม่มีการลบหรือเปลี่ยนชื่อคอลัมน์เดิม

## 1.7.1 — 2026-07-20

- ทำ response กลาง `ok()` / `fail()` ให้มี `success`, `message`, `data`,
  `errorCode` และ `timestamp` ตามสัญญา API เดียวกันทั้งระบบ
- คง `ok` / `error` เพื่อรองรับหน้าเดิมโดยไม่ต้องแก้ข้อมูลหรือ migration
- เพิ่ม success/failure handler ให้การ logout หลังบ้านและการนับยอดอ่าน Knowledge Base
- เพิ่ม static regression checks สำหรับ response contract และทุกจุดที่เรียก
  `google.script.run`
- ปรับ client response adapters ทั้งหน้าหลังบ้านและหน้า Help Desk สาธารณะให้รับ
  `success/message/errorCode` และยังรองรับ `ok/error` จาก deployment รุ่นเดิม
- ให้ `fail('SESSION_REQUIRED')` สร้าง `errorCode` ที่จำแนกได้อัตโนมัติ และเพิ่ม
  Gap Analysis ที่แยก capability สมบูรณ์/บางส่วน/ยังขาดจากหลักฐาน Source จริง
- อัปเดต package metadata เป็น 1.7.1 ไม่มีการเปลี่ยน schema หรือข้อมูล Production

### ผลตรวจรับในเครื่อง

- `npm run validate`: ผ่าน — 39 GS, 28 HTML, 627 server functions และ 207 API allowlist entries
- ไม่ได้ push/deploy ไป Apps Script และไม่ได้เขียน Google Sheets/Drive
- `npm install --package-lock-only --ignore-scripts` รายงาน dependency audit 4 รายการ
  (moderate 3, high 1); ยังไม่ใช้ `npm audit fix --force` เพราะอาจเกิด breaking change
