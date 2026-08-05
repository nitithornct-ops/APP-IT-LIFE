# ระบบบริหารจัดการความมั่นคงปลอดภัยสารสนเทศและไซเบอร์ (ISMS Governance System)
### กองทุนประกันชีวิต — Google Apps Script Web App

ระบบแปลงนโยบาย 2 ฉบับ (นโยบายความมั่นคงปลอดภัยทางสารสนเทศ 2569 + ประมวลแนวปฏิบัติด้านไซเบอร์ 2569)
ให้เป็นระบบงานจริงที่เก็บหลักฐานสำหรับ IT Audit โดยอัตโนมัติ

## หน้าตาระบบ (UI/UX)
ดีไซน์ทันสมัย: **sidebar สีน้ำเงินเข้มพร้อมไอคอนและหัวข้อกลุ่มโมดูล** (ย่อ/ขยายได้ จดจำสถานะ, off-canvas บนมือถือ) อยู่ทุกหน้า · topbar แบบ glass + ชื่อหน้า/อวาตาร์ผู้ใช้ · dashboard ย่อยประจำทุกโมดูล · การ์ดมุมโค้งเงานุ่มพร้อมเอฟเฟกต์ hover ยกตัว · KPI ไล่เฉดสี + ไอคอน · แอนิเมชันเข้าหน้า/การ์ดไล่ลำดับ · progress bar, toast, loading ring · Bootstrap 5 + Bootstrap Icons + ฟอนต์ Sarabun · Responsive เต็มรูปแบบ

### ฟีเจอร์ UX/UI ทันสมัยสำหรับหน่วยงานภาครัฐ
- **โหมดมืด/สว่าง (Dark mode)** — สลับได้บน topbar จดจำค่า และใช้ค่าตามระบบปฏิบัติการอัตโนมัติครั้งแรก
- **มาตรฐานการเข้าถึง (Accessibility/WCAG)** — ปุ่มปรับขนาดตัวอักษร (ก-/ก/ก+), โหมดความคมชัดสูง (High Contrast), ลิงก์ "ข้ามไปยังเนื้อหาหลัก", โฟกัสคีย์บอร์ดที่มองเห็นชัด, เคารพค่า "ลดการเคลื่อนไหว" ของผู้ใช้, ป้าย ARIA
- **ค้นหาด่วน / Command Palette (Ctrl+K)** — พิมพ์เพื่อกระโดดไปยังโมดูลตามสิทธิ์ ใช้ลูกศร/Enter เลือกได้
- **ศูนย์การแจ้งเตือน (กระดิ่งบน topbar)** — รวมงานเร่งด่วน/ใกล้ครบกำหนด (Ticket เกิน SLA, Incident, เหตุข้อมูลส่วนบุคคลรอ DPO, คำขอสิทธิ์, รายการใกล้ครบ) พร้อม badge ตัวเลข อัปเดตทุก 5 นาที คลิกเพื่อไปยังโมดูลที่เกี่ยวข้อง
- **Task / งานของฉัน** — จดงานส่วนตัว, จัดความสำคัญ, กำหนดวันเริ่ม/วันครบกำหนด, ติดตามความคืบหน้า, ค้นหา/กรอง และแจ้งเตือนงานใกล้ครบในกระดิ่ง โดย Server แยกข้อมูลตามเจ้าของบัญชี
- **กราฟแดชบอร์ด (Chart.js)** — โดนัทสุขภาพมาตรการควบคุม + แท่งรายการใกล้ครบจำแนกตามประเภท (สีปรับตามธีมมืด/สว่าง)
- **Skeleton loader + Empty state** — โหลดดูลื่นขึ้น และหน้าจอว่างสื่อความหมาย (helper `skeletonCards()` / `emptyState()` ใช้ซ้ำได้ทุกโมดูล)
- **แดชบอร์ดตามบทบาท (Role-based dashboard)** — ผู้บริหาร/DPO/IT Admin เห็นแบนเนอร์และลำดับการเน้น KPI ต่างกัน (ผู้บริหาร-DPO เน้นธรรมาภิบาล/ความเสี่ยง/PDPA, IT เน้นงานปฏิบัติการ) + ป้ายสรุปงานเร่งด่วน
- **รายงานผู้บริหารแบบพิมพ์/บันทึก PDF** — ปุ่มบนแดชบอร์ดเปิด print แบบ A4 พร้อมหัวรายงานราชการ (ชื่อหน่วยงาน/วันที่/ผู้พิมพ์) ซ่อน sidebar/topbar อัตโนมัติ เหมาะแนบแฟ้ม IT Audit
- **Document Designer แบบ Word-like** — ออกแบบ A4 แบบลากวาง ปรับขนาดกล่องข้อความ ฟอนต์/ตัวหนา/เอียง/ขีดเส้นใต้/การจัดแนว เพิ่มตาราง รูปภาพ กรอบ Data Field จากทุกโมดูล Undo/Redo หลายหน้า บันทึก Template และออก PDF
- **คลังเอกสารธรรมาภิบาล** — จัดเก็บ PDF/DOC/DOCX ใน Drive พร้อมประเภทเอกสาร เวอร์ชัน โมดูลอ้างอิง วันทบทวน สิทธิ์ และ AuditTrail

