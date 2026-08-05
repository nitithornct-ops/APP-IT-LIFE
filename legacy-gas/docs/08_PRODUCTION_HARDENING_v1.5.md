# Production Hardening v1.5

## หลักการเข้าถึง

- URL หลักเป็นหน้าแจ้งซ่อมสาธารณะ ทุกคนเปิดได้โดยไม่ต้องมี Google Account และไม่บังคับกรอกอีเมล
- ผู้แจ้งที่ไม่ใช้อีเมลจะได้รับ `Ticket ID` และ `รหัสติดตาม` หลังส่งรายการ
- Browser จะจำ Ticket ID และรหัสติดตามไว้ในอุปกรณ์นั้นสูงสุด 20 รายการ ผู้ใช้ลบออกจากอุปกรณ์ได้
- Email OTP และ LINE Login เป็นทางเลือกสำหรับผู้ที่ต้องการดูหลาย Ticket ไม่ใช่เงื่อนไขในการแจ้งซ่อม
- หลังบ้าน `?page=admin` ยังต้องเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่และ MFA

## สิ่งที่เพิ่มในรุ่นนี้

- ป้องกัน Formula/CSV Injection เมื่อเขียนข้อมูลลง Google Sheets และ Export CSV
- ใช้เลขอ้างอิงแบบวันที่ + UUID 16 ตัว ลดโอกาส ID ชนกัน
- ตรวจชนิดไฟล์จากเนื้อหาจริง จำกัดชนิดไฟล์ ขนาดต่อไฟล์ และขนาดรวม
- จำกัดจำนวน Ticket ต่ออุปกรณ์และรวมทั้งระบบ เพื่อลด bot/spam
- เพิ่มสถานะเวลา `AcknowledgedAt` และ `ResolvedAt`
- ตรวจ state transition ฝั่ง Server ป้องกันคำขอเก่าทำให้สถานะย้อนกลับ
- ตรวจ Build/Schema หลังเข้าสู่ระบบ และแสดงแถบเตือนเมื่อไฟล์อัปโหลดไม่ครบชุด
- เพิ่ม `npm run validate` ตรวจ syntax, ชื่อ top-level ซ้ำ, API allowlist และ HTML partial ก่อน push/deploy

## ขั้นตอนอัปเดตระบบเดิม

1. ที่เครื่อง local รัน `npm.cmd run validate` ต้องขึ้น `Validation PASSED`
2. อัปโหลดไฟล์ `.gs`, `.html` และ `appsscript.json` ทั้งชุดไปยัง Apps Script project เดียวกัน
3. ใน Apps Script editor รัน `setupSystem()` หนึ่งครั้ง เพื่อเพิ่มคอลัมน์และตั้ง `APP_SCHEMA_VERSION`
4. Deploy > Manage deployments > Edit > New version
5. ตั้ง Execute as: Me และ Who has access: Anyone
6. เปิด URL หลักด้วย Incognito ต้องเข้าได้โดยไม่ต้องล็อกอินและส่ง Ticket โดยเว้นอีเมลได้
7. เปิด `?page=admin` เข้าระบบ แล้วตรวจว่าไม่มีแถบเตือน Build/Schema
8. ไปที่ Tester / QA แล้วตรวจ `Public helpdesk` และ `Deployment / Schema` ต้องเป็น PASS

## ค่าควบคุม Public Helpdesk

| Script Property | ค่าเริ่มต้น | ความหมาย |
|---|---:|---|
| `PUBLIC_TICKET_MAX_FILES` | 5 | จำนวนไฟล์สูงสุดต่อ Ticket |
| `PUBLIC_TICKET_MAX_FILE_MB` | 10 | ขนาดสูงสุดต่อไฟล์ |
| `PUBLIC_TICKET_MAX_TOTAL_MB` | 20 | ขนาดไฟล์รวมสูงสุดต่อ Ticket |
| `PUBLIC_TICKET_MAX_PER_HOUR` | 3 | Ticket ต่ออุปกรณ์ต่อชั่วโมง |
| `PUBLIC_TICKET_MAX_PER_DAY` | 8 | Ticket ต่ออุปกรณ์ต่อวัน |
| `PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR` | 60 | Ticket รวมทั้งระบบต่อชั่วโมง |
| `PUBLIC_TICKET_GLOBAL_MAX_PER_DAY` | 300 | Ticket รวมทั้งระบบต่อวัน |

## Smoke test สำคัญ

1. แจ้ง Ticket โดยกรอกชื่อแต่เว้นอีเมล ต้องส่งได้และได้รับ Ticket ID + รหัสติดตาม
2. เปิดหน้า Status แล้วใช้ Ticket ID + รหัสติดตาม ต้องเห็นสถานะ
3. รีเฟรชหน้า Status ต้องเห็น Ticket ที่อุปกรณ์จำไว้
4. แนบไฟล์เปลี่ยนนามสกุลปลอม หรือไฟล์เกินขนาด ต้องถูกปฏิเสธฝั่ง Server
5. กรอกข้อความขึ้นต้นด้วย `=`, `+`, `-`, `@` แล้วตรวจ Sheet ต้องเป็นข้อความ ไม่ทำงานเป็นสูตร
6. รับเรื่อง > ดำเนินการ > ส่งต่อ Outsource > เสร็จสิ้น > ปิดงาน และตรวจ Worklog/เวลา
7. ลองรับเรื่อง Ticket ที่อยู่ระหว่างดำเนินการแล้ว Server ต้องไม่ยอมย้อนเป็น `รับเรื่องแล้ว`
8. ลบ Ticket จากหลังบ้าน ต้องเป็น soft-delete และกู้คืนจากถังขยะได้
