# Production Rollout — ISMS v1.9.0

สถานะ: **Deploy สำเร็จ**  
วันที่ตรวจรับ: **2026-07-20 (ICT)**  
Release: **Apps Script version 31**  
Build: **2026.07.20.3-assurance-ops**  
Schema: **11**

## 1. ขอบเขตที่ขึ้น Production

- Response contract กลาง `success/message/data/errorCode/timestamp` พร้อม legacy compatibility
- Privacy / PDPA: RoPA, consent evidence และ Data Subject Request
- Problem Management และ Known Error Database
- Vulnerability Management พร้อม remediation, exception และ independent verification
- Audit Management พร้อม engagement, finding, corrective action และ closure verification
- RBAC, API allowlist, Audit Trail, schema/build readiness และ regression guards

## 2. Backup ก่อน Migration

### Source code

- Apps Script immutable version **30**
- Description: `PRE_V1.9_BACKUP_2026-07-20`
- Project: [เปิด Apps Script project](https://script.google.com/home/projects/1CRv7HkefACJwd_WVrNGJQbvMZ1uoVvObSK7NWQfjq-cIzxCiGPlH4m7w/edit)

### Production database

- Production: [App-Life-It](https://docs.google.com/spreadsheets/d/1tFow9YQt7TQfAoOncSOQJbpYv6gOQtqWksDlms2u-4o/edit)
- Pre-migration snapshot: [ISMS_DB_SNAPSHOT_20260720_PRE_MIGRATION_v1.9.0](https://docs.google.com/spreadsheets/d/1LQorS5XNPEJ1pq1TK_0997IXvwVoVenxLLZKm7LsAIw/edit)
- Snapshot file ID: `1LQorS5XNPEJ1pq1TK_0997IXvwVoVenxLLZKm7LsAIw`
- ตรวจแล้วว่าสำเนามีชีตเดิมครบ **58 ชีต** ตั้งแต่ `Users` ถึง `PolicyMapping`
- มี automatic daily snapshot ล่าสุดก่อน rollout: `ISMS_DB_SNAPSHOT_20260720_020527_AUTO_DAILY`

## 3. Additive Database Migration

เพิ่มชีตใหม่ 8 ชีต โดยไม่ลบ เปลี่ยนชื่อ หรือแก้โครงสร้าง 58 ชีตเดิม:

1. `PrivacyROPA`
2. `PrivacyConsents`
3. `PrivacyDSR`
4. `Problems`
5. `KnownErrors`
6. `VulnerabilityFindings`
7. `AuditEngagements`
8. `AuditFindings`

ผลตรวจหลัง migration:

- Production มีทั้งหมด **66 ชีต**
- Header ของทั้ง 8 ชีตตรงกับ `DB_SCHEMA`
- Freeze header row, header styling และ auto-resize คอลัมน์หลักแล้ว
- Runtime ใช้ schema/header จริงเป็น readiness source จึงรายงาน schema พร้อมใช้งานแม้ Script Property จะยังเป็นค่ารุ่นก่อน

## 4. Deployment

- Release version: **31** — `v1.9.0 Assurance Operations + Privacy PDPA`
- Deployment A อัปเดตเป็น version 31:
  [เปิด Web App A](https://script.google.com/macros/s/AKfycbw8U6hLKauh-x0x2d8jQjrzHj6nM06dAQO_IvOmjB8vIkw8az5DF77-BsE7SbQT5vF3mw/exec)
- Deployment B อัปเดตเป็น version 31:
  [เปิด Web App B](https://script.google.com/macros/s/AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA/exec)
- HEAD deployment ไม่ถูกใช้แทน versioned production deployments

## 5. Verification Evidence

### Static validation

`npm run validate` ผ่านครบ:

- 41 Apps Script files
- 30 HTML files
- 655 server functions
- 222 API allowlist entries
- ตรวจ response contract, API routing และ `google.script.run` success/failure handlers

### Live HTTP smoke test

- Deployment A และ B ตอบ HTTP **200**
- ทั้งสอง deployment มี build `2026.07.20.3-assurance-ops`
- พบ renderer ของ Privacy, Problem, Vulnerability และ Audit ครบ

### Live browser smoke test

รันด้วย `npm run qa:live -- --url <deployment-url>` ผ่าน Chrome DevTools Protocol:

- หน้า Public Helpdesk โหลดแบบฟอร์มจริงครบ ไม่ค้าง loading
- พบหมวดบริการและ SLA, ฟอร์มแจ้งปัญหา, ข้อมูลติดต่อ และเมนูติดตามสถานะ
- หน้า Admin แสดง login overlay, username/password fields และ build marker v1.9
- ไม่พบ JavaScript exception หรือ console error ของแอป
- พบเฉพาะคำเตือน sandbox มาตรฐานจาก Google Apps Script wrapper

## 6. Rollback Plan

หากต้อง rollback code ให้เปลี่ยน version ของ deployment เดิมกลับเป็น **30** เพื่อคง URL เดิม:

```powershell
clasp deploy -i AKfycbw8U6hLKauh-x0x2d8jQjrzHj6nM06dAQO_IvOmjB8vIkw8az5DF77-BsE7SbQT5vF3mw -V 30 -d "ROLLBACK_PRE_V1.9"
clasp deploy -i AKfycbzfRYprRHYQ5c21_1xH--MMc24Vu3afyr4Kp_d8XG6r63DIJoIw5sVscuP5bQ4jAFRgLA -V 30 -d "ROLLBACK_PRE_V1.9"
```

ไม่ต้องลบ 8 ชีตใหม่ระหว่าง code rollback เพราะรุ่นเดิมจะไม่อ่านชีตเหล่านี้ การย้อนข้อมูลควรเปรียบเทียบกับ pre-migration snapshot และ restore เฉพาะรายการที่จำเป็น ห้ามเขียนทับ Production ทั้งไฟล์โดยไม่มี change approval

## 7. งานถัดไปหลัง Release

1. เปิด Apps Script Editor และรัน `setupSystem()` หนึ่งครั้ง เพื่อ sync `APP_SCHEMA_VERSION`, ใช้ strict sheet protection, seed ที่ยังขาด และตรวจ operational triggers แบบ idempotent
2. ใช้บัญชี Tester/QA ที่ได้รับอนุญาตทดสอบ authenticated workflows ของ Privacy, Problem, Vulnerability และ Audit รวมถึง independent verification
3. เฝ้าดู Audit Trail, notification queue, trigger failures และ automatic snapshot อย่างน้อย 1 รอบงาน
4. เริ่ม P2: CMDB/relationship map และ Service Catalog/Request Fulfilment โดยใช้ additive schema และ RBAC เดิม