## สถาปัตยกรรม
- **หน้าบ้าน:** Apps Script HtmlService + Bootstrap 5 + ฟอนต์ Sarabun (ธีมน้ำเงิน-ขาว, responsive)
- **ฐานข้อมูล:** Google Sheets (1 ไฟล์, 1 Sheet/ทะเบียน)
- **บริการเสริม:** LINE Messaging API (แจ้งเตือนงานระบบ), Gmail (OTP เท่านั้น), Drive (หลักฐาน/Snapshot), Calendar/Trigger (งานตามกำหนด)
- **สถาปัตยกรรมแบบหลายโมดูล · 5 บทบาท (User/Approver/IT Admin/Executive/DPO)**

## เริ่มต้นใช้งาน
ดู [docs/04_คู่มือ_Deploy.md](docs/04_คู่มือ_Deploy.md) — สรุปสั้น:
1. สร้างโปรเจกต์ที่ script.google.com คัดลอกไฟล์ `.gs`/`.html` + `appsscript.json`
2. รันฟังก์ชัน **`setupSystem`** หนึ่งครั้ง (สร้าง DB + ตั้งท่านเป็น IT Admin + ตั้ง Trigger)
3. ตั้งรหัสผ่านผู้ดูแลครั้งแรกด้วย **`bootstrapFirstAdmin("ข้อความรหัสผ่าน≥12ตัว")`** หรือกำหนด `ADMIN_INIT_PASSWORD` แล้วรัน `setupAdminLogin`
4. ตั้ง Script Properties เฉพาะ LINE token/target/secret; ค่าอื่นเช่น `ORG_NAME`, SLA, retention อยู่ใน Settings
5. Deploy เป็น Web App — **Who has access = Anyone (even anonymous)** เพื่อให้หน้าแจ้งซ่อมสาธารณะใช้ได้โดยไม่ต้องล็อกอิน
   - **URL หลัก** = หน้าแจ้งซ่อม/ติดตามสถานะ สำหรับผู้ใช้ทั่วไป (ไม่ต้องล็อกอิน)
   - **`?page=admin`** = หลังบ้านเจ้าหน้าที่ (ล็อกอินด้วยอีเมล + รหัสผ่านในทะเบียน `Users`)
   - หน้าหลังบ้านเพิ่มผู้ใช้และตั้งรหัสผ่านให้เจ้าหน้าที่คนอื่นได้ที่โมดูล **Users**

