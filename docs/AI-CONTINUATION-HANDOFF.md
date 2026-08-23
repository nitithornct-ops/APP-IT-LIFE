# AI Continuation Handoff — LIFE IT UI Redesign

อัปเดตล่าสุด: 23 สิงหาคม 2026 (Asia/Bangkok)

เอกสารนี้ใช้ส่งต่องานให้ AI/Developer ตัวถัดไป โปรดอ่านทั้งไฟล์ก่อนแก้โค้ด

## 1. เป้าหมายงาน

ปรับหน้าตาและประสบการณ์ใช้งานระบบ LIFE IT Smart Service Center ให้ตรงกับ design handoff โดยใช้ข้อมูลและความสามารถที่ระบบรองรับจริง ห้ามสร้างข้อมูลสถานะ, integration, capacity หรือ workflow ปลอมเพื่อให้หน้าจอดูเต็ม

ตำแหน่งโปรเจกต์:

```text
D:\Jap_Life\8. Project-App\App_LIFE1
```

ตำแหน่ง design handoff:

```text
C:\Users\it2\Downloads\UI mockups สำหรับระบบ\design_handoff_it_service_redesign
```

ไฟล์อ้างอิงหลัก:

- `00-PROMPT-FOR-AI.md`
- `01-design-tokens.md`
- `02-screens.md`
- `03-implementation-plan.md`
- `mockups/IT Service Redesign.dc.html`
- เอกสาร pattern ที่สรุปไว้ใน repo: `docs/ui-patterns.md`

## 2. ข้อควรระวังก่อนทำต่อ

- Working tree มีการแก้ไขจำนวนมากจากงาน redesign รอบนี้และยังไม่ได้ commit
- การแก้ไขทั้งหมดถือเป็นงานของผู้ใช้ ห้ามใช้ `git reset --hard`, `git checkout --`, ลบไฟล์ หรือเขียนทับการเปลี่ยนแปลงเดิม
- ตรวจ `git status --short` และอ่านไฟล์ที่เกี่ยวข้องก่อนแก้ทุกครั้ง
- ใช้ `apply_patch` สำหรับการแก้ไฟล์
- ใน PowerShell เครื่องนี้ต้องใช้ `npm.cmd` และ `npx.cmd` เสมอ เพราะ `.ps1` ถูก Execution Policy บล็อก
  (`npx supabase ...` เปล่า ๆ จะขึ้น `UnauthorizedAccess` ทุกครั้ง ให้ใช้ `npx.cmd supabase ...`)
- ห้ามอ่านหรือแสดงค่าจริงจาก `apps/api/.dev.vars`; ใช้ได้เฉพาะชื่อ environment variables
- ไม่ต้องสร้าง commit เว้นแต่ผู้ใช้สั่งโดยตรง
- ทำทีละหน้าจอและทดสอบให้ผ่านก่อนเริ่มหน้าถัดไป

## 3. สถานะระบบที่กำลังรัน

ระหว่างส่งต่องาน ระบบเปิดไว้ที่:

- Web: `http://127.0.0.1:5173/`
- API: `http://127.0.0.1:8787/`

หาก process เดิมหยุด ให้เปิดใหม่จาก root ของ repo:

```powershell
npm.cmd run dev:api
npm.cmd run dev:web
```

หน้าใหม่ที่ควรตรวจได้โดยตรง:

- War Room: `http://127.0.0.1:5173/war-room`
- Integration Center: `http://127.0.0.1:5173/admin/integrations`
- PM Roster: เมนู `PM / บำรุงรักษา` แล้วเลือก tab `ตารางช่าง`
- CSAT: เมนู `Report Center` แล้วเลือกชุดรายงาน Service Desk
- SLA impact: เมนู `System Settings`
- Technician Skill Matrix: `http://127.0.0.1:5173/admin/technician-skills` และแผงในหน้า `/profile`
  (ต้อง apply migration `20260916100000_technician_skill_matrix.sql` ก่อน มิฉะนั้น endpoint จะตอบ 500)
- Mobile Field Workflow: `http://127.0.0.1:5173/field/scan` และปุ่ม `ปิดงานหน้างาน (มือถือ)` ในหน้า Ticket detail
  (ต้อง apply migration `20260917100000_field_work_parts_provenance.sql` ก่อนใช้การตัดอะไหล่)
  ตรวจที่ viewport 390px เป็นหลัก เพราะทั้งสองจอออกแบบมาสำหรับมือถือหน้างาน
