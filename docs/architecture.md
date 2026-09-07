# Architecture — LIFE IT Smart Service Center

## ภาพรวม

```
GitHub Repository
        │
        ├── GitHub Actions: typecheck / lint / test / build (PR) และ deploy (main)
        ▼
Cloudflare Pages                         Cloudflare Workers
Frontend: React + TS + Vite    ───────▶  Backend API: TypeScript + Hono
        │  HTTPS REST /api/v1/...  Bearer JWT        │
        │                                            ├── ตรวจ Supabase JWT
        │                                            ├── ตรวจ Role/Permission (RBAC)
        │                                            ├── Business Logic + Validation (Zod)
        │                                            ├── Audit Log
        │                                            └── Cron Trigger (SLA/Reminder)
        │                                            ▼
        └────────── Supabase Auth (login เท่านั้น) ── Supabase
                                                       ├── PostgreSQL + Row Level Security
                                                       ├── Storage (Private bucket + Signed URL)
                                                       └── Realtime (เฉพาะจุดที่จำเป็น)
```

Frontend เรียกข้อมูลของระบบทั้งหมดผ่าน Cloudflare Workers API เท่านั้น — ยกเว้นการ login/logout/refresh session
ที่ใช้ Supabase Auth SDK โดยตรงจาก Frontend (ตามสถาปัตยกรรมมาตรฐานของ Supabase Auth)

## หลักการสำคัญที่ต้องยึดตลอดทุก Phase

1. **ห้าม Frontend เรียกฐานข้อมูลตรง** ยกเว้น Supabase Auth
2. **ห้ามใช้ Service Role Key ใน Frontend** — เก็บใน Cloudflare Workers Secret เท่านั้น (`wrangler secret put`)
3. **ห้ามเชื่อถือ Permission จาก Frontend** — Backend ต้องตรวจ Role/Permission ซ้ำทุก request จาก Database จริง
   (Frontend ใช้ Permission เพื่อซ่อน/ปิดเมนูเพื่อ UX เท่านั้น)
4. **RBAC ต้อง Configurable** ผ่านตาราง `roles`/`permissions`/`role_permissions`/`user_roles` ไม่ hard-code สิทธิ์
5. **API Response ต้องเป็นมาตรฐานเดียวกันทุก endpoint** (ดูหัวข้อ "API Response Format" ด้านล่าง — implement แล้วที่
   `apps/api/src/utils/response.ts`)
6. **Timezone `Asia/Bangkok`** ทุกจุดที่แสดงผลผู้ใช้ แต่เก็บวันที่ในฐานข้อมูลเป็น UTC เสมอ และแสดงปี พ.ศ. บน UI
   (มี helper `formatThaiDate()`/`toBuddhistYear()` แล้วที่ `apps/web/src/utils/date.ts`)

## Technology Stack

| ชั้น | เทคโนโลยี |
|---|---|
| Frontend | React 18, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, Tailwind CSS, Lucide Icons, date-fns (locale `th`), Vitest, Playwright |
| Backend | Cloudflare Workers, TypeScript, Hono, Zod, Supabase JS Client |
| Database/Auth | Supabase (PostgreSQL, Auth, Storage, Row Level Security) |
| Shared | `packages/shared` — Types, Zod schemas, ค่าคงที่ Role/Permission ที่ทั้ง Frontend และ Backend ใช้ร่วมกัน |
| CI/CD | GitHub Actions (`.github/workflows/`) |

## API Response Format (มาตรฐาน — implement แล้วใน Phase 1)

สำเร็จ:

```json
{ "success": true, "data": {}, "meta": { "requestId": "string", "timestamp": "ISO-8601" } }
```

