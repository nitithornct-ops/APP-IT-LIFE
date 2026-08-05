# CMDB และ Service Catalog / Request Fulfilment — v1.10

เอกสารนี้เป็นคู่มือติดตั้ง ใช้งาน ควบคุมสิทธิ์ และตรวจรับฟีเจอร์ที่เพิ่มใน release `1.10.0` โดยอ้างอิง source และ `Config.gs > DB_SCHEMA` ของรุ่นปัจจุบัน

## 1. Release identity

| รายการ | ค่าที่ต้องได้ |
|---|---|
| Application version | `ISMS Governance System v1.10 (CMDB & Service Catalog)` |
| Build ID | `2026.07.20.4-cmdb-service-catalog` |
| Schema version | `12` |
| Package version | `1.10.0` |
| Policy mapping | `MAP-020` CMDB และ `MAP-021` Service Catalog |

ฟีเจอร์ v1.10 เป็น additive change: เพิ่มชีตและคอลัมน์ที่ขาดโดยไม่ลบ เปลี่ยนชื่อ หรือสลับคอลัมน์เดิม อย่างไรก็ตามต้องสำรองฐานข้อมูลก่อนอัปเกรดเสมอ

## 2. ขอบเขตของ release

### CMDB

- เก็บ Configuration Item (CI), owner/administrator, environment, criticality, data classification, RPO/RTO และข้อมูลสำรอง
- เชื่อม CI กับทะเบียนเดิม ได้แก่ Asset, Vendor, Contract, Cloud, Backup, Incident และ Change
- แสดงรายการ CI, ตารางความสัมพันธ์, data-quality view และ relationship map แบบ inline SVG
- ตรวจ reference/enum/IP/URL, รายการซ้ำ, self-link, dependency cycle และเงื่อนไข Retire ฝั่ง Server
- บันทึกการตรวจยืนยันข้อมูลและ Audit Trail

### Service Catalog / Request Fulfilment

- ให้ IT Admin นิยามบริการ แบบฟอร์ม เงื่อนไขผู้มีสิทธิ์ SLA การอนุมัติ Checklist และวิธีปิดงาน
- ให้ผู้ใช้ที่ล็อกอินทุกบทบาทเลือกบริการ ยื่นคำขอ และติดตามรายการที่ตนเกี่ยวข้อง
- Route การอนุมัติไปหัวหน้างานหรือผู้อนุมัติที่กำหนด และห้ามผู้ขออนุมัติตนเอง
- ให้ IT Admin มอบหมาย ดำเนิน Checklist พักรอ ส่งมอบ และปิดงาน
- เก็บ snapshot ของ Catalog version/workflow/checklist ต่อคำขอ เพื่อไม่ให้การแก้ Catalog ย้อนหลังเปลี่ยนหลักฐานเดิม
- เชื่อม KPI/กระดิ่งแจ้งเตือน/ปฏิทินรวม/LINE alert และรายงานผู้บริหาร

> Service Request เป็นคำขอรับบริการภายใน ไม่ใช่ Public Helpdesk Ticket, Incident หรือ Access Request และ v1.10 ยังไม่สร้างรายการในโมดูลเหล่านั้นอัตโนมัติ แม้ schema จะเตรียมช่อง `Related*ID` ไว้สำหรับการเชื่อมในอนาคต

## 3. ไฟล์และข้อมูลที่เพิ่ม

| ส่วน | ไฟล์/ชีต | หน้าที่ |
|---|---|---|
| Server | `Module_CMDB.gs` | API, validation, atomic upsert, node catalog และ relationship integrity |
| Client | `CMDB.html` | CI/relationship forms, quality view, map และ accessible adjacency table |
| Server | `Module_ServiceCatalog.gs` | Catalog, request, approval, assignment, checklist, status, confirmation และ history |
| Client | `ServiceCatalog.html` | เลือกบริการ, dynamic request form, งานอนุมัติ/fulfilment และจัดการ Catalog |
| Data | `ConfigurationItems` | Master ของ CI |
| Data | `CIRelationships` | Typed edge ระหว่าง CI/ทะเบียนปฏิบัติการ |
| Data | `ServiceCatalog` | นิยามและ version ของบริการ |
| Data | `ServiceRequests` | Header/workflow state ของคำขอ |
| Data | `ServiceRequestTasks` | Checklist ที่ snapshot ต่อคำขอ |
| Data | `ServiceRequestHistory` | Timeline การกระทำและสถานะ |

