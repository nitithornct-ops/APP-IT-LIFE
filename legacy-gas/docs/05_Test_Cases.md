# 5. ข้อเสนอแนะการทดสอบ (Test Cases)

ครอบคลุม: Authentication/RBAC (รอบ 1), Workflow อนุมัติสิทธิ์ (รอบ 2), Workflow แจ้งเหตุการณ์ (รอบ 2), ระบบแจ้งเตือนอัตโนมัติ (รอบ 1/3), Task ส่วนตัว (รอบ 7)

## A. การยืนยันตัวตนและสิทธิ์ (พร้อมทดสอบในรอบ 1)

| # | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| A1 | ผู้ใช้ที่ไม่อยู่ในทะเบียน | เปิด Web App ด้วยบัญชี Google ใดก็ได้ (รวม Gmail) ที่ยังไม่เพิ่มใน Users | AccessDenied "ไม่พบบัญชีในทะเบียน" (ไม่จำกัดโดเมนแล้ว) |
| A2 | ผู้ใช้ทุกโดเมนที่อยู่ในทะเบียน | เพิ่มอีเมล (โดเมนใดก็ได้) ใน Users สถานะ Active แล้วเปิด | เข้าระบบได้ เห็นเมนูตามบทบาท |
| A3 | ผู้ใช้ถูกระงับ | ตั้ง Status = Inactive แล้วเปิด | AccessDenied "บัญชีถูกระงับ" |
| A4 | เมนูตามบทบาท | เข้าด้วย Role = User | เห็น Task / งานของฉัน และเมนูที่เปิดให้ User; ไม่เห็นเมนู IT Admin |
| A5 | Executive read-only | เข้าด้วย Executive | เห็นเมนูพร้อม badge "อ่านอย่างเดียว" ในโมดูลที่กำหนด |
| A6 | บายพาสฝั่ง Server | ผู้ใช้ Role=User เรียก `getDashboardData` ของโมดูลที่ไม่มีสิทธิ์ผ่าน console | คืน `{ok:false, error:"ไม่มีสิทธิ์..."}` + บันทึก ACCESS_DENIED ใน AuditTrail |
| A7 | Audit log การเปิดแอป | เปิดแอปสำเร็จ | มีแถว OPEN_APP ใน AuditTrail (Actor/เวลา ถูกต้อง) |
| A8 | API allowlist | หลังล็อกอินหลังบ้านแล้วลองเรียก `api(token, 'appendRow', [])` หรือ helper ที่ไม่อยู่ใน allowlist | คืน error ไม่อนุญาต/ไม่พบฟังก์ชัน และไม่เกิดการเขียน Sheet |
| A9 | Helper private | เรียก `google.script.run.appendRow(...)`, `getConfig(...)`, `writeAudit(...)` จาก console | เรียกไม่ได้เพราะไม่มี public function ชื่อดังกล่าว |
| A10 | Login throttle | ใส่รหัสผ่านผิดเกินค่า `LOGIN_MAX_FAILS_5MIN` ภายใน 5 นาที | ระบบพักการล็อกอินชั่วคราวและแจ้งให้ลองใหม่ภายหลัง โดยข้อความไม่เปิดเผยว่าบัญชีมีอยู่หรือไม่ |

## B. Workflow อนุมัติสิทธิ์ (รอบ 2)

| # | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| B1 | ยื่นคำขอครบถ้วน | User กรอกฟอร์มขอสิทธิ์ (ระบบ/ระดับ/เหตุผล) → ส่ง | สร้างแถวใน AccessRequests สถานะ "รออนุมัติ", route ไปหัวหน้าตาม Supervisor, ส่งอีเมลแจ้ง Approver |
| B2 | ฟอร์มไม่ครบ | เว้นช่อง "ระบบงาน" | ฝั่ง Server คืน error "กรุณากรอกข้อมูลให้ครบถ้วน: SystemName" ไม่บันทึก |
| B3 | หัวหน้าอนุมัติ | Approver กดอนุมัติ | สถานะ → "รอ IT ดำเนินการ", ส่งอีเมลแจ้ง IT Admin, บันทึก Audit APPROVE |
| B4 | หัวหน้าปฏิเสธ | Approver กดปฏิเสธ + เหตุผล | สถานะ → "ปฏิเสธ", แจ้งผู้ยื่น, ไม่สร้างสิทธิ์ |
| B5 | IT ดำเนินการ | IT Admin กด "ดำเนินการแล้ว" | สถานะ → "เสร็จสิ้น", เพิ่มแถวใน UserAccessRegistry + ตั้ง NextReviewDue |
| B6 | สิทธิ์ผู้อื่น | Approver A พยายามอนุมัติคำขอข้ามหน่วยงาน | ปฏิเสธฝั่ง Server (ไม่ใช่ผู้อนุมัติที่ถูก route) |
| B7 | พ้นสภาพพนักงาน | ตั้ง User Status=Inactive | งานประจำเปลี่ยนสิทธิ์ใน UserAccessRegistry เป็น Suspended + แจ้ง IT |
| B8 | Concurrency | สองคนอนุมัติคำขอเดียวกันพร้อมกัน | LockService กันชนกัน — อัปเดตสำเร็จครั้งเดียว ไม่เกิดข้อมูลซ้อน |

## B2. Workflow Help Desk / Ticket → Incident

| # | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| T1 | เปิด Ticket ทั่วไป | User กรอกหัวข้อ/หมวด/รายละเอียด → ส่ง | สร้างแถวใน `Tickets` สถานะ `เปิดใหม่`, ตั้ง `DueAt` ตาม SLA, แจ้ง IT Admin |
| T2 | คัดแยกและมอบหมาย | Approver หรือ IT Admin กดคัดแยก → เลือก priority/ผู้รับผิดชอบ | Ticket เปลี่ยนเป็น `คัดแยกแล้ว` หรือ `มอบหมายแล้ว`, บันทึก Audit, แจ้งผู้รับผิดชอบถ้าเป็นอีเมล |
| T3 | ปิด Ticket | IT Admin บันทึกผลการแก้ไขแล้วกดปิดงาน | Ticket เปลี่ยนเป็น `ปิดงาน`, มี `Resolution/CloseDate`, แจ้งผู้แจ้ง |
| T4 | ยกระดับเป็น Incident | Approver หรือ IT Admin กด “ยกระดับ Incident” จาก Ticket ที่เข้าข่ายภัยคุกคาม | สร้างแถวใน `Incidents`, ตั้ง `SourceTicketID`, อัปเดต Ticket เป็น `ยกระดับเป็น Incident`, บันทึก Audit ทั้งสองฝั่ง |
| T5 | ส่งต่อ Outsource | IT Admin กด “ส่งต่อ Outsource” → เลือก Vendor หรือกรอกชื่อเอง → ระบุ/ให้ระบบสร้างเลขแจ้งปัญหา | Ticket เปลี่ยนเป็น `ส่งต่อ Outsource`, เก็บชื่อ/เลขอ้างอิง/วันที่ส่งต่อ และเพิ่ม Worklog + Audit |
| T6 | ลบ Ticket | IT Admin กดปุ่มถังขยะและยืนยัน | Ticket ถูก soft-delete ออกจากรายการปกติ, มี Audit และกู้คืนได้จากหน้า Settings; บทบาทอื่นไม่มีปุ่มและเรียกคำสั่งลบ Ticket ไม่ได้ |
| T5 | เคสข้อมูลส่วนบุคคลจาก Ticket | ยกระดับโดยเลือกข้อมูลส่วนบุคคล = Yes | Incident มี `DPONotifyDeadline` ตามกรอบภายใน `INCIDENT_DPO_ESCALATION_HOURS` และส่ง DPO/IT คัดกรอง |
| T6 | Dashboard/SLA | ตั้ง Ticket ให้ `DueAt` เลยเวลาแล้วเปิด Dashboard | KPI `Ticket เกิน SLA` เพิ่มขึ้น และรายการใกล้/เลยกำหนดแสดง Ticket นั้น |
| T7 | Public honeypot | ส่งหน้าแจ้งซ่อมโดยมีค่าในช่องซ่อน `website` | Server ปฏิเสธว่าไม่สามารถส่งรายการได้ |
| T8 | Public rate limit | ส่ง Ticket ด้วยอีเมลเดิมเกิน `PUBLIC_TICKET_MAX_PER_HOUR` หรือ `PUBLIC_TICKET_MAX_PER_DAY` | Server ปฏิเสธและไม่สร้าง Ticket เพิ่ม |
| T9 | Public shared code | ตั้ง `PUBLIC_TICKET_SHARED_CODE` แล้วส่ง Ticket โดยไม่กรอกรหัสหรือกรอกรหัสผิด | Server ปฏิเสธ; เมื่อกรอกรหัสถูกจึงส่งได้ |
| T10 | File limit | แนบไฟล์เกิน `PUBLIC_TICKET_MAX_FILES` หรือไฟล์ใหญ่กว่า `PUBLIC_TICKET_MAX_FILE_MB` | Client เตือนก่อนส่ง และ Server ยังตรวจซ้ำไม่ให้บันทึก |
| T11 | LINE-only anti-abuse | ตั้ง `PUBLIC_TICKET_REQUIRE_LINE=true` แล้วส่งผ่าน anonymous form | Server ปฏิเสธ; เมื่อ LINE Login สำเร็จจึงส่งได้ |
| T12 | Public KB write limit | เปิดบทความเดิมซ้ำเกิน 3 ครั้งต่อชั่วโมงจาก client เดิม | Server ไม่นับยอดเพิ่มเกิน rate limit |

## C. Workflow แจ้งเหตุการณ์ (รอบ 2)

| # | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| C1 | แจ้งเหตุทั่วไป | User กรอกฟอร์มแจ้งเหตุ (หัวข้อ/รายละเอียด/ระบบ) | สร้าง Incident สถานะ "เปิด", แจ้ง IT Admin |
| C2 | จำแนกความรุนแรง | IT Admin ตั้ง Severity = วิกฤต | บันทึก + แสดงเด่นใน Dashboard |
| C3 | เคสข้อมูลส่วนบุคคล | ตั้ง ContainsPersonalData = Yes | ระบบคำนวณ `DPONotifyDeadline` จากกรอบภายใน (ค่าเริ่มต้น 4 ชม.) และส่ง DPO คัดกรอง |
| C4 | ใกล้ครบกรอบคัดกรอง DPO | ยังไม่แจ้ง DPO และเวลาใกล้ครบ | KPI “เหตุข้อมูลส่วนบุคคลรอ DPO” เพิ่มขึ้นและแจ้งเตือน DPO/IT |
| C5 | มอบหมาย/ปิดเคส | IT Admin มอบหมาย Assignee → ปิดเคสพร้อม RootCause/บทเรียน | สถานะ "ปิดเคส", CloseDate ถูกตั้ง, ออกจากรายการเปิด |
| C6 | สิทธิ์ DPO | DPO เปิดระบบ | เห็นเฉพาะ Incident ที่ ContainsPersonalData=Yes |
| C7 | Validation | ส่งฟอร์มที่มี `<script>` ในรายละเอียด | บันทึกแบบ escape, แสดงผลเป็นข้อความ ไม่ทำงานเป็นสคริปต์ (กัน XSS) |

## D. ระบบแจ้งเตือนอัตโนมัติ (รอบ 1/3)

| # | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| D1 | License ใกล้หมด | ตั้ง AssetRegister มี LicenseExpiry อีก 15 วัน, NOTIFY_LEAD_DAYS=30 → รัน `runNotificationCheckNow` จากหน้า Settings หรือรัน `dailyNotificationCheck` จาก editor | อีเมลถึง IT Admin มีรายการนี้ + บันทึก NotificationLog (Result=success) |
| D2 | ยังไม่ถึงกำหนด | LicenseExpiry อีก 90 วัน | ไม่อยู่ในอีเมลแจ้งเตือน |
| D3 | เลยกำหนดทบทวนสิทธิ์ | UserAccessRegistry NextReviewDue เมื่อวาน | อีเมลระบุ "เลยกำหนด N วัน" |
| D4 | สัญญา Vendor ใกล้หมด | ContractExpiry อีก 20 วัน | อยู่ในอีเมลแจ้งเตือน |
| D5 | ทดสอบช่องทาง | รัน `testNotification` (ในฐานะ IT Admin) | ได้รับอีเมล (และ LINE ถ้าเปิด) + NotificationLog 1-2 แถว |
| D6 | LINE ปิดอยู่ | NOTIFY_LINE_ENABLED=false | ไม่พยายามส่ง LINE, ส่งเฉพาะอีเมล |
| D7 | LINE token ผิด | NOTIFY_LINE_ENABLED=true แต่ token ว่าง | NotificationLog Result=fail + ErrorMsg อธิบาย ไม่ทำให้งานล้มทั้งชุด |
| D8 | สิทธิ์ทดสอบ | ผู้ใช้ที่ไม่ใช่ IT Admin เรียก `testNotification` | ปฏิเสธ "ไม่มีสิทธิ์แก้ไขโมดูลนี้" |
| D9 | Trigger รายวัน | รัน `ensureDailyTrigger` แล้วเปิดหน้า Triggers | เห็น handler `dailyNotificationCheck_` เวลา 07:00 และไม่มี trigger ซ้ำชื่อเดิม |

## E. ทะเบียนและ workflow รอบ 4

