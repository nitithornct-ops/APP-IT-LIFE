# Production Deployment Runbook

เอกสารนี้เป็น gate สำหรับ Production ของ LIFE IT Smart Service Center การ deploy จริงทำผ่าน
GitHub Actions workflow `Deploy Production` จาก branch `master` เท่านั้น และต้องใช้ GitHub
Environment ชื่อ `production` ที่กำหนด required reviewers ไว้แล้ว

## 1. สิ่งที่ต้องผ่านก่อนเริ่ม

- PR Checks บน commit เดียวกับที่จะ deploy ต้องผ่านทั้งหมด: typecheck, lint, unit tests, build,
  production dependency audit, browser smoke test และ migration dry-run
- Workflow `Staging Live E2E` ต้องผ่านครบทุก live suite บน Supabase staging และต้องเก็บ URL/run ID
  ไว้เป็น `staging_e2e_run_ref` โดย run ต้องเป็น workflow `.github/workflows/staging-e2e.yml`, สำเร็จบน
  `master` commit SHA เดียวกับที่จะ deploy และอายุไม่เกิน 72 ชั่วโมง ระบบจะตรวจผ่าน GitHub API ก่อน deploy

### 1.0 เลือก `staging_e2e_mode`

**`verified`** (ค่าเริ่มต้น) — ตามเงื่อนไขข้างบนทุกข้อ ใช้กับทุกรุ่นตามปกติ

**`deferred`** — ใช้ได้เฉพาะเมื่อ environment `staging` ยังตั้งค่าไม่ครบจน Staging Live E2E รันไม่ได้เลย

- ต้องกรอก `staging_e2e_defer_confirm` เป็น `NO-STAGING-EVIDENCE` และยังบังคับ `migration_approval_ref`
  เหมือนเดิม เพื่อให้ย้อนตรวจได้ว่าใครสั่งเลื่อนและอ้างอิงเอกสารใด
- ปล่อย `staging_e2e_run_ref` ว่างไว้ — ด่าน `npm run predeploy` รับคำประกาศแทนเลข run ในโหมดนี้
- ด่านจะพิมพ์ `::warning` ติดไว้ในหน้า run ว่า commit นี้ขึ้น Production โดยไม่มีหลักฐาน E2E
- **สิ่งที่แลกไป:** ไม่มีอะไรยืนยันว่า flow จริง (login/MFA, ticket, vendor portal, report) ยังทำงาน
  บนข้อมูลจริง — regression จะถูกพบที่ Production เท่านั้น ต้องเฝ้า smoke test ในข้อ 4 ให้ครบ
- เมื่อตั้งค่า staging ครบแล้วให้กลับไปใช้ `verified` ทันที โหมดนี้ไม่ใช่ค่าปกติของโครงการ

### 1.1 เลือก `migration_mode` ให้ตรงกับรุ่นที่ปล่อย

ด่าน `npm run migration:gate` มีสองโหมด และ **ทั้งสองโหมดบังคับ `migration_approval_ref` เสมอ** —
ไม่มีเส้นทางใดที่ deploy ได้โดยไม่มีผู้รับผิดชอบที่ระบุตัวได้

**`legacy-import`** — รุ่นที่ยกข้อมูลจากระบบเดิมบน Google Sheets เข้ามาด้วย

- ต้องมี `docs/migration/phase7-rehearsal-report.json` จากข้อมูล legacy จริง รายงานต้องมี SQL/Auth
  failure เป็นศูนย์, ไม่มี unverified sheet และมี owner approval/change ticket
- Attachment exception ทุกไฟล์ต้องถูกตรวจ checksum/upload result หรือบันทึกเหตุผลและอนุมัติ
- บันทึกผลเป็น `docs/migration/phase7-attachment-report.json` ตามไฟล์ `.example.json` โดยห้ามมี
  URL/File ID ต้นทาง และยอด uploaded/archived/unresolved ต้อง reconcile กับ rehearsal report

**`fresh-start`** — รุ่นที่ไม่นำเข้าข้อมูลเดิมเลย ผู้ใช้กรอกใหม่ทั้งหมด

