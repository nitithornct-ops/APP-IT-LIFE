# คู่มือติดตั้ง Production Hardening v1.7

เอกสารนี้ใช้หลังอัปโหลด source ชุด v1.7 ไปยัง Google Apps Script แล้ว

## 1. ติดตั้ง Schema และ Trigger

1. เปิด Apps Script Editor ด้วยบัญชีเจ้าของ Deployment
2. รัน `setupSystem()`
3. อนุญาตสิทธิ์ Spreadsheet, Drive, UrlFetch, Mail และ Trigger
4. ตรวจว่ามี Sheet ใหม่:
   - `NotificationQueue`
   - `RetentionLog`
   - `EmployeeLifecycle`
5. Deploy เป็นเวอร์ชันใหม่

`setupSystem()` จะสร้าง Trigger ต่อไปนี้โดยไม่สร้างซ้ำ:

| Handler | รอบทำงาน |
|---|---|
| `processNotificationQueue_` | ทุก 15 นาที |
| `scheduledLiveHealthCheck_` | ทุกวันประมาณ 06:00 |
| `scheduledSystemBackup_` | ทุกวันประมาณ 02:00 |
| `monthlyRestoreDrill_` | วันที่ 2 ของเดือน ประมาณ 03:00 |
| `dailyRetentionMaintenance_` | ทุกวันประมาณ 04:00 |
| `dailyNotificationCheck_` | ทุกวันประมาณ 07:00 |
| `monthlyExecutiveReport_` | วันที่ 1 ของเดือน ประมาณ 08:00 |

## 2. ตั้งค่า LINE-only Notification

เปิดหลังบ้าน → **ตั้งค่าการแจ้งเตือน**

1. เปิด LINE
2. กรอก `LINE target ID`
3. กรอก Channel access token
4. กด **บันทึกและทดสอบ LINE**

งานแจ้งเตือนระบบทั้งหมดส่งผ่าน LINE เท่านั้น หาก LINE ตอบผิดพลาด ระบบจะสร้างรายการใน
`NotificationQueue` และ retry แบบ exponential backoff สูงสุด 5 ครั้งก่อนเปลี่ยนเป็น `DEAD`

Email ยังถูกใช้เฉพาะ:

- OTP เข้าสู่ระบบหลังบ้าน
- OTP สำหรับค้นหารายการ Ticket ด้วยอีเมล

## 3. Backup และ Restore

ค่าเริ่มต้น:

- Snapshot ทุกวัน
- เก็บ Snapshot 90 วัน
- Restore drill ไปยัง Sandbox ทุกเดือน
- เก็บไฟล์ Sandbox 30 วัน

ตรวจได้ที่ **Backup → Automation / Retention** หาก Trigger ใดหายให้รัน `setupSystem()` อีกครั้ง

ค่า Settings ที่ปรับได้:

- `AUTO_BACKUP_ENABLED=true`
- `AUTO_RESTORE_DRILL_ENABLED=true`
- `BACKUP_RETENTION_DAYS=90`
- `RESTORE_SANDBOX_RETENTION_DAYS=30`
- `BACKUP_HEALTH_MAX_HOURS=30`

## 4. Retention / PDPA

ค่าเริ่มต้น `RETENTION_MODE=DRY_RUN` จะตรวจและบันทึกผล แต่ไม่เปลี่ยนข้อมูล

1. เปิด **Backup → Automation / Retention**
2. กด **Preview ตอนนี้**
3. ตรวจจำนวนรายการที่พบใน `RetentionLog`
4. เมื่ออนุมัตินโยบายแล้วจึงกด **Enforce ตอนนี้** หรือเปลี่ยน `RETENTION_MODE=ENFORCE`

Policy เริ่มต้น:

| ข้อมูล | อายุเริ่มต้น | การดำเนินการ |
|---|---:|---|
| LINE session หมดอายุ/ถูกเพิกถอน | 30 วัน | ลบแถว session hash |
| NotificationLog | 365 วัน | ลบ Log เก่า |
| NotificationQueue ที่ SENT/DEAD | 90 วัน | ลบคิวเก่า |
| Ticket ที่ปิดแล้ว | 730 วัน | Anonymize ข้อมูลผู้แจ้ง แต่คงสถิติ/SLA |
| รายการในถังขยะ | 365 วัน | ลบถาวร |

ไฟล์หลักฐาน Ticket จะไม่ถูกย้ายเข้าถังขยะ Drive จนกว่าจะตั้ง
`RETENTION_TRASH_EVIDENCE=true`

## 5. Joiner / Mover / Leaver

เปิดโมดูล **พนักงานและทรัพย์สิน** แล้วกด **Lifecycle**