| # | สถานการณ์ | ผลที่คาดหวัง |
|---|---|---|
| E1 | ขอทำลายข้อมูล "ลับมาก" | คำขอถูก route ไป Executive; IT Admin **อนุมัติไม่ได้** (ปฏิเสธฝั่ง Server) |
| E2 | ขอทำลายข้อมูล "ลับ/ไม่ลับ" | route ไป IT Admin อนุมัติได้ |
| E3 | ยืนยันทำลายข้อมูล | เฉพาะคำขอสถานะ "อนุมัติแล้ว" จึงยืนยันได้; ชุดข้อมูลเปลี่ยนเป็น "ทำลายแล้ว" |
| E4 | Change ยังไม่ผ่านทดสอบ | กด "อนุมัติ" ไม่ได้ (ต้อง sign-off test ก่อน); ติดตั้งได้เฉพาะหลังอนุมัติ |
| E5 | e-sign นโยบายซ้ำ | ลงชื่อเวอร์ชันเดิมซ้ำ → error "ลงชื่อรับทราบแล้ว" |
| E6 | e-sign ไม่ติ๊ก checkbox | error "กรุณาทำเครื่องหมายยืนยัน" |
| E7 | บันทึกผู้เข้าอบรม + แนบไฟล์ | ไฟล์ขึ้น Drive (awareness/ปี) และลิงก์เก็บใน TrainingRecords |

## F. Audit Evidence + Audit Trail (รอบ 5)

| # | สถานการณ์ | ผลที่คาดหวัง |
|---|---|---|
| F1 | เปิด Evidence Center | แสดงสุขภาพมาตรการควบคุมรวม + รายด้าน และมีคำเตือนว่าไม่ใช่ Legal Compliance |
| F2 | Export PDF | สร้างไฟล์ PDF ใน Drive (ISMS_Evidence/รายงาน) + เปิดได้ + บันทึก EXPORT_PDF ใน AuditTrail |
| F3 | Export CSV | ดาวน์โหลดไฟล์ .csv เปิดใน Excel ภาษาไทยอ่านได้ (มี BOM) |
| F4 | สิทธิ์ Evidence | User/Approver เรียก `getEvidenceData` → ปฏิเสธ "ไม่มีสิทธิ์" |
| F5 | Audit Trail กรอง | กรองตามช่วงวันที่/ผู้กระทำ/การกระทำ → ได้ผลถูกต้อง |
| F6 | AuditTrail แก้ไม่ได้ | ผู้ใช้เปิด Sheet AuditTrail ตรง (ถ้าเข้าถึงได้) → แก้ไขไม่ได้ (protected) |
| F7 | ตั้งค่า Notification | IT Admin เปิด LINE + เปลี่ยน lead days → token อยู่ใน Script Properties ส่วน lead days อยู่ใน Settings |
| F8 | เปิดโมดูล Tester แล้วรัน QA Smoke Checks | เห็น API surface, Database, Daily trigger, Admin password, Public helpdesk และ Notification secrets เป็น PASS/WARN/FAIL พร้อมรายละเอียด |
| F9 | เปิดโมดูล Tester / QA หลัง Deploy New version | การ์ด Go-live / Release Checklist แสดง Build/Schema, Live health, Trigger, LINE, Backup, Retention, Privacy และ Script Properties capacity พร้อมสถานะ PASS/WARN/FAIL |

## F2. Legal Compliance Governance

| # | สถานการณ์ | ผลที่คาดหวัง |
|---|---|---|
| LC1 | รัน `setupSystem()` หลังอัปเดต | ได้ LegalRegister, ComplianceObligations, ComplianceAssessments, CorrectiveActions และ RegulatoryNotifications โดยไม่ลบข้อมูลเดิม |
| LC2 | เปิดกฎหมายสถานะ `ต้องยืนยัน` | แสดงป้ายเตือนและไม่นำไปอ้างว่าเป็นข้อบังคับที่ยืนยันแล้ว |
| LC3 | ประเมินข้อกำหนด | เก็บผู้ประเมิน วันที่ ผล หลักฐาน ช่องว่าง และ AuditTrail |
| LC4 | เปิด CAPA จากผลไม่สอดคล้อง | เชื่อม ObligationID/AssessmentID และติดตาม Owner/Priority/DueDate/Status ได้ |
| LC5 | ประเมิน Incident | แยกผลแจ้ง สคส., เจ้าของข้อมูล, สกมช. และหน่วยงานกำกับอื่น |
| LC6 | บันทึก `ไม่ต้องแจ้ง` โดยไม่ใส่เหตุผล | Server ปฏิเสธรายการ |
| LC7 | บันทึกแจ้งแล้ว | แสดงวันแจ้ง เลขรับเรื่อง ผู้อนุมัติ และลิงก์หลักฐานในแท็บหน่วยงานกำกับ |
| LC8 | ทดสอบสิทธิ์ | ITAdmin/DPO แก้ไขได้; Executive/Approver อ่านอย่างเดียว; User ไม่มีเมนู |

## G) Production Hardening v1.7

| ID | กรณีทดสอบ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| G1 | LINE retry | ใช้ target ที่ไม่ถูกต้องให้ส่งล้มเหลว แล้วแก้ target และกดประมวลผลคิว | คิวเปลี่ยน PENDING/RETRY → SENT และมี LINE-RETRY log |
| G2 | Dead letter | ให้ LINE ล้มเหลวครบจำนวน `LINE_QUEUE_MAX_ATTEMPTS` | คิวเป็น DEAD และ Live health เป็น FAIL |
| G3 | Snapshot อัตโนมัติ | รัน `scheduledSystemBackup_()` จาก Editor | ได้ Snapshot + checksum ตรง + BackupLog |
| G4 | Restore drill | รัน `monthlyRestoreDrill_()` | ได้ Sandbox แยกจาก Production และ RecoveryTests มี RTO/RPO |
| G5 | Retention Preview | Backup → Automation/Retention → Preview | RetentionLog เป็น PREVIEW และข้อมูลจริงไม่เปลี่ยน |
| G6 | Retention Enforce | ใช้ข้อมูลทดสอบที่พ้นอายุแล้วกด Enforce | ลบ/anonymize ตาม Policy และมี Audit/RetentionLog |
| G7 | LEAVER | เริ่ม LEAVER กับพนักงานที่มีบัญชี สิทธิ์ LINE และ Asset | บัญชี/สิทธิ์/LINE ถูกระงับ และปิด checklist ไม่ได้จนคืน Asset |
| G8 | Business-hours SLA | เปิด Ticket ก่อนหมดเวลาทำการและกำหนด SLA ข้ามเสาร์อาทิตย์ | DueAt เลื่อนไปวันทำการถัดไปตามชั่วโมงที่เหลือ |
| G9 | Live deployment | Tester → ตรวจ Deployment จริง | Public Web App, Schema, Trigger, LINE, Snapshot, Dead letter แสดง PASS/FAIL พร้อมสาเหตุ |
| G10 | Privacy consent public/LINE | เปิดหน้าแจ้งซ่อมสาธารณะ แล้วลองส่ง Ticket โดยไม่ติ๊ก consent จากนั้นติ๊กแล้วส่งใหม่ | ครั้งแรกถูกปฏิเสธทั้ง client/server; ครั้งที่สองสร้าง Ticket และบันทึกเวอร์ชัน consent ใน Ticket/Worklog |