### หลังอัปเดตเป็น v1.3
1. รัน `setupSystem()` อีกครั้งเพื่อเพิ่มคอลัมน์ใหม่แบบไม่ลบข้อมูลเดิม และย้ายรหัสติดตาม Ticket เดิมจาก plaintext เป็น HMAC hash
2. หลังกรอกรหัสผ่านหลังบ้าน ระบบจะส่ง OTP ทางอีเมลก่อนออก Session (`ADMIN_MFA_ENABLED=true` เป็นค่าเริ่มต้น)
3. หน้าติดตาม Ticket ต้องยืนยัน OTP ทางอีเมลก่อนดูรายการ และจะไม่ส่ง `PublicToken` ของ Ticket กลับจากการค้นด้วยอีเมล
4. โมดูล Backup มีปุ่ม **สร้าง System Snapshot**, **ตรวจ checksum** และ **ทดสอบ Restore** ไปยัง Sandbox แยกจาก Production
5. Workflow สำคัญบังคับ Separation of Duties แล้ว: ผู้ขอห้ามอนุมัติเอง และผู้อนุมัติห้ามเป็นผู้ดำเนินการรายการเดียวกัน จึงควรมีบัญชี Approver และ IT Admin ที่ Active ตามหน้าที่จริง

### หลังอัปเดตเป็น v1.6
1. อัปโหลดไฟล์ `Module_Task.gs` และ `Task.html` พร้อมไฟล์แกนกลางที่เปลี่ยนแปลง
2. รัน `setupSystem()` อีกครั้งเพื่อสร้าง Sheet `PersonalTasks` แบบไม่ลบข้อมูลเดิม
3. Deploy เวอร์ชันใหม่ แล้วตรวจว่าเมนู **Task / งานของฉัน** แสดงในกลุ่มงานหลักสำหรับทุกบทบาท

### หลังอัปเดตเป็น v1.7
1. อัปโหลด `Module_OperationsHardening.gs` พร้อมไฟล์แกนกลางที่เปลี่ยนแปลง แล้วรัน `setupSystem()` อีกครั้ง
2. ระบบจะสร้าง `NotificationQueue`, `RetentionLog`, `EmployeeLifecycle` และเพิ่ม Response/Resolution SLA ให้ Ticket
3. Trigger ใหม่: LINE retry ทุก 15 นาที, Live health รายวันเวลา 06:00, Snapshot รายวัน, Retention รายวัน และ Restore drill รายเดือน
4. แจ้งเตือนงานระบบผ่าน LINE เท่านั้น; Email ยังคงใช้เฉพาะ OTP สำหรับ Admin MFA
5. Retention เริ่มต้นที่ `DRY_RUN` ให้ตรวจ Preview ในโมดูล Backup ก่อนเปลี่ยนเป็น `ENFORCE`
6. หลังอัปเดตล่าสุด ระบบมี **Go-live / Release Checklist** ในโมดูล **Tester / QA** และบังคับ Privacy consent บนหน้าแจ้งซ่อมสาธารณะ/LINE
7. รายละเอียดตั้งค่าและขั้นตอนตรวจรับอยู่ที่ [docs/10_OPERATIONAL_HARDENING_v1.7.md](docs/10_OPERATIONAL_HARDENING_v1.7.md)
8. อัปเดตธรรมาภิบาลกฎหมาย: รัน `setupSystem()` เพื่อสร้างทะเบียนกฎหมาย/ข้อกำหนด/Assessment/CAPA/Regulatory Notification จากนั้น Deploy ใหม่และตรวจ Build `2026.07.09.1`, Schema `6/6`
9. คู่มือใช้งานอยู่ที่ [docs/11_LEGAL_COMPLIANCE_GOVERNANCE.md](docs/11_LEGAL_COMPLIANCE_GOVERNANCE.md)

### หลังอัปเดตเป็น v1.8