- `JOINER` เปิดสถานะพนักงานและสร้าง checklist บัญชี/อุปกรณ์
- `MOVER` อัปเดตหน่วยงาน/ตำแหน่งและบังคับทบทวนสิทธิ์เดิม
- `LEAVER` ปิดบัญชีระบบ ระงับสิทธิ์ ตัด LINE link/session และเปิดรายการคืนทรัพย์สิน

LEAVER จะปิด checklist ไม่ได้จนกว่าทรัพย์สินและ Software ที่ระบบตรวจพบจะถูกคืนครบ

## 6. Business-hours SLA

Ticket แยกเป็น:

- Response SLA: เวลารับเรื่องครั้งแรก
- Resolution SLA: เวลาดำเนินการเสร็จ

กำหนดรายหมวดหมู่ได้จาก **Ticket → จัดการหมวดหมู่**

ค่า Settings:

- `SLA_BUSINESS_START=08:30`
- `SLA_BUSINESS_END=17:30`
- `SLA_BUSINESS_DAYS=1,2,3,4,5` (`0=อาทิตย์`, `6=เสาร์`)
- `SLA_HOLIDAYS=2026-01-01,2026-04-13`

สถานะ `รอผู้ใช้งาน` และ `รออะไหล่` ยังคงหยุดนาฬิกา SLA

## 7. ตรวจรับหลัง Deploy

1. รัน `npm.cmd run validate` ที่เครื่องพัฒนา
2. รัน `setupSystem()` ใน Apps Script Editor
3. Deploy New version
4. เปิด **Tester / QA**
5. ตรวจการ์ด **Go-live / Release Checklist**
6. กด **ตรวจ Deployment จริง**
7. ตรวจว่า Public Web App, Schema/Build, Trigger, LINE, Snapshot, Dead letter, Privacy Notice และ Script Properties capacity เป็น `PASS` หรือเหลือเฉพาะ `WARN` ที่ผู้ดูแลยอมรับแล้ว
8. ทดสอบสร้าง Ticket ผ่าน LINE แล้วเปลี่ยนสถานะจากหลังบ้าน
9. ทดสอบ Backup → สร้าง Snapshot → ตรวจ checksum → Restore Sandbox
10. รัน Retention แบบ Preview ก่อน Enforce

การตรวจในเครื่องยืนยัน syntax และ wiring เท่านั้น การพร้อมใช้งานจริงต้องผ่านข้อ 2–10 บน Deployment

## 8. Go-live / Release Checklist

เปิด **Tester / QA** แล้วดูการ์ด **Go-live / Release Checklist** ก่อนประกาศใช้งานจริง

Checklist รวมสถานะสำคัญ:

- Build และ Schema version
- ผลตรวจ Live deployment ล่าสุด
- Operational triggers รวม `monthlyExecutiveReport_`
- จำนวน Script Properties เทียบกับเพดาน 50 keys
- Public ticket intake และ rate limit
- Privacy Notice และ consent enforcement
- LINE Login และ LINE notification queue/dead letter
- System Snapshot, Restore drill และ Retention mode
- Admin login และ MFA

หากมี `BLOCKER` ไม่ควร Go-live จนกว่าจะแก้รายการนั้นก่อน หากมีเฉพาะ `WARN` ให้ผู้ดูแลบันทึกเหตุผลการยอมรับความเสี่ยงไว้ใน Test case หรือ Audit evidence

## 9. Privacy Notice / Consent

หลังรัน `setupSystem()` ระบบจะ seed ค่า Settings กลุ่ม **Privacy / PDPA**:

| Key | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `PUBLIC_TICKET_CONSENT_REQUIRED` | `true` | บังคับให้ผู้แจ้งยอมรับ Privacy Notice ก่อนส่ง Ticket |
| `PUBLIC_PRIVACY_NOTICE_VERSION` | `2026-07-08` | เวอร์ชันประกาศที่บันทึกกับ Ticket |
| `PUBLIC_PRIVACY_NOTICE_TEXT` | ข้อความย่อ | ข้อความสรุปที่แสดงบนหน้าแจ้งซ่อม |
| `PUBLIC_PRIVACY_NOTICE_URL` | ว่าง | URL ประกาศฉบับเต็ม ต้องเป็น HTTPS หากกรอก |
| `PUBLIC_PRIVACY_DPO_CONTACT` | `DPO / ส่วนงาน IT` | ช่องทางติดต่อผู้รับผิดชอบข้อมูล |

หน้า Public Helpdesk จะแสดง Privacy Notice และ checkbox consent ก่อนปุ่มส่ง Ticket ทั้งโหมด anonymous และ LINE Login ฝั่ง server จะปฏิเสธคำขอที่ไม่มี consent และบันทึกเวอร์ชัน consent ใน `Tickets.Notes` กับ `Ticket_Worklogs`
