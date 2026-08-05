# My Task – งานของฉัน

## สถาปัตยกรรม

หน้า `Task.html` ทำงานภายใน Web App เดิมและเรียก backend ผ่าน `callServer()` → `api()` พร้อม session token ฝั่ง server ทุกคำสั่งอ่านและเขียนข้อมูลโดยกรอง `OwnerEmail` จาก session จึงไม่รับ owner จาก browser มาใช้ตัดสินสิทธิ์

ข้อมูลหลักอยู่ใน Google Sheets, ไฟล์จริงอยู่ในโฟลเดอร์ Google Drive ที่ระบบสร้างให้ และกิจกรรมแจ้งเตือนแบบ Calendar อยู่ในปฏิทินหลักของเจ้าของ deployment งานอัตโนมัติใช้ time-driven trigger `dailyNotificationCheck_()`

## โครงสร้างชีตของโมดูล

- `PersonalTasks` งานหลัก สถานะ วันที่ ความสำคัญ ความคืบหน้า และ recurrence
- `TaskSubtasks` checklist/งานย่อย
- `TaskProgressLogs` ประวัติเปอร์เซ็นต์และบันทึกความคืบหน้า
- `TaskLinks` ลิงก์ประกอบงาน
- `TaskAttachments` metadata ของไฟล์ใน Drive (ไม่เก็บ binary ใน Sheet)
- `TaskReminders` วันเวลา ช่องทาง สถานะส่ง และ Calendar Event ID
- `AuditTrail` หลักฐานการสร้าง แก้ไข และกู้คืนรายการสำคัญ

`Config.gs > DB_SCHEMA` เป็นแหล่งอ้างอิงชื่อคอลัมน์เพียงจุดเดียว `setupSystem()` จะสร้างชีตที่ยังไม่มีและเพิ่มคอลัมน์ใหม่โดยไม่ลบข้อมูลเดิม

## ไฟล์สำคัญ

- `Config.gs` ชื่อชีตและ schema
- `Setup.gs` สร้าง/ปรับ schema, protection และ trigger
- `Module_Task.gs` validation, owner isolation, CRUD, checklist, recurrence, attachment, progress และ reminder
- `Task.html` Dashboard, Quick Add, Feed/List, Kanban, Calendar, filter และแผงรายละเอียด
- `Notification.gs` จุดรวมการส่งและคิวแจ้งเตือน
- `Auth.gs` API allowlist และ session authorization
- `appsscript.json` timezone และ OAuth scopes

## การตั้งค่า

1. เปิด Apps Script Editor แล้วรัน `setupSystem()` ด้วยบัญชีเจ้าของระบบ
2. อนุญาตสิทธิ์ Google Sheets, Drive, Calendar, Mail และ external request ตามหน้าจอ Google
3. ถ้าจะใช้ LINE ให้ตั้ง `LINE_CHANNEL_ACCESS_TOKEN` ใน Script Properties และตั้ง target ตามหน้าตั้งค่าการแจ้งเตือนเดิม
4. `setupSystem()` จะติดตั้ง trigger รายวันเวลาใกล้ 07:00 และป้องกัน trigger ชื่อเดียวกันซ้ำ
5. Deploy → Manage deployments → Edit → New version → Deploy โดย Execute as เจ้าของระบบ และเลือกกลุ่มผู้เข้าถึงให้แคบที่สุดตามการใช้งานจริง
6. ตรวจ build หลัง deploy ด้วย `getAppBuildInfo()` ต้องเห็น `2026.07.17.1-my-task-complete`

## ทดสอบทีละขั้น

1. รัน `npm.cmd run validate` ใน checkout ก่อน push
2. รัน `setupSystem()` แล้วตรวจว่ามีชีต Task ทั้ง 6 ชีตและหัวคอลัมน์ตรง `DB_SCHEMA`
3. เปิดหน้า “งานของฉัน” เพิ่มงานผ่าน Quick Add และฟอร์มเต็ม จากนั้นรีเฟรชเพื่อยืนยันว่าบันทึกครั้งเดียว
4. ทดลองค้นหา กรอง เปลี่ยน List/Kanban/Calendar ลากสถานะ และลากวันครบกำหนด
5. เปิดรายละเอียด เพิ่ม checklist, progress log, HTTPS link และไฟล์ขนาดเล็ก
6. ตั้ง LINE/Email reminder เป็นเวลาอนาคตอันใกล้ แล้วรัน `dailyNotificationCheck_()` จาก editor เพื่อตรวจแบบ manual
7. ตั้ง Calendar reminder และตรวจว่ามี event เพียงหนึ่งรายการพร้อม `CalendarEventID` ในชีต
8. ยกเลิกงาน แล้วเปิดกลับมาทำต่อจากประวัติ เพื่อตรวจ soft-delete/restore
9. ทดสอบบนมือถือว่าปุ่มและ side panel ใช้งานได้ และไม่มีข้อความ `Cannot read properties of null`

## ข้อผิดพลาดที่พบบ่อย

- หน้าเว็บยังเหมือนรุ่นเก่า: ตรวจ `getAppBuildInfo()`, `clasp.cmd versions` และ `clasp.cmd deployments` ก่อนแก้ source ซ้ำ
- สร้าง Calendar ไม่ได้: deploy ใหม่หลังเพิ่ม calendar scope แล้วอนุญาตสิทธิ์อีกครั้ง
- แนบไฟล์ไม่ได้: ตรวจ Drive permission และขนาดไฟล์ไม่เกิน 7 MB
- LINE ไม่ส่ง: ตรวจ token, target และ `NotificationLog`/`NotificationQueue`
- ไม่เห็นชีตใหม่: รัน `setupSystem()` ใน deployment database เดียวกับ Web App
