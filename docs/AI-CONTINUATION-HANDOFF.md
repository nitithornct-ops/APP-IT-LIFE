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
- ใน PowerShell เครื่องนี้ควรใช้ `npm.cmd` เพราะ `npm.ps1` ถูก Execution Policy บล็อก
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

- API: 50 test files / 340 tests
- Web: 49 test files / 269 tests
- Supabase (pglite RLS): 19 test files / 236 tests
- Shared: 3 test files / 13 tests
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

### 1. Onboarding Flow

อ้างอิง `02-screens.md` หัวข้อ `3k สถานะเริ่มใช้ครั้งแรก`

- ตรวจว่ามี user-level onboarding state หรือยัง
- ต้องมีทางออกและค่าเริ่มต้นที่ปลอดภัย
- ห้ามแสดง onboarding ซ้ำทุกครั้งถ้าไม่มี state persistence

### 2. External UAT

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

1. อ่านเอกสารนี้และ `02-screens.md` ส่วน 3k ให้ครบ
2. รัน `git status --short`
3. ยืนยันกับผู้ใช้ว่า migration สองตัวนี้ถูก apply กับ Supabase จริงแล้วหรือยัง
   - `20260916100000_technician_skill_matrix.sql`
   - `20260917100000_field_work_parts_provenance.sql`
   ถ้ายัง หน้า `/admin/technician-skills`, แผงทักษะใน `/profile` และการตัดอะไหล่ในจอปิดงานหน้างาน
   จะขึ้น error ตามคาด — เป็นพฤติกรรมที่ถูกต้อง ไม่ใช่บั๊กที่ต้องไปแก้โค้ด
4. ตรวจว่ามี user-level onboarding state ในระบบหรือยัง ก่อนเริ่ม Onboarding Flow
   (ห้ามแสดง onboarding ซ้ำทุกครั้งถ้าไม่มีที่เก็บสถานะจริง)
5. เพิ่ม tests และรัน verification ชุดเต็ม

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