- Onboarding: การ์ด "ยินดีต้อนรับ" บนหน้าแรก แสดงเฉพาะบัญชีที่ยังไม่เคยปิด
  (กดปิดแล้วต้องไม่กลับมาอีก แม้ล้าง cache หรือเปลี่ยนเครื่อง เพราะเก็บสถานะในฐานข้อมูล)

หมายเหตุ: browser automation ใน session ก่อนหน้าติดปัญหา `codex/sandbox-state-meta: missing field sandboxPolicy` แต่ dev server และ HMR ทำงานปกติ ให้ลอง browser tooling ใหม่ได้หนึ่งครั้ง หรือเปิด URL ข้างต้นตรวจด้วยตนเอง

## 4. งาน redesign ที่ทำแล้ว

### Foundation และ shell

- Design tokens, Sarabun + IBM Plex Mono, สี surface/ink/hairline, dark palette และ reusable UI patterns
- Sidebar/rail, responsive shell, mobile bottom navigation, Topbar, command palette, theme/font controls
- DataTable, Card, Button, Badge, EmptyState, QueryError, Modal, Toast และ async/page patterns
- Responsive และ dark mode สำหรับ public/authenticated surfaces ที่เกี่ยวข้อง

### หน้าหลักและโมดูลเดิม

- Tickets และ Ticket detail/action workflow
- Home dashboard แบบเล่าเรื่อง พร้อม executive analytics
- My Work, Tasks/Calendar
- Assets, CMDB, Inventory, Licenses
- Incident/Problem/Change และ Governance-related pages
- Vendor & Contract
- Admin users/roles/permissions/settings
- Public ticket/LINE/auth pages
- Profile redesign
- War Room (`/war-room`)

### ฟีเจอร์ข้อมูลจริงที่เพิ่มในรอบล่าสุด

1. CSAT Analytics
   - Aggregation ฝั่ง API อยู่ใน `apps/api/src/routes/reports.ts`
   - UI: `apps/web/src/features/reports/CsatAnalyticsPanel.tsx`
   - แสดงคะแนน, distribution, trend, category, low-score follow-up และ technician ranking จากข้อมูล report จริง

2. SLA Settings Impact Preview
   - Service: `apps/api/src/services/slaImpactService.ts`
   - Endpoint: `GET /api/v1/settings/sla-impact`
   - UI: `apps/web/src/features/admin/SlaSettingsOverview.tsx`
   - คำนวณผลกระทบกับ Ticket เปิดจริงก่อนบันทึกค่า

3. Executive Service Analytics
   - Service: `apps/api/src/services/dashboardAnalyticsService.ts`
   - Dashboard API ส่ง `executiveAnalytics`
   - UI: `apps/web/src/features/dashboard/ExecutiveServiceAnalytics.tsx`
   - แสดง heatmap, backlog aging, status distribution และ technician performance

4. PM Technician Roster
   - Service: `apps/api/src/services/pmRosterService.ts`
   - Endpoint: `GET /api/v1/maintenance-plans/roster?weekStart=YYYY-MM-DD`
   - UI: `apps/web/src/features/maintenance/PmRosterView.tsx`
   - แสดงตารางช่าง 7 วัน, unassigned PM, overdue backlog และ workload จากแผนจริง
   - ฐานข้อมูลปัจจุบันมี maintenance plan 0 รายการ จึงต้องแสดง empty state ตามจริง
   - Schema ยังไม่มี on-call schedule, leave schedule, field visit และ Change window ห้ามสร้างข้อมูลสมมติ

