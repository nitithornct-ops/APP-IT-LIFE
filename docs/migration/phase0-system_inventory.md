# Phase 0 — System Inventory (ระบบเดิม)

> จัดทำจากการตรวจ Source Code จริงในโปรเจกต์ (root ของ repo) ร่วมกับเอกสารเดิมที่มีอยู่แล้วใน `docs/01_โครงสร้างไฟล์.md`,
> `docs/02_โครงสร้างฐานข้อมูล.md`, `docs/03_Mapping_Feature_Policy.md`, `CHANGELOG.md`, `docs/18_PRODUCTION_ROLLOUT_v1.11.md`
> ตรวจสอบวันที่: 2026-08-05 · **ไม่มีการแก้ไข Source Code เดิมในขั้นตอนนี้**

## 0. สิ่งสำคัญที่ต้องทราบก่อนอ่านเอกสารนี้

**ชื่อระบบเดิมจริงคือ "ระบบบริหารความมั่นคงปลอดภัยสารสนเทศและไซเบอร์ (ISMS Governance System)"
ของกองทุนประกันชีวิต ไม่ใช่ระบบ Help Desk/ITSM ล้วน** — ระบบครอบคลุมทั้ง ITSM (Ticket/Asset/CMDB/Change/Problem)
**และ** GRC/ISMS/PDPA (Risk, Legal Compliance, Privacy/PDPA, Awareness, Audit, Data Classification, Vendor,
AI/Cloud Register) ในระบบเดียวกัน โมดูลกลุ่ม GRC/ISMS **ไม่ปรากฏ** ในรายการโมดูลเป้าหมายที่ระบุไว้ในคำสั่งเริ่มต้น (ข้อ 5)
รายละเอียดและผลกระทบต่อขอบเขตอยู่ใน [`phase0-migration_matrix.md`](phase0-migration_matrix.md) และ [`phase0-risk_register.md`](phase0-risk_register.md) (R-01)

## 1. สถานะ Deployment ปัจจุบัน (ข้อเท็จจริงจาก Production)

| รายการ | ค่า |
|---|---|
| เวอร์ชัน Package | `1.11.0` |
| Build ID | `2026.07.21.1-workflow-integration` |
| Schema Version | `13` (installed บน Production แล้ว, ตรวจแล้วว่า `schemaReady=true`) |
| Production rollout ล่าสุด | 21 กรกฎาคม 2569 (เปลี่ยนจาก Apps Script version 33 → release version 35) |
| Production Script ID (จาก `.clasp.json`) | `1CRv7HkefACJwd_WVrNGJQbvMZ1uoVvObSK7NWQfjq-cIzxCiGPlH4m7w` |
| Production Spreadsheet ID | `1tFow9YQt7TQfAoOncSOQJbpYv6gOQtqWksDlms2u-4o` |
| Web App access | `ANYONE_ANONYMOUS` (ตั้งใจ — เพื่อให้หน้าแจ้งซ่อมสาธารณะใช้ได้โดยไม่ login) |
| Web App executeAs | `USER_DEPLOYING` |
| Timezone (manifest) | `Asia/Bangkok` |
| จำนวนไฟล์ .gs (ตรวจนับจริง) | **47 ไฟล์** — ตรงกับผล `npm run validate` ล่าสุด |
| จำนวนไฟล์ .html (ตรวจนับจริง) | **33 ไฟล์** — ตรงกับผล `npm run validate` ล่าสุด |
| จำนวน Server function (รายงานจาก validate-project.js) | 1,126 ฟังก์ชัน |
| จำนวน API allowlist entries (google.script.run ที่อนุญาต) | 267 รายการ |
| Acceptance ที่ยังไม่เสร็จ (ตาม `docs/18`) | Authenticated transactional UAT ราย role, fault-injection/retry/retention UAT, sandbox rollback drill — ยังไม่บันทึกว่า Complete |

## 2. Entry Point และ Routing (`Code.gs > doGet`)

ระบบเป็น Single Web App ที่แยกเส้นทางด้วย query parameter `page`/`mode` (ไม่มี `doPost` — ทุกการเขียนข้อมูลใช้
`google.script.run` เรียกฟังก์ชันฝั่ง Server โดยตรงจาก client):

