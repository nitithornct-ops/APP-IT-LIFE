# Production Rollout Evidence — v1.11

เอกสารนี้บันทึกหลักฐานการนำ App LIFE v1.11 ขึ้น Production เมื่อวันที่ **21 กรกฎาคม 2569 (Asia/Bangkok)** ครอบคลุม source/database backup, static release gate, additive migration, deployment, source parity และ live smoke ที่ตรวจได้จริง

หลักฐานชุดเดียวกันในรูปแบบ machine-readable อยู่ที่ [evidence/v1.11/production-verification.json](evidence/v1.11/production-verification.json)

> **ผลสรุป:** Production deployment เดิมอัปเดตจาก Apps Script version `33` เป็น release version `35` สำเร็จ, `setupSystem()` สถานะ Completed, Build/Schema พร้อมใช้งาน และ public/admin smoke ผ่าน ขอบเขตนี้ยัง **ไม่ใช่** การรับรองว่า authenticated transactional UAT ทุก role หรือ sandbox rollback drill เสร็จแล้ว

## 1. Release identity

| รายการ | หลักฐาน |
|---|---|
| Package | `1.11.0` |
| Build | `2026.07.21.1-workflow-integration` |
| Schema | `13` |
| Production deployment ID | `AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA` |
| Production version ก่อน rollout | `33` — v1.10.0 |
| Remote source backup | version `34` — pre-v1.11 source backup |
| Production release version | `35` |
| Deployment description | `v1.11.0 Workflow + Attachment Registry + Integration (2026-07-21)` |
| Production Web App | `https://script.google.com/macros/s/AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA/exec` |
| Production Spreadsheet ID | `1tFow9YQt7TQfAoOncSOQJbpYv6gOQtqWksDlms2u-4o` |

## 2. Pre-rollout backup

### 2.1 Source backup และ rollback package

- สร้าง Apps Script remote source version `34` ก่อน push source v1.11
- clone source ของ Production version `33` แยกจาก working directory ไว้ที่ `C:\Users\it2\Downloads\App_LIFE_ReleaseBackups\v1.10_version_33_pre_v1.11_20260721`
- canonical SHA-256 ของ source package version 33 คือ `cc9c905abcf7e6cb740cd8da59a4c7c34cb6fc0e9d9fe82e779d1cf640f96ed5`
- rollback clone เป็น source v1.10 ที่ต้องใช้คืน remote HEAD; ห้ามใช้ working directory v1.11 เป็น rollback source

### 2.2 Production Spreadsheet copy

สร้างสำเนาฐานข้อมูลก่อน migration และอ่าน metadata กลับเพื่อตรวจยืนยัน:

| รายการ | ค่า |
|---|---|
| Backup title | `App-Life-It_PRE_v1.11_20260721_140001` |
| Backup file ID | `1ada1m0Vra6sZh4QW7_wRBUx-es_ET06FiCKb1-__Jxk` |
| Backup URL | `https://docs.google.com/spreadsheets/d/1ada1m0Vra6sZh4QW7_wRBUx-es_ET06FiCKb1-__Jxk/edit?usp=drivesdk` |
| Parent folder ID | `0AMO2Okpx94crUk9PVA` |
| Created time | `2026-07-21T07:00:12.742Z` หรือ 14:00:12 น. Asia/Bangkok |

สำเนานี้เป็น recovery point ก่อน schema/seed migration และต้องเก็บสิทธิ์เข้าถึงตามนโยบายฐานข้อมูล Production

## 3. Static release gate

รัน `npm.cmd run validate` บน source ชุดที่จะ deploy แล้วได้ผล **PASSED**:

- 47 ไฟล์ GS
- 33 ไฟล์ HTML
- 1126 server functions
- 267 API allowlist entries
- syntax, duplicate functions, schema/build marker, renderer และ security regression guards ผ่าน

ผล final independent review ไม่พบ release blocker ใน Workflow/Attachment/Integration/Action Permission snapshot ที่ deploy

## 4. Production setup execution

รัน `setupSystem()` จาก Apps Script Editor ด้วยบัญชีที่มีสิทธิ์บน Production:

| รายการ | ผล |
|---|---|
| เริ่ม | 14:08:23 น. Asia/Bangkok |
| สิ้นสุด | 14:14:02 น. Asia/Bangkok |
| Apps Script Executions duration | 340.256 วินาที |
| Execution status | **Completed** |
| Project Settings | ตรวจ `APP_SCHEMA_VERSION=13` และ `SPREADSHEET_ID=1tFow9YQt7TQfAoOncSOQJbpYv6gOQtqWksDlms2u-4o` แล้ว |