5. Integration Center
   - Service: `apps/api/src/services/integrationCenterService.ts`
   - Route: `apps/api/src/routes/integrations.ts`
   - Endpoint: `GET /api/v1/integrations/overview`
   - UI: `apps/web/src/features/admin/IntegrationCenterPage.tsx`
   - Route: `/admin/integrations` permission `integration.view`
   - อ่านสถานะ LINE จาก deployment environment จริงโดยส่งกลับเฉพาะสถานะ ไม่ส่ง secret
   - อ่านสถิติจาก `notifications`, `integration_outbox`, `line_notification_log` และ `line_users`
   - Error/target ถูก mask ก่อนส่งไปหน้าเว็บ
   - Retry/Cancel ใช้ action เดิมของ Governance API และต้องมี `integration.manage`
   - SMTP, Teams และ Generic Webhook แสดง `ยังไม่รองรับ` เพราะ runtime ยังไม่มี adapter
   - Notification rules ปัจจุบันจัดการจาก source code ยังไม่มีตาราง rule จึงตั้งใจไม่ทำ toggle ปลอม

6. Technician Skill Matrix
   - Migration: `supabase/migrations/20260916100000_technician_skill_matrix.sql`
     สร้างตาราง `public.technician_skills` (technician_id -> profiles, category_id -> ticket_categories,
     level 1-3, note, assessed_at/assessed_by) พร้อม RLS และ permission ใหม่
     `technician_skill.view` / `technician_skill.manage`
   - "ยังไม่ประเมิน" คือการไม่มีแถว ไม่ใช่ระดับ 0 — หน้าจอแสดง `—` ตามจริง
   - RLS: เจ้าตัวอ่านผลประเมินของตนเองได้ คนอื่นต้องมี `technician_skill.view`
     การเขียนต้องมี `technician_skill.manage` เท่านั้น (ผู้ถูกประเมินแก้ระดับตัวเองไม่ได้)
   - Service: `apps/api/src/services/technicianSkillService.ts`
   - Route: `apps/api/src/routes/technicianSkills.ts` ที่ `/api/v1/technician-skills`
     * `GET /matrix` (technician_skill.view) — ตารางเต็ม + ความเสี่ยงรายหมวด (uncovered/single)
     * `GET /me` — ทักษะ ภาระงาน และผลงาน 6 เดือนของตนเอง
     * `GET /:technicianId` (technician_skill.view) — ของเจ้าหน้าที่คนอื่น
     * `PUT /:technicianId` (technician_skill.manage) — บันทึก/ถอนผลประเมิน + audit log
   - รายชื่อเจ้าหน้าที่ในตารางคำนวณจาก RBAC จริง (บทบาทที่ได้ `ticket.update` แบบ allow)
     รวมกับผู้ที่เคยถูกประเมินไว้แล้ว ไม่ได้ hard-code รายชื่อหรือ role key ใด
   - ภาระงาน/ผลงานย้อนหลังจะแสดงเฉพาะเมื่อผู้ใช้มี `ticket.view_all` (หรือดูของตนเอง)
     ถ้าไม่มีสิทธิ์จะบอกตรง ๆ ว่าดูไม่ได้ แทนการแสดงเลข 0 ที่ผิด (`workloadAvailable`)
     และมี `workloadSampled` เตือนเมื่อ Ticket ค้างมากกว่าที่สแกนได้ครั้งเดียว
   - UI: `apps/web/src/features/technicianSkills/` (TechnicianSkillMatrixPage, TechnicianSkillPanel,
     skillDisplay) + route `/admin/technician-skills` และแผงในหน้า `/profile`
   - **ต้อง apply migration ก่อนใช้งานจริง**: `npx supabase db push --linked --include-all`
     (ยังไม่ได้รันกับ Supabase โปรเจกต์จริงในรอบนี้ เพราะเป็นการเปลี่ยนระบบภายนอกที่ต้องให้เจ้าของสั่ง)