| Route | เงื่อนไข | หน้าที่ให้บริการ | ต้อง Login หรือไม่ |
|---|---|---|---|
| `?health=public` | query `health=public` | Health check แบบเบา (ไม่ render หน้าใหญ่) คืนค่า build id + timestamp | ไม่ต้อง |
| `?page=line-callback` | query `page=line-callback` | LINE Login OAuth callback → แลก code, สร้าง one-time handoff กลับ PublicTicket | ไม่ต้อง (เป็นเส้นทาง callback) |
| `?page=admin` / `?page=app` / `?page=backend` | query `page` | Backend shell (`Index.html`) — เจ้าหน้าที่ login ด้วย email+password (มี MFA OTP ทางอีเมล) | ต้อง (หลัง shell โหลดแล้ว client เรียก login ผ่าน `google.script.run`) |
| (ไม่ระบุ / `?page=status,track,kb`) | ค่าเริ่มต้น | หน้าแจ้งซ่อม/ติดตามสถานะ/KB สาธารณะ (`PublicTicket.html`) — รองรับ LINE Login หรือ Email OTP หรือไม่ login เลย (anonymized) | ไม่บังคับ |

**ข้อสังเกตสำคัญสำหรับสถาปัตยกรรมใหม่:** ระบบเดิมมี "หน้าเจ้าหน้าที่" (ต้อง login, RBAC เต็มรูปแบบ) และ
"หน้าสาธารณะ" (ไม่ต้อง login, มี honeypot/rate limit/PDPA consent) อยู่ใน Web App เดียวกัน — สถาปัตยกรรมใหม่ต้องออกแบบ
ให้ Frontend (Cloudflare Pages) แยกส่วน "public intake" ออกจาก "authenticated app" อย่างชัดเจน และ Backend API
ต้องรองรับ endpoint สาธารณะแบบไม่มี JWT (พร้อม rate limit/CAPTCHA-equivalent) คู่ขนานกับ endpoint ที่ต้องมี JWT

## 3. กลไก Authentication/Session เดิม (`Auth.gs`)

- บัญชีเจ้าหน้าที่ (`Users` sheet): login ด้วย **Username + Password** (ไม่ใช่อีเมล) — รหัสผ่าน hash แบบมี salt/iteration
  เก็บใน Sheet เอง (ไม่ใช่ Identity Provider); มี legacy hash format เก่าที่ auto-upgrade หลัง login สำเร็จ
- Session เก็บใน `CacheService` เป็น token, อายุ **Idle timeout 3,600 วินาที (1 ชม.)**, **Absolute TTL 21,600 วินาที (6 ชม.)**
- MFA: OTP ทางอีเมล (`ADMIN_MFA_ENABLED=true` ค่าเริ่มต้น) หลังกรอกรหัสผ่านถูกต้อง ก่อนออก session จริง
- Login throttle ป้องกัน brute-force (ราย username)
- Authorization ฝั่ง Server ผ่าน `requireModule(moduleKey, needEdit)` และ `requireRole(allowedRoles)` — ตรวจ**ทุกครั้ง**
  ไม่เชื่อการซ่อนเมนูฝั่ง client (ตรงกับหลักการที่ระบบใหม่ต้องรักษาไว้)
- ผู้แจ้งทั่วไป (public) มีอีกเส้นทางแยกต่างหาก: **LINE Login (OAuth/OIDC + PKCE)** ผูกกับ `EmployeeCode`, หรือ **Email OTP**
  สำรอง, หรือไม่ login เลย (anonymized ticket + track ด้วยรหัสติดตามที่เก็บเป็น HMAC hash เท่านั้น)
- **1 ผู้ใช้ = 1 Role เดียว** (คอลัมน์ `Users.Role` เป็น Enum ค่าเดียว ไม่ใช่ many-to-many) — เป็นข้อจำกัดสำคัญเทียบกับ
  Configurable RBAC ที่ระบบใหม่ต้องมี (ดู [`phase0-migration_matrix.md`](phase0-migration_matrix.md) หัวข้อ RBAC)

## 4. บทบาท (Roles) ที่ Hard-code ไว้จริงใน `Config.gs`