1. Push ไฟล์ทั้งหมดพร้อมกันและรัน `setupSystem()` เพื่อเพิ่ม `PrivacyROPA`, `PrivacyConsents` และ `PrivacyDSR` แบบไม่ลบข้อมูลเดิม
2. ตรวจว่า Script Property `APP_SCHEMA_VERSION` เป็น `10` และ Build เป็น `2026.07.20.2-privacy-pdpa`
3. Deploy เวอร์ชันใหม่ แล้วเปิดเมนู **Privacy / PDPA** ด้วย IT Admin หรือ DPO
4. ทดสอบ RoPA, Consent และ DSR ตามหัวข้อ H ใน `docs/05_Test_Cases.md`; Executive ต้องอ่านได้แต่แก้ไขไม่ได้

### หลังอัปเดตเป็น v1.9

1. สำรองฐานข้อมูล แล้ว Push source ทั้งชุดและรัน `setupSystem()` เพื่อเพิ่ม Problems, KnownErrors, VulnerabilityFindings, AuditEngagements และ AuditFindings
2. ตรวจ Schema version `11` และ Build `2026.07.20.3-assurance-ops`
3. Deploy เวอร์ชันใหม่และทดสอบเมนู Problem, Vulnerability และ Audit ด้วย role ที่กำหนด
4. ใช้บัญชีคนละคนระหว่าง Owner กับ Verifier เพื่อทดสอบ Separation of Duties ตอนปิดช่องโหว่/ข้อตรวจพบ

### หลังอัปเดตเป็น v1.10

1. สำรองฐานข้อมูล แล้ว Push source ทั้งชุดและรัน `setupSystem()` เพื่อเพิ่ม `ConfigurationItems`, `CIRelationships`, `ServiceCatalog`, `ServiceRequests`, `ServiceRequestTasks` และ `ServiceRequestHistory` แบบ additive โดยไม่ลบหรือสลับคอลัมน์เดิม
2. ตรวจว่า `APP_SCHEMA_VERSION` เป็น `12`, Build เป็น `2026.07.20.4-cmdb-service-catalog` และ `getAppBuildInfo()` ไม่รายงานชีต/คอลัมน์ที่ขาด
3. Deploy เวอร์ชันใหม่ แล้วทดสอบเมนู **CMDB / Relationship Map** ด้วย IT Admin และบัญชีอ่านอย่างเดียว (Approver/Executive/DPO)
4. ตรวจรายการบริการตั้งต้น 12 รายการใน **Service Catalog / คำขอบริการ** แล้วทดสอบเส้นทาง ไม่ต้องอนุมัติ/หัวหน้างาน/ผู้อนุมัติที่กำหนด, SLA, Checklist และการปิดงานทั้งสองรูปแบบ
5. ใช้บัญชีแยกผู้ขอ ผู้อนุมัติ และ IT Admin เพื่อยืนยัน Separation of Duties; test cases และขั้นตอนตรวจรับอยู่ใน [docs/15_CMDB_SERVICE_CATALOG_v1.10.md](docs/15_CMDB_SERVICE_CATALOG_v1.10.md)

### หลังอัปเดตเป็น v1.11 — Production rollout แล้วเมื่อ 21 กรกฎาคม 2569

1. Production deployment เดิมถูกอัปเดตจาก Apps Script version `33` เป็น release version `35`; source ก่อนอัปเกรดสำรองเป็น remote version `34` และ local rollback clone แยกจาก workspace
2. สำเนา Production Spreadsheet ถูกสร้างก่อน migration แล้ว จากนั้น `setupSystem()` ทำ additive migration ครบ 16 ชีตโดยไม่พบการเปลี่ยน existing fields ที่ไม่คาดหมาย
3. Live Web App ยืนยัน Schema `13/13`, Build `2026.07.21.1-workflow-integration`, `schemaReady=true` และ `missingSchema=[]`; public form และหน้า Admin login โหลดได้โดยไม่พบ application error
4. Workflow seed, Action Permission/Role mapping, กลุ่ม IT Admin, Catalog routing และ operational triggers ถูกตรวจจาก Production แล้ว
5. รายละเอียด deployment, backup, migration, live verification และ rollback target อยู่ที่ [docs/18_PRODUCTION_ROLLOUT_v1.11.md](docs/18_PRODUCTION_ROLLOUT_v1.11.md)
6. ยังต้องทำ authenticated transactional UAT แยกตาม User/Approver/IT Admin/Executive/DPO และ sandbox rollback drill ตามหัวข้อ L ใน [docs/05_Test_Cases.md](docs/05_Test_Cases.md); rollout นี้ไม่ได้ถือว่าทดสอบชุด L ครบทุกกรณี
7. คำขอเดิมไม่ถูก backfill อัตโนมัติ; ใช้ `backfillWorkflowTransactions(limit)` เฉพาะคำขอ `รออนุมัติ` ที่ตรวจรายการแล้ว และอย่าสั่ง backfill integration เดิมโดยไม่มีแผนควบคุม