- ต้องกรอก `fresh_start_confirm` เป็น `NO-LEGACY-DATA` เพื่อประกาศเจตนาอย่างชัดเจนและตรวจสอบย้อนหลังได้
- ด่านจะ **ปฏิเสธ** ถ้าพบ `phase7-rehearsal-report.json` อยู่จริง เพราะขัดกับคำประกาศ — ต้องให้คน
  ตัดสินว่าโหมดไหนถูก ไม่ใช่ให้สคริปต์เดา
- Export/backup ฐาน Production ต้องเสร็จและทดสอบว่าสามารถอ่านไฟล์สำรองได้
- UAT sign-off, maintenance window, change owner, rollback owner และช่องทางสื่อสารต้องระบุใน change ticket

## 2. GitHub Environment configuration

ตั้งค่า Variables:

- `PRODUCTION_WEB_URL` — HTTPS origin ของ Cloudflare Pages ไม่มี `/` ปิดท้าย
- `PRODUCTION_API_URL` — HTTPS origin ของ Worker
- `CLOUDFLARE_PAGES_PROJECT`
- `LINE_LOGIN_ENABLED` และ `NOTIFY_LINE_ENABLED` เป็น `true` เฉพาะเมื่อ integration ผ่านการทดสอบแล้ว
- `LINE_LOGIN_CALLBACK_URL` เมื่อเปิด LINE Login