### 4.1 Schema และ header verification

ตรวจพบชีต P3 ใหม่ครบ 16 ชีตและ exact headers ตรงกับ schema:

1. `WorkflowDefinitions`
2. `WorkflowSteps`
3. `WorkflowInstances`
4. `WorkflowApprovals`
5. `WorkflowHistory`
6. `WorkflowDelegations`
7. `AttachmentRegistry`
8. `AttachmentLinks`
9. `AttachmentAccessLog`
10. `RecordLinks`
11. `IntegrationOutbox`
12. `ActionPermissions`
13. `RoleActionPermissions`
14. `UserPermissionOverrides`
15. `ApprovalGroups`
16. `ApprovalGroupMembers`

### 4.2 Seed และ policy verification

- Workflow definition seed 1 รายการ และ Workflow step seed 1 รายการ
- `ActionPermissions`: 25 permission keys ที่ distinct, Active
- `RoleActionPermissions`: 66 mappings ที่ distinct, `ALLOW`, Active
- Approval group `APG-IT-ADMINS`: Active และมี active member 1 รายการ
- Settings defaults: `WORKFLOW_PII_RETENTION_DAYS=730`, `ATTACHMENT_RETENTION_DAYS=730`, `ATTACHMENT_STAGED_RETENTION_HOURS=72` และ `ATTACHMENT_DOWNLOAD_MAX_MB=10`
- Policy Mapping `MAP-022`, `MAP-023` และ `MAP-024` ครบ

### 4.3 Service Catalog additive migration

ตรวจ Service Catalog เดิม 12 แถวหลัง migration แล้ว:

- append headers ใหม่ 4 คอลัมน์โดยไม่ลบหรือสลับ headers เดิม
- Catalog version เพิ่ม 12 รายการตาม migration ที่คาดหมาย
- existing fields เปลี่ยนเฉพาะ `Notes` และ `LastUpdated` ที่ migration ออกแบบไว้
- ไม่พบการเปลี่ยน existing fields อื่นที่ไม่คาดหมาย
- พบ migration audit intent 12 รายการ และ success 12 รายการ

### 4.4 Trigger inventory

ตรวจ operational triggers รวม 8 รายการ และแต่ละ handler มีหนึ่ง instance:

- `dailyNotificationCheck_`
- `monthlyExecutiveReport_`
- `processNotificationQueue_`
- `scheduledSystemBackup_`
- `monthlyRestoreDrill_`
- `dailyRetentionMaintenance_`
- `scheduledLiveHealthCheck_`
- `scheduledWorkflowAutomation_`

การตรวจนี้ยืนยัน inventory/uniqueness หลัง setup แต่ไม่ทดแทน transactional UAT ของ reminder, escalation, integration retry หรือ concurrent manual execution

## 5. Deployment และ source parity

อัปเดต deployment ID เดิมจาก version `33` เป็น version `35` ด้วย description `v1.11.0 Workflow + Attachment Registry + Integration (2026-07-21)` แล้ว

หลัง deploy สร้าง exact remote version 35 clone ไว้ที่ `C:\Users\it2\Downloads\App_LIFE_ReleaseBackups\v1.11_version_35_production_20260721` และตรวจ parity ดังนี้:

- remote clone 81 ไฟล์
- map ตรงกับ local release source: 47 GS + 33 HTML + manifest
- content mismatch = 0 หลัง normalize newline
- canonical SHA-256 ของ version 35 release source คือ `71367065d18a10d85c40bc5dc73389bcc741e895fd1d5419c41711666b2a31fb`

## 6. Live verification

รัน browser live check กับ Production deployment แล้ว process exit code เป็น `0`:

- public Helpdesk form โหลดสำเร็จ และไม่พบ application error
- หน้า Admin แสดง login ตามคาด และไม่พบ application error
- server build: `2026.07.21.1-workflow-integration`
- schema: expected `13`, current `13`
- `schemaReady=true`
- `missingSchema=[]`
- ตรวจภาพ public/admin แล้วว่า layout และสถานะหลักแสดงผลได้
- console warning จาก Google iframe sandbox เป็น warning ที่คาดหมายของ Apps Script container ไม่ใช่ application exception