7. Mobile Field Workflow (design handoff 3j)
   - Migration: `supabase/migrations/20260917100000_field_work_parts_provenance.sql`
     เพิ่ม `inventory_transactions.ticket_id` (FK -> tickets, on delete set null) และขยาย RPC
     `record_inventory_transaction` ให้รับ `ticket_id_input` — ต้อง drop ตัวเดิม 7 พารามิเตอร์ทิ้ง
     เพื่อไม่ให้เหลือทางเบิกของที่ข้ามการผูก Ticket
   - เดิมการตัดสต็อกไม่มีที่บอกว่าอะไหล่ถูกใช้กับใบงานไหน ยอดที่หายจากคลังจึงตรวจย้อนไม่ได้
   - Service: `apps/api/src/services/assetFieldService.ts`
     * `parseScannedAssetCode()` แยกรหัสจากข้อความ QR ที่ระบบสร้าง ("{asset_code} | {name}")
       รองรับรูปแบบ URL เผื่ออนาคต และปฏิเสธข้อความที่ไม่ใช่รหัสแทนการยิง query ด้วยขยะ
     * `buildAssetFieldSummary()` สรุปเครื่อง + ประวัติซ่อม + สถิติ "ซ่อมซ้ำ"
       (>= 3 ใบใน 90 วัน นับจาก Ticket จริง ไม่นับใบที่ยกเลิก)
   - Endpoint: `GET /api/v1/assets/lookup?code=` (permission `asset.view`)
     ประวัติอ่านด้วย client ของผู้ใช้ — ผู้ที่ไม่มี `ticket.view_all` จะได้ `historyScope: 'personal'`
     และหน้าจอบอกตรง ๆ ว่าประวัติไม่ครบ แทนการทำให้ดูเหมือนเครื่องนี้ไม่เคยซ่อม
   - `fieldOutcomesFor()` ใน `ticketWorkflow.ts` — ตัวเลือก "ผลการแก้ไข" กรองจาก TRANSITIONS
     ตัวเดียวกับที่ PATCH บังคับ ส่งออกทาง `field_outcomes` ใน `GET /tickets/:id`
     จอหน้างานจึงไม่มีทางเสนอปุ่มที่กดแล้วถูกปฏิเสธ และไม่ต้องคัดลอก state machine ไปฝั่งเว็บ
   - เพิ่ม `rootCause` เข้า `updateTicketSchema` + PATCH (คอลัมน์ `tickets.root_cause` มีอยู่แล้ว
     แต่ API เดิมไม่เคยเขียนลงไป)
   - UI: `apps/web/src/features/fieldWork/`
     * `QrScanner.tsx` ใช้ `BarcodeDetector` ของเบราว์เซอร์ ไม่เพิ่ม dependency สแกนใด ๆ
       เครื่องที่ไม่รองรับ (เช่น Safari/iOS) หรือไม่อนุญาตกล้อง ใช้ช่องพิมพ์รหัสที่แสดงอยู่เสมอแทน
     * `AssetScanPage.tsx` -> route `/field/scan` (permission `asset.view`)
     * `FieldCloseTicketPage.tsx` -> route `/field/tickets/:id/close` (permission `ticket.view`)
   - ปุ่ม "เปิดใบงานกับเครื่องนี้" ลิงก์ไป `/tickets?newForAsset=<assetId>` ซึ่งเปิดฟอร์มแจ้งซ่อม
     ตัวเดิมของ TicketsPage พร้อมเลือกเครื่องไว้แล้ว — ไม่ทำฟอร์มที่สองให้ตรรกะ SLA แตกกันสองทาง
   - ลำดับการบันทึกตอนปิดงาน: ตัดอะไหล่ -> แนบรูป -> เปลี่ยนสถานะ ถ้าขั้นใดล้มเหลวจะหยุดและแสดง
     ว่าอะไรบันทึกไปแล้วบ้าง ไม่ปิดงานสำเร็จโดยที่ของหายจากคลังแบบไม่มีบันทึก
   - "แจ้งผู้ใช้" เป็นของจริง: PATCH สถานะจะส่ง in-app notification + LINE push ให้ผู้แจ้งอยู่แล้ว
   - Gap ที่ยังไม่ทำ: mockup มี "ชิปสาเหตุ (สร้าง KB)" แต่ระบบไม่มีทะเบียนสาเหตุมาตรฐาน
     จึงบันทึก root cause เป็นข้อความจริงและเขียนบอกผู้ใช้ในหน้าจอ ไม่สร้างชิปสาเหตุปลอม
     ส่วนการสร้างบทความ KB จากใบงานยังไม่ได้ทำ (ต้องออกแบบ deep link + prefill ของ knowledge module)
   - **ต้อง apply migration ก่อนใช้งานจริง** เช่นเดียวกับข้อ 6