ตั้งค่า Secrets:

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`
- LINE secrets ตาม feature ที่เปิด: `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET`,
  `LINE_SESSION_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_DEFAULT_TO`
- เมื่อเปิด `NOTIFY_LINE_ENABLED=true` การแจ้งเตือน in-app ทุกโมดูลจะส่งคู่ทาง LINE ให้ผู้ใช้ที่มี
  บัญชี LINE สถานะ `Active`; เหตุการณ์ Ticket ที่มี Flex Message เฉพาะทางจะกันการส่งซ้ำไว้แล้ว
  ข้อความตอบกลับของผู้ใช้ยังเข้าสู่ LINE OA Manager ตามการตั้งค่า Chat เดิม

Environment `staging` ต้องมี Supabase keys, อีเมล UAT ของ Requester/Technician/Approver/Manager/Admin,
TOTP secret ของ Technician/Approver/Manager/Admin และ `UAT_VENDOR_CODE`, `UAT_VENDOR_EMAIL`,
`UAT_VENDOR_PASSWORD` ให้ครบ ส่วนข้อมูล Ticket สำหรับทดสอบจะถูกสร้างและล้างในแต่ละรอบ หากขาด
credential/secret ใด หรือมี test ถูก skip แม้แต่รายการเดียว Staging Live E2E จะ fail แทนการแสดงผลเขียว

Supabase Auth ต้องปิด public sign-up, ตั้ง Site URL/redirect URL เป็น Production, ตั้ง SMTP และสร้าง
ผู้ดูแลระบบคนแรกด้วย `scripts/bootstrap-admin.mjs` ผ่านช่องทางที่ควบคุมสิทธิ์

### 2.0 ส่งออกไป Google Sheets (ไม่บังคับ)

ปิดอยู่เป็นค่าเริ่มต้น ถ้าไม่ตั้งค่า ปุ่ม "ส่งไป Google Sheets" จะไม่ขึ้นให้ผู้ใช้เห็นเลย ระบบยังทำงาน
ครบทุกอย่างเหมือนเดิม — Supabase Storage ยังเป็นที่เก็บไฟล์หลักของระบบ ส่วน Drive เป็นปลายทาง
ส่งออกอย่างเดียว

ขั้นตอนตั้งค่าฝั่ง Google:

1. สร้าง Service Account ใน Google Cloud แล้วเปิดใช้งาน **Google Drive API** ในโปรเจกต์เดียวกัน
   จากนั้นสร้าง key ชนิด JSON เก็บไว้
2. สร้าง **Shared Drive** (หรือโฟลเดอร์ในนั้น) แล้วเชิญอีเมลของ Service Account เป็น *Content manager*
   — Service Account ไม่มีพื้นที่เก็บของตัวเอง การอัปโหลดลง My Drive จะได้ `storageQuotaExceeded`
   ทันที ปลายทางจึงต้องเป็น Shared Drive เท่านั้น
3. เก็บรหัสโฟลเดอร์ปลายทางจาก URL ของโฟลเดอร์นั้น

ตั้งค่าใน GitHub Environment `production`:

- Variables: `GOOGLE_DRIVE_ENABLED` = `true` เมื่อทดสอบผ่านแล้วเท่านั้น
- Secrets: `GOOGLE_SA_CLIENT_EMAIL` (ค่า `client_email` ในไฟล์ JSON), `GOOGLE_SA_PRIVATE_KEY`
  (ค่า `private_key` ทั้งก้อนรวมบรรทัด BEGIN/END), `GOOGLE_DRIVE_FOLDER_ID`

Worker ถือ credential ไว้ฝั่งเดียว หน้าเว็บไม่เคยคุยกับ Google โดยตรง จึงไม่ต้องแก้ `connect-src`
ใน CSP และไฟล์ที่ส่งออกจะถูกจัดเก็บเป็นโฟลเดอร์รายปี พ.ศ. ใต้โฟลเดอร์ปลายทาง แบบเดียวกับระบบเดิม

ทุกครั้งที่มีการส่งออกจะถูกบันทึกลง audit log (`module = google_drive`) ทั้งครั้งที่สำเร็จและครั้งที่ล้ม
เพราะเป็นการนำข้อมูลออกนอกระบบ ถ้าต้องการปิดฟีเจอร์นี้ทันทีโดยไม่ deploy ใหม่ ใช้
`npx wrangler secret put GOOGLE_DRIVE_ENABLED --env production` แล้วใส่ค่า `false`

### 2.1 Environment `backup` (แยกจาก `production`)

Workflow `Backup` ทำงาน **เมื่อกดสั่งเท่านั้น** (Actions → Backup → Run workflow) ไม่มี schedule
ตามการตัดสินใจของผู้ดูแลระบบ 2026-08-14 — ผลที่ตามมาคือ **ข้อมูลที่เกิดขึ้นหลังการกดครั้งล่าสุด
จะไม่มีสำเนา** จึงต้องกดหลังงานสำคัญทุกครั้ง (นำเข้าข้อมูลจำนวนมาก, ก่อน deploy) และตามรอบที่
หน่วยงานกำหนด ถ้าภายหลังต้องการให้รันเอง เพิ่ม `schedule:` กลับเข้าไปใน `on:` ได้ทันที

สร้าง environment ชื่อ `backup` โดย **ไม่ตั้ง required reviewer** — การสำรองข้อมูลไม่เปลี่ยนแปลง
อะไรในระบบ อ่านออกมาเก็บอย่างเดียว จึงไม่ควรต้องรอใครอนุมัติ

- Secrets: `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- Variables: `R2_BACKUP_BUCKET`, `BACKUP_KEEP_COUNT` (ไม่ใส่ = เก็บ 10 ชุดล่าสุด)

`BACKUP_KEEP_COUNT` นับเป็น **จำนวนชุด ไม่ใช่จำนวนวัน** โดยตั้งใจ เพราะงานที่กดเองไม่มีระยะห่าง
ที่แน่นอน ถ้าใช้เกณฑ์อายุ การเว้นช่วงนานแล้วกดครั้งเดียวจะลบสำเนาเก่าทิ้งทั้งหมดจนเหลือชุดเดียว

ไฟล์สำรองมีข้อมูลส่วนบุคคลและ hash รหัสผ่านจาก `auth.users` — bucket ต้องเป็น private และ R2 API
token ต้องจำกัดสิทธิ์ไว้ที่ bucket นี้ bucket เดียว

#### สำเนาที่สองบน Google Drive (ไม่บังคับ)

R2 ยังเป็นที่เก็บสำเนาหลัก ขั้นตอนนี้เพิ่มสำเนาไว้คนละผู้ให้บริการเท่านั้น เพราะเหตุที่ทำให้เข้าถึง R2
ไม่ได้ (บัญชีถูกระงับ, token ถูกเพิกถอน, ลบผิดชุด) มักไม่ใช่เหตุเดียวกับที่ทำให้เข้าถึง Drive ไม่ได้พร้อมกัน