```
ROLES = { USER: 'User', APPROVER: 'Approver', IT_ADMIN: 'ITAdmin', EXECUTIVE: 'Executive', DPO: 'DPO' }
```

รวม **5 บทบาท** เท่านั้น (User / Approver / ITAdmin / Executive / DPO) — น้อยกว่าบทบาทเริ่มต้น 9 บทบาทที่กำหนดไว้ในคำสั่ง
(`super_admin, it_admin, technician, approver, manager, executive, auditor, dpo, user`) ระบบใหม่ต้อง Mapping และเพิ่มบทบาท
ที่ขาด (โดยเฉพาะ `super_admin`, `technician`, `manager`, `auditor`) — ดูรายละเอียดใน Migration Matrix

สิทธิ์ระดับโมดูลกำหนดใน `Config.gs > MODULE_ACCESS` (ตรวจซ้ำฝั่ง Server ทุกครั้งผ่าน `requireModule`) และตั้งแต่ v1.11
มีสิทธิ์ระดับ action เพิ่มอีกชั้นผ่านตาราง `ActionPermissions` / `RoleActionPermissions` / `UserPermissionOverrides`
(unknown/inactive key ถูกปฏิเสธ, user override มี precedence เหนือ role mapping, และ `DENY` ชนะเสมอเมื่อขัดแย้ง) —
นี่คือรากฐานที่ใกล้เคียงกับ Configurable RBAC ที่ระบบใหม่ต้องการอยู่แล้ว สามารถต่อยอดแนวคิดนี้ได้โดยตรง

## 5. ฐานข้อมูล — Google Sheets

- ใช้ Google Sheets **1 ไฟล์** แยก **1 Sheet ต่อ 1 ทะเบียน** สร้าง/อัปเดตอัตโนมัติแบบ additive ด้วย `setupSystem()` ใน `Setup.gs`
  (อ้างอิงนิยามจาก `Config.gs > DB_SCHEMA`)
- นับ Sheet ได้ **~68 ทะเบียน** (Schema version 13) ครอบคลุมตั้งแต่ Users/Employees ไปจนถึง Workflow Engine, Attachment
  Registry และ Integration Outbox ที่เพิ่มใน v1.11 — รายละเอียดคอลัมน์ครบทุก Sheet อยู่ใน
  [`phase0-data_dictionary_reference.md`](phase0-data_dictionary_reference.md) (อ้างอิง `docs/02_โครงสร้างฐานข้อมูล.md` เป็นหลัก)
- คอลัมน์มาตรฐานที่ทุก Sheet มี (ยกเว้น `AuditTrail`, `NotificationLog`, `PolicyMapping`): `Timestamp`, `CreatedBy`,
  `LastUpdatedBy`, `LastUpdatedAt`
- Soft-delete แบบรวมศูนย์ผ่าน `DeleteService.gs`: เติมคอลัมน์ `IsDeleted/DeletedAt/DeletedBy` ให้ทุก Sheet ที่ใช้งานครั้งแรก
  แถวที่ลบถูกซ่อนอัตโนมัติจาก `readSheetObjects_()` แต่ยังอยู่ในชีตเพื่อกู้คืน/ตรวจสอบย้อนหลังได้
- Sheet ที่พิจารณาเป็น "Sensitive" ถูก `protectSensitiveSheet_()` ป้องกันการแก้ไขตรงจาก editor ทั่วไป (เช่น `AuditTrail`,
  Workflow/Attachment/Integration/ActionPermission sheets ทั้งหมด, Privacy sheets)
- **ไม่มี Foreign Key จริงในระดับฐานข้อมูล** (Google Sheets ไม่รองรับ) — ความสัมพันธ์ตรวจสอบด้วยโค้ดฝั่ง Server เท่านั้น
  (เช่น CMDB ตรวจ node อ้างอิงจริง, Service Request ตรวจ CatalogID) นี่คือความเสี่ยงข้อมูลไม่สอดคล้องกันที่การย้ายไป
  PostgreSQL + FK จะแก้ได้โดยตรง

## 6. Google Drive (ไฟล์แนบ)

มี **2 รุ่น** อยู่คู่กันในปัจจุบัน:

