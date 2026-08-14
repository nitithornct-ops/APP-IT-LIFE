# Help Desk — Phase 1 Repository Analysis

วันที่สำรวจ: 11 สิงหาคม 2569

ขอบเขต: วิเคราะห์ repository จริงก่อนพัฒนา และกำหนดแนวทางต่อยอด Module Ticket เดิมโดยไม่สร้างระบบซ้ำ

## Executive summary

APP_LIFE1 เป็น npm workspaces monorepo ที่มี Help Desk พื้นฐานอยู่แล้วในชื่อ Ticket module ทั้ง Frontend, Backend และ
Database การพัฒนาจึงต้องต่อยอด `tickets`, `ticket_worklogs`, `ticket_categories` และ integration เดิม ไม่สร้าง
`apps/helpdesk` หรือ `helpdesk_tickets` ชุดใหม่

ข้อค้นพบด้านความปลอดภัยที่สำคัญที่สุดคือ RLS เดิมใช้ `ticket.view` เป็นเงื่อนไขดู Ticket ทั้งองค์กร ขณะที่ role `user`
ได้รับ permission นี้เพื่อเข้าเมนู Ticket อยู่แล้ว จึงมีความเสี่ยงที่ User เห็น Ticket ของผู้อื่นผ่าน REST โดยตรง Phase 2
แก้ด้วย `ticket.view_all` และ participant-scoped RLS

## ผลสำรวจ 20 หัวข้อ

1. **Technology stack** — React 18 + TypeScript + Vite, React Router, TanStack Query, React Hook Form, Zod,
   Tailwind CSS, Lucide, Hono บน Cloudflare Workers, Supabase PostgreSQL/Auth/Storage/RLS, Vitest และ Playwright
2. **Main application** — Frontend อยู่ที่ `apps/web`; API อยู่ที่ `apps/api`
3. **Frontend framework** — React SPA; route-level lazy loading และ protected routes
4. **Backend architecture** — REST API `/api/v1/*` ด้วย Hono; middleware แยก auth, permission, rate limit,
   request ID และ error handling; business data เรียกผ่าน user-scoped Supabase client
5. **Database** — PostgreSQL บน Supabase; migration สะสมตาม timestamp; test migration จริงด้วย PGlite
6. **Authentication** — Frontend ใช้ Supabase Auth สำหรับ login/logout/refresh; Backend ตรวจ Bearer JWT ซ้ำทุก request;
   service role อยู่เฉพาะ Cloudflare Workers
7. **Routing** — `apps/web/src/App.tsx`; Ticket เดิมใช้ `/tickets` และ `/tickets/:id`; API ใช้ `/api/v1/tickets`
8. **UI library/design system** — Tailwind + shared primitives `Button`, `Badge`, `Card`, `EmptyState`, `Skeleton`,
   `Toast`; icon ใช้ Lucide; รองรับ dark theme และขนาดตัวอักษร
9. **State management** — TanStack Query สำหรับ server state; React Context สำหรับ auth/theme; local state และ
   React Hook Form สำหรับ form state
10. **User/Profile tables** — Supabase `auth.users` ผูก 1:1 กับ `public.profiles`; profile เชื่อม `departments`,
    `positions`, supervisor และ employee data
11. **Role/Permission** — Configurable RBAC ผ่าน `roles`, `permissions`, `user_roles`, `role_permissions`,
    `user_permission_overrides`; DENY และ user override มี precedence; RLS ใช้ `has_permission()`
12. **Asset module** — มี `assets`, `asset_categories`, `asset_movements`, employee assignments และ API/UI ครบ;
    Help Desk ต้อง FK ไป `assets.id`
13. **Notification module** — มี private in-app `notifications`, bell/hook และ backend service; เขียนผ่าน service role
14. **Audit module** — มี immutable `audit_logs` และ `login_logs`; backend `auditService` เป็นจุดเขียนกลาง
15. **Reusable components/services** — AppShell, Sidebar, Topbar, ProtectedRoute, RequirePermission, UI primitives,
    pagination utilities, standard API response, Supabase clients, notification/audit/storage services และ Thai date helper
16. **Help Desk folder** — ใช้ `apps/web/src/features/tickets`, `apps/api/src/routes/tickets.ts`,
    `apps/api/src/validators/tickets.ts`, `apps/web/src/types/tickets.ts`; ไม่สร้าง app ใหม่
17. **Reusable database tables** — `tickets`, `ticket_worklogs`, `ticket_categories`, `profiles`, `departments`,
    `assets`, `file_attachments`, `notifications`, `audit_logs`, `knowledge_articles`