### LINE Login สำหรับหน้าแจ้งซ่อม
1. Source รองรับ LINE Login (OAuth/OpenID Connect + PKCE), session hash, การผูก EmployeeCode และ Ticket รายบุคคลแล้ว
2. รัน `setupSystem()` เพื่อเพิ่ม `LineUsers`, `LineSessions` และคอลัมน์ LINE ใน `Users/Tickets/Ticket_Worklogs`
3. ตั้ง Script Properties เฉพาะค่า LINE และ Callback URL ตาม [docs/06_SETUP_LINE_OA_TICKET.md](docs/06_SETUP_LINE_OA_TICKET.md)
4. Deploy Web App เป็นเวอร์ชันใหม่ แล้วรัน `diagnoseLineLoginSetup()` จาก Apps Script Editor
5. Email OTP สำหรับผู้แจ้งถูกปิดในโหมด LINE-only; หากไม่ Login ให้ใช้เลข Ticket + รหัสติดตาม

## เอกสารส่งมอบ

- [CHANGELOG.md](CHANGELOG.md) — ประวัติการเปลี่ยนแปลงและผลตรวจรับล่าสุด
- [docs/13_GAP_ANALYSIS_v1.7.1.md](docs/13_GAP_ANALYSIS_v1.7.1.md) — Gap Analysis จาก Source/Schema จริงและลำดับพัฒนาต่อ
- [docs/15_CMDB_SERVICE_CATALOG_v1.10.md](docs/15_CMDB_SERVICE_CATALOG_v1.10.md) — คู่มือติดตั้ง ใช้งาน และตรวจรับ CMDB/Service Catalog v1.10
- [docs/16_PRODUCTION_ROLLOUT_v1.10.md](docs/16_PRODUCTION_ROLLOUT_v1.10.md) — หลักฐาน Production rollout, rollback plan, ข้อจำกัดการตรวจรับ และแผนเฟสถัดไป
- [docs/17_WORKFLOW_INTEGRATION_v1.11.md](docs/17_WORKFLOW_INTEGRATION_v1.11.md) — สถาปัตยกรรมและคู่มือ P3: Workflow, Attachment Registry, Integration Outbox, Action Permission, migration/test/rollback
- [docs/18_PRODUCTION_ROLLOUT_v1.11.md](docs/18_PRODUCTION_ROLLOUT_v1.11.md) — หลักฐาน Production rollout v1.11, backup, migration verification, live smoke, rollback target และ acceptance ที่ยังเหลือ