1. **Drive.gs (รุ่นเดิม)** — อัปโหลดหลักฐานแยกตามโฟลเดอร์ `[module]/[ปี พ.ศ.]`, ผูกกับ record ผ่านคอลัมน์ `EvidenceLink`/
   `FileID`/`FileURL` ตรงๆ ใน Sheet ของแต่ละโมดูล ยังใช้งานอยู่กับ path เดิมบางจุด (Anonymous/Public/LINE Ticket เดิม)
2. **Attachment Registry (`Module_AttachmentRegistry.gs`, เพิ่มใน v1.11)** — ศูนย์กลางไฟล์แนบใหม่: private Drive storage,
   STAGED→exact record claim, ตรวจ MIME/magic-byte/ขนาด/SHA-256, download ผ่าน Server proxy เท่านั้น (ไม่ส่ง raw Drive
   ID/URL ให้ client), Access log, Legal hold, Retention ตาม lifecycle, Soft-delete/Restore — โมดูล Service Request,
   Ticket (ภายใน), และ Personal Task ถูก migrate มาใช้เส้นทางนี้แล้ว

**ข้อสรุปสำหรับการย้ายระบบ:** ต้องย้ายไฟล์ทั้งสองรุ่นไป Supabase Storage (Private Bucket + Signed URL) — Attachment
Registry มีแนวคิดตรงกับเป้าหมายอยู่แล้ว (private, checksum, access log, legal hold) จึงเป็น "ต้นแบบที่ดี" ให้ออกแบบ
Storage service ใหม่ตาม ส่วน path แบบ Drive.gs เดิมต้องอ่าน metadata แล้ว mapping เข้ากับ record ใหม่ด้วยเครื่องมือ Migration

## 7. Trigger ที่ตั้งไว้จริงบน Production (ตรวจสอบแล้วจาก `Setup.gs` และยืนยันซ้ำจาก `docs/18`)

| Trigger Handler | ความถี่ | หน้าที่ |
|---|---|---|
| `dailyNotificationCheck_` | ทุกวัน เวลา 07:00 | ตรวจวันครบกำหนด/SLA ใกล้ครบทุกโมดูล แล้วส่งแจ้งเตือน |
| `monthlyExecutiveReport_` | วันที่ 1 ของเดือน เวลา 08:00 | สรุปสุขภาพมาตรการควบคุมรายเดือนส่งผู้บริหารทาง LINE |
| `processNotificationQueue_` | ทุก 15 นาที | ประมวลผล LINE Outbox: retry/dead-letter |
| `scheduledSystemBackup_` | ทุกวัน เวลา 02:00 | สร้าง System Snapshot รายวัน |
| `monthlyRestoreDrill_` | วันที่ 2 ของเดือน เวลา 03:00 | ทดสอบ Restore ไปยัง Sandbox อัตโนมัติ |
| `dailyRetentionMaintenance_` | ทุกวัน เวลา 04:00 | ประมวลผล Data Retention/PDPA (โหมด DRY_RUN หรือ ENFORCE) |
| `scheduledLiveHealthCheck_` | ทุกวัน เวลา 06:00 | ตรวจสุขภาพ Deployment จริง (public/admin smoke) |
| `scheduledWorkflowAutomation_` | ทุกชั่วโมง | Reminder/Escalation ของ Workflow + ประมวลผล Integration Outbox ตาม quota |

→ ทั้งหมดนี้ต้องแปลงเป็น **Cloudflare Workers Cron Trigger** ในระบบใหม่ (ระบุไว้แล้วในสถาปัตยกรรมเป้าหมาย ข้อ 3/7)

## 8. บริการภายนอกที่ผูกอยู่ (OAuth Scopes จาก `appsscript.json`)

