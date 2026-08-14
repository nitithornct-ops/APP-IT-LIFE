# ติดตั้ง APP_LIFE1 บน Supabase โปรเจกต์ใหม่

เอกสารนี้ใช้กับ Supabase CLI ที่ตรวจในโปรเจกต์นี้ (`2.113.0`) และ migration ล่าสุด
`20260907100000_form_studio.sql` เป้าหมายคือสร้างฐานใหม่จาก migration history ทั้งชุด ไม่ใช่ copy
Google Apps Script หรือใช้ Google Sheet เป็นฐานข้อมูลต่อ

## 1. ข้อมูลที่ต้องเตรียม

- Supabase Project Ref ของโปรเจกต์ใหม่
- Database password ของโปรเจกต์ใหม่
- Project URL, anon key และ service role key
- อีเมลจริงของผู้ดูแลระบบคนแรก
- URL ของ Web และ API ที่จะ deploy จริง

ห้าม commit database password, service role key, LINE token หรือ secret อื่นลง Git

## 2. ตรวจโค้ดก่อนแตะฐานข้อมูลจริง

รันจาก root ของ repository:

```powershell
npm.cmd run typecheck
npm.cmd test
```

ไฟล์ใน `supabase/tests/fixtures/` ใช้จำลอง Supabase Auth สำหรับ test เท่านั้น ห้ามรันกับโปรเจกต์จริง

