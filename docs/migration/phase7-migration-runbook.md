# Phase 7 — Public-safe migration runbook

Runbook นี้เป็น template สำหรับการซ้อม migration เท่านั้น ไม่ใช่คำสั่งให้แก้ production และไม่มีค่า environment จริง

## หลักการควบคุม

- ใช้ branch/PR ที่ตรวจสอบแล้วและห้ามแก้ `master` โดยตรง
- ใช้ database ที่สร้างใหม่หรือ staging ที่ได้รับอนุมัติเท่านั้น
- ห้ามใส่ข้อมูลจริง, PII, credential, connection string, token หรือ identifier ของ production ใน report
- ต้องมี backup/restore evidence และ rollback owner ก่อน migration ที่มีผลกระทบ
- migration ต้องทำก่อน deploy API/web ที่พึ่งพา schema ใหม่

## ขั้นตอนมาตรฐาน

1. ตรวจ clean working tree และตรวจ migration filename/order
2. สร้าง database ทดสอบใหม่จาก migration ทั้งชุด
3. รัน migration dry-run หรือ schema diff กับ target ที่ระบุเป็น `<TARGET_ENV>` ในระบบภายใน
4. รัน database tests, RLS tests, API tests และ browser smoke ด้วย test credentials
5. สร้าง reconciliation summary ที่มีเฉพาะ count/boolean/สถานะ ไม่ส่งออกแถวข้อมูลหรือค่าลับ
6. ขอ approval ตาม change-control policy
7. Apply migration แบบมี transaction/step boundary ตามที่ migration รองรับ
8. ตรวจ schema/runtime gate และ health check แบบ read-only
9. Deploy application ที่ตรงกับ schema
10. หาก gate ใดไม่ผ่าน ให้หยุดและใช้ rollback plan ที่อนุมัติแล้ว

## ตัวอย่างคำสั่งใน local/test เท่านั้น

```bash
npm ci
npm run migration:gate
npm run typecheck
npm run lint
npm run test
npm run build
```

คำสั่งที่ใช้กับ remote database ต้องเติมผ่าน CI protected environment และตัวแปรลับของ environment นั้น ห้ามเขียนค่าเหล่านั้นลงไฟล์หรือ command history

## หลักฐานที่ควรเก็บ

- commit/PR reference ที่ไม่เปิดเผยข้อมูลลับ
- ผล dry-run และ test summary แบบ redacted
- schema/runtime gate result
- approval และ rollback decision ในระบบ change management ภายใน
- post-release health result โดยไม่แนบ response body ที่มีข้อมูลผู้ใช้

## สิ่งที่ไม่เก็บใน repository

ไม่เก็บ database URL, project ID, account ID, deployment ID, release artifact ที่มี PII, raw reconciliation file, production log หรือ screenshot ของระบบจริง
