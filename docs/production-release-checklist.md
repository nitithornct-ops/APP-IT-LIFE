# Production release checklist

เอกสารนี้เป็น checklist สำหรับผู้อนุมัติ release ไม่ใช่คำสั่งให้ deploy อัตโนมัติ

## ก่อนอนุมัติ

- [ ] PR ใช้ branch ที่ไม่ใช่ `master` และมี reviewer ด้าน application/security
- [ ] ไม่มี secret, PII, production identifier, raw log หรือข้อมูล Ticket ใน diff/artifact
- [ ] `typecheck`, `lint`, unit/integration tests, coverage และ dependency audit ผ่าน
- [ ] migration gate และ database dry-run ผ่านบน test/staging database
- [ ] migration ใหม่ถูก apply ก่อน application ที่เรียกใช้ schema ใหม่
- [ ] Turnstile site key/secret และ hostname policy อยู่ใน protected environment secret store
- [ ] CORS, CSP, `PUBLIC_APP_URL`, API origin และ cache/service worker ถูกตรวจแล้ว
- [ ] backup/restore evidence และ rollback owner ได้รับการยืนยัน

## ระหว่าง release

1. ใช้ protected workflow ที่บังคับ approval และ typed confirmation
2. ตรวจ migration dry-run ก่อน apply
3. Apply migration ตามลำดับ แล้วตรวจ runtime/schema gate แบบ read-only
4. Synchronize Worker secrets โดยไม่ echo ค่าออก log
5. Deploy API แล้วจึง build/deploy web ที่ใช้ API contract เดียวกัน
6. ทำ health check/smoke ที่ไม่สร้างหรือแก้ข้อมูล production

## หลัง release

- [ ] ตรวจ login, logout, password reset และ vendor login ด้วย test account ที่ได้รับอนุญาต
- [ ] ตรวจ ticket reopen/signoff ผ่าน staff, requester web และ LINE test paths
- [ ] ตรวจ generic auth error, rate limit, CSP และ service worker cache behavior
- [ ] ตรวจ monitoring/alert และ rollback decision window
- [ ] เก็บหลักฐานแบบ redacted ในระบบ change management ภายใน

ห้าม merge หรือ deploy จากเอกสารนี้โดยอัตโนมัติ และห้ามใช้ bypass workflow หากไม่มี approval ใหม่ที่ตรวจสอบได้