## วิธีรันทดสอบเร็ว (รอบ 1)
1. รัน `setupSystem` → ตรวจว่าสร้างครบทุก Sheet + AuditTrail ถูกป้องกัน
2. เพิ่มผู้ใช้ทดลองหลายบทบาทใน Sheet `Users`
3. ตั้งรหัสผ่านผู้ดูแลด้วย `bootstrapFirstAdmin` หรือ `ADMIN_INIT_PASSWORD` + `setupAdminLogin`
4. ใส่ข้อมูลตัวอย่างใน AssetRegister/VendorRegister (วันหมดอายุใกล้ๆ) แล้วรัน `runNotificationCheckNow`
5. เปิดหน้า public ticket ส่งงานทดสอบ 1 รายการ แล้วติดตามด้วย Ticket ID + token
6. เปิด Web App หลังบ้านด้วยแต่ละบทบาท ตรวจเมนู Dashboard และ smoke check ใน Tester

## G. Task / งานของฉัน (รอบ 7)

| # | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| G1 | เพิ่มงาน | เปิด Task → เพิ่มชื่องาน/ความสำคัญ/วันครบกำหนด | สร้างแถวใน `PersonalTasks` โดย `OwnerEmail` เป็นอีเมลใน session และแสดงในรายการทันที |
| G2 | แยกข้อมูลตามเจ้าของ | สร้างงานด้วยผู้ใช้ A แล้วเข้าสู่ระบบด้วยผู้ใช้ B หรือ IT Admin คนอื่น | ไม่เห็นและไม่สามารถแก้ไขงานของ A; เรียก `updateTask` ด้วย TaskID ของ A แล้ว Server ปฏิเสธ |
| G3 | เปลี่ยนสถานะเร็ว | กด เริ่ม → เสร็จ | สถานะเป็น `กำลังทำ` แล้ว `เสร็จแล้ว`, Progress เป็น 100 และมี CompletedAt |
| G4 | เปิดงานใหม่ | กด เปิดใหม่จากงานที่เสร็จแล้ว | สถานะกลับเป็น `ต้องทำ`, Progress เป็น 0 และล้าง CompletedAt |
| G5 | ยกเลิกแทนลบถาวร | กดยกเลิกงานและยืนยัน | สถานะเป็น `ยกเลิก`, รายการยังค้นหา/กรองและตรวจ Audit Trail ได้ |
| G6 | วันครบกำหนดผิด | กำหนด DueDate ก่อน StartDate หรือ Progress เกิน 100 | Server ปฏิเสธและไม่บันทึกข้อมูลผิด |
| G7 | Kanban | ลากงานข้ามคอลัมน์ ต้องทำ → กำลังทำ → เสร็จแล้ว | สถานะและลำดับถูกบันทึก โหลดหน้าใหม่แล้วยังอยู่ตำแหน่งใหม่ |
| G8 | งานซ้ำ | ตั้งรายสัปดาห์และปิดงาน | สร้างรอบถัดไปหนึ่งรายการเท่านั้น และไม่เกิน RecurrenceEndDate |
| G9 | Checklist | เพิ่มและติ๊กรายการย่อย | แสดงจำนวนเสร็จ/ทั้งหมดบน Kanban และผู้ใช้อื่นเข้าถึงไม่ได้ |
| G10 | Task LINE reminder | รัน dailyNotificationCheck_ กับงานครบกำหนดภายใน 1 วัน | ส่งเข้าคิว LINE รายบุคคลหรือค่า default และไม่ส่งซ้ำในวันเดียวกัน |
| G7 | แจ้งเตือนงานส่วนตัว | ตั้งงานครบวันนี้หรือเลยกำหนด แล้วรีเฟรชกระดิ่ง | เห็น Task ของผู้ใช้ปัจจุบันในกระดิ่งและ badge นับงานวันนี้/เลยกำหนด โดยไม่แสดงงานของผู้อื่น |

## H. Privacy / PDPA v1.8

| ID | กรณีทดสอบ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| H1 | Additive migration | สำรองฐานข้อมูล แล้วรัน `setupSystem()` บนฐานเดิม | เพิ่ม 3 Privacy sheets, คอลัมน์เดิม/ข้อมูลเดิมไม่เปลี่ยน และ schema version เป็น 10 |
| H2 | RBAC แก้ไข | เข้าเมนูด้วย ITAdmin, DPO, Executive และ User | ITAdmin/DPO บันทึกได้; Executive อ่านอย่างเดียว; User ไม่มีเมนูและเรียก API แล้วถูกปฏิเสธ |
| H3 | RoPA validation | บันทึกโดยไม่ใส่ Purpose/Lawful basis แล้วบันทึกใหม่ให้ครบ | ครั้งแรก Server ปฏิเสธ; ครั้งที่สองสร้าง ROPA ID และ Audit Trail |
| H4 | DPIA tracking | สร้าง RoPA ที่ DPIARequired=Yes และสถานะรอดำเนินการ | KPI DPIA ค้างเพิ่ม และวันทบทวนเกินกำหนดแสดงสถานะเตือน |
| H5 | Consent evidence | บันทึก consent พร้อม Notice version/HTTPS evidence จากนั้นบันทึก withdrawal | ได้หลักฐานสองเหตุการณ์ตรวจย้อนหลังได้; URL ที่ไม่ใช่ HTTPS ถูกปฏิเสธ |
| H6 | DSR SLA | รับคำขอโดยเว้น DueDate | ระบบคำนวณ DueDate จาก `PRIVACY_DSR_SLA_DAYS` (ค่าเริ่มต้น 30 วัน) |
| H7 | Identity verification | อัปเดต DSR เป็นกำลังดำเนินการและเลือกยืนยันตัวตนแล้ว | บันทึก `IdentityVerifiedAt`, Owner, Decision และ Audit Trail |
| H8 | DSR closure | ปิดเป็นเสร็จสิ้น/ปฏิเสธพร้อมผลและ HTTPS evidence | บันทึก `CompletedAt`; เคสไม่อยู่ใน KPI งานเปิด |
| H9 | Separation from public data | เปิดหน้า public helpdesk แล้วลองเรียก Privacy API โดยตรง | ไม่อ่าน/เขียน Privacy sheets และไม่เปิดเผยข้อมูลเจ้าของข้อมูล |
| H10 | Regression | รัน `npm run validate` และตรวจ Ticket/Incident/Data Classification | Validator ผ่าน และโมดูลเดิมยังโหลด/บันทึกได้ |