## 3. Link โปรเจกต์ใหม่และตรวจรายการ SQL ก่อนรัน

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref <PROJECT_REF>
npx.cmd supabase db push --linked --include-all --include-seed --dry-run
```

อ่านรายการจาก `--dry-run` ให้ครบ ต้องเริ่มที่ `20260805100000_extensions.sql` และจบที่
`20260907100000_form_studio.sql` ถ้ามี error หรือมี SQL ที่ไม่คาดหมายให้หยุดก่อน

## 4. Run all SQL บน Supabase ใหม่

เมื่อผล dry-run ถูกต้อง:

```powershell
npx.cmd supabase db push --linked --include-all --include-seed
npx.cmd supabase migration list --linked
```

คำสั่งแรกจะทำสองส่วนตามลำดับ:

1. รัน `supabase/migrations/*.sql` ตาม timestamp
2. รัน `supabase/seed.sql` ผ่านค่า `[db.seed]` ใน `supabase/config.toml`

ไม่ควรรวม migration ทั้งหมดเป็น SQL ก้อนเดียว และไม่ควรรัน seed ก่อน migration

ถ้าคำว่า “run WAL” หมายถึง PostgreSQL Write-Ahead Log: ไม่ต้องเปิดเอง Supabase จัดการ WAL ให้แล้ว และ
APP_LIFE1 ปัจจุบันไม่ได้พึ่ง Realtime publication สำหรับหน้า Ticket หากภายหลังต้องใช้ Realtime ให้เปิดเฉพาะตารางที่
ผ่าน security review ห้ามเพิ่มทุกตารางเข้า `supabase_realtime` โดยอัตโนมัติ

## 5. ตรวจ master data หลังรัน

รันใน Supabase SQL Editor แบบ read-only:

```sql
select key, name_th from public.roles order by key;
select key from public.permissions where key like 'ticket.%' or key = 'ticket_category.manage' order by key;
select name, default_priority, response_sla_hours, resolution_sla_hours
from public.ticket_categories
where status = 'active'
order by sort_order, name;
select code, ticket_value, name_th, pauses_sla, is_terminal
from public.ticket_statuses
order by sort_order;
select code, ticket_value, name_th
from public.ticket_priorities
order by sort_order;
```

ผล Helpdesk ที่ต้องได้อย่างน้อย:

- Ticket categories เดิม 7 รายการ
- Priority 4 ค่า: ต่ำ, ปานกลาง, สูง, วิกฤต
- Status 10 ค่า และ `ส่งต่อ Outsource` ต้องไม่ pause SLA
- Transition 45 เส้นทาง
- Permission `ticket.triage` และ `ticket.escalate`

### ตรวจอัตโนมัติว่าฐานข้อมูลตรงกับโค้ดจริง

การอ่าน `migration list` ด้วยตาไม่พอ — migration ที่รันไม่ครบจะทำให้โค้ดอ้างถึงคอลัมน์ที่ไม่มีอยู่ และ
typecheck/lint/unit test จะยังผ่านหมดทั้งที่หน้ารายการ Ticket ใช้งานไม่ได้ ให้รันตัวตรวจนี้ทุกครั้งหลังตั้งฐานใหม่
และก่อน deploy (workflow `Deploy Production` เรียกให้อัตโนมัติอยู่แล้ว):

```powershell
npm.cmd run runtime:gate
```

ในเครื่องตัวเองไม่ต้องตั้ง environment variable เอง ตัวตรวจจะอ่าน `SUPABASE_URL`, `SUPABASE_ANON_KEY`
และ `SUPABASE_SERVICE_ROLE_KEY` จาก `apps/api/.dev.vars` (ไฟล์ที่ถูก git ignore) ให้อัตโนมัติเมื่อยังไม่มีค่าใน
environment จึงไม่ต้องวาง service role key ลง terminal ให้ติดอยู่ใน history ส่วนบน CI ไม่มีไฟล์นี้ จะใช้ค่าจาก
secret ของ workflow ตามเดิม ถ้าจะตรวจโปรเจกต์อื่นให้ตั้ง environment variable ทับได้

ตัวตรวจจะเทียบตารางทั้งหมดที่ migration สร้าง คอลัมน์ที่ route handler เรียกใช้จริง แถว `system_settings`
ที่ API ต้องมี และการตั้งค่า Supabase Auth (ต้องปิด public sign-up และปิด anonymous sign-in)
โดยไม่พิมพ์ค่า secret ใด ๆ ออกมา

## 6. สร้างผู้ดูแลระบบคนแรก

ใส่ `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ของโปรเจกต์ใหม่ใน environment ชั่วคราวหรือ
`apps/api/.dev.vars` ที่ถูก ignore แล้วรัน:

```powershell
node scripts/bootstrap-admin.mjs --email=admin@company.com --name="ชื่อผู้ดูแลระบบ"
```

สคริปต์ส่ง invitation ผ่าน Supabase Auth และมอบ role `super_admin` โดยไม่ตั้งหรือพิมพ์รหัสผ่าน

จากนั้นตั้ง Supabase Auth:

- ปิด public sign-up
- ตั้ง Site URL เป็น Web production URL
- เพิ่ม redirect URL สำหรับหน้า `/reset-password`
- ตรวจ email provider/SMTP ก่อนเชิญผู้ใช้จริงจำนวนมาก

## 7. ตั้งค่า Web และ API

Web (`apps/web/.env.local` สำหรับ local และ environment ของ hosting สำหรับ production):

```text
VITE_API_BASE_URL=<API_URL>
VITE_SUPABASE_URL=<SUPABASE_URL>
VITE_SUPABASE_ANON_KEY=<ANON_KEY>
```

API (`apps/api/.dev.vars` สำหรับ local; production ใช้ secret ของ Cloudflare Worker):

```text
SUPABASE_URL=<SUPABASE_URL>
SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
ALLOWED_ORIGINS=<WEB_URL>
PUBLIC_APP_URL=<WEB_URL>
```

ตั้ง secret production ทีละรายการ ห้ามนำค่าจริงไปใส่ `wrangler.toml`:

```powershell
npx.cmd wrangler secret put SUPABASE_URL --cwd apps/api
npx.cmd wrangler secret put SUPABASE_ANON_KEY --cwd apps/api
npx.cmd wrangler secret put SUPABASE_SERVICE_ROLE_KEY --cwd apps/api
npx.cmd wrangler secret put ALLOWED_ORIGINS --cwd apps/api
npx.cmd wrangler secret put PUBLIC_APP_URL --cwd apps/api
```

LINE เป็น optional ให้ตั้งเฉพาะเมื่อจะเปิด LINE Login/Notification ตาม `.dev.vars.example`

## 8. ย้ายข้อมูล Legacy อย่างปลอดภัย

อย่ารัน import ครั้งแรกลง production ใช้ rehearsal project ก่อน:

```powershell
npm.cmd run dry-run --workspace=packages/migration
npm.cmd run test --workspace=packages/migration
npm.cmd run test --workspace=supabase
```

จากนั้นทำตาม `docs/migration/phase7-migration-runbook.md` โดยต้องมี real legacy workbook export และ Settings
allowlist ตรวจ reconciliation report, unresolved attachments และ exception ทุกแถวก่อนอนุมัติ production import

## 9. Smoke test ก่อนเปิดใช้

- Login ด้วย super_admin ได้
- หน้า `/tickets` แสดง KPI, filter, category และเลข `TCK-YYYYMMDD-16HEX`
- เปิด Ticket แล้วเกิด worklog `เปิด Ticket`
- ทดสอบรับเรื่อง, มอบหมาย, pause/resume SLA, ปิดงาน และเปิดงานซ้ำตาม role
- ทดสอบ `/report` ทั้ง แจ้งซ่อม, วิธีแก้เบื้องต้น และติดตามสถานะ
- ตรวจ RLS ด้วย user/approver/technician/ITAdmin อย่างน้อยหนึ่งบัญชีต่อ role
- ตรวจ private attachment signed URL, notification และ audit log
- สำรองฐานและเตรียม rollback ก่อน cutover จริง