ทั้งหกชีตถูกตั้งเป็น Sensitive Sheet ระหว่าง `setupSystem()` การแก้ไขตามปกติต้องทำผ่าน API ที่ตรวจสิทธิ์ฝั่ง Server

## 4. RBAC และการมองเห็นข้อมูล

| ความสามารถ | User | Approver | IT Admin | Executive | DPO |
|---|:---:|:---:|:---:|:---:|:---:|
| เปิด CMDB | – | อ่าน | แก้ไข | อ่าน | อ่าน |
| สร้าง/แก้ CI และ relationship | – | – | ได้ | – | – |
| เปิด Service Catalog | ได้ | ได้ | ได้ | ได้ | ได้ |
| ยื่น/ยืนยัน/ยกเลิกคำขอของตน | ได้ | ได้ | ได้ | ได้ | ได้ |
| อนุมัติคำขอ | – | เมื่ออีเมลตรง `Approver` ของคำขอเท่านั้น | เมื่ออีเมลตรง `Approver` ของคำขอเท่านั้น | เมื่ออีเมลตรง `Approver` ของคำขอเท่านั้น | เมื่ออีเมลตรง `Approver` ของคำขอเท่านั้น |
| จัดการ Catalog/มอบหมาย/Checklist/ผลดำเนินการ | – | – | ได้ | – | – |

กติกาการมองเห็น Service Request:

- IT Admin เห็นคำขอทั้งหมด
- บุคคลอื่นเห็นเฉพาะคำขอที่เป็นผู้ขอ ผู้อนุมัติ หรือผู้รับผิดชอบ
- ผู้ขอเห็นเฉพาะ history ที่กำหนด `IsPublic=Yes`; internal task evidence/notes ไม่ถูกส่งให้ผู้ขอ
- CMDB role อ่านอย่างเดียวได้รับ CIs และ node ที่อยู่ใน graph แต่ไม่ได้รับ external-record selector ทั้งชุด

## 5. ขั้นตอนอัปเกรดจาก v1.9

1. สร้าง source backup และ Spreadsheet snapshot ก่อนเปลี่ยนแปลง Production
2. Push source v1.10 **ทั้งชุดใน release เดียวกัน** เพื่อให้ Server, HTML, allowlist และ build marker ตรงกัน
3. รัน `setupSystem()` จาก Apps Script Editor ด้วยบัญชีเจ้าของ/ผู้ติดตั้ง
4. ตรวจว่ามีหกชีตใหม่และ header ตรงกับ `Config.gs > DB_SCHEMA`
5. ตรวจ `ServiceCatalog` ว่ามีรายการตั้งต้น 12 รายการ; การรัน setup ซ้ำต้องไม่สร้าง CatalogID เดิมซ้ำหรือเขียนทับรายการที่แก้แล้ว
6. ตรวจ Script Property `APP_SCHEMA_VERSION=12`
7. รัน `getAppBuildInfo()` และยืนยันว่า build/schema พร้อมใช้งานและไม่มีรายการชีตหรือคอลัมน์ที่ขาด
8. สร้าง Deployment version ใหม่ แล้วเปิดหน้า Admin แบบ hard refresh
9. ทดสอบบัญชี ITAdmin, Approver, Executive/DPO read-only และ User ตามหัวข้อ J/K ใน `docs/05_Test_Cases.md`
10. เฝ้าดู `AuditTrail`, `NotificationQueue/NotificationLog` และรายการเกิน SLA หลังเปิดใช้งาน

คำสั่งตรวจ source ในเครื่อง Windows:

```powershell
npm.cmd run validate
```

## 6. วิธีใช้งาน CMDB

### 6.1 เตรียม master data

ก่อนสร้าง CI ให้ตรวจรหัสอ้างอิงในโมดูล Asset, Vendor/Contract, Cloud และ Backup เพราะ Server จะไม่ยอมรับ reference ที่ไม่มีอยู่จริง

CI ที่ต้องกรอกขั้นต่ำมีชื่อ ประเภท Environment, Owner, Administrator, Criticality, Data Classification, Backup Required และ Status

กติกาสำคัญ:

- ชื่อ CI ต้องไม่ซ้ำกันภายใน Environment เดียวกัน ยกเว้นรายการ Retired ตามกติกาใน Server
- AssetID และ CloudID เดียวกันผูกกับ Active CI ซ้ำไม่ได้
- URL ต้องขึ้นต้น `http://` หรือ `https://`; IP รองรับ IPv4, IPv6 และ CIDR หลายค่า
- Production CI ที่ Active และมี Criticality High/Critical ต้องกำหนด RPO และ RTO
- เมื่อ `BackupRequired=Yes` ต้องอ้าง Backup record หรือ CI ประเภท Backup Job ที่มีอยู่
- Contract ที่เลือกต้องอยู่ภายใต้ Vendor เดียวกับ VendorID ของ CI
- การแก้ข้อมูลสาระสำคัญของ CI/relationship จะล้างผลตรวจยืนยันเดิม; status-only update ไม่ล้างผลตรวจยืนยัน

### 6.2 สร้าง relationship

Node type ที่รองรับ: `CI`, `Asset`, `Vendor`, `Contract`, `Cloud`, `Backup`, `Incident`, `Change`

Relationship type ที่รองรับ:

| Type | ความหมาย/ข้อบังคับหลัก |
|---|---|
| `DEPENDS_ON`, `RUNS_ON` | dependency แบบมีทิศทางและต้องไม่ทำให้เกิด cycle |
| `HOSTS`, `USES`, `CONNECTS_TO`, `LINKED_TO` | ความสัมพันธ์เชิงโครงสร้าง/การใช้งานทั่วไป |
| `BACKED_UP_BY` | ปลายทางต้องเป็น Backup หรือ CI |
| `SUPPLIED_BY` | ปลายทางต้องเป็น Vendor |
| `COVERED_BY_CONTRACT` | ปลายทางต้องเป็น Contract |
| `IMPACTED_BY` | ปลายทางต้องเป็น Incident |
| `CHANGED_BY` | ปลายทางต้องเป็น Change |

ระบบป้องกันต้นทาง=ปลายทาง, edge ซ้ำ, reverse duplicate สำหรับความสัมพันธ์ symmetric, วันที่สิ้นสุดก่อนวันเริ่ม และ dependency cycle

ก่อน Retire CI ต้องเปลี่ยน relationship ที่ Active ซึ่งอ้าง CI นั้นเป็น Inactive พร้อมเหตุผล จากนั้นจึงเปลี่ยน CI เป็น Retired

### 6.3 ใช้ Relationship Map

- เลือก node เพื่อ focus ความสัมพันธ์ใกล้เคียงไม่เกิน 2 ระดับ
- ใช้สี/ป้าย type และ impact ประกอบการวิเคราะห์ ไม่ควรใช้สีเพียงอย่างเดียว
- ตาราง adjacency ใต้แผนผังเป็นทางเลือกที่อ่านได้ด้วยคีย์บอร์ด/โปรแกรมอ่านหน้าจอ
- ตรวจ Quality view สำหรับ CI ที่ยังไม่ verified และ relationship ที่ปลายทางหาย

CMDB รุ่นนี้เป็นทะเบียนที่ผู้ดูแลควบคุม ไม่ใช่ระบบ auto-discovery หรือ real-time network topology

## 7. วิธีใช้งาน Service Catalog

### 7.1 รายการตั้งต้น

| CatalogID | ServiceCode | บริการ | SLA (ชม.ธุรกิจ) | การอนุมัติ |
|---|---|---|---:|---|
| SVC-CAT-001 | ACCOUNT_CREATE | ขอสร้างบัญชี | 16 | หัวหน้างาน |
| SVC-CAT-002 | ACCESS_MODIFY | ขอแก้ไขสิทธิ์ | 16 | หัวหน้างาน |
| SVC-CAT-003 | ACCESS_REVOKE | ขอถอนสิทธิ์ | 8 | หัวหน้างาน |
| SVC-CAT-004 | SOFTWARE_INSTALL | ขอติดตั้งโปรแกรม | 16 | หัวหน้างาน |
| SVC-CAT-005 | IT_EQUIPMENT | ขออุปกรณ์ IT | 24 | หัวหน้างาน |
| SVC-CAT-006 | EQUIPMENT_BORROW | ขอยืมอุปกรณ์ | 8 | หัวหน้างาน |
| SVC-CAT-007 | VPN_ACCESS | ขอ VPN | 8 | หัวหน้างาน |
| SVC-CAT-008 | STORAGE_QUOTA | ขอพื้นที่จัดเก็บข้อมูล | 16 | หัวหน้างาน |
| SVC-CAT-009 | FIREWALL_PORT | ขอเปิด Port | 16 | หัวหน้างาน |
| SVC-CAT-010 | EMAIL_ACCOUNT | ขอ Email | 16 | หัวหน้างาน |
| SVC-CAT-011 | SHARED_FOLDER | ขอ Shared Folder | 16 | หัวหน้างาน |
| SVC-CAT-012 | IT_CONSULT | ขอคำปรึกษา IT | 8 | ไม่ต้องอนุมัติ |