| ไฟล์ | เนื้อหา |
|---|---|
| [docs/01_โครงสร้างไฟล์.md](docs/01_โครงสร้างไฟล์.md) | แผนผังไฟล์ทั้งโปรเจกต์ + สถานะแต่ละรอบ |
| [docs/02_โครงสร้างฐานข้อมูล.md](docs/02_โครงสร้างฐานข้อมูล.md) | Schema ครบทุก Sheet |
| [docs/03_Mapping_Feature_Policy.md](docs/03_Mapping_Feature_Policy.md) | Feature ↔ ข้อกำหนดนโยบาย + เมทริกซ์สิทธิ์ |
| [docs/04_คู่มือ_Deploy.md](docs/04_คู่มือ_Deploy.md) | ขั้นตอน Deploy + OAuth scopes |
| [docs/05_Test_Cases.md](docs/05_Test_Cases.md) | Test cases รวม Auth/Workflow/CMDB/Service Catalog และ regression |
| [docs/06_SETUP_LINE_OA_TICKET.md](docs/06_SETUP_LINE_OA_TICKET.md) | ขั้นตอนเตรียม LINE Login, LINE OA, Rich Menu และการแจ้งสถานะ Ticket รายบุคคล |
| [docs/10_OPERATIONAL_HARDENING_v1.7.md](docs/10_OPERATIONAL_HARDENING_v1.7.md) | ติดตั้ง LINE queue, Backup/Restore, Retention, JML, SLA และ Live health |
| [docs/11_LEGAL_COMPLIANCE_GOVERNANCE.md](docs/11_LEGAL_COMPLIANCE_GOVERNANCE.md) | ติดตั้งทะเบียนกฎหมาย Assessment/CAPA และการแจ้งหน่วยงานกำกับ |

## ความปลอดภัยที่ออกแบบไว้
- อนุญาตเฉพาะอีเมลในทะเบียน `Users` (Active) + ตรวจบทบาทฝั่ง **Server** ทุกฟังก์ชัน (`requireModule`)
- API หลังบ้านเรียกผ่าน allowlist เท่านั้น และ helper สำคัญถูกทำเป็น private `_` เพื่อลดการเรียกตรงจาก client
- รหัสผ่านหลังบ้านมี login throttle + hash แบบมี salt/iteration; legacy hash เดิมยังเข้าได้และจะถูกอัปเกรดหลังล็อกอินสำเร็จ
- หน้าแจ้งซ่อมสาธารณะมี honeypot, rate limit ต่ออุปกรณ์/รวมทั้งระบบ, จำกัดไฟล์แนบ/ขนาดไฟล์, จำกัดโดเมน และรหัสกลางแบบ optional
- หน้าแจ้งซ่อมสาธารณะแสดง Privacy Notice และบังคับ consent ก่อนสร้าง Ticket; ระบบบันทึกเวอร์ชัน consent ใน Ticket/Worklog
- ความลับเก็บใน `PropertiesService` (ไม่ hardcode และไม่ส่ง token ไป client)
- `LockService` ครอบทุกการเขียน Sheet · escape XSS · input validation
- Sheet `AuditTrail` ถูก protect · ทุกการกระทำสำคัญถูกบันทึก
- CMDB ตรวจ reference ของ node, ป้องกันความสัมพันธ์ซ้ำ/self-link/dependency cycle และห้าม Retire CI ที่ยังมีความสัมพันธ์ Active
- Service Request snapshot version/workflow/checklist ต่อคำขอ, ใช้ idempotency key พร้อมซ่อม child ที่เขียนไม่ครบ, บังคับ Checklist/หลักฐานก่อนส่งมอบหรือปิด และใช้ Attachment Registry ID ที่ผูก exact record/field/role สำหรับหลักฐานใหม่
- Workflow กลางใช้ definition/step version snapshot, exact assignee, SoD, delegation-cycle/duplicate-vote guard, reminder/escalation และ reauthorization ภายใน `ScriptLock`
- Action Permission ปฏิเสธ unknown/inactive key, ใช้ user override ก่อน role mapping โดย `DENY` ชนะ และป้องกันการทำให้ระบบไม่มีผู้ดูแลคนสุดท้าย
- Attachment Registry เก็บ Drive แบบ private, ไม่ส่ง raw Drive ID/URL ไป client, ตรวจ MIME/magic bytes/SHA-256, ใช้ exact durable intent/link และ canonical module context, download ผ่าน Server, บันทึก verified audit, ควบคุม legal hold โดย ITAdmin/DPO และใช้ retention ตาม lifecycle พร้อม admin-only restore
- Integration ใช้ named-adapter allowlist, immutable payload, deterministic idempotency, retry/backoff, reverse source marker และ `RecordLinks` เป็นความสัมพันธ์ canonical

