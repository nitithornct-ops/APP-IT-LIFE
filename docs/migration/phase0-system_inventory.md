# Phase 0 — Public-safe system inventory

เอกสารนี้เป็น inventory เชิงสถาปัตยกรรมสำหรับ repository สาธารณะเท่านั้น

ห้ามใส่ข้อมูลต่อไปนี้ในไฟล์นี้หรือ commit ใด ๆ:

- ชื่อ project, account, tenant, database, Worker หรือ Pages ที่ใช้งานจริง
- URL ภายใน, deployment ID, job/run ID, release SHA หรือข้อมูลระบุ environment แบบเจาะจง
- email, ชื่อบุคคล, เบอร์โทร, Ticket, ไฟล์แนบ, access token, password, secret หรือ PII
- export จาก production, migration dump, log หรือ screenshot ที่ยังไม่ redact

## ขอบเขตระบบ

| ส่วนประกอบ | หน้าที่ | ขอบเขตข้อมูล |
| --- | --- | --- |
| `apps/web` | React/Vite frontend และ browser-only tools | รับเฉพาะ public configuration ที่ไม่ใช่ secret |
| `apps/api` | Cloudflare Worker/Hono API, validation, authorization และ integrations | เป็น trust boundary สำหรับ service role และ provider secrets |
| `supabase` | PostgreSQL migrations, RLS, Auth และ private Storage policy | เป็น source of truth ของข้อมูลธุรกิจ |
| `packages/shared` | schema, type และ permission contract ที่ใช้ร่วมกัน | ไม่มี runtime credentials |
| `packages/migration` | เครื่องมือเตรียม/ตรวจคุณภาพข้อมูลก่อนย้าย | ใช้กับข้อมูลที่ anonymize หรือได้รับอนุญาตเท่านั้น |

## เส้นทางข้อมูลที่อนุมัติ

```text
Browser → API validation/authz → Supabase RLS/transaction → audit/notification
```

Frontend ห้ามเชื่อมต่อด้วย service-role credential และห้ามถือข้อมูลลับเกินอายุ request/session ที่จำเป็น

## Environment record แยกจาก repository

รายละเอียดของแต่ละ environment ต้องเก็บในระบบจัดการ secrets/configuration ที่ได้รับอนุมัติ โดยใช้ชื่อมาตรฐานจากไฟล์ตัวอย่าง เช่น `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY` และ `PUBLIC_APP_URL` เท่านั้น ไฟล์นี้จงใจไม่บันทึกค่า ตัวระบุ หรือผลตรวจของ environment จริง

## Gate ก่อน release

1. ตรวจ `typecheck`, `lint`, unit/integration tests, coverage และ dependency audit
2. ตรวจ migration ด้วย dry-run และ test database ที่สร้างใหม่
3. ตรวจ RLS, Auth, CORS, CSP, rate limit, anti-bot และ public response ว่าไม่เปิดเผยข้อมูล
4. ตรวจ staging evidence ตาม workflow ของ repository
5. ให้ผู้มีอำนาจอนุมัติ release และ rollback plan แยกจาก source repository

## การแก้ไขเอกสาร

หากจำเป็นต้องอ้างอิงค่าเฉพาะ ให้ใส่ในระบบเอกสารภายในที่มี access control ไม่ใช่ในไฟล์นี้ และตรวจ secret scan ก่อนเปิด PR