## I. Assurance Operations v1.9

| ID | กรณีทดสอบ | ผลที่คาดหวัง |
|---|---|---|
| I1 | รัน `setupSystem()` บนสำเนาฐานเดิม | เพิ่ม 5 ชีต, Schema=11 และข้อมูลเดิมไม่เปลี่ยน |
| I2 | สร้าง Problem อ้างอิง Ticket/Incident แล้วสร้าง Known Error | มี PRB/KEDB ID, workaround และ KB reference พร้อม Audit Trail |
| I3 | บันทึก CVSS นอกช่วง 0-10 | Server ปฏิเสธและไม่เขียนข้อมูล |
| I4 | ปิด Vulnerability ด้วยบัญชี Owner | Server ปฏิเสธ independent verification |
| I5 | ปิด Vulnerability ด้วย ITAdmin คนอื่น | บันทึก VerifiedAt/VerifiedBy และหลักฐาน HTTPS |
| I6 | สร้าง Audit และ Finding ที่อ้าง Audit ID ไม่มีจริง | Server ปฏิเสธ |
| I7 | Owner ของ Audit Finding พยายามตรวจยืนยันปิดเอง | Server ปฏิเสธและบันทึกไม่สำเร็จ |
| I8 | Verifier คนอื่นปิด Finding | บันทึก CompletedAt, VerifiedAt, VerifiedBy และ Audit Trail |
| I9 | Executive/DPO เปิดเมนูตาม permission matrix | อ่านข้อมูลที่อนุญาตได้แต่ไม่มีปุ่มแก้ไข |
| I10 | รัน `npm run validate` | Syntax, schema, allowlist, renderer และ server guards ผ่านทั้งหมด |

## J. CMDB / Relationship Map v1.10

| ID | กรณีทดสอบ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| J1 | Additive migration | สำรองฐานเดิม แล้วรัน `setupSystem()` | เพิ่ม `ConfigurationItems` และ `CIRelationships`, ข้อมูล/คอลัมน์เดิมไม่เปลี่ยน และ Schema=12 |
| J2 | RBAC | เปิด CMDB ด้วย User, Approver, ITAdmin, Executive และ DPO | User ไม่มีสิทธิ์; ITAdmin แก้ไขได้; Approver/Executive/DPO อ่านได้แต่ไม่มีการแก้ไข และ API เขียนถูกปฏิเสธฝั่ง Server |
| J3 | CI required fields | เว้นชื่อ/type/environment/owner/administrator/criticality/data classification/backup required | Server ปฏิเสธและไม่สร้าง CI |
| J4 | Production critical CI | สร้าง Active Production CI ระดับ High/Critical โดยไม่ระบุ RPO/RTO แล้วส่งใหม่ให้ครบ | ครั้งแรกถูกปฏิเสธ; ครั้งที่สองสร้าง CI ได้ |
| J5 | Backup/reference integrity | ตั้ง BackupRequired=Yes แต่ไม่ระบุ reference หรืออ้าง Asset/Cloud/Vendor/Contract/Backup ที่ไม่มีจริง | Server ปฏิเสธ; Contract ต้องอยู่ใต้ Vendor ที่เลือก และ Backup ต้องเป็น Backup record หรือ CI ประเภท Backup Job |
| J6 | CI uniqueness/format | ใช้ชื่อ+Environment ซ้ำ, ผูก Asset/Cloud เดียวกับหลาย CI, ใส่ IP/CIDR หรือ URL ผิดรูปแบบ | Server ปฏิเสธรายการผิด; IPv4/IPv6/CIDR และ http/https ที่ถูกต้องบันทึกได้ |
| J7 | Typed relationship | เชื่อม CI กับ Vendor/Contract/Backup/Incident/Change ด้วย relationship type ที่ตรงความหมาย | สร้าง REL ID, เก็บชื่อปลายทางและแสดงในตาราง/แผนผัง; target type ผิด semantics ถูกปฏิเสธ |
| J8 | Self-link/duplicate/date guard | สร้าง self-link, ความสัมพันธ์ซ้ำ/กลับทิศแบบ symmetric, ValidUntil ก่อน ValidFrom หรือวันที่ไม่มีจริง เช่น `2026-02-30` | Server ปฏิเสธทั้งหมดและไม่เขียนแถวซ้ำ |
| J9 | Dependency cycle | สร้าง A DEPENDS_ON B, B DEPENDS_ON C แล้ว C DEPENDS_ON A | รายการสุดท้ายถูกปฏิเสธว่าเกิด dependency cycle |
| J10 | Retirement guard | Retire CI ที่ยังมี relationship Active; ลองสร้าง/เปิด Active relationship ไปยัง CI/Asset ที่ Retired/Inactive; จากนั้น Inactive ความสัมพันธ์และ Retire ใหม่ | Server ปฏิเสธทั้งการ retire ที่ยังมีเส้น Active และ Active edge ไป endpoint ที่เลิกใช้; หลังยกเลิกความสัมพันธ์จึง Retire ได้ และ Degraded/Retired ต้องมีเหตุผล |
| J11 | Verification | กดตรวจยืนยัน CI/relationship แล้วแก้ข้อมูลภายหลัง | บันทึก LastVerifiedAt/By; การแก้ไขข้อมูลทำให้ต้องตรวจยืนยันใหม่ และทุกเหตุการณ์มี Audit Trail |
| J12 | Relationship Map | เลือก node ในแผนผังและ Quality view | แสดง node ใกล้เคียงไม่เกิน 2 ระดับ, มี adjacency table สำหรับการเข้าถึง และ KPI orphan/unverified สอดคล้องกับข้อมูล |

## K. Service Catalog / Request Fulfilment v1.10

