# 4. ขั้นตอนการติดตั้งและ Deploy

## ทางเลือก A — ติดตั้งผ่านเว็บ (ไม่ต้องใช้ clasp) แนะนำสำหรับผู้เริ่มต้น

### 1) สร้างโปรเจกต์ Apps Script
1. ไปที่ https://script.google.com → **New project**
2. ตั้งชื่อโปรเจกต์ เช่น `ISMS Governance - กองทุนประกันชีวิต`
3. คัดลอกเนื้อหาไฟล์ `.gs` แต่ละไฟล์มาสร้างไฟล์ชื่อเดียวกันในโปรเจกต์
   (เมนู **+ > Script** ตั้งชื่อให้ตรง เช่น `Config`, `Auth`, `Utils`, `Setup` ...)
4. สร้างไฟล์ HTML (เมนู **+ > HTML**) ชื่อให้ตรงกับทุกไฟล์ `.html` ในโปรเจกต์ เช่น `Index`, `Styles`, `JavaScript`, `Dashboard`, `Task`, `Ticket`, `AccessDenied`, `Incident` ฯลฯ
5. แก้ Manifest: เมนู **Project Settings (⚙)** → ติ๊ก **Show "appsscript.json" manifest file** → เปิดไฟล์ `appsscript.json` แล้ววางเนื้อหาที่ให้

### 2) ติดตั้งฐานข้อมูล (รันครั้งเดียว)
1. เลือกฟังก์ชัน **`setupSystem`** บนแถบเครื่องมือ → กด **Run**
2. ครั้งแรกจะขอสิทธิ์ (Authorize) → เลือกบัญชีองค์กร → **Advanced → Go to project (unsafe)** → **Allow**
3. ระบบจะ:
   - สร้าง Spreadsheet ฐานข้อมูลใหม่ + เก็บ `SPREADSHEET_ID` ใน Script Properties
   - สร้างทุก Sheet ตาม schema + ป้องกัน Sheet `AuditTrail`
   - เพิ่มอีเมลของท่านเป็น **IT Admin** เริ่มต้น
   - เติม `PolicyMapping` + ตั้ง Trigger รายวัน
   - เติม `TicketCategories` สำหรับ Help Desk/SLA เริ่มต้น
   - สร้าง `PersonalTasks` สำหรับโมดูล Task / งานของฉัน
4. ดู log (View > Execution log) จะเห็น **Spreadsheet URL** — เปิดเพื่อเพิ่มผู้ใช้ใน Sheet `Users`

> **container-bound ก็ได้:** หากต้องการผูกกับ Google Sheet ที่มีอยู่ ให้สร้างสคริปต์จากเมนู **Extensions > Apps Script** ของชีตนั้น แล้ว `setupSystem` จะใช้ชีตนั้นเป็นฐานข้อมูล

> ฟังก์ชันติดตั้ง/seed/ตั้ง trigger ถูกจำกัดให้รันจาก Apps Script editor โดยเจ้าของหรือผู้ deploy เท่านั้น ไม่ควรเรียกผ่าน Web App

### 3) ตั้งค่า Script Properties แบบประหยัดช่อง
**Project Settings (⚙) → Script Properties → Add script property**

เก็บเฉพาะค่าลับ, LINE connection และค่าบูตระบบไว้ที่นี่ ค่าอื่น เช่น `ORG_NAME`, `SLA_*`,
`RETENTION_*`, `PUBLIC_TICKET_*`, `NOTIFY_LEAD_DAYS` และรอบทบทวน ให้แก้จากหน้า **Settings**
ในระบบหรือชีต `Settings` แทน เพื่อไม่ให้ชนขีดจำกัดจำนวน Script Properties

| Key | ค่าตัวอย่าง | จำเป็น |
|---|---|---|
| `SPREADSHEET_ID` | ตั้งอัตโนมัติ | ไม่ต้องใส่เอง |
| `NOTIFY_LINE_ENABLED` | `true` | ใช้ LINE |
| `LINE_CHANNEL_ACCESS_TOKEN` | `<token จาก LINE Developers>` | ถ้าใช้ LINE |
| `LINE_DEFAULT_TO` | `<userId/groupId ปลายทาง>` | ถ้าใช้ LINE |
| `LINE_LOGIN_ENABLED` | `true`/`false` | เปิดหลังตั้งค่า LINE Login ครบ |
| `LINE_LOGIN_CHANNEL_ID` | `<Channel ID>` | ถ้าใช้ LINE Login |
| `LINE_LOGIN_CHANNEL_SECRET` | `<Channel secret>` | ถ้าใช้ LINE Login |
| `LINE_LOGIN_CALLBACK_URL` | `<Web app /exec?page=line-callback>` | ถ้าใช้ LINE Login |
| `LINE_REQUIRE_EMPLOYEE_LINK` | `true`/`false` | – (บังคับผูก EmployeeCode ก่อนแจ้งซ่อม) |
| `LINE_AUTO_APPROVE_EMPLOYEE_LINK` | `false` | – (แนะนำให้ Admin อนุมัติการผูก) |
| `LINE_SESSION_HOURS` | `24` | – |
| `LINE_SESSION_SECRET` | `<ค่าสุ่มยาว>` | ตั้งอัตโนมัติเมื่อรัน `setupSystem` |
| `LINE_CHANNEL_SECRET` | `<Messaging API channel secret>` | เฉพาะถ้าเปิด webhook |
| `LINE_WEBHOOK_GATEWAY_SECRET` | `<shared secret>` | เฉพาะถ้าใช้ gateway |
| `ADMIN_INIT_PASSWORD` | `<รหัสผ่านผู้ดูแลเริ่มต้น>` | ใช้ชั่วคราวตอน bootstrap |