8. Onboarding Flow และการ์ดสถานะ (design handoff 3k) — จบครบ 27 จอของดีไซน์แล้ว
   - Migration: `supabase/migrations/20260918100000_user_onboarding_state.sql`
     เพิ่ม `profiles.onboarding_completed_at` และ `onboarding_dismissed_at`
     แยกสองคอลัมน์เพราะ "ดูครบแล้ว" กับ "กดข้าม" เป็นคนละเรื่องเวลาย้อนดูว่าผู้ใช้ติดตรงไหน
   - `my_profile()` ถูก drop แล้วสร้างใหม่ (เปลี่ยน OUT parameters ด้วย create or replace ไม่ได้)
     เพื่อคืนสองคอลัมน์นี้ให้หน้าเว็บอ่านได้
   - RPC ใหม่ `set_my_onboarding_state(boolean)` ล็อกไว้ที่ `auth.uid()` — ต้องเป็น RPC เพราะ
     20260915100000 ตัดสิทธิ์ UPDATE ตาราง profiles ของ authenticated ออกไปแล้ว
   - Endpoint: `POST /api/v1/auth/onboarding` body `{ dismissed: boolean }`
   - UI: `apps/web/src/features/onboarding/OnboardingCard.tsx` แสดงบนหน้าแรก
     * ขั้นตอนกรองตามสิทธิ์จริงของบัญชีนั้น
     * ติ๊กถูกเฉพาะขั้นที่ระบบตรวจได้จริง (เบอร์โทรกรอกแล้วหรือยัง) ขั้นที่เหลือเป็นทางลัด
       ไม่ติ๊กให้ เพราะเครื่องหมายถูกที่ไม่ได้ตรวจจริงทำให้ผู้ใช้เชื่อว่าตั้งค่าครบแล้วทั้งที่ยังไม่ได้ทำ
     * บันทึกไม่สำเร็จ = การ์ดยังอยู่และบอกเหตุผล ไม่ปิดหน้าจอทิ้งโดยที่สถานะไม่ได้บันทึก
   - การ์ด "ผิดพลาด": `QueryError`/`ErrorState` แสดงรหัส (HTTP status หรือ error code) และ REQ id
     จาก `meta.requestId` ที่ API ส่งมาอยู่แล้ว ผู้ใช้แจ้งเลขนี้ให้ผู้ดูแลตามใน log ได้ตรงคำขอ
   - `draftNotice` เป็น prop ที่ต้องส่งมาเอง ไม่ตั้งเป็นค่าเริ่มต้น — mockup เขียนว่า "ร่างถูกเก็บแล้ว"
     แต่ระบบยังไม่มี draft persistence การบอกว่าเก็บร่างทั้งที่ไม่ได้เก็บทำให้ผู้ใช้ปิดหน้าจอแล้วงานหาย
   - การ์ด "ว่างเปล่า"/"กำลังโหลด"/"ไม่มีสิทธิ์" มีของเดิมครบแล้วจากรอบ redesign
     (`EmptyState` มี action, `LoadingState` รับ label, `AccessDenied` ใน ProtectedRoute ลิงก์ไป
     `/access-requests` ซึ่งเป็นเส้นทางขอสิทธิ์จริง)
   - **ต้อง apply migration ก่อนใช้งานจริง** เช่นเดียวกับข้อ 6 และ 7

### รอบตรวจความสม่ำเสมอของธีม (23 ส.ค. 2026)

ตรวจทุกหน้าเทียบ `01-design-tokens.md` และ `02-screens.md` แล้วแก้ 4 เรื่อง:

1. **War Room บังคับ dark ที่ระดับ root** — เดิมทาสีเข้มเฉพาะ div ของตัวเอง Topbar สูง 46px จึงยังขาว
   เพิ่ม `useForcedTheme()` ใน `stores/themeContext.tsx` ซึ่งไม่เขียนทับธีมที่ผู้ใช้เลือกไว้ใน localStorage
   และคืนค่าเดิมอัตโนมัติตอนออกจากหน้า (`resolvedTheme` = ค่าที่ผู้ใช้เลือก, `appliedTheme` = ที่แสดงจริง)