| ID | กรณีทดสอบ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| K1 | Seed แบบ idempotent | รัน `setupSystem()` สองครั้ง | มี Catalog ตั้งต้น 12 รายการเพียงชุดเดียว และข้อมูล Catalog ที่แก้ไว้ไม่ถูกเขียนทับ |
| K2 | RBAC แยกหน้าที่ | เปิดด้วยทุก role และลองเรียก API จัดการ Catalog/มอบหมาย/Checklist | ทุก role ยื่นและดูคำขอที่ตนเกี่ยวข้องได้; เฉพาะ ITAdmin จัดการ Catalog/fulfilment; เฉพาะบัญชีที่ถูกกำหนดเป็น Approver ของคำขออนุมัติได้ |
| K3 | Catalog lifecycle/version | สร้างร่าง → ใช้งาน → ระงับ; แก้ Catalog; ลองเปิดรายการยกเลิกกลับ | PublishedAt ถูกตั้งเมื่อใช้งานครั้งแรก, ทุกการแก้เพิ่ม Version, รายการยกเลิกเปิดกลับ/แก้ไม่ได้ และยกเลิก Catalog ที่มีคำขอค้างไม่ได้ |
| K4 | Dynamic form validation | กำหนด field text/select/number/date/email/url/checkbox แล้วส่งค่าขาด/ผิด options/URL ไม่ใช่ HTTPS/วันที่ไม่มีจริง เช่น `2026-02-30` | Server ตรวจ schema และคำตอบแบบ strict; รายการผิดถูกปฏิเสธโดยไม่เชื่อ input ฝั่ง client |
| K5 | Eligibility/attachment | ใช้ role/department/email ที่ไม่ผ่าน, Eligibility JSON ใช้ key ผิด, ไม่แนบไฟล์เมื่อบังคับ หรือส่ง raw HTTPS/Drive URL แทน Registry ID | ยื่นไม่ได้และมี Audit denied; v1.11 รับ attachment ที่อัปโหลดผ่าน Registry, เป็นของผู้ขอ, ยัง claim ได้ และซ่อมเป็น exact active link หลัง durable source write |
| K6 | Approval routing/SoD | ทดสอบ ไม่ต้องอนุมัติ, หัวหน้างาน และผู้อนุมัติที่กำหนด; ให้ผู้ขออนุมัติตนเอง | route ไป Workflow กลาง/สถานะ/ผู้อนุมัติถูกต้อง; exact assignee ต้องเป็นบัญชี Active มี `workflow.approve` และผู้ขออนุมัติตนเองไม่ได้ |
| K7 | Idempotency | ส่ง payload เดิมซ้ำด้วย RequesterEmail+IdempotencyKey เดิม และจำลองครั้งแรกหยุดหลังสร้าง parent/Checklist บางส่วน | คืน RequestID เดิมพร้อม `duplicate=true`, ซ่อม Task/CREATE_REQUEST history ที่ขาดจาก snapshot และไม่สร้างคำขอ/Checklist ซ้ำ |
| K8 | Catalog snapshot | ยื่นคำขอ แล้วแก้ Form/Workflow/Checklist ของ Catalog | คำขอเดิมคง CatalogVersion, WorkflowJSON และ ChecklistSnapshotJSON เดิม; คำขอใหม่ใช้ version ใหม่ |
| K9 | Assignment | มอบหมายก่อนอนุมัติ หรือมอบหมายให้บัญชีที่ไม่ใช่ ITAdmin Active | Server ปฏิเสธ; หลังอนุมัติสามารถมอบหมายกลุ่ม/ITAdmin และสถานะเป็นกำลังดำเนินการ |
| K10 | Required checklist/evidence | ข้ามงานบังคับ, ปิดงานก่อน Checklist ครบ, ปิด task ที่ต้องมีหลักฐานโดยไม่มี Registry ID/exact active evidence link หรือเปิด task กลับขณะ `รอยืนยันผล` | Server ปฏิเสธ; seed ขั้น “ทดสอบผลและแนบหลักฐาน” บังคับ Registry evidence ที่ field/role ตรงและ Drive file ยังอยู่ และยืนยันปิดจะตรวจ required task ซ้ำภายใต้ lock |
| K11 | Status transition | ทดลองข้ามจากรอมอบหมายไปปิดงาน, เปลี่ยนจาก terminal status หรือกำหนด WorkflowJSON ให้ตัด transition บางเส้น | Server transition table ปฏิเสธเส้นทางผิด; Workflow snapshot จำกัดเส้นทางได้แต่ขยายเกิน policy กลางไม่ได้ |
| K12 | Close mode | ทดสอบบริการแบบผู้ขอยืนยันและแบบ IT ปิดงาน | แบบแรกไป `รอยืนยันผล`; ผู้ขอยืนยันแล้วปิด หรือส่งกลับแก้ไขได้; แบบหลัง IT ปิดตรงเมื่อผล/Checklist ครบ |
| K13 | Cancel/visibility | ผู้ขออื่นพยายามดู/ยกเลิกคำขอ และเจ้าของยกเลิกพร้อมเหตุผล | ผู้ไม่เกี่ยวข้องไม่เห็น/แก้ไม่ได้; เจ้าของหรือ ITAdmin ยกเลิก non-terminal request ได้ แต่ยกเลิกช่วงรอยืนยันผลไม่ได้ |
| K14 | SLA/integration | ยื่นคำขอ SLA สั้น แล้วตรวจ Dashboard, กระดิ่ง, ปฏิทิน และ daily notification | DueAt คำนวณด้วย business hours; จำนวนงานเปิด/รออนุมัติ/เกิน SLA และ Calendar ตรงกัน; LINE alert ส่งเฉพาะ RequestID/ServiceCode ไม่ส่งคำตอบฟอร์มหรือ PII |
| K15 | Timeline/Audit | เดิน workflow ครบแล้วตรวจ History และ AuditTrail | History แสดงเฉพาะ public events แก่ผู้ขอ ส่วน IT/Approver เห็น context ที่มีสิทธิ์; การกระทำสำคัญมี Audit Trail |
| K16 | Regression | รัน `npm run validate` และ smoke test Ticket/Access/Calendar/Dashboard | Syntax, schema, allowlist, renderer, server guards และโมดูลเดิมผ่านทั้งหมด |
| K17 | Universal report IDOR | Executive/DPO ที่ไม่เกี่ยวข้องเลือก ServiceRequests/Tasks/History ใน Universal PDF sample และผู้ขอเลือก request ของตน | ผู้ไม่เกี่ยวข้องได้แถวว่าง; ผู้ขอเห็นเฉพาะคำขอตนและ public history โดย internal notes, idempotency key, workflow/checklist snapshot และ task evidence ถูก mask |
| K18 | Upload orphan/idempotent repair | อัปโหลด STAGED แล้วทำให้ validation/submit ล้มก่อนสร้าง Request หรือ retry idempotency key เดิมพร้อม staged ID ใหม่ | staged orphan ที่ไม่มี durable intent ถูกเก็บกวาดตาม retention; retry คืน RequestID/attachment IDs เดิมและไม่ผูก staged ID ใหม่โดยพลการ; ID ใน durable source array ถูกข้ามเพื่อให้ซ่อม exact link ได้ |
| K19 | Retention retry | ENFORCE retention โดยจำลอง child history update ล้มกลางทาง แล้วรันซ้ำ | ระบบล้าง Task/History ก่อน parent sentinel; รอบถัดไป retry ได้จน PII child/parent ถูก anonymize ครบ |

## L. Workflow / Attachment / Integration / Action Permission v1.11

> Production rollout เสร็จเมื่อ 21 กรกฎาคม 2569 และมีหลักฐานด้าน backup, additive migration, build/schema, trigger inventory, static validation และ public/admin live smoke ใน `docs/18_PRODUCTION_ROLLOUT_v1.11.md` อย่างไรก็ตาม ชุด L **ไม่ได้ถือว่าผ่านครบทั้งหมด**: authenticated transactional UAT แยกตาม role, fault-injection cases และ sandbox rollback drill ยังต้องบันทึก account/role, record IDs, เวลา, expected/actual, Audit Log ID และหลักฐานหน้าจอ

