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