18. **สิ่งที่ต้องเพิ่ม** — Ticket number, subcategory, configurable priority/status/transition/SLA, participant-safe RLS,
    asset/department link, room/building/root cause, conversation/internal note/worklog metadata, SLA ledger และ search indexes
19. **Risks** — permission leak เดิม, requester mass assignment ผ่าน direct REST, state machine ซ้ำระหว่าง API/DB,
    SLA เดิมคำนวณ calendar hours, `ticket_worklogs` ทำหลายหน้าที่, status/priority API เดิมเป็นค่าไทย และ migration
    production ต้องผ่าน approval/backup
20. **Implementation plan** — Phase 2 วาง schema/security/seed; Phase 3 ทำ core create/list/detail; Phase 4 แยก
    operation endpoints และ conversation/worklog; Phase 5 ทำ business-hours SLA/dashboard; Phase 6 เชื่อม attachment,
    asset, notification, KB, satisfaction; Phase 7 report/export/audit/security QA

## Architecture ที่ใช้ต่อ

```text
apps/web (React)
    -> HTTPS /api/v1 + Supabase JWT
apps/api (Cloudflare Workers + Hono)
    -> validation + RBAC + business logic + audit/notification
    -> user-scoped Supabase client
Supabase
    -> PostgreSQL constraints + RLS + private Storage
```

Frontend ห้ามเรียกตารางธุรกิจตรงตาม architecture เดิม แต่ RLS/trigger ยังคงบังคับสิทธิ์เพื่อป้องกัน IDOR และ direct
PostgREST access หาก token ถูกนำไปใช้ภายนอก UI

## Route proposal

คง URL เดิมเพื่อ backward compatibility และเพิ่ม route ภายใต้ namespace เดิม:

| Web route | วัตถุประสงค์ | Permission |
|---|---|---|
| `/tickets` | รายการของฉันสำหรับ User / รายการทั้งหมดตามสิทธิ์สำหรับ IT | `ticket.view` |
| `/tickets/new` | Form แจ้งซ่อมแบบ mobile-first | `ticket.create` |
| `/tickets/kanban` | Kanban สำหรับ IT | `ticket.view_all` |
| `/tickets/:id` | รายละเอียด, timeline, comment, worklog, attachment, SLA | participant หรือ `ticket.view_all` |
| `/admin/ticket-settings` | Category, subcategory, priority, transition, SLA | `ticket.settings.manage` |
| `/reports/helpdesk` | รายงาน Help Desk | `report.view` + source permission |

API คง `/api/v1/tickets` และเสนอเพิ่ม nested resources เช่น `/:id/comments`, `/:id/internal-notes`, `/:id/worklogs`,
`/:id/assign`, `/:id/transitions`, `/:id/resolve`, `/:id/confirm`, `/:id/feedback` เพื่อจำกัด mass assignment ราย action

## Permission matrix

ชื่อ role ตามระบบเดิมถูกนำมาใช้: `technician` คือ IT Support และ `executive` คือ Executive / Viewer

| Capability | user | technician | it_admin | executive |
|---|:---:|:---:|:---:|:---:|
| เข้าโมดูล/ดู Ticket ตนเอง | ✓ | ✓ | ✓ | ✓ |
| สร้าง Ticket | ✓ | ตาม config | ✓ | — |
| Comment สาธารณะ | ✓ เฉพาะ Ticket ตน | ✓ | ✓ | — |
| ดู Ticket ทั้งหมด | — | ✓ | ✓ | ✓ read-only |
| Assign / รับงาน | — | ✓ | ✓ | — |
| เปลี่ยนสถานะ | — | ✓ | ✓ | — |
| Internal note / worklog | — | ✓ | ✓ | — |
| ปิด/เปิดงานซ้ำ | — | ตาม permission | ✓ | — |
| ตั้งค่า Category/Priority/SLA/Workflow | — | — | ✓ | — |
| Dashboard/Report | ของตน | งาน IT | ✓ | ✓ |

`super_admin` ได้ทุก permission; role อื่นยังคงปรับได้ผ่าน Permission Matrix เดิม

## File plan

Phase 2 เพิ่ม migration และ test โดยแตะ shared permission/seed เท่านั้น ส่วน Phase 3 เป็นต้นไปจะปรับไฟล์ Ticket เดิม:

- `supabase/migrations/20260905100000_helpdesk_foundation.sql`
- `supabase/seed.sql`
- `supabase/tests/helpdeskFoundation.test.ts`
- `packages/shared/src/constants/permissions.ts`
- ภายหลัง: `apps/api/src/routes/tickets.ts`, `apps/api/src/validators/tickets.ts`
- ภายหลัง: `apps/web/src/features/tickets/*`, `apps/web/src/types/tickets.ts`
