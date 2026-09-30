# Security review checklist

## Authentication and enumeration

- [ ] Login resolve ไม่คืน email หรือบอกว่าบัญชีมีอยู่หรือไม่
- [ ] Turnstile ถูก verify ฝั่ง API ด้วย action และ hostname ที่คาดหวัง
- [ ] Challenge เป็น one-time, short-lived, bound กับ flow/identifier/request context และเก็บเป็น hash
- [ ] Password ไม่ถูก log, cache หรือส่งไปยัง browser storage
- [ ] Password reset ใช้ response แบบ generic

## Authorization and data integrity

- [ ] Backend ตรวจ permission/ownership ซ้ำ แม้ UI จะซ่อนปุ่ม
- [ ] Ticket transition ใช้ transaction/optimistic state และ worklog ที่สอดคล้องกัน
- [ ] การ reopen ล้าง sign-off ปัจจุบันและเก็บ immutable history แยกตาม SLA round
- [ ] RLS และ service-role function grants ถูกทดสอบด้วย database test

## Abuse resistance

- [ ] Public endpoints มี Cloudflare limiter เมื่อ binding พร้อม และมี bounded isolate limiter เป็น defense in depth
- [ ] Map/cache มี expiry และ eviction ไม่เติบโตไม่จำกัด
- [ ] Error response ไม่ส่ง SQL/provider/internal detail ให้ client
- [ ] Upload/file paths ตรวจ type, size, ownership และ signed URL expiry

## Browser and deployment

- [ ] CSP ไม่อนุญาต external resource กว้างเกินจำเป็น
- [ ] Service worker ไม่ serve HTML shell เก่าจาก cache-first โดยไม่ revalidate
- [ ] Public docs ไม่มี secrets, PII, production IDs หรือ operational snapshots
- [ ] CI ตรวจ secret files และ deployment workflow ไม่พิมพ์ค่าลับ
