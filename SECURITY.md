# Security and Public Repository Rules

Repository นี้เป็น **public repository** จึงถือว่าไฟล์ทุกไฟล์, commit history, pull request, Actions artifact และ release ที่ผูกกับ repository อาจถูกเข้าถึงได้โดยบุคคลภายนอก

## ห้าม commit ข้อมูลต่อไปนี้

- รหัสผ่าน, API key, access token, refresh token, JWT, private key, service-account key และ connection string ของฐานข้อมูล
- ค่า secret ของ Supabase, Cloudflare, LINE, Google, GitHub หรือผู้ให้บริการภายนอก
- ไฟล์ `.env`, `.env.local`, `.dev.vars` หรือไฟล์ตั้งค่าที่มีค่าจริง
- ข้อมูลส่วนบุคคล เช่น ชื่อ อีเมล เบอร์โทรศัพท์ เลขประจำตัว ข้อมูลพนักงาน ข้อมูลผู้แจ้ง และข้อมูลจาก Ticket
- ไฟล์แนบ, log, backup, database dump, spreadsheet export และข้อมูล migration ที่มีค่าในแถวจริง
- URL ภายใน, private IP, รหัสโครงการ/บัญชี, Spreadsheet ID, deployment ID, ชื่อระบบ production และภาพหน้าจอจาก production
- บัญชี UAT, TOTP secret, cookie/session, test fixture หรือ seed ที่มีข้อมูลจริง/credential ที่ใช้ได้จริง

ไฟล์ตัวอย่างต้องมีเฉพาะชื่อ variable หรือค่า placeholder ที่ใช้ไม่ได้จริงเท่านั้น

## จุดที่ต้องตรวจสอบก่อนถือว่า repository นี้ปลอดภัยสำหรับ public

จากโครงสร้างปัจจุบัน ควรตรวจและพิจารณาย้ายออกจาก public repository เป็นพิเศษ:

- `docs/AI-CONTINUATION-HANDOFF.md`
- `docs/migration/phase0-*` และ `docs/migration/phase7-*`
- `legacy-gas/docs/evidence/`
- ไฟล์ใน `legacy-gas/docs/` ที่เป็น production rollout, production verification หรือคู่มือการตั้งค่าระบบจริง
- ไฟล์ seed, fixture, report และ migration output ทุกไฟล์ว่ามีข้อมูลจริงหรือ identifier ภายในหรือไม่

การเพิ่มชื่อไฟล์ลง `.gitignore` **ไม่ถอนข้อมูลที่เคย commit แล้ว** หากพบข้อมูลที่ไม่ควรเปิดเผย ต้องลบจาก working tree และตรวจ/ล้าง Git history ตามขั้นตอนที่เหมาะสมด้วย

## แนวทางเก็บความลับ

- ใช้ GitHub Actions Secrets/Environment Secrets, Cloudflare Secrets หรือ secret manager ที่ได้รับอนุมัติ
- Service Role และ database connection string ต้องอยู่ฝั่ง backend/งาน migration ที่ควบคุมสิทธิ์เท่านั้น ห้ามใส่ใน Frontend หรือไฟล์ public
- ใช้ private bucket และ signed URL สำหรับไฟล์แนบ
- ใช้ข้อมูลสังเคราะห์ใน test/seed และแยก environment development, staging และ production
- จำกัดสิทธิ์ token ตามหลัก least privilege และกำหนดวันหมดอายุ/รอบหมุนเวียน
- เปิดใช้ GitHub Secret Scanning และ Push Protection หากการตั้งค่าองค์กรรองรับ

## ตรวจสอบก่อน commit

อย่างน้อยให้ตรวจ:

```bash
git status --short
git diff --cached --name-only

# ค้นหาไฟล์ที่มักมีความลับหรือข้อมูลจริง
git ls-files | rg '(^|/)(\.env|\.dev\.vars)(\.|$)|backup|dump|export|evidence|screenshot|\.sql\.gz$'

# ค้นหารูปแบบที่ไม่ควรปรากฏใน source
git grep -nE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_|github_pat_|SUPABASE_SERVICE_ROLE|postgres(ql)?://|Bearer [A-Za-z0-9._-]+'
```

การตรวจนี้เป็นเพียงตัวช่วย ไม่ใช่หลักฐานว่าไม่มีข้อมูลรั่ว เพราะ secret อาจอยู่ใน history, artifact, cache, issue, PR หรือไฟล์ binary ได้

## หากพบ secret หรือข้อมูลจริงหลุด

1. ยกเลิก/หมุน secret หรือ credential ทันที อย่ารอเพียงแก้ไฟล์แล้ว commit ใหม่
2. ตรวจ Git history, Actions logs/artifacts, releases, pull requests และเครื่องมือสำรองที่เกี่ยวข้อง
3. ลบข้อมูลออกจาก branch ปัจจุบันและล้าง history ตามขั้นตอนที่อนุมัติ
4. ตรวจ audit log ของ Supabase, Cloudflare, LINE, Google และบริการที่เกี่ยวข้อง
5. ประเมินว่ามีข้อมูลส่วนบุคคลหรือข้อมูลความมั่นคงปลอดภัยถูกเข้าถึงหรือไม่ และดำเนินการตาม incident/breach procedure ขององค์กร
6. อย่าเปิดเผยรายละเอียดของ secret หรือข้อมูลส่วนบุคคลใน public issue

## การรายงานช่องโหว่

ไม่ควรรายงานช่องโหว่หรือข้อมูลรั่วผ่าน public issue ให้ติดต่อผู้ดูแล repository ผ่านช่องทางส่วนตัวขององค์กร พร้อมระบุผลกระทบ ขั้นตอนทำซ้ำ และหลักฐานที่ลบ/ปกปิดข้อมูลสำคัญแล้ว