2. **หัวข้อหน้า** — เดิม 54 หน้าเขียน `<h1>` เอง คนละ utility class และไม่มี eyebrow เลย
   เพิ่ม `components/ui/PageTitle.tsx` เป็นนิยามเดียวของบล็อกหัวข้อ แล้วย้าย 39 หน้ามาใช้
   `PageHeader` ก็ใช้ `PageTitle` ข้างในอีกที ขนาดตัวอักษรจึงมีที่มาที่เดียว
   หน้าที่จงใจไม่ใช้ถูกขึ้นบัญชีพร้อมเหตุผลไว้ใน `PageTitle.test.tsx` และมีเทสต์สแกนซอร์สกันหลุดกลับ

   **สาเหตุจริงที่หัวข้อไม่ตรงสเปก** ไม่ใช่ utility class ที่ต่างกัน แต่เป็นกฎรวม `.life-app h1`
   ใน `index.css` (specificity 0-1-1) ซึ่งชนะ class เดี่ยวของ Tailwind (0-1-0) และ `index.css`
   ไม่ได้อยู่ใน `@layer` ผลคือ `text-[22px]` ของ `PageHeader` ไม่เคยมีผลเลย ทุกหน้าถูก `clamp(1.45rem, 2vw, 2rem)`
   ดันขึ้นไปถึง 32px บนจอกว้าง เกินสเปก 18–22px จึงต้องปักขนาดด้วย `.life-app .life-page-title h1`

   CSS เดิมที่เลือกด้วย `:has(h1)` แล้วบังคับสีด้วย `!important` ถูกแทนด้วยกฎที่เลือกจาก
   class `.life-page-title` และให้เฉพาะกรอบการ์ด ไม่แตะสีข้างใน (ของเดิมกลบสี eyebrow ทิ้ง)

3. **ปฏิทิน PM (3c)** — เพิ่มไฮไลต์วันนี้ พื้นเสาร์-อาทิตย์ และแยกสีชิป "เลยกำหนด" ออกจาก PM ปกติ
   ให้เท่ากับ `TaskCalendarView` ที่ทำถูกอยู่แล้ว พร้อมคำอธิบายสีใต้ปฏิทิน
   สเปกระบุสีประเภทงาน "ลงพื้นที่" และ "Change window" ด้วย แต่ `maintenance_plans` ไม่มีคอลัมน์ประเภทงาน
   จึง **ไม่ทำ** เพราะต้องเดาข้อมูล ถ้าต้องการต้องเพิ่มคอลัมน์ก่อน

4. **AppErrorBoundary** — เติม `dark:` ที่ขาดไป เดิมผู้ใช้ dark mode จะเจอจอขาวเต็มจอตอนแอปแครช

ที่ตรวจแล้วไม่ใช่ข้อผิดพลาด: การ์ดดำ "เงินที่ประหยัดได้" ของ 3e ทำไม่ได้เพราะ `software_licenses`
ไม่มีคอลัมน์ราคา จะขึ้นการ์ดนี้ต้องกุตัวเลขเงิน — ปล่อยว่างไว้ถูกแล้ว

หมายเหตุ: `variant="hero"` ของ `PageHeader` กับ CSS `.life-page-header--hero` ยังไม่มีหน้าไหนเรียกใช้
(เดิมถูก `!important` ของ CSS เก่ากลบอยู่ ตอนนี้ใช้งานได้แล้วถ้าต้องการ)

### ทะเบียนสาเหตุ ชนิดงาน PM และราคาลิขสิทธิ์ (23 ส.ค. 2026)

สามช่องว่างที่เคยบันทึกไว้ว่า "ทำไม่ได้เพราะ schema ไม่รองรับ" ถูกปิดในรอบนี้ตามที่ผู้ใช้อนุมัติ

1. **ทะเบียนรหัสสาเหตุ** (`20260921100000`) — ตาราง `ticket_cause_codes` + `tickets.cause_code_id`
   - เพิ่มรหัส ไม่ได้แทนที่ `root_cause` ที่เป็นข้อความอิสระ ข้อมูลที่ช่างเคยพิมพ์ไว้ไม่ถูกแตะเลย
   - `on delete set null` ลบรหัสแล้วใบงานไม่หาย และยังเหลือข้อความเดิมเป็นหลักฐาน
   - API: `GET/POST/PATCH /api/v1/cause-codes` — อ่านได้ทุกคนที่ล็อกอิน แก้ต้องมี `cause_code.manage`
   - UI: ชิปในหน้าปิดงานหน้างาน (กรองตามหมวดของใบงาน + สาเหตุกลาง) และ `CauseCodesSection` ใน Master Data