| ID | กรณีทดสอบ | ขั้นตอน | ผลที่คาดหวัง |
|---|---|---|---|
| L1 | Additive migration / idempotency | สำรองฐาน v1.10 แล้วรัน `setupSystem()` สองรอบ | เพิ่มชีต P3 16 ชีตและคอลัมน์เชื่อมท้ายตาราง, Schema=13, ไม่มีแถว/คอลัมน์เดิมลดหรือสลับ, seed/trigger ไม่ซ้ำ |
| L2 | Build/schema readiness | เรียก `getAppBuildInfo()` หลัง migration | Version v1.11, Build `2026.07.21.1-workflow-integration`, schema `13/13`, `schemaReady=true`, `missingSchema=[]` |
| L3 | Atomic definition generation | แก้ Workflow definition ระหว่างจำลอง failure ก่อน/หลังเปลี่ยน Definition.Version | ก่อน commit instance ใหม่ยังใช้ generation เก่า; หลัง commit ใช้ step ใหม่ครบชุดเดียว; ไม่เกิด steps ข้าม version และมี intent/success หรือ rollback audit |
| L4 | Immutable snapshot | เริ่ม instance แล้วแก้ definition/step/approver master | instance เดิมคง DefinitionVersion/context/step snapshot; instance ใหม่ใช้ version ใหม่ |
| L5 | ANY/ALL/QUORUM | สร้าง step ที่มีผู้อนุมัติหลายคนแล้วตัดสินใจตามแต่ละ mode | ANY ผ่านเมื่อได้หนึ่งเสียง, ALL รอครบทุกเสียง, QUORUM รอถึง MinApprovals; vote ที่เหลือถูก supersede ตาม policy |
| L6 | Exact assignee / SoD | ผู้ที่มี role Approver แต่ไม่ใช่ assignee ลองตัดสินใจ; requester ลองอนุมัติของตน | Server ปฏิเสธทั้งสองกรณี; exact assignee ที่ Active และมี `workflow.approve` จึงทำได้ |
| L7 | Delegation guards | ทดสอบ self/requester delegation, ผู้รับไม่มี approve permission, duplicate vote, cycle, ช่วง delegation ทับซ้อน และช่วง valid ปกติ | รายการเสี่ยงถูกปฏิเสธ; delegation ปกติเปลี่ยน assignee, เก็บ original approver/timeline/audit และไม่สร้างสิทธิ์โหวตซ้ำ |
| L8 | Reminder/escalation | ทำ approval ให้ถึง ReminderHours/EscalationHours แล้วรัน automation ซ้ำ | ส่ง/บันทึก reminder และ escalation แบบ idempotent, ไม่เลือก requester/ผู้ถือ vote ซ้ำ และอัปเดตเวลาที่เกี่ยวข้อง |
| L9 | Workflow visibility | ทดสอบ `workflow.view_own`, `view_assigned`, `view_all` แยกกัน และเรียก detail ด้วย record ที่ไม่เกี่ยวข้อง | เห็นเฉพาะ own/assigned/all ตาม action permission; ไม่มี fallback จากสิทธิ์ source record และ denied ถูกบันทึก |
| L10 | Permission fail closed | ใช้ unknown key, inactive permission, role ไม่มี mapping, override หมดอายุ และ ALLOW/DENY ขัดกัน | unknown/inactive/omitted/expired ถูกปฏิเสธ; `DENY` ชนะ; fallback ใช้เฉพาะ key ที่ยังไม่มี configured role mapping |
| L11 | Permission admin safety | ถอนสิทธิ์ admin คนสุดท้าย, ระงับ group member สุดท้าย, เปลี่ยน permission ระหว่างรอ lock และจำลอง audit failure | last-admin invariant ป้องกันการแก้, mutation re-authorize ใน lock, ไม่มี governed row ที่ไร้ durable intent/result และ cache ถูกล้าง |
| L12 | Attachment validation/private Drive | อัปโหลดชนิดที่อนุญาต, MIME/extension/magic bytes ไม่ตรง, เกิน 15 MB และตรวจ sharing | ไฟล์ถูกต้องสร้าง STAGED พร้อม SHA-256; รายการผิดถูกปฏิเสธ/compensate; public/domain sharing ถูกปฏิเสธ |
| L13 | Exact attachment claim | อัปโหลด STAGED แล้วสร้าง source record; เปลี่ยน module/record type/record/field/role ใน payload เพื่อโจมตี และลอง claim STAGED ที่ durable intent อื่นอ้างอยู่ | หลัง durable source write จึงเกิด active link ที่ canonical module/entity/field/role ตรง; context คู่ผิด, terminal record, cross-record link และ ID ที่มี owner intent แล้วถูกปฏิเสธ; retry ซ่อมได้เฉพาะ exact intent |
| L14 | Attachment duplicate/replay | ส่ง source idempotency key เดิมพร้อม staged upload ใหม่, อัปโหลดเนื้อหาเดียวกันซ้ำ และจำลอง secondary summary-log ล้มหลัง LINK commit | คืน source ID/attachment IDs เดิม, discard staged ID ใหม่จาก duplicate, ไม่ reuse/ลบ ID ที่ durable record อื่นอ้าง, committed link ไม่ถูก compensation ทำลาย และ orphan จริงเท่านั้นที่ถูกจัดการตาม policy |
| L15 | Download authorization/integrity | เจ้าของ/assignee/ผู้ไม่มีสิทธิ์ดาวน์โหลด, เปลี่ยนเนื้อหา Drive หลัง upload และตรวจ DTO/network response | ผู้มี row-level access ดาวน์โหลดผ่าน Server ได้; ผู้ไม่มีสิทธิ์ถูกปฏิเสธ; checksum mismatch ถูก mark/log; DTO ไม่เปิดเผย FileID/folder/raw Drive URL |
| L16 | Legal hold/delete/restore | ใช้ API set/release hold ด้วย User/ITAdmin/DPO พร้อม/ไม่มีเหตุผล; ลบไฟล์ที่ hold/shared; restore รายการปกติและ retention-expired พร้อมจำลอง commit failure | เฉพาะ ITAdmin/DPO จัดการ hold ได้และต้องมีเหตุผล; failure rollback link/aggregate; retention restore ต้อง `attachment.admin`+เหตุผลและได้ recovery window; delete/restore มี verified audit และ rollback file/link/registry |
| L17 | Attachment retention/repair | ทำ STAGED เกิน 72 ชม. แบบ orphan/durable intent/JSON เสีย; ทำ source active→terminal→soft-delete, link EXPIRED/legal hold และจำลอง audit/commit failure | source active/hold ถูก freeze; deleted source ใช้ `DeletedAt`+policy และไม่ถูก generic purge ขณะมี active link; expire/trash audit ใน lock+rollback; historical EXPIRED/CANCELLED ไม่สร้าง pseudo authorization หรือ download resurrection |
| L18 | Migrated module evidence | ทดสอบ Service Request/Task, authenticated Ticket/Worklog, Personal Task, Workflow Approval และ Ticket→Incident ด้วย Registry ID/HTTPS raw URL; ตรวจ legacy row ที่ไม่มี Registry ID | Registry ID ต้อง active + exact link + evidence flag + live private Drive; raw URL ใหม่ถูกปฏิเสธ; Incident ใช้ opaque provenance link ไม่คัดลอก locator; legacy proxy จำกัด ITAdmin/DPO เคส PDPA และ Public/LINE Ticket compatibility ยังทำงาน |
| L19 | Integration adapter allowlist | ใช้ target access/ticket/asset/change และใส่ target/function แปลกใน Catalog JSON | 4 target ทำ CREATE/LINK ตาม allowlist; unknown target/function ถูกปฏิเสธและไม่มี arbitrary dispatch |
| L20 | Integration idempotency/provenance | ประมวลผล job แล้วจำลอง crash ก่อน commit ResultRecordID จากนั้น retry | ไม่สร้าง target ซ้ำ; ซ่อม reverse `SourceServiceRequestID`, RecordLinks, primary compatibility field และ side effect ก่อน mark COMPLETED |
| L21 | Retry/backoff/stale recovery | ทำ adapter ล้มต่อเนื่อง, ตรวจเวลา retry 1/5/15/60/240 นาที, ทำ PROCESSING ค้างเกิน 15 นาที, ทำ completed-repair ล้ม และ manual retry | งานสร้าง target หยุดหลัง 5 ครั้ง; stale ถูกนำกลับมาทำได้; completed evidence คงสถานะและนัด repair ด้วย backoff; manual retry ใช้เฉพาะ non-terminal request และมี permission/audit |
| L22 | Cancellation/terminal safety | ยกเลิก Service Request ที่มี PENDING/PROCESSING/COMPLETED job แล้วลอง retry/repair | งานยังไม่เสร็จถูก CANCELLED; COMPLETED target/RecordLinks คงเป็นหลักฐาน; terminal request ไม่สร้าง target ใหม่หรือ manual retry |
| L23 | Lifecycle fairness | สร้าง active RecordLinks มากกว่า limit หลายชุด แล้วรัน reconciliation หลายรอบ | persistent cursor หมุนครบทุก link, ไม่ starvation ชุดท้าย, sync สถานะ/provenance และบันทึก error/backoff แบบตรวจสอบได้ |
| L24 | API/DTO exposure | เรียก helper ลงท้าย `_`, public P3 APIs, Integration status ด้วย user/IT Admin | helper ไม่อยู่ allowlist; public API คืน response contract; user ไม่เห็น job ID/attempt/raw error/target ID ที่เปิดไม่ได้ ส่วน IT Admin เห็นข้อมูลปฏิบัติการ |
| L25 | Admin bootstrap/logout | จำลอง credential/audit write failure ระหว่าง `bootstrapFirstAdmin`; ทำ logout เมื่อ AuditTrail ผิดพลาด | bootstrap rollback Users row/formula และไม่ลบ init password ก่อน commit; logout invalidate session ก่อน audit และ token เดิมใช้ซ้ำไม่ได้ |
| L26 | Retention regression | รัน DRY_RUN/ENFORCE สำหรับ Service Request/Ticket/Workflow/Attachment และจำลอง partial failure | child/attachment intent ถูกจัดลำดับปลอดภัย, retry ต่อได้, legal hold ไม่ถูกล้าง และ public/legacy flow ที่อยู่ในขอบเขตยังทำงาน |
| L27 | Trigger/automation | ตรวจ trigger ก่อน/หลังรัน setup ซ้ำ แล้วให้ scheduled job ทำงานพร้อม manual job | มี `scheduledWorkflowAutomation_` รายชั่วโมงหนึ่งรายการ, lock/idempotency ป้องกันการทำซ้ำและ AuditTrail มีผล scheduled run |
| L28 | Rollback rehearsal | บน sandbox deploy v1.11/migrate/สร้าง transaction แล้วปิด trigger v1.11, push HEAD จาก source package version 33 และ redeploy version 33; ทดสอบ restore snapshot แยก | Web App และ trigger ไม่เหลือ source v1.11 ที่ทำงานอยู่, rollback ได้โดยไม่ลบชีต additive; data rollback ใช้ snapshot ที่ตรวจ ID/checksum/row count และ Drive orphan ถูก reconcile |
| L29 | Static release gate | รัน `npm.cmd run validate` หลังรวม source/docs ทั้งหมด | Syntax, duplicate function, schema, build marker, API allowlist, renderer และ security invariants ผ่านทั้งหมด |
| L30 | Live smoke/UAT | เปิด versioned Production URL ด้วย public และบัญชีทุก role; ตรวจ Console/Network/build | Public Helpdesk/Admin/Workflow/Service Catalog โหลดได้, ไม่มี client exception, server build ตรง, role/row visibility ถูกต้อง และมี evidence อ้าง deployment version |

