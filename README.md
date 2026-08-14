# LIFE IT Smart Service Center

ระบบ IT Service Management ใหม่ของกองทุนประกันชีวิต — ย้ายจากระบบเดิมบน Google Apps Script
(เก็บไว้ครบที่ [`legacy-gas/`](legacy-gas/)) มาเป็น Web Application แบบ Full Stack ที่แยก Frontend/Backend/Database
ออกจากกันชัดเจน ปลอดภัย และดูแลรักษาง่ายกว่าเดิม

## สถาปัตยกรรม

```
Cloudflare Pages (React + TypeScript + Vite)
        │  HTTPS REST API / Bearer JWT
        ▼
Cloudflare Workers (TypeScript + Hono)
        │  Supabase JWT + Service Role (เฉพาะ Admin function)
        ▼
Supabase (PostgreSQL + Auth + Storage + RLS)
```

รายละเอียดเต็มอยู่ที่ [`docs/architecture.md`](docs/architecture.md)

## โครงสร้าง Repository

```
├── apps/
│   ├── web/            React + TypeScript + Vite (Frontend)
│   └── api/             Cloudflare Workers + Hono (Backend API)
├── packages/
│   └── shared/           Types, Zod schemas, ค่าคงที่ Role/Permission ที่ใช้ร่วมกัน
├── supabase/              Database migration / RLS policy (เริ่มสร้างใน Phase 2)
├── migration/             เครื่องมือย้ายข้อมูลจาก Google Sheets (เริ่มสร้างใน Phase 7)
├── legacy-gas/            Source Code ระบบเดิม (Google Apps Script) — เก็บไว้อ้างอิง ห้ามใช้ต่อยอด
├── docs/                  เอกสารสถาปัตยกรรม/ฐานข้อมูล/API/สิทธิ์/deploy ของระบบใหม่
└── .github/workflows/     CI (typecheck, lint, test, build)
```

## เริ่มต้นใช้งาน (Local Development)

**ข้อกำหนดเบื้องต้น:** Node.js 20+ และ npm 10+

```bash
npm install                       # ติดตั้ง dependency ทุก workspace (web, api, shared)
```

ตั้งค่า Environment ก่อนรัน (ดูรายละเอียดค่าทั้งหมดที่ `.env.example`):

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
# แก้ไขค่าในสองไฟล์นี้ตามสภาพแวดล้อมจริง (ค่า Supabase จะได้ตั้งแต่ Phase 2 เป็นต้นไป)
```

รันระหว่างพัฒนา (เปิดสองหน้าต่าง terminal):

```bash
npm run dev:api     # Cloudflare Workers dev server ที่ http://localhost:8787
npm run dev:web     # Vite dev server ที่ http://localhost:5173
```

เปิด `http://localhost:5173/health` เพื่อตรวจว่า Frontend เรียก Backend API สำเร็จ

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ผลกระทบ |
|---|---|
| `npm run typecheck` | ตรวจ TypeScript ทุก workspace โดยไม่สร้างไฟล์ output |
| `npm run lint` | ตรวจ ESLint ทุก workspace |
| `npm run test` | รัน Unit Test (Vitest) ทุก workspace |
| `npm run test:e2e` | รัน End-to-End Test (Playwright) ของ `apps/web` — ต้องรัน `npx playwright install` ก่อนครั้งแรก |
| `npm run build` | Build ทุก workspace (Vite build สำหรับ web, `wrangler deploy --dry-run` สำหรับ api เพื่อตรวจ bundle โดยไม่ deploy จริง) |

## สถานะโครงการ

ระบบอยู่ในช่วง **Pre-production hardening / migration rehearsal** โค้ดต้องผ่าน CI, Staging Live E2E,
migration rehearsal, UAT และ owner approval ก่อน Production ดูขั้นตอนที่
[`docs/deployment.md`](docs/deployment.md) และแผนกู้คืนที่ [`docs/rollback.md`](docs/rollback.md)