ค่าเริ่มต้นใช้ fulfillment group `IT Support`, Checklist 4 ขั้น (ขั้น “ทดสอบผลและแนบหลักฐาน” บังคับ evidence), close mode `ผู้ขอยืนยัน` และ Catalog status `ใช้งาน` IT Admin ต้องทบทวน SLA, form, eligibility, approver และ owner ให้ตรงกระบวนการจริงก่อนเปิด Production

### 7.2 จัดการ Catalog

Catalog status มี `ร่าง`, `ใช้งาน`, `ระงับ`, `ยกเลิก`

- ผู้ใช้ยื่นได้เฉพาะ Catalog สถานะใช้งานและผ่าน eligibility
- การแก้ Catalog เพิ่ม Version ทุกครั้ง; คำขอเดิมยังใช้ snapshot เดิม
- Catalog ที่ยกเลิกแก้/เปิดกลับไม่ได้
- ถ้ายังมีคำขอ non-terminal จะยกเลิก Catalog ไม่ได้ ให้ใช้สถานะระงับเพื่อหยุดรับคำขอใหม่
- Approval mode: ไม่ต้องอนุมัติ / หัวหน้างาน (`Users.Supervisor`) / ผู้อนุมัติที่กำหนด
- Close mode: ผู้ขอยืนยัน / IT ปิดงาน

Dynamic form รองรับ `text`, `textarea`, `number`, `date`, `datetime-local`, `select`, `checkbox`, `email`, `url` ไม่เกิน 40 ช่อง; `select` ต้องมี options และ URL ในคำตอบต้องเป็น HTTPS

Checklist รองรับไม่เกิน 50 งาน กำหนด owner group, assignee, required, evidence required และ SLA แยกรายการได้ งาน required ข้ามไม่ได้

`WorkflowJSON` รองรับรายการสถานะ, `states`, `allowedStatuses` และ `transitions` แบบ array/map ระบบ snapshot นิยามต่อคำขอและบังคับใช้ร่วมกับ transition table ฝั่ง Server: Catalog จำกัดเส้นทางให้แคบลงได้ แต่ขยายเกิน policy กลางไม่ได้ ส่วน `CloseCondition`, required checklist และ close mode ยังคงเป็นเงื่อนไขปิดงานบังคับ

### 7.3 Request lifecycle

```text
ยื่นคำขอ
  ├─ ต้องอนุมัติ → รออนุมัติ ─┬─ ปฏิเสธ
  │                            └─ อนุมัติ → รอมอบหมาย
  └─ ไม่ต้องอนุมัติ ─────────────────────→ รอมอบหมาย

รอมอบหมาย → กำลังดำเนินการ ↔ รอผู้ใช้งาน / รอผู้ให้บริการ
                                  │
                                  ├─ close mode: ผู้ขอยืนยัน → รอยืนยันผล
                                  │      ├─ ยืนยัน → ปิดงาน
                                  │      └─ ขอแก้ไข → กำลังดำเนินการ
                                  └─ close mode: IT ปิดงาน → ปิดงาน
```

ก่อนส่งมอบ/ปิดงาน:

- Checklist ที่บังคับต้องเสร็จทั้งหมด
- งานที่บังคับ evidence ต้องมี HTTPS link
- IT ต้องระบุผลการดำเนินการ
- ผู้รับผิดชอบรายบุคคลต้องเป็นบัญชี ITAdmin ที่ Active
- ขณะ `รอยืนยันผล` แก้ Checklist ไม่ได้ และการยืนยันปิดตรวจ required task ซ้ำภายใต้ ScriptLock

ไฟล์แนบคำขอ (ทั้ง required และ optional) ต้องมาจาก `uploadEvidence` ของผู้ใช้เดียวกันในโมดูล `serviceCatalog`, มี Audit claim สำเร็จ และยังอยู่ใน Drive เท่านั้น URL ภายนอกไม่ผ่าน validation; ไฟล์ที่ upload แล้ว submission ล้มก่อนมี Request อ้างอิงจะถูกย้ายเข้าถังขยะแบบ best effort เพื่อลด orphan