Live check นี้ยืนยัน public/admin smoke และ server readiness แต่ไม่ได้เข้าสู่ระบบด้วยทุก role จึงไม่อ้างว่า authenticated row-level visibility หรือธุรกรรมทุกเส้นทางผ่านแล้ว

## 7. Acceptance status

| Gate | สถานะ |
|---|---|
| Pre-v1.11 source backup | Complete |
| Pre-v1.11 Spreadsheet copy | Complete |
| Static validation/security review | Complete |
| Source push + release version | Complete — version 35 |
| Production `setupSystem()` | Complete |
| Schema/header/seed/Catalog migration verification | Complete |
| Trigger inventory/uniqueness | Complete |
| Remote version 35 source parity | Complete |
| Public/Admin live smoke | Complete |
| Authenticated transactional UAT แยกทุก role | **Recommended post-rollout acceptance — ยังไม่บันทึกว่า Complete** |
| Fault-injection/retry/retention UAT | **Recommended post-rollout acceptance — ยังไม่บันทึกว่า Complete** |
| Sandbox source/data rollback drill | **Recommended post-rollout acceptance — ยังไม่บันทึกว่า Complete** |

รายละเอียดกรณีทดสอบอยู่ที่ [05_Test_Cases.md](05_Test_Cases.md) หัวข้อ L ต้องเก็บ account/role, record IDs, expected/actual, Audit Log ID และหลักฐานหน้าจอก่อนปิดแต่ละ test case ห้ามตีความ rollout evidence ฉบับนี้ว่า L1–L30 ผ่านทั้งหมด

## 8. Exact rollback procedure

ใช้ขั้นตอนนี้เมื่อมีการอนุมัติ rollback:

1. หยุด manual Workflow/Integration automation และปิดหรือลบ installable trigger `scheduledWorkflowAutomation_` ก่อน เพราะ trigger รัน remote HEAD ไม่ได้รัน source ตาม version ของ Web App deployment
2. เปิด rollback clone `C:\Users\it2\Downloads\App_LIFE_ReleaseBackups\v1.10_version_33_pre_v1.11_20260721` และตรวจ source package SHA-256 ให้ตรงกับ `cc9c905abcf7e6cb740cd8da59a4c7c34cb6fc0e9d9fe82e779d1cf640f96ed5`
3. คืน remote HEAD จาก rollback clone ด้วย `npx.cmd clasp push --force`
4. redeploy version `33` ไปยัง deployment ID เดิม `AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA`
5. ตรวจ deployment/version, public/admin smoke, build marker และยืนยันว่า trigger `scheduledWorkflowAutomation_` ของ v1.11 ไม่คงอยู่
6. คงชีต/คอลัมน์ v1.11 ที่เป็น additive ไว้เพื่อหลักฐานและ compatibility; **ห้ามลบทันที**
7. หากจำเป็นต้อง rollback ข้อมูล ให้หยุด writes, เก็บสำเนาฐานปัจจุบันเพื่อ forensic evidence แล้ว restore ตาม runbook จาก pre-v1.11 Spreadsheet copy ID `1ada1m0Vra6sZh4QW7_wRBUx-es_ET06FiCKb1-__Jxk`; reconcile Drive attachments ที่สร้างหลัง recovery point แยกต่างหาก

ตัวอย่าง redeploy หลังคืน remote HEAD:

```powershell
npx.cmd clasp deploy --deploymentId AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA --versionNumber 33 --description "Rollback v1.10.0 (version 33)"
```

การ redeploy version 33 โดยไม่คืน remote HEAD และไม่ปิด trigger v1.11 **ไม่ถือเป็น rollback ที่สมบูรณ์**

## 9. งานถัดไปที่แนะนำ

1. ทำ authenticated transactional UAT แยกบัญชี User, Approver, IT Admin, Executive และ DPO โดยเน้น SoD, row-level visibility และ denied audit
2. ทดสอบ Workflow approve/reject/delegation/reminder/escalation, Attachment claim/download/checksum/legal hold/restore และ Integration idempotency/retry/cancellation ด้วย controlled test records
3. ทำ sandbox rollback drill ทั้ง source และ data recovery โดยไม่แตะ Production จากนั้นบันทึก RTO, ผู้อนุมัติ, checksum/row counts และ Drive reconciliation result
4. เฝ้าระวัง `AuditTrail`, `IntegrationOutbox`, Workflow overdue/error, Attachment access/integrity และ trigger health ในช่วงหลัง rollout
