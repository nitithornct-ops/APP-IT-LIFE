# AI continuation handoff — public-safe template

เอกสารนี้อธิบายวิธีส่งต่องานใน repository โดยไม่เปิดเผย environment หรือข้อมูลของผู้ใช้งานจริง

## ก่อนเริ่มงาน

- ตรวจ branch และ working tree
- อ่าน request ล่าสุดและ scope ที่อนุมัติ
- ห้ามใช้ `master` เป็น working branch และห้าม reset/checkout ทับงานของผู้ใช้
- ใช้ `apply_patch` สำหรับการแก้ไฟล์
- ใน Windows ที่ policy บล็อก PowerShell script ให้เรียก `npm.cmd`/`npx.cmd`
- ห้ามเปิดเผยค่าจาก `.env`, `.dev.vars`, CI secrets หรือ production logs

## จุดตรวจที่ต้องรักษา

- Frontend เรียก API ผ่าน contract ที่ตรวจด้วย schema
- Backend ตรวจ authentication, authorization, input และ ownership ซ้ำ
- Service role อยู่ใน API/CI secret store เท่านั้น
- Database migration ต้องมี test และต้องใช้ migration gate ก่อน release
- Public endpoint ต้องมี generic error, rate limit, anti-bot และไม่ทำ account enumeration
- Ticket state transition, SLA round และ requester sign-off ต้อง atomic และตรวจสอบย้อนหลังได้

## วิธีรายงานผล

รายงานเฉพาะ:

- branch name และไฟล์ที่เปลี่ยน
- เหตุผลเชิงเทคนิคและ security impact
- test command กับ pass/fail/blocked status
- residual risk และขั้นตอนที่ต้องให้ผู้มีอำนาจอนุมัติ

ห้ามรายงาน:

- URL หรือ identifier ของ production
- email, ชื่อบุคคล, Ticket number, PII หรือ payload จริง
- token, password, secret, database connection string หรือค่า config จริง

## Handoff checklist

```text
[ ] ตรวจ branch/working tree แล้ว
[ ] ไม่มี production write หรือ merge master
[ ] มี test สำหรับทุก behavior ที่เปลี่ยน
[ ] migration ผ่าน dry-run/test database
[ ] docs และ logs ไม่มี secret/PII
[ ] สรุป residual risk และ release owner แล้ว
```
