# Production Rollout — ISMS v1.10.0

สถานะ: **Deploy สำเร็จและพร้อมทำ UAT ตามบทบาท**  
วันที่ดำเนินการ: **2026-07-20 (ICT)**  
Release: **Apps Script version 33**  
Build: **2026.07.20.4-cmdb-service-catalog**  
Schema: **12**

## 1. ผลลัพธ์ของ Release

- เพิ่ม CMDB สำหรับ Configuration Item, data quality และ typed relationship map
- เพิ่ม Service Catalog และ Service Request Fulfilment ตั้งแต่ยื่นคำขอ อนุมัติ มอบหมาย ทำ checklist ส่งมอบ ยืนยันผล และปิดงาน
- เชื่อม dashboard, calendar, notification, retention, report, Audit Trail และ RBAC เดิม
- เพิ่ม server-side validation สำหรับ reference integrity, cycle, state transition, separation of duties, eligibility, checklist evidence และ attachment provenance
- Migration เป็นแบบ additive ไม่ลบหรือสลับคอลัมน์ของชีตเดิม และไม่ได้ใส่ข้อมูลตัวอย่างลงทะเบียน CMDB หรือคำขอ Production

## 2. Backup ก่อน Migration

### Source code

- Apps Script immutable version **32**
- Description: `pre-v1.10 source backup (v1.9.0 production)`
- Project: [เปิด Apps Script project](https://script.google.com/home/projects/1CRv7HkefACJwd_WVrNGJQbvMZ1uoVvObSK7NWQfjq-cIzxCiGPlH4m7w/edit)

### Production database

- Production: [App-Life-It](https://docs.google.com/spreadsheets/d/1tFow9YQt7TQfAoOncSOQJbpYv6gOQtqWksDlms2u-4o/edit)
- Pre-migration snapshot: [App-Life-It_PRE_v1.10_20260720_154947](https://docs.google.com/spreadsheets/d/1OrSMtWF_wNF2VjVx_fQ3mordpPRGsQkMauaCBKEdcoY/edit)
- Snapshot file ID: `1OrSMtWF_wNF2VjVx_fQ3mordpPRGsQkMauaCBKEdcoY`
- ตรวจแล้วว่าสำเนามีชีตเดิมครบ **71 ชีต** และชื่อชีตไม่ซ้ำ

## 3. Additive Database Migration

Production เพิ่มจาก **71 เป็น 77 ชีต** โดยมีชีตใหม่ดังนี้:

| ชีต | Sheet ID | จำนวนคอลัมน์ | ผลตรวจ |
|---|---:|---:|---|
| `ConfigurationItems` | `2100000009` | 29 | Header ตรง schema, freeze header และป้องกันชีตแล้ว |
| `CIRelationships` | `2100000010` | 21 | Header ตรง schema, freeze header และป้องกันชีตแล้ว |
| `ServiceCatalog` | `2100000011` | 25 | Header ตรง schema, freeze header และป้องกันชีตแล้ว |
| `ServiceRequests` | `2100000012` | 44 | Header ตรง schema, freeze header และป้องกันชีตแล้ว |
| `ServiceRequestTasks` | `2100000013` | 18 | Header ตรง schema, freeze header และป้องกันชีตแล้ว |
| `ServiceRequestHistory` | `2100000014` | 13 | Header ตรง schema, freeze header และป้องกันชีตแล้ว |

ผลตรวจข้อมูลประกอบ:

- `ServiceCatalog` มีรายการตั้งต้น **12 รายการ** และ checklist ที่ต้องแนบหลักฐานถูกกำหนด `evidenceRequired=true`
- เพิ่ม Policy Mapping `MAP-016` ถึง `MAP-021`; หลัง migration มีข้อมูล mapping 22 data rows ไม่รวมหัวตาราง
- เพิ่ม Setting `SERVICE_REQUEST_PII_RETENTION_DAYS=730` เพียงหนึ่งรายการ
- ชีตใหม่ใช้ header สีน้ำเงินเข้ม ตัวอักษรขาว ตัวหนา และจำกัดการแก้ไขไว้ที่บัญชีเจ้าของ
- Runtime ตรวจ readiness จากชีตและ header จริง จึงเห็น schema 12 พร้อมใช้งานแม้ Script Property ยังไม่ได้ sync

## 4. Deployment

- Version **31** — `v1.9.0 Assurance Operations + Privacy PDPA` (จุด rollback ของ Production)
- Version **32** — `pre-v1.10 source backup (v1.9.0 production)`
- Version **33** — `v1.10.0 CMDB + Service Catalog`
- Production deployment ถูกอัปเดตเป็น version 33 โดยคง URL เดิม:
  [เปิด Production Web App](https://script.google.com/macros/s/AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA/exec)
- Developer deployment `AKfycbytEgg_g1zpoTgGNlDCQgjpchk1gm2EY-qV16n81LAT` ยังคงชี้ `@HEAD` และต้องผ่าน Google sign-in
- Deployment เก่าที่เคยบันทึกเป็น Web App A ไม่อยู่ใน deployment list ปัจจุบันและตอบว่าไม่พบ entity จึงไม่ถูกนับเป็น Production endpoint

## 5. Verification Evidence

### Static และ semantic validation

`npm.cmd run validate` ผ่านครบ:

- 43 Apps Script files
- 32 HTML files
- 742 server functions
- 239 API allowlist entries
- ตรวจ schema, routing, response contract, client handlers และ guard สำคัญของ CMDB/Service Request

ผล targeted CMDB validation ที่รันระหว่าง rollout ผ่าน 15 assertions รวม reference integrity, duplicate/self-link, active endpoint และ dependency cycle

### Live browser smoke test

รัน Production `/exec` ด้วย headless browser แล้วได้ผลดังนี้:

- หน้า Public Helpdesk โหลดจบและแสดงแบบฟอร์ม/เมนูครบ
- `google.script.run` พร้อมใช้งาน และไม่พบ JavaScript error ของแอป
- หน้า `?page=admin` แบบยังไม่ล็อกอินแสดง login overlay, build marker v1.10 และมี renderer ของ CMDB/Service Catalog อยู่ใน bundle
- พบเฉพาะคำเตือน iframe sandbox มาตรฐานของ Google Apps Script

หลักฐานภาพ:

- [Public Helpdesk screenshot](evidence/v1.10/production-public.png) — SHA-256 `9DC82C8D59305068A353CD223318A85989E0586E567B9D8BFE4E1C09215ED130`
- [Admin login screenshot](evidence/v1.10/production-admin-login.png) — SHA-256 `750BB18AA643CE07462205500C34B4DF262507E6D82B75B02BABEC1E2C3544AF`

## 6. ข้อจำกัดของการตรวจรับรอบนี้

- ยังไม่ได้รัน authenticated end-to-end ด้วยบัญชี User, Approver, IT Admin, Executive และ DPO เพราะไม่มี session/credential ที่ได้รับอนุญาตในสภาพแวดล้อมทดสอบ
- Developer deployment `@HEAD` ตรวจได้เพียงว่าถูก Google sign-in ป้องกันไว้; Production versioned deployment เป็น endpoint ที่ใช้ smoke test
- คำสั่ง `clasp run setupSystem` จากเครื่องนี้ไม่สำเร็จเนื่องจากไม่มี Apps Script API execution credential จึงยังไม่ได้ sync Script Property `APP_SCHEMA_VERSION=12` และตรวจ trigger ผ่านฟังก์ชันดังกล่าว อย่างไรก็ตาม ชีต/headers/seed/setting ที่ release ต้องใช้ถูก migrate และตรวจโดยตรงแล้ว และ `getAppBuildInfo()` ใช้โครงสร้างจริงเป็น readiness source

ข้อจำกัดทั้งสามข้อไม่ปิดกั้น code/data readiness แต่ต้องปิดด้วย owner-run setup และ UAT ก่อนประกาศ operational acceptance เต็มรูปแบบ

## 7. Rollback Plan

หากต้อง rollback code ให้เปลี่ยน Production deployment เดิมกลับเป็น version **31** เพื่อคง URL เดิม:

```powershell
npx.cmd clasp deploy --deploymentId AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA --versionNumber 31 --description "ROLLBACK v1.10 -> v1.9.0"
```

ให้คงหกชีตใหม่ไว้ระหว่าง code rollback เพราะ v1.9 จะไม่อ่านชีตเหล่านี้ การย้อนข้อมูลต้องเทียบกับ pre-migration snapshot และ restore เฉพาะรายการที่ได้รับอนุมัติ ห้ามลบชีตหรือเขียนทับ Production ทั้งไฟล์โดยไม่มี change approval

## 8. งานปิด Operational Acceptance

1. เจ้าของระบบเปิด Apps Script Editor และรัน `setupSystem()` หนึ่งครั้ง เพื่อ sync Script Property, protection, seed และ operational triggers แบบ idempotent
2. ทำ UAT แยกบัญชี User → Approver → IT Admin → User confirmation และตรวจ read-only ด้วย Executive/DPO ตาม `docs/15_CMDB_SERVICE_CATALOG_v1.10.md`
3. ตรวจ `AuditTrail`, `NotificationQueue`, `NotificationLog`, trigger failures, SLA และ automatic snapshot อย่างน้อยหนึ่งรอบงาน
4. เมื่อผ่าน ให้บันทึกผู้ทดสอบ เวลา Request ID และหลักฐานลง change record แล้วประกาศ operational acceptance

## 9. เฟสถัดไปที่แนะนำ — P3 Workflow & Integration

1. สร้าง Workflow/Approval Engine กลาง รองรับ definition, step, transaction, delegation, escalation และ SLA
2. เชื่อม Service Request ไปยัง Access Request, Ticket, Asset และ Change แบบอัตโนมัติผ่านช่อง `Related*ID`
3. เพิ่ม Attachment Registry และการดาวน์โหลดผ่าน server proxy พร้อม audit การเข้าถึงหลักฐาน
4. เพิ่ม action-level permission และ automated authenticated tests สำหรับทุกบทบาท
5. อัปเดต gap analysis, control mapping และ operational dashboard หลัง integration