ล้มเหลว:

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "ข้อความภาษาไทย", "details": [] },
  "meta": { "requestId": "string", "timestamp": "ISO-8601" }
}
```

## โครงสร้าง Repository

ดู [`README.md`](../README.md) หัวข้อ "โครงสร้าง Repository" — โฟลเดอร์ `supabase/` และ `migration/` ยังไม่ถูกสร้างใน
Phase 1 (จะสร้างพร้อมเนื้อหาจริงใน Phase 2 และ Phase 7 ตามลำดับ เพื่อไม่ให้มีโฟลเดอร์ว่างที่ไม่มีเนื้อหา)

## เครื่องมือที่ทำงานในเบราว์เซอร์ล้วน ๆ

โมดูลเกือบทั้งหมดอ่านเขียนข้อมูลผ่าน Workers API แต่มีข้อยกเว้นที่ตั้งใจไว้คือ **เครื่องมือจัดการ PDF**
(`apps/web/src/features/pdfTools/`, route `/pdf-tools`) ซึ่งรวม แยก จัดเรียง หมุน ลบหน้า แปลงรูปเป็น PDF
และใส่ลายน้ำ/เลขหน้า โดยไม่มี endpoint ฝั่ง API ไม่มีตารางใน database และไม่อัปโหลดไฟล์ไปที่ Storage เลย

- **ทำไมไม่ผ่าน server** ผู้ใช้มักต้องแก้เอกสารที่ยังไม่ควรออกจากเครื่อง การประมวลผลในเบราว์เซอร์จึงเป็น
  ทางที่ปลอดภัยกว่า และไม่กิน quota ของ Workers/Storage
- **ทำไมไม่มี permission** ไม่มีข้อมูลของระบบให้เข้าถึง จึงไม่มีสิทธิ์ใดให้ตรวจ route นี้อยู่ในรายการยกเว้น
  ของ `App.routeGuards.test.tsx` พร้อมเหตุผล เหมือน `/system-status`
- **การแบ่งชั้น** `pdfDocumentEngine.ts` เป็นตรรกะ PDF ล้วน (ทดสอบใน Node ได้) ส่วน `pdfBrowser.ts` และ
  `pdfThumbnails.ts` เป็นส่วนที่ต้องใช้ canvas/worker ของเบราว์เซอร์จริง
- **ขนาด bundle** pdf-lib และ pdf.js ถูกโหลดแบบ lazy เฉพาะตอนเปิดหน้านี้ ไม่ติดไปกับ bundle หลัก

## เอกสารแบบฟอร์ม — แม่แบบหลักและการจัดวางอิสระ

**Form Studio (`/forms`) คือแบบฟอร์มหลัก** แม่แบบทุกใบถูกสร้างและแก้ที่นั่นที่เดียว ส่วนที่เหลือลิงก์กลับมาหามัน
ตารางแบบฟอร์มงานลิงก์ไปที่ Ticket และแบบฟอร์มที่พิมพ์ได้ของ Ticket ใบนั้น ส่วนหน้าแบบฟอร์มของ Ticket
ลิงก์กลับมาที่แม่แบบด้วย `/forms?template=<id>` และที่แบบฟอร์มงานด้วย `/forms?issue=<id>`

การแก้ในหน้า Ticket มีผลเฉพาะใบนั้น เก็บที่ `tickets.form_content_html` เป็นสำเนาที่ resolve `{{field}}` ไปแล้ว
(หยุดตามข้อมูล Ticket และแม่แบบ) และคืนค่ากลับไปใช้แม่แบบได้เสมอ

**การลากย้ายบล็อกใช้ `position: relative` เท่านั้น** (`apps/web/src/features/forms/blockLayout.ts`) ห้ามเปลี่ยนเป็น
`absolute` หรือ `fixed` — ตัวกรอง HTML ทั้งสองฝั่งบล็อกไว้แล้วโดยตั้งใจ ด้วยเหตุผลสองข้อ

- **การแบ่งหน้ากระดาษ** บล็อกที่เยื้องแบบ relative ยังกินที่เดิมในสายเนื้อหา `formPagination.ts` จึงวัดความสูงได้
  เท่าเดิมและบล็อกยังอยู่แผ่นเดียวกับเนื้อหารอบตัว ถ้าเป็น absolute บล็อกจะหลุดออกจากสายเนื้อหา เนื้อหาที่เหลือ
  จะเลื่อนขึ้นมาแทนที่ และตำแหน่งบนกระดาษที่พิมพ์ออกมาจะไม่ตรงกับที่เห็นบนจอ
- **ความปลอดภัย** relative ทำได้แค่เยื้องจากที่เดิม สร้างแผ่นทับทั้งหน้าจอไม่ได้

ค่าที่ยอมรับต้องตรงกันเป๊ะ ๆ ระหว่าง `apps/web/src/utils/formHtml.ts` (DOMPurify) กับ
`apps/api/src/utils/formHtml.ts` (sanitize-html) คือ `left`/`top` เป็นจำนวนเต็มไม่เกินสี่หลัก และ `z-index` หลักเดียว
ถ้าสองฝั่งไม่ตรงกัน ตำแหน่งจะรอดตอนแก้แต่หายตอนบันทึก ซึ่งเป็นบั๊กที่ผู้ใช้เจอแต่เทสต์ฝั่งเดียวจับไม่ได้

## ระบบเดิมที่กำลังย้าย

ระบบเดิม (Google Apps Script — เก็บไว้ที่ [`../legacy-gas/`](../legacy-gas/)) คือ **ISMS Governance System** ของ
กองทุนประกันชีวิต ครอบคลุมทั้ง ITSM และ GRC/ISMS/PDPA ในระบบเดียว รายละเอียดการวิเคราะห์ระบบเดิมทั้งหมดอยู่ที่
[`migration.md`](migration.md)

## Environment Variables

ดูค่าทั้งหมดที่ [`.env.example`](../.env.example) (root), [`apps/web/.env.example`](../apps/web/.env.example) และ
[`apps/api/.dev.vars.example`](../apps/api/.dev.vars.example) — **ห้ามใส่ค่าจริงในไฟล์ตัวอย่างหรือ Source Code**
Production Secret ของ Cloudflare Workers ตั้งด้วย `wrangler secret put <ชื่อ>` เท่านั้น

## เอกสารที่ยังไม่ได้เขียน (รอ Phase ที่เกี่ยวข้อง)

- `docs/database.md` — Phase 2 (ER Diagram + Migration SQL)
- `docs/permissions.md` — Phase 3 (Permission Matrix ของระบบใหม่)
- `docs/api.md` — ขยายทีละ endpoint ตั้งแต่ Phase 4 เป็นต้นไป
- `docs/deployment.md`, `docs/rollback.md` — Phase 9 (Deploy และ Cutover)