- Variables: `BACKUP_TO_DRIVE_ENABLED` = `true` เพื่อเปิด (ไม่ตั้ง = ข้ามขั้นตอนนี้ไปเงียบ ๆ ตามตั้งใจ)
- Secrets: `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (ชุดเดียวกับ §2.0 ได้),
  `GOOGLE_DRIVE_BACKUP_FOLDER_ID`

**`GOOGLE_DRIVE_BACKUP_FOLDER_ID` ต้องเป็นคนละโฟลเดอร์กับ `GOOGLE_DRIVE_FOLDER_ID` ของ §2.0**
— โฟลเดอร์ส่งออกรายงานเปิดให้คนในทีมเข้าดู แต่ไฟล์สำรองมีข้อมูลส่วนบุคคลและ hash รหัสผ่าน
`scripts/backup-to-drive.mjs` จะหยุดงานทันทีถ้าพบว่าสองค่านี้ชี้ไปที่โฟลเดอร์เดียวกัน โฟลเดอร์สำรอง
ข้อมูลควรแชร์ให้เฉพาะผู้ดูแลระบบเท่านั้น

เมื่อเปิดใช้งานแล้ว ถ้าตั้ง secret ไม่ครบ ขั้นตอนตรวจค่าตั้งต้นจะ fail พร้อมบอกชื่อที่ขาด ไม่ใช่รันจนจบ
แล้วได้สำเนาเดียว ไฟล์ที่อัปโหลดจะถูกอ่านขนาดกลับมาเทียบกับต้นฉบับทุกครั้ง และยังไม่มีการลบชุดเก่า
อัตโนมัติเหมือนฝั่ง R2 — ต้องดูพื้นที่ของ Shared Drive เป็นระยะ

## 3. ลำดับ deploy

1. เปิด Actions → `Staging Live E2E` และเก็บหลักฐานผลผ่าน
2. สร้าง backup และบันทึก backup ID/timestamp ลง change ticket — รัน Actions → `Backup` แล้วเก็บชื่อไฟล์
   `itlife-backup-<เวลา UTC>.tar.gz` ที่ workflow รายงานไว้
3. เปิด Actions → `Deploy Production` จาก `master`
4. ใส่ `DEPLOY`, migration approval reference, เลือก `migration_mode` (พร้อม `fresh_start_confirm`
   เมื่อเลือก `fresh-start`), Staging E2E reference และยืนยัน attachment review
5. GitHub Environment reviewer ตรวจ commit SHA, backup และหลักฐานก่อน approve
6. Workflow จะตรวจ config/migration gate, รัน release verification, dry-run migration แล้วจึงเรียง
   Database → Worker API → Cloudflare Pages
7. ห้ามแก้ Worker vars/secrets ผ่าน Dashboard หลัง deploy เพราะ config และ workflow เป็น source of truth

## 4. Post-deploy verification

- `/api/v1/health` ต้องตอบ `status: ok` และ database check เป็น `ok`
- Login, reset password และ permission menu ถูกต้องอย่างน้อย role: user, approver, technician, auditor, IT admin
- ทดสอบ Ticket create/assign/SLA/pause/resume/resolve/reopen และ public ticket tracking
- ตรวจ private attachment signed URL, audit log, login log, notification และ scheduled reminder
- ทดสอบ report CSV/PDF; PDF ต้องเห็น Browser Rendering binding `MYBROWSER`
- ตรวจ CORS, CSP/security headers และยืนยัน origin อื่นเรียก API ไม่ได้
- ตรวจ Worker logs/429 metrics และ Cloudflare security events ช่วง 30 นาทีแรก

หาก smoke test สำคัญข้อใดไม่ผ่าน ให้หยุดรับ traffic/cutover และทำตาม `docs/rollback.md` ทันที

## 5. Go-live record

บันทึก commit SHA, GitHub run URL, Supabase migration list, Worker version ID, Pages deployment ID,
backup ID, ผู้อนุมัติ, เวลาเริ่ม/จบ และผล smoke test ลง change ticket ทุกครั้ง
