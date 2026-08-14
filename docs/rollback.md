# Production Rollback Runbook

Rollback owner ต้องตัดสินใจจากผลกระทบ ไม่รอแก้สดใน Production หากพบ login ใช้ไม่ได้, RLS/RBAC
รั่ว, data corruption, migration ล้มเหลว, error rate สูงต่อเนื่อง หรือ critical workflow ใช้งานไม่ได้

## 1. Containment

1. ประกาศ incident และหยุด deployment/cutover เพิ่มเติม
2. หาก public intake เป็นต้นเหตุ ให้ตั้ง `PUBLIC_TICKET_FORM_ENABLED=false` ที่ Worker production
3. เก็บ request ID, Worker logs, deployment/version ID และเวลาที่เริ่มมีปัญหา
4. ห้ามลบ migration history หรือแก้ข้อมูล Production แบบ ad-hoc

## 2. Web rollback

เลือก Cloudflare Pages deployment ของ commit ก่อนหน้าแล้วใช้ Rollback to this deployment จาก
Dashboard จากนั้นตรวจ `/login`, static assets และ SPA deep links หาก CLI/API automationถูกเพิ่มภายหลัง
ต้องบันทึก deployment ID เดิมและใหม่ลง change ticket เช่นกัน

## 3. Worker rollback

ดู version ก่อนหน้าและ rollback โดยใช้ credentials ของ GitHub Environment `production`:

```powershell
npm.cmd exec --workspace=apps/api -- wrangler versions list --env production
npm.cmd exec --workspace=apps/api -- wrangler rollback <VERSION_ID> --env production --message "rollback <CHANGE_REF>" --yes
```

หลัง rollback ตรวจ health, CORS, secrets/bindings, cron และ endpoint สำคัญ อย่า rollback Worker ไปยัง
version ที่คาดหวัง schema ใหม่กว่าฐานข้อมูลปัจจุบัน

## 4. Database recovery

- ถ้า migration ยังไม่เริ่ม: หยุด workflowและไม่ต้องเปลี่ยนฐานข้อมูล
- ถ้าเป็น additive migration และ API/Web เก่ายังรองรับ: rollback application ก่อน แล้วสร้าง forward-fix migration
- ถ้ามี destructive migration หรือข้อมูลเสีย: ปิด write traffic และ restore จากไฟล์สำรองตามขั้นตอน 4.1
- ห้ามแก้ migration เดิมที่เคย apply แล้ว ให้เพิ่ม migration ใหม่ที่ตรวจสอบและอนุมัติ
- หลัง restore ให้เทียบ row counts, foreign keys, Auth users, storage objects และ reconciliation report

### 4.1 Restore จากไฟล์สำรองบน Cloudflare R2

Supabase free tier **ไม่มี Point-in-time recovery** จุดกู้คืนที่มีจริงคือไฟล์สำรองจาก workflow `Backup`
เท่านั้น ซึ่งหมายความว่าข้อมูลที่เกิดขึ้นหลังไฟล์สำรองล่าสุดจะสูญหาย — ต้องแจ้ง impact นี้ใน incident เสมอ

Restore ทำเข้า **โปรเจกต์ Supabase ใหม่ที่ยังว่าง** ไม่ใช่ทับของเดิม เพื่อให้ยังตรวจสอบต้นตอจากของเดิมได้

```bash
aws s3 cp "s3://$R2_BUCKET/itlife-backup-<STAMP>.tar.gz" . --endpoint-url "$R2_ENDPOINT"
tar -xzf itlife-backup-<STAMP>.tar.gz

psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f db-public.sql   # โครงสร้าง + ข้อมูล + RLS + GRANT
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f db-auth.sql     # บัญชีผู้ใช้ ต้องทำหลัง db-public.sql
```

จากนั้นอัปโหลดไฟล์ใน `attachments/` และ `branding/` กลับเข้า Storage bucket ชื่อเดิม แล้ว**ตรวจ SHA-256
ทุกไฟล์กับ `manifest.json`** ก่อนประกาศว่ากู้คืนสำเร็จ สุดท้ายชี้ `SUPABASE_URL`/key ของ Worker และ Pages
ไปยังโปรเจกต์ใหม่

ข้อควรรู้: ไฟล์สำรองมี hash รหัสผ่านและข้อมูลส่วนบุคคล — เครื่องที่ใช้ restore ต้องเป็นเครื่องที่ควบคุมได้
และต้องลบไฟล์ที่แตกไว้ทิ้งเมื่อจบงาน

## 5. Verification and closure

รัน smoke test ชุดเดียวกับ `docs/deployment.md`, ยืนยัน audit trail และข้อมูลช่วง deployment window,
บันทึก root cause/impact/data recovery point และเปิด corrective action ก่อนปิด incident