## ความคืบหน้าการพัฒนา
- ✅ **รอบ 1:** โครงสร้าง + Auth/Role + Schema ครบทุก Sheet + Dashboard + Notification engine ฐาน
- ✅ **รอบ 2:** Access/RBAC (workflow คำขอ→อนุมัติ→ไอที→ทบทวน→ระงับผู้พ้นสภาพ) + Incident Response (แจ้งเหตุ→DPO คัดกรอง→ประเมินหน้าที่แจ้งภายนอก→เก็บหลักฐาน→ปิดเคส) + อัปโหลดหลักฐาน Drive
- ✅ **รอบ 3:** Backup (บันทึกสำรอง/ทดสอบกู้คืน) + BCP/DR (ทะเบียน/ทบทวน/บันทึกการใช้จริง) + Logging & Monitoring (ทะเบียน Log/บันทึกตรวจสอบ/Anomaly) + ขยาย Notification ครบทุกตัวจับเวลา
- ✅ **รอบ 4:** Asset Register + Data Classification (+ workflow ทำลายข้อมูล, ลับมาก→Executive) + Change Management + Vendor + AI/Cloud Register + Awareness (อบรม + e-sign รับทราบนโยบาย) + ขยาย Notification (Cloud/ทำลายข้อมูล/แผนอบรม)
- ✅ **รอบ 5:** Audit Evidence Center (สุขภาพมาตรการควบคุม + Export PDF/CSV + นับหลักฐาน) + Audit Trail UI (ค้น/กรอง) + หน้าตั้งค่า Notification
- ✅ **รอบ 6:** Help Desk / Ticket + SLA + การคัดแยกโดยหัวหน้า/IT + ยกระดับ Ticket เป็น Incident พร้อม Audit Trail
- ✅ **รอบ 7:** Task / งานของฉัน — งานส่วนตัวแยกตามเจ้าของ, สถานะ/ความสำคัญ/ความคืบหน้า/กำหนดส่ง, KPI, ค้นหา/กรอง และแจ้งเตือนงานใกล้ครบ
- ✅ **UI Update:** Sidebar จัดกลุ่มเป็น ภาพรวม / งานปฏิบัติการ IT Support / ธรรมาภิบาล กฎหมาย และ ISMS / ตรวจสอบและตั้งค่า + ทุกหน้าโมดูลมี Dashboard ย่อย
- ✅ **UX/UI ภาครัฐทันสมัย:** Dark mode + Accessibility (ปรับขนาดอักษร/High Contrast/Skip link/Focus/Reduced-motion/ARIA) + Command Palette (Ctrl+K) + ศูนย์การแจ้งเตือนบน topbar (`getMyNotifications`) + กราฟแดชบอร์ด Chart.js + Skeleton/Empty-state helper + แดชบอร์ดตามบทบาท + รายงานผู้บริหารพิมพ์/บันทึก PDF (A4)
- ✅ **Incident Risk Matrix:** ประเมินความเสี่ยง โอกาสเกิด × ผลกระทบ (1-5) → เมทริกซ์ 5×5 heatmap แสดงจำนวนเหตุการณ์ที่เปิดอยู่ต่อช่อง + ป้ายระดับความเสี่ยงในตาราง (migration อัตโนมัติ ไม่กระทบข้อมูลเดิม)
- ✅ **แบบทดสอบหลังอบรม (Quiz):** IT สร้างชุดคำถาม (เกณฑ์ผ่านปรับได้) · ผู้เข้าอบรมทำออนไลน์ ตรวจฝั่ง server (ไม่ส่งเฉลยไป client) บันทึกคะแนน/ผ่าน-ไม่ผ่านลงทะเบียนอบรมเป็นหลักฐาน audit อัตโนมัติ
- ✅ **ส่งออก CSV ทุกตาราง:** ปุ่ม “ส่งออก” บนทุกตารางข้อมูล (ตัวช่วย dataTable ร่วม) — ส่งออกเฉพาะแถวที่กรอง/เรียง + คอลัมน์ที่เลือก, มี BOM ภาษาไทย เปิดด้วย Excel ได้ทันที
- ✅ **รายงานผู้บริหารรายเดือนอัตโนมัติ:** Trigger วันที่ 1 เวลา 08:00 ส่งสรุปสุขภาพมาตรการควบคุมรายด้าน + ประเด็นเร่งด่วน (Incident/SLA/PDPA) ผ่าน LINE · IT/ผู้บริหารสั่งส่งนอกรอบได้
- ✅ **Legal Compliance Governance:** ทะเบียนกฎหมาย/ข้อกำหนด, Assessment, CAPA, applicability sign-off และ Incident regulatory notification แยกการแจ้ง DPO ภายในออกจากการแจ้ง สคส./สกมช./หน่วยงานกำกับ
- ✅ **Production Hardening v1.7:** LINE-only outbox/retry/dead-letter · Snapshot รายวัน + retention + Restore drill รายเดือน · Retention/PDPA Preview/Enforce · Joiner/Mover/Leaver · Business-hours Response/Resolution SLA · Live deployment health
- ✅ **Go-live + Privacy readiness:** Tester / QA มี Release Checklist รวม schema, trigger, LINE, backup, restore, retention, Script Properties capacity และ privacy consent; public helpdesk/LINE แสดง Privacy Notice และบังคับยอมรับก่อนส่ง Ticket
- ✅ **Privacy / PDPA v1.8:** RoPA + lawful basis + DPIA tracking · Consent/withdrawal evidence · DSR lifecycle, identity verification, SLA due date, decision/evidence และ Audit Trail
- ✅ **Assurance Operations v1.9:** Problem/Known Error · Vulnerability remediation/exception/verification · Audit engagement/finding/action/independent closure
- ✅ **CMDB & Service Catalog v1.10:** Configuration Item + typed relationship map เชื่อม Asset/Vendor/Contract/Cloud/Backup/Incident/Change · Service Catalog แบบ dynamic form + eligibility + approval + business-hours SLA + checklist + requester confirmation
- ✅ **Workflow & Integration v1.11:** Production rollout แล้ว — Workflow/Approval Engine, Attachment Registry, Integration Outbox/RecordLinks และ Action Permission; backup, additive migration, schema/build และ public/admin live smoke ผ่าน โดย authenticated per-role transactional UAT และ sandbox rollback drill ยังเป็น post-rollout acceptance
- ✅ **ฐานความรู้ (Knowledge Base):** โมดูลใหม่ — IT สร้าง/แก้/เผยแพร่บทความวิธีแก้ปัญหา (ผูกหมวดหมู่กับ Ticket) · ผู้ใช้ทุกบทบาทค้นหา/อ่านบทความที่เผยแพร่เพื่อแก้ปัญหาด้วยตนเอง (ลดงานซ้ำ Help Desk) พร้อมยอดวิว + ปุ่ม “มีประโยชน์”
- ✅ **Self-service KB บนหน้าแจ้งซ่อมสาธารณะ:** แท็บ “วิธีแก้เบื้องต้น” (ค้นหา/กรองหมวด + accordion อ่านวิธีแก้) สำหรับผู้ใช้ที่ไม่ต้องล็อกอิน + ป้ายนำทาง “มี N บทความในหมวดนี้” เมื่อเลือกประเภทปัญหา + **คำแนะนำบทความแบบเรียลไทม์ขณะพิมพ์หัวข้อปัญหา** (debounce, แสดง 3 อันดับแรก คลิกเปิดได้) → ลด Ticket ซ้ำซ้อน · เปิดเฉพาะบทความที่ “เผยแพร่” (read-only, public)