2. **สร้าง KB จากใบงาน** — `POST /api/v1/knowledge/articles/from-ticket`
   - คอลัมน์ `knowledge_articles.source_ticket_id` **มีอยู่แล้ว** ตั้งแต่ `20260905100000` ไม่ต้องเพิ่ม
     (migration แรกที่เขียนซ้ำถูกจับได้จาก pglite harness แล้วตัดออก)
   - รับแค่ `ticketId` เนื้อหาคัดจากใบงานฝั่งเซิร์ฟเวอร์ ผู้เรียกส่งเนื้อหาเองไม่ได้
   - สร้างเป็น **ร่าง** เสมอ เพราะใบงานมักมีชื่อผู้แจ้งหรือรายละเอียดภายในที่ไม่ควรเผยแพร่
   - ทำเป็นขั้นสุดท้ายหลัง PATCH สถานะ ถ้าขั้นนี้ล้ม งานก็ปิดเรียบร้อยไปแล้ว

3. **ชนิดงาน PM** (`20260919100000`) — `maintenance_plans.work_type` (PM / ลงพื้นที่ / Change window)
   ปฏิทินแยกสีได้ตาม 3c แล้ว โดยสถานะ "เลยกำหนด" ยังชนะสีชนิดงานเสมอ

4. **ราคาต่อสิทธิ์** (`20260920100000`) — `software_licenses.unit_price` nullable โดยตั้งใจ
   - `null` = ยังไม่ได้กรอกราคา ไม่ใช่ของฟรี validator ห้ามใช้ `z.coerce.number()` ตรง ๆ เพราะ `Number('') = 0`
   - `GET /api/v1/software-licenses/summary` + `services/licenseCostService.ts` (pure function มี unit test 7 ข้อ)
   - การ์ดสรุปบอกเสมอว่ายังไม่รวมกี่รายการที่ไม่มีราคา และไม่ขึ้นเลยถ้ายังไม่มีใครกรอกราคา

## 5. สถานะข้อมูลจริงล่าสุด

จากการตรวจ Supabase ด้วย query shape เดียวกับ API:

- `notifications`: 17 รายการ
- `integration_outbox`: 0 รายการ
- `line_notification_log`: 0 รายการ
- LINE users สถานะ Active: 0 รายการ
- LINE environment variables ไม่ได้เปิดใน local `.dev.vars`
- Maintenance plans: 0 รายการจากการตรวจรอบ PM Roster

ตัวเลขอาจเปลี่ยนหลังเอกสารนี้ถูกสร้าง ให้ query ใหม่ก่อนสรุปสถานะกับผู้ใช้

## 6. ผลทดสอบล่าสุด

ผ่านทั้งหมด ณ เวลาส่งต่องาน:

- API: 50 test files / 341 tests
- Web: 50 test files / 279 tests
- Supabase (pglite RLS): 20 test files / 241 tests
- Shared: 3 test files / 13 tests
- E2E (Playwright): 4 passed / 25 skipped — specs ที่ข้ามเป็น `*.live.spec.ts` ซึ่งเป็น opt-in
  ต้องตั้ง `LIVE_E2E=1` พร้อมบัญชีจริง จึงยังไม่เคยรันในรอบนี้
- `npm run audit:prod`: 0 vulnerabilities
- API typecheck, lint และ Wrangler dry-run build ผ่าน
- Web typecheck, lint และ Vite production build ผ่าน
- `git diff --check` ไม่มี whitespace error มีเพียงคำเตือน LF/CRLF ของ Windows

คำสั่งตรวจมาตรฐาน:

```powershell
npm.cmd --workspace apps/api run typecheck
npm.cmd --workspace apps/api run lint
npm.cmd --workspace apps/api test
npm.cmd --workspace apps/api run build

npm.cmd --workspace apps/web run typecheck
npm.cmd --workspace apps/web run lint
npm.cmd --workspace apps/web test
npm.cmd --workspace apps/web run build
```

หลังแก้ฟีเจอร์หนึ่งจุด ให้รัน targeted test ก่อน แล้วค่อยรันชุดเต็มก่อนส่งมอบ

## 7. งานหลักที่ยังเหลือ

ทำตามลำดับนี้ เว้นแต่ผู้ใช้ระบุอย่างอื่น:

ทุกจอในดีไซน์ (27 จอ) ทำครบแล้ว เหลือเฉพาะการตรวจรับกับผู้ใช้จริง

### 1. External UAT

- ทำหลังฟีเจอร์ข้างต้นเสร็จ
- ใช้ environment/บัญชี UAT ที่ผู้ใช้อนุญาตเท่านั้น
- ห้าม deploy, ส่งข้อความ LINE, ส่งอีเมล หรือเปลี่ยน external system โดยไม่ได้รับคำสั่งชัดเจน
- บันทึกผลตามเส้นทางจริง: desktop, mobile, dark mode, permission boundary, empty/loading/error states

## 8. หลักการตัดสินใจสำคัญ

- Design mockup เป็นเป้าหมายด้าน layout/visual hierarchy ไม่ใช่แหล่งข้อมูลจริง
- ถ้า mockup มีข้อมูลที่ schema ไม่มี ให้แสดง gap อย่างโปร่งใสหรือเพิ่ม backend ที่ถูกต้อง ห้าม hard-code ให้ดูเหมือนใช้งานได้
- Secret ต้องอยู่ใน deployment environment เท่านั้น หน้า Settings/Integration Center ห้ามอ่านค่ากลับมาแสดง
- Endpoint admin ที่ใช้ service-role client ต้องถูกครอบด้วย permission middleware เสมอ
- การคำนวณ SLA, analytics, workload และ status summary ต้องทำจาก record จริง พร้อม pure service tests เมื่อ logic ซับซ้อน
- รักษา accessibility, responsive layout, dark mode และ empty/loading/error states ทุกหน้าที่เพิ่ม

## 9. จุดเริ่มงานแนะนำสำหรับ AI ตัวถัดไป

1. รัน `git status --short` และ `git log --oneline -5`
2. ยืนยันกับผู้ใช้ว่า migration สามตัวนี้ถูก apply กับ Supabase จริงแล้วหรือยัง
   - `20260916100000_technician_skill_matrix.sql` (apply แล้ว 23 ส.ค. 2026)
   - `20260917100000_field_work_parts_provenance.sql` (apply แล้ว 23 ส.ค. 2026)
   - `20260918100000_user_onboarding_state.sql` (**ยังไม่ apply**)
   - `20260919100000_maintenance_work_type.sql` (**ยังไม่ apply**) — ชนิดงานในปฏิทิน PM
   - `20260920100000_software_license_unit_price.sql` (**ยังไม่ apply**) — ราคาต่อสิทธิ์
   - `20260921100000_ticket_cause_codes.sql` (**ยังไม่ apply**) — ทะเบียนรหัสสาเหตุ + `tickets.cause_code_id`
   ตัวที่ยังไม่ apply จะทำให้ฟีเจอร์ที่ผูกกับมันล้มเหลว — เป็นพฤติกรรมที่ถูกต้อง ไม่ใช่บั๊กที่ต้องไปแก้โค้ด
   (การ์ดต้อนรับกดปิดไม่ได้ / ปฏิทิน PM ทาสีเดียว / การ์ดเงินไม่ขึ้น / ชิปสาเหตุว่างและปิดงานพร้อมรหัสสาเหตุไม่ได้)
   คำสั่ง: `npx.cmd supabase db push --linked --include-all`
3. งานที่เหลือคือ External UAT ให้ตกลงกับผู้ใช้ก่อนว่าจะใช้ environment/บัญชีใด
4. ถ้าจะรัน live E2E ต้องได้รับอนุญาตและตั้ง `LIVE_E2E=1` พร้อมบัญชีทดสอบจากผู้ใช้เท่านั้น

## 10. Definition of Done ต่อหนึ่งหน้าจอ

- ตรง intent และ visual hierarchy ของ mockup
- ใช้ข้อมูลจริงหรือระบุ unsupported state ชัดเจน
- Permission/API/RLS ถูกต้อง
- ไม่มี secret หรือข้อมูลละเอียดอ่อนรั่ว
- Responsive และ dark mode
- มี loading, empty และ error state ที่มีทางออก
- Targeted tests ผ่าน
- API/Web typecheck + lint ผ่าน
- Full tests และ production builds ผ่านก่อนแจ้งผู้ใช้