### สถานะหลักฐาน Production ณ 21 กรกฎาคม 2569

- ยืนยันส่วน migration ของ L1 แล้ว: เพิ่มชีต P3 16 ชีตและตรวจ exact headers; Catalog 12 แถวเปลี่ยนเฉพาะฟิลด์ที่ migration คาดหมาย แต่การรัน setup สองรอบบน sandbox เพื่อพิสูจน์ idempotency ยังเป็น acceptance ที่แนะนำ
- ยืนยัน L2 และ L29 แล้ว: Build `2026.07.21.1-workflow-integration`, Schema `13/13`, `schemaReady=true`, `missingSchema=[]`; static validation ผ่าน 47 GS, 33 HTML, 1126 server functions และ 267 API allowlist entries
- ยืนยันเฉพาะ inventory/uniqueness ส่วนหนึ่งของ L27: operational triggers มี 8 รายการและแต่ละรายการมีหนึ่ง instance; scheduled/manual concurrency และ transactional outcome ยังต้อง UAT
- ยืนยันเฉพาะ public form, Admin login, build/schema และ application-error-free smoke ของ L30; authenticated role/row visibility และธุรกรรม Workflow/Attachment/Integration ยังต้อง UAT ด้วยบัญชีจริง
- L3–L26 และ L28 ไม่ได้ถูกทำเครื่องหมายว่า Complete จาก rollout นี้ ให้เก็บหลักฐานแยกตามแต่ละกรณีก่อนปิด acceptance