ผู้ขอหรือ ITAdmin ยกเลิกคำขอที่ยังไม่ terminal ได้เมื่อระบุเหตุผล ยกเว้นสถานะ `รอยืนยันผล`; รายการ `ปิดงาน`, `ปฏิเสธ`, `ยกเลิก` เปลี่ยนต่อไม่ได้

## 8. SLA, การแจ้งเตือน และความเป็นส่วนตัว

- `DueAt` คำนวณจาก `SLAHours` ด้วย business-hours helper ของระบบ
- Dashboard แสดงจำนวน Service Request เปิด รออนุมัติ และเกิน SLA ตามสิทธิ์ที่มองเห็น
- Notification center และ Calendar แสดงเฉพาะคำขอที่ผู้ใช้เกี่ยวข้อง; ITAdmin เห็นทุกคำขอ
- Daily LINE alert สำหรับ SLA ส่งเฉพาะ RequestID/ServiceCode ไม่ส่ง dynamic-form answers หรือข้อมูลส่วนบุคคล
- Retention ใช้ค่า `SERVICE_REQUEST_PII_RETENTION_DAYS` (ค่าเริ่มต้น 730 วัน) เพื่อลบตัวระบุผู้ขอ/ผู้ปฏิบัติงาน รายละเอียดฟอร์ม หมายเหตุ และลิงก์หลักฐานจากคำขอที่ปิดแล้ว โดยคงรหัส สถานะ และ SLA สำหรับสถิติ/Audit
- Retention anonymize Task/History ก่อนตั้ง sentinel ที่ parent เพื่อให้รอบถัดไป retry ได้หาก child update ล้มกลางทาง
- การแจ้งอนุมัติ/มอบหมาย/สถานะใช้ notification helper กลาง; ตรวจ Queue/Log เมื่อช่องทางปลายทางล้มเหลว
- `RequestDetailsJSON`, requester, approval, task evidence และ history เป็นข้อมูลภายใน ห้ามเปิดชีตหรือ export ให้ผู้ไม่มีหน้าที่
- Universal PDF sample ใช้ row-level scope เดียวกับโมดูล และ mask administrative/internal fields สำหรับผู้ที่ไม่ใช่ ITAdmin

## 9. Acceptance checklist

- [ ] Source version, Build ID, Schema และ package version ตรงหัวข้อ 1
- [ ] `setupSystem()` เพิ่มหกชีตโดยข้อมูลเดิมไม่เปลี่ยน
- [ ] `getAppBuildInfo()` ไม่พบ missing sheet/header
- [ ] Catalog ตั้งต้นมี 12 CatalogID ไม่ซ้ำ
- [ ] RBAC read/write ผ่านทั้ง UI และ direct API negative test
- [ ] CMDB reference, duplicate, cycle และ retirement guards ผ่าน
- [ ] Service approval, SoD, idempotent repair, trusted attachment, workflow constraint, checklist/evidence และ close mode ผ่าน
- [ ] Dashboard/Calendar/Notification แสดงข้อมูลตามสิทธิ์และไม่เปิดเผย form data ใน LINE alert
- [ ] Audit Trail มี CREATE/UPDATE/STATUS/VERIFY/APPROVE/ASSIGN/FULFILL/CONFIRM/CANCEL ตามเหตุการณ์ที่ทดสอบ
- [ ] `npm.cmd run validate` ผ่าน

รายละเอียดกรณีทดสอบอยู่ใน `docs/05_Test_Cases.md` หัวข้อ J และ K

## 10. Rollback

1. หาก UI/API มีปัญหา ให้สลับ Web App กลับไป Deployment version ก่อนหน้า
2. อย่าลบหกชีต v1.10 ระหว่าง rollback; code รุ่นก่อนจะไม่ใช้งานชีตเหล่านี้และการคงไว้ช่วยรักษาหลักฐาน
3. หากต้องย้อนข้อมูล ให้ restore snapshot ไป Sandbox ก่อน ตรวจ checksum/header แล้วจึงดำเนินการกับ Production ตาม change approval
4. เก็บ AuditTrail, deployment/version ID, ผู้อนุมัติ เหตุผล และเวลาที่ rollback
5. แก้สาเหตุในสำเนา ทดสอบหัวข้อ J/K และ validator ก่อน deploy v1.10 ใหม่

การเปลี่ยน `APP_SCHEMA_VERSION` ลงเองไม่ใช่ data rollback และห้ามใช้แทนการ restore ที่ตรวจสอบแล้ว