| Scope/บริการ | ใช้ทำอะไร | แผนในระบบใหม่ |
|---|---|---|
| `spreadsheets` | ฐานข้อมูลหลัก | ย้ายไป Supabase PostgreSQL ทั้งหมด |
| `drive` | ไฟล์แนบ/หลักฐาน/Snapshot | ย้ายไป Supabase Storage (Private Bucket) |
| `script.send_mail` (Gmail) | **เฉพาะ OTP ของ Admin MFA เท่านั้น** — งานแจ้งเตือนระบบทั่วไปใช้ LINE ไม่ใช่อีเมล | แทนที่ด้วยผู้ให้บริการอีเมล/Supabase Auth OTP หรือ Cloudflare Email Workers |
| `calendar` | ปฏิทินรวม (อ่านนัดหมาย SLA/due date ข้ามโมดูล — เป็น aggregation ภายใน ไม่ได้ sync ไป Google Calendar จริงจากโค้ดที่ตรวจ) | เขียน query รวมข้าม table ใน PostgreSQL แทน ไม่จำเป็นต้องพึ่ง Calendar API ภายนอก |
| `documents` (Google Docs) | ใช้เป็นไฟล์ชั่วคราวสร้าง PDF (Evidence Export, PDF Designer, รายงาน Ticket/Asset) | ต้องเลือก PDF generation library ฝั่ง Workers หรือบริการภายนอกใหม่ (ยังไม่กำหนดใน Stack เป้าหมาย — ต้องตัดสินใจใน Phase 4) |
| `script.external_request` | เรียก LINE Messaging API / LINE Login OAuth | คง LINE Login/Notify integration ผ่าน Workers (เรียก REST API ตรง) |
| `script.scriptapp` | จัดการ Trigger เอง | แทนที่ด้วย Cloudflare Cron Trigger config |
| `userinfo.email` | อ่านอีเมลผู้ใช้ (ไม่ได้ใช้เป็นกลไก auth หลัก) | ไม่จำเป็นในระบบใหม่ (ใช้ Supabase Auth) |

**LINE เป็นช่องทางแจ้งเตือนหลักของระบบ (ไม่ใช่อีเมล)** — เป็นข้อกำหนดทางธุรกิจที่สำคัญ ต้องคงไว้ในระบบใหม่ (Cloudflare
Workers เรียก LINE Messaging API ตรง + LINE Login OAuth/PKCE สำหรับผู้แจ้งภายนอก)

## 9. Audit Log เดิม

Sheet `AuditTrail` (ป้องกันการแก้ไข) บันทึก: `LogID, Timestamp, ActorEmail, ActorRole, Action, Module, TargetSheet,
TargetID, Detail, IPHint (สงวนไว้ — Apps Script ไม่ให้ IP จริง), Result (success/fail/denied)` — เขียนผ่าน helper กลาง
`writeAudit_()` ใน `Utils.gs` ครอบคลุมการสร้าง/แก้ไข/ลบ/อนุมัติ/login/export ตามที่คำสั่งกำหนด (แนวคิดตรงกับ Audit Log
ที่ระบบใหม่ต้องมีอยู่แล้ว) ข้อจำกัด: ไม่มี IP จริง, ไม่มี Request ID/Correlation ID เนื่องจากข้อจำกัดของ Apps Script runtime

## 10. เครื่องมือ Static Validation ที่มีอยู่แล้ว

`scripts/validate-project.js` (79 KB) เป็นตัวตรวจ syntax, duplicate function, schema/build marker, renderer, security
regression guard ก่อน push/deploy ทุกครั้ง (`npm run validate`, ผูกกับ `prepush`/`predeploy`) — เป็นเครื่องมือเฉพาะของ
ระบบเดิมที่จะไม่ถูกย้าย (สถาปัตยกรรมใหม่ใช้ TypeScript type check + ESLint + Vitest/Playwright + GitHub Actions แทน)
แต่ **แนวคิด "ห้าม deploy ถ้า validate ไม่ผ่าน" ควรนำมาใช้ต่อใน CI/CD ใหม่**

## 11. สรุปจำนวนไฟล์ (ตรวจนับจริง ณ วันที่ตรวจสอบ)

- ไฟล์ `.gs` (Server): 47 ไฟล์
- ไฟล์ `.html` (Frontend/Include): 33 ไฟล์
- ไฟล์ตั้งค่า: `appsscript.json`, `.clasp.json`
- เอกสารเดิม: `docs/01`–`docs/18` (19 ไฟล์ .md) + README.md + CHANGELOG.md — เอกสารครบถ้วนและอัปเดตต่อเนื่องทุก release
  (คุณภาพเอกสารเดิมสูงกว่าระบบ GAS ทั่วไปมาก ช่วยลดความเสี่ยงของ Phase 0 นี้ได้มาก)