> ถ้า Script Properties เกิน 50 รายการ ให้ deploy source ล่าสุดแล้วรัน `cleanupScriptPropertiesForLine()` จาก Apps Script editor
> ฟังก์ชันนี้จะย้ายค่า non-secret ไปชีต `Settings` และลบ key ชั่วคราว เช่น `PUBLIC_TICKET_DAY_*`
>
> การตั้งค่า LINE Login แบบละเอียดดู [06_SETUP_LINE_OA_TICKET.md](06_SETUP_LINE_OA_TICKET.md)

ตั้งรหัสผ่านผู้ดูแลหลังบ้านครั้งแรกได้ 2 วิธี:
- วิธีเร็ว: รัน `bootstrapFirstAdmin("ข้อความรหัสผ่านอย่างน้อย 12 ตัว")` จาก editor
- วิธีไม่ใส่รหัสในโค้ด: ตั้ง `ADMIN_INIT_PASSWORD` ใน Script Properties แล้วรัน `setupAdminLogin` หรือ `bootstrapFirstAdmin`

หลังตั้งรหัสสำเร็จ ให้ลบ `ADMIN_INIT_PASSWORD` ออกจาก Script Properties

### 4) Deploy เป็น Web App
1. กด **Deploy → New deployment → ⚙ เลือก Web app**
2. ตั้งค่า:
   - **Description:** ISMS v1.0
   - **Execute as:** **Me (ตัวผู้ Deploy)** — เพื่อให้ระบบเข้าถึง Spreadsheet ได้โดยผู้ใช้ไม่ต้องมีสิทธิ์ Sheet โดยตรง
   - **Who has access:** **Anyone, even anonymous** — เพื่อให้หน้าแจ้งซ่อมสาธารณะใช้งานได้โดยไม่ต้องล็อกอิน Google
3. กด **Deploy** → คัดลอก **Web app URL** แจกผู้ใช้
4. **การคุมการเข้าถึง:**
   - URL หลักเป็นหน้าแจ้งซ่อม/ติดตาม Ticket สาธารณะ คุมด้วย rate limit, honeypot, file limit, allowed domains และ optional shared code
   - หน้า `?page=admin` เป็นหลังบ้าน ต้องล็อกอินด้วย Username + รหัสผ่านจากทะเบียน `Users` (Email ใช้รับ MFA)
   - หลังบ้านตรวจ token, API allowlist และสิทธิ์รายโมดูลฝั่ง Server ทุกครั้ง
   - **ห้ามแชร์ไฟล์ Spreadsheet ตรงให้ผู้ใช้ทั่วไป** ให้เข้าผ่าน Web App เท่านั้น

> ถ้าหน่วยงานไม่ต้องการหน้าแจ้งซ่อมสาธารณะ ให้ตั้ง `PUBLIC_TICKET_ENABLED=false` และ deploy เป็น access ที่เหมาะกับนโยบายองค์กร

### 5) ตรวจสอบ Trigger
**Triggers (⏰ ซ้ายมือ)** → ควรเห็น 2 รายการ:
- `dailyNotificationCheck_` — Time-driven รายวัน 07:00 (หากไม่มีให้รัน `ensureDailyTrigger`)
- `monthlyExecutiveReport_` — Time-driven รายเดือน วันที่ 1 เวลา 08:00 ส่งรายงานสรุปให้ผู้บริหาร (หากไม่มีให้รัน `ensureMonthlyReportTrigger`)

---

## ทางเลือก B — ใช้ clasp (สำหรับนักพัฒนา)

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "ISMS Governance"
# หรือคัดลอก .clasp.json.example เป็น .clasp.json แล้วใส่ scriptId ของโปรเจกต์เดิม
clasp push
clasp deploy --description "ISMS v1.0"
```
จากนั้นเปิด `clasp open` แล้วรัน `setupSystem` + ตั้ง Script Properties + Deploy ตามขั้นตอน A ข้อ 2-5

---

## OAuth Scopes ที่ระบบขอ (ใน appsscript.json)
| Scope | ใช้ทำ |
|---|---|
| `spreadsheets` | อ่าน/เขียนฐานข้อมูล Google Sheets |
| `script.external_request` | เรียก LINE Messaging API (UrlFetch) |
| `script.send_mail` | ส่งอีเมลแจ้งเตือน |
| `script.scriptapp` | สร้าง/จัดการ Time-driven Trigger |
| `drive` | จัดเก็บไฟล์หลักฐาน และเก็บ PDF รายงาน |
| `documents` | สร้างรายงาน/Export PDF |
| `userinfo.email` | ระบุอีเมลผู้ใช้เพื่อตรวจสิทธิ์ |

## การเพิ่มผู้ใช้งาน
เพิ่มได้ 2 ทาง:
- หลังบ้าน `?page=admin` → โมดูล **Users** → เพิ่มผู้ใช้/ตั้งรหัสผ่าน/เปิด-ปิดสถานะ
- หรือเปิด Spreadsheet → Sheet `Users` → เพิ่มแถว: Username (ไม่ใช่อีเมล), Email (สำหรับ MFA), FullName, Department, Role (User/Approver/ITAdmin/Executive/DPO), Supervisor, Status = `Active`
