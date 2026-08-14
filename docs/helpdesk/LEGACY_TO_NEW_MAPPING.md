# Legacy GAS → APP_LIFE1 Helpdesk Migration Mapping

> สถานะเอกสาร: Analysis Gate — อ้างอิงจากการอ่าน `legacy-gas/` ทั้งชุดก่อนแก้ระบบใหม่  
> Source of Truth: `legacy-gas/`  
> เป้าหมาย: ย้ายพฤติกรรมและข้อมูลเดิมเข้าสู่ React/Hono/Supabase โดยไม่พึ่งพา GAS runtime หรือ Google Sheets

## 1. ขอบเขตและหลักฐานที่ตรวจสอบ

ตรวจไฟล์ source และเอกสารที่เกี่ยวข้องใน `legacy-gas/` ทั้งหมด โดยเน้น `.gs`, `.html`, `.js`, `.mjs`, `.json`, `.md` และภาพอ้างอิง UI/Workflow

| ประเภท | จำนวนที่พบ | หมายเหตุ |
|---|---:|---|
| Google Apps Script (`.gs`) | 47 | Backend, schema, auth, workflow, report, notification, migration/retention |
| HTML (`.html`) | 35 | Shared shell, public portal, module fragments, CSS และ client scripts |
| JavaScript (`.js`, `.mjs`) | 2 | tooling/test support |
| JSON | 5 | Apps Script manifest และ config/test artifacts |
| Markdown | 21 | architecture, UX/UI, operations, security, evidence |
| PNG | 4 | production UI และ architecture/workflow diagrams |

นิยามจำนวนหน้าจอในรายงานนี้เป็น **logical screen/state** ไม่ใช่จำนวนไฟล์ HTML:

- 37 authenticated module views ใน shell เดียว
- 3 public portal modes: แจ้งซ่อม, วิธีแก้เบื้องต้น, ติดตามสถานะ
- Admin login, Access denied และ LINE callback อีก 3 states
- รวม 43 logical screens/states; มี 35 physical HTML files เพราะหลายหน้าจอใช้ shared shell/fragment

หลักฐาน UI ที่ตรวจด้วยภาพ ได้แก่ `production-public.png`, `production-admin-login.png` และ `ticket_to_incident_workflow.png` ใน `legacy-gas/docs/evidence/` รวมถึง design specification ใน `legacy-gas/docs/UX_UI_DESIGN_SYSTEM_TH.md`

## 2. Legacy file responsibility map

| Legacy file/group | หน้าที่หลัก | Destination ใน APP_LIFE1 |
|---|---|---|
| `Code.gs` | `doGet()` routing, health endpoint, เลือก public/admin/LINE callback shell | React Router + Hono health/public routes |
| `Config.gs` | ชื่อ Sheet 93 รายการ, `DB_SCHEMA`, role/module access, constants | Supabase migrations, shared enums/constants, seed |
| `Ticket.gs` | Ticket CRUD/workflow, category, worklog, tracking, feedback, analytics | Hono ticket/public routes, services, PostgreSQL functions/RLS |
| `PublicTicket.html` | Public portal: แจ้งซ่อม, KB, ติดตามสถานะ, LINE identity | React public Helpdesk routes/components |
| `Index.html` | Authenticated shell, sidebar/topbar/breadcrumb/module loader | `AppShell`, navigation, protected routes |
| Ticket/module HTML fragments | ตาราง, KPI, modal, action forms, chart/report | Helpdesk pages using APP_LIFE1 UI primitives |
| `Dashboard.gs` และ dashboard fragments | KPI และภาพรวมทั้งระบบ | dashboard query/service and widgets |
| `Line.gs`/LINE-related files | LINE Login, identity binding, Messaging API | Existing APP_LIFE1 LINE integration + notification adapter |
| Notification files | Queue, retry, dedupe, LINE send, scheduled reminders | Notification service + queue/worker + channel adapters |
| Attachment/Drive files | upload, registry, link, access log, retention | Supabase Storage + `file_attachments` + signed URLs/audit |
| Auth/User/Permission files | session, roles, module access, admin MFA | Supabase Auth + RBAC permissions + RLS |
| Incident files | ยกระดับ Ticket เป็น Incident และ provenance | Existing incidents domain + transactional escalation RPC |
| Report/Export files | ticket analytics, executive summary, CSV/PDF-related output | API aggregate queries + frontend charts/export |
| `appsscript.json` | timezone, OAuth scopes, web app execution | ไม่ย้าย; ใช้ env/config ของ Vite, Worker และ Supabase |
| Legacy CSS/style HTML | สี, typography, spacing, responsive behavior | Design tokens/Tailwind; ไม่ copy CSS 1:1 |

## 3. Migration report 15 ข้อ

1. **หน้าจอ:** 43 logical screens/states ตามนิยามข้างต้น; Helpdesk โดยตรงคือ public 3 modes, authenticated Ticket module, dashboard ticket section, admin login และ LINE callback ที่เกี่ยวข้อง
2. **Module:** 37 modules ได้แก่ dashboard, task, workflow, calendar, ticket, serviceCatalog, kb, asset, borrow, maintenance, inventory, employees, license, vendor, cmdb, reports, users, settings, auditTrail, tester, notification, dataClass, privacy, problem, vulnerability, audit, access, change, backup, logging, incident, risk, compliance, ai, cloud, awareness, evidence
3. **Google Sheet/Data Source:** 93 schemas ใน `Config.gs`; ชุด Helpdesk หลักคือ Tickets, TicketCategories, Ticket_Worklogs และเกี่ยวข้องกับ Users, LineUsers, LineSessions, AssetRegister, KnowledgeBase, AttachmentRegistry, AttachmentLinks, AttachmentAccessLog, NotificationQueue, NotificationLog, RateLimits, Settings, AuditTrail, Incidents, VendorRegister และ ServiceRequests
4. **Fields:** Tickets 50 fields, TicketCategories 13 fields, Ticket_Worklogs 17 fields; mapping ครบอยู่ในหัวข้อ 8–10
5. **Status:** ใหม่, รับเรื่องแล้ว, กำลังดำเนินการ, รออะไหล่, รอผู้ใช้งาน, ส่งต่อ Outsource, เสร็จสิ้น, ปิดงาน, ยกเลิก, ยกระดับเป็น Incident
6. **Category:** Computer, Notebook, Printer, Network, Software, Email, ขอรับบริการ IT
7. **Priority:** ต่ำ, ปานกลาง, สูง, วิกฤต
8. **Role:** User, Approver, ITAdmin, Executive, DPO
9. **Workflow:** เปิด Ticket → รับเรื่อง/คัดแยก → มอบหมาย/ดำเนินงาน/รอ/Outsource → เสร็จสิ้นหรือปิด/ยกเลิก; Ticket ด้าน Security ยกระดับเป็น Incident ได้ และ Ticket ที่เสร็จสิ้น/ปิดแล้วเปิดใหม่ได้ด้วย action เฉพาะ
10. **GAS functions สำคัญ:** `createTicketCore_`, `submitTicket*`, `getTicketModuleData`, `getTicketAdminBootstrapV2`, `trackTicket*`, `listMyTickets*`, `acknowledgeTicket`, `triageTicket`, `updateTicketWork`, `forwardTicketToOutsource`, `closeTicket`, `cancelTicket`, `reopenTicket`, `escalateTicketToIncident`, category admin, analytics และ feedback functions
11. **Report:** Helpdesk KPI, SLA compliance, average first response/resolution, CSAT, created-vs-closed 6 เดือน, breakdown ตาม status/category/priority, rating distribution, assignee workload, executive monthly summary
12. **Notification:** แจ้ง ITAdmin เมื่อมีงานใหม่, ผู้รับผิดชอบเมื่อ assign/reopen, ผู้แจ้งเมื่อ status เปลี่ยน/close/cancel/escalate/reopen, DPO เมื่อ Incident เกี่ยวข้อง PDPA, scheduled SLA reminder และ queue retry/dedupe
13. **Reuse:** APP_LIFE1 AppShell/navigation, Supabase Auth, RBAC/RLS, Button/Badge/Card/Skeleton/EmptyState/Toast, TanStack Query/forms, NotificationBell/service, private Storage/signed URL, audit service และ domains ที่มีอยู่แล้ว เช่น assets/incidents/vendors/KB/service requests
14. **Rewrite:** GAS endpoints, Spreadsheet CRUD, Drive attachment flow, session/permission checks, trigger jobs, reports และ LINE notification orchestration ให้เป็น Hono/Supabase/Worker architecture
15. **ไม่ควรนำมาใช้:** anonymous Apps Script execution model, Spreadsheet เป็นฐานข้อมูลหลัก, Drive public links, plaintext tracking secret, inline scripts/CSS จำนวนมาก, hardcoded user/role, client-trusted permission และการผูก business logic กับเลขคอลัมน์

## 4. Before / After

| Legacy | New System | Action |
|---|---|---|
| GAS `doGet()` | React Router + Hono routes | Replace |
| HTML Service shell | APP_LIFE1 `AppShell` | Rebuild โดยคง IA/menu |
| PublicTicket HTML | Public Helpdesk React pages | Migrate UI/workflow |
| Ticket admin fragment | `/tickets`, `/tickets/:id`, settings/categories | Migrate |
| Dashboard ticket section | APP_LIFE1 dashboard widgets | Rebuild query/UI |
| Google Sheet `Tickets` | `public.tickets` | Normalize + migrate |
| `TicketCategories` | `ticket_categories` | Migrate exact seed/data |
| `Ticket_Worklogs` | `ticket_worklogs` | Migrate |
| SpreadsheetApp | Supabase PostgreSQL | Replace |
| DriveApp | Supabase Storage/private bucket | Replace |
| Session/User checks | Supabase Auth + RBAC + RLS | Replace |
| Script triggers | Worker cron / scheduled Edge Function | Replace |
| LINE Messaging API calls | Notification channel adapter/queue | Rewrite and reuse integration |
| GAS audit rows | Central audit log | Normalize |
| GAS Incident escalation | Transactional DB/RPC + incidents service | Rewrite atomically |

## 5. Legacy System Map

| Legacy screen | File/functions | Data source/fields | Business behavior | New destination |
|---|---|---|---|---|
| Public: แจ้งซ่อม | `PublicTicket.html`, `getPublicTicketFormData`, `submitTicketPublic`, `submitTicketLine`, `createTicketCore_` | TicketCategories, Settings, Tickets, attachments/rate limits | consent, validation, category SLA, anti-spam, attachment limits, one-time tracking code | `/helpdesk/new` or compatible public route + public API |
| Public: วิธีแก้เบื้องต้น | `PublicTicket.html`, KB functions | KnowledgeBase/category | searchable published KB before submission | `/helpdesk/kb` using existing KB domain |
| Public: ติดตามสถานะ | `trackTicketPublic`, `trackTicketLine`, `listMyTicketsPublic`, `listMyTicketsLine`, feedback functions | Tickets, public worklogs, LineUsers | Ticket+tracking code or LINE identity; public-only timeline; rating 1–5 | `/helpdesk/status`, `/helpdesk/tickets/:ticketNo` |
| Authenticated Ticket list | Ticket module HTML, `getTicketModuleData` | Tickets/categories/users/vendors | KPI, filters, table/cards, role-aware actions | `/tickets` |
| Ticket detail/action modal | acknowledge/triage/work/outsource/close/cancel/reopen/escalate functions | Tickets, worklogs, assets, vendors, incidents, attachments | transition validation, SLA timestamps, audit, notification | `/tickets/:id` + action APIs/RPCs |
| Category admin | category admin functions | TicketCategories | active/inactive, default priority/SLA/security | `/helpdesk/settings/categories` guarded by permission |
| Ticket analytics | analytics functions | Tickets/worklogs/categories/users | SLA/CSAT/trends/workload | `/helpdesk/reports` |
| Dashboard | Dashboard GAS/fragments | ticket aggregates plus other modules | open/overdue/priority summary | existing dashboard widgets |
| Admin login | admin login HTML/auth functions | Users/session/settings | login and access checks | Supabase Auth login |
| LINE callback | callback page/functions | LineSessions/LineUsers | identity binding/state verification | existing LINE callback route/service |

## 6. UI and information architecture mapping

หลักการ: **Legacy UI = Functional Reference; APP_LIFE1 Design System = Visual Foundation**

| Legacy element | สิ่งที่ต้องคง | APP_LIFE1 implementation |
|---|---|---|
| Sidebar | ตำแหน่งเมนู, ชื่อภาษาไทย, active state | `AppShell` sidebar + permission-aware navigation |
| Topbar/breadcrumb | ลำดับข้อมูลและ context ปัจจุบัน | Existing topbar/breadcrumb pattern |
| Page header | ชื่อหน้า, คำอธิบาย, primary action | Reusable page header |
| KPI cards | ทั้งหมด/open/overdue/security/rating ตามหน้าที่ | Card/Skeleton; responsive grid |
| Ticket table | search, field filters, reset, columns, sort, pagination, CSV | Existing table pattern; mobile card fallback |
| Form sections | ปัญหาที่พบ → ข้อมูลติดต่อกลับ → ตรวจสอบก่อนส่ง | React Hook Form + Zod; คง label เดิม |
| Modal/action forms | รับเรื่อง, triage, work, outsource, close, cancel, reopen, escalate | Accessible Dialog with role/status guards |
| Badge | status/priority สีสม่ำเสมอ | Shared Badge with exact legacy labels |
| Loading/empty/error | ปรับปรุงได้โดยไม่เปลี่ยน workflow | Skeleton, EmptyState, Toast/inline error |

ข้อความ public form ที่ต้องคง ได้แก่ `แจ้งซ่อม`, `วิธีแก้เบื้องต้น`, `ติดตามสถานะ`, `ปัญหาที่พบ`, `ประเภทปัญหา *`, `ความเร่งด่วน`, `สรุปปัญหาสั้น ๆ *`, `รายละเอียดเพิ่มเติม *`, `จุดที่พบปัญหา (ถ้ามี)`, `รหัสเครื่อง / Asset`, `แนบรูปภาพหรือไฟล์ประกอบ`, `ข้อมูลสำหรับติดต่อกลับ`, `ชื่อผู้แจ้ง`, `เบอร์โทร`, `แผนก/หน่วยงาน`, `ตรวจสอบก่อนส่ง`, `ส่งแจ้งซ่อม` และผลสำเร็จ `รับแจ้งเรียบร้อยแล้ว`

Design reference ที่ต้องรักษา:

- Font Sarabun; body 15.5/1.55, page title 24/800, section 16/700, label 13–14/700
- spacing scale 4/8/12/16/20/24/32
- primary `#1D4ED8`, primary dark `#173A8A`, background `#F1F5FB`, text `#1E293B`, muted `#64748B`, success `#16A34A`, warning `#D97706`, error `#DC2626`
- desktop sidebar fixed/collapsible; tablet overlay; mobile table → cards, full-width filters และ modal sticky footer
- keyboard focus, ARIA, skip link, reduced motion, high contrast และ font sizing

Legacy ไม่มี logo file ที่ควร copy โดยตรง; logo ถูกอ่านจาก `ORG_LOGO_URL` ใน Settings และ fallback เป็นข้อความ `IT`/`กช` ดังนั้นระบบใหม่ต้องใช้ organization branding/settings หรือ asset เดิมที่ตรวจสิทธิ์แล้ว ห้ามสร้าง brand ใหม่

## 7. Data sources ที่เกี่ยวข้องกับ Helpdesk

`Config.gs` ประกาศทั้งหมด 93 sheets. ขอบเขต Helpdesk โดยตรงและ cross-domain มีดังนี้:

| Legacy source | New source | Action |
|---|---|---|
| Tickets | `tickets` | migrate all 50 fields; normalize references |
| TicketCategories | `ticket_categories` | preserve exact master values |
| Ticket_Worklogs | `ticket_worklogs` | preserve public/private and actor provenance |
| Users | Supabase Auth + `profiles` + role tables | resolve identity, never import passwords |
| LineUsers/LineSessions | existing LINE identity/session tables | migrate active links where lawful |
| AssetRegister | `assets` | resolve by legacy ID/asset code |
| KnowledgeBase | existing KB tables | migrate published content/status |
| AttachmentRegistry/Links/AccessLog | Storage + `file_attachments` + access audit | migrate binary + metadata; private by default |
| NotificationQueue/Log | notification queue/log | migrate only required operational/audit history |
| RateLimits | server-side rate limiter | do not copy stale counters; preserve configuration |
| Settings | typed app settings/secrets | migrate non-secret values; rotate secrets |
| AuditTrail | central `audit_logs` | migrate immutable history/provenance |
| Incidents | `incidents` | preserve Ticket↔Incident relationship |
| VendorRegister | `vendors` | resolve outsource vendor |
| ServiceRequests | existing service request table | preserve source request link |

## 8. Complete Tickets field mapping (50 fields)

| # | Legacy field | Supabase destination | Transform/constraint |
|---:|---|---|---|
| 1 | TicketID | `tickets.ticket_no` | เก็บค่า `TCK-YYYYMMDD-<16HEX>` เดิมแบบ unique; UUID `id` เป็น internal PK |
| 2 | Title | `tickets.title` | trim, required, max 200 |
| 3 | RequesterEmail | `requester_id` lookup + `requester_email_snapshot` | lookup profile แบบ case-insensitive; เก็บ snapshot เพื่อไม่เสียประวัติ/รองรับ guest |
| 4 | RequesterName | `requester_name_snapshot` / `guest_name` | profile snapshot; guest ใช้ `guest_name` |
| 5 | RequesterPhone | `tickets.requester_phone` | preserve text format |
| 6 | Department | `department_id` lookup + `department_name_snapshot` | match master name; unresolved ต้องอยู่ใน exception report |
| 7 | Location | `tickets.location` | preserve text |
| 8 | Category | `category_id` | lookup ด้วย **CategoryName** ไม่ใช่ CategoryID |
| 9 | Priority | `tickets.priority` | exact Thai enum mapping ต่ำ/ปานกลาง/สูง/วิกฤต |
| 10 | ResponseSLAHours | `response_sla_hours` | numeric snapshot from category |
| 11 | ResponseDueAt | `response_due_at` | parse Asia/Bangkok instant safely |
| 12 | ResolutionSLAHours | `resolution_sla_hours` | numeric snapshot |
| 13 | SLAHours | `resolution_sla_hours` fallback + import metadata | legacy compatibility alias; do not duplicate authority |
| 14 | DueAt | `due_at` | resolution due instant |
| 15 | AssetID | `asset_id` | lookup legacy asset ID/code |
| 16 | AssetName | asset snapshot/import provenance | preserve even when asset lookup fails |
| 17 | Description | `tickets.description` | required, max 3000 |
| 18 | Assignee | `assignee_id` lookup + snapshot | match profile email; unresolved exception |
| 19 | IsSecurity | `is_security` | Yes/No → boolean |
| 20 | IncidentID | `incident_id` | lookup migrated incident legacy ID; 1:1 rule |
| 21 | Status | `status` | exact canonical legacy value |
| 22 | AcknowledgedAt | `acknowledged_at` | timestamp |
| 23 | ResolvedAt | `resolved_at` | timestamp |
| 24 | Resolution | `resolution` | preserve text |
| 25 | CloseDate | `closed_at` | timestamp |
| 26 | EvidenceLink | attachment/provenance metadata | copy to private Storage where possible; never expose raw Drive link publicly |
| 27 | PublicToken | controlled re-hash/reissue only | never store plaintext in target |
| 28 | PublicTokenHash | `public_tracking_token_hash` | reuse only if algorithm/pepper can be verified; otherwise reissue securely |
| 29 | RequesterIdentityType | `requester_identity_type` | preserve WEB/LINE/INTERNAL identity semantics |
| 30 | RequesterLineUserID | `requester_line_user_id` | FK by LINE user ID |
| 31 | SourceChannel | `source_channel` + provenance | `WEB_PUBLIC→guest`, `LINE_OA→line`, `WEB_INTERNAL→web`; preserve raw value |
| 32 | Rating | `rating` | integer 1–5 |
| 33 | Feedback | `feedback` | text |
| 34 | FeedbackAt | `feedback_at` | timestamp |
| 35 | OutsourceVendorID | `outsource_vendor_id` | lookup vendor legacy ID |
| 36 | OutsourceName | `outsource_name` | preserve vendor snapshot/free text |
| 37 | OutsourceIssueNo | `outsource_issue_no` | preserve string |
| 38 | OutsourceSentAt | `outsource_sent_at` | timestamp |
| 39 | Notes | `notes` | preserve text |
| 40 | SLAPausedAt | `sla_paused_at` | timestamp |
| 41 | SLAPausedMs | import provenance / validation | raw calendar duration for reconciliation; not SLA authority |
| 42 | SLAPausedBusinessMinutes | `sla_paused_minutes` | authoritative accumulated business minutes |
| 43 | ReopenCount | `reopen_count` | non-negative integer |
| 44 | SourceServiceRequestID | `source_service_request_id` | FK by legacy service request ID |
| 45 | AttachmentIDsJSON | `file_attachments` links | parse JSON, migrate each registry object, record failures |
| 46 | IdempotencyKey | `idempotency_key` | preserve; unique within source/requester scope |
| 47 | Timestamp | `created_at` | original creation timestamp |
| 48 | CreatedBy | `created_by` + actor snapshot | profile lookup; unresolved preserved in provenance |
| 49 | LastUpdatedBy | `updated_by` + actor snapshot | profile lookup; unresolved preserved in provenance |
| 50 | LastUpdatedAt | `updated_at` | original update timestamp |

Schema additions marked as snapshot/provenance are required to satisfy “รักษาข้อมูลเดิม”; they must be limited, access-controlled and not treated as a second business source. A migration ledger must retain source sheet, row number, legacy ID, target UUID, checksum, result and error without exposing secrets.

## 9. TicketCategories field mapping (13 fields)

| # | Legacy field | Supabase destination | Transform |
|---:|---|---|---|
| 1 | CategoryID | `ticket_categories.legacy_id` | preserve `TCAT-*`; target UUID remains PK |
| 2 | CategoryName | `ticket_categories.name` | exact legacy text, unique among active records |
| 3 | DefaultPriority | `default_priority` | exact priority mapping |
| 4 | ResponseSLAHours | `response_sla_hours` | numeric |
| 5 | ResolutionSLAHours | `resolution_sla_hours` | numeric |
| 6 | SLAHours | resolution fallback/provenance | compatibility alias |
| 7 | IsSecurityDefault | `is_security_default` | Yes/No → boolean |
| 8 | Status | `is_active` + legacy status | Active/Inactive mapping |
| 9 | Notes | `notes` | preserve |
| 10 | Timestamp | `created_at` | timestamp |
| 11 | CreatedBy | `created_by` + actor provenance | identity lookup |
| 12 | LastUpdatedBy | `updated_by` + actor provenance | identity lookup |
| 13 | LastUpdatedAt | `updated_at` | timestamp |

Initial category data ต้องเป็นข้อมูล Legacy ชุดนี้ก่อน ไม่ใช่ชุดที่คิดขึ้นใหม่:

| Legacy ID | CategoryName | Default priority | Response SLA | Resolution SLA | Security default | Notes |
|---|---|---|---:|---:|---|---|
| TCAT-001 | Computer | ปานกลาง | 4h | 24h | No | PC |
| TCAT-002 | Notebook | ปานกลาง | 4h | 24h | No | Notebook |
| TCAT-003 | Printer | ปานกลาง | 4h | 16h | No | Printer |
| TCAT-004 | Network | สูง | 2h | 8h | No | Network |
| TCAT-005 | Software | ปานกลาง | 4h | 16h | No | Software |
| TCAT-006 | Email | สูง | 2h | 8h | No | Email |
| TCAT-007 | ขอรับบริการ IT | ปานกลาง | 4h | 24h | No | IT Service Request |

ทุก record เริ่มต้นเป็น Active. หาก production sheet มีค่าที่แก้ภายหลัง ให้ production export ชนะ seed fixture โดยมี migration diff report

## 10. Ticket_Worklogs field mapping (17 fields)

| # | Legacy field | Supabase destination | Transform |
|---:|---|---|---|
| 1 | WorklogID | `ticket_worklogs.legacy_id` | preserve `WL-*` |
| 2 | TicketID | `ticket_id` | lookup migration ledger by legacy TicketID |
| 3 | Action | `action` | preserve Thai/action text |
| 4 | Detail | `detail` | preserve |
| 5 | StatusFrom | `status_from` | exact status mapping |
| 6 | StatusTo | `status_to` | exact status mapping |
| 7 | MinutesSpent | `minutes_spent` | numeric, non-negative |
| 8 | AttachmentURL | private attachment link/provenance | migrate binary where possible; no public raw URL |
| 9 | IsPublic | `is_public` | Yes/No → boolean; controls requester timeline |
| 10 | ActorEmail | `actor_id` lookup + `actor_email_snapshot` | nullable for guest/LINE/system |
| 11 | ActorName | `actor_label` | preserve display name |
| 12 | ActorIdentityType | `actor_identity_type` | preserve provenance |
| 13 | ActorLineUserID | `actor_line_user_id` | identity lookup |
| 14 | Timestamp | `created_at` | original timestamp |
| 15 | CreatedBy | audit/provenance | preserve resolved actor/raw value |
| 16 | LastUpdatedBy | audit/provenance | preserve resolved actor/raw value |
| 17 | LastUpdatedAt | `updated_at` | original timestamp |

## 11. Ticket identity, IDs and secret migration

- Legacy Ticket number ใช้ `TCK-YYYYMMDD-<16 uppercase hex>` จาก `generateId('TCK')`; ต้องเก็บหมายเลขเดิมทั้งหมดและใช้รูปแบบเดียวกันสำหรับการย้ายระยะแรก
- ห้ามแทนด้วย `HD-ปีพุทธศักราช-ลำดับ` โดยไม่มี approved product migration เพราะจะทำให้ผู้ใช้ค้นหาหมายเลขเดิมไม่พบและผิด requirement
- Legacy public tracking code เป็น random 32 uppercase hex แสดง plaintext ครั้งเดียว แล้วเก็บ HMAC-SHA256 ด้วย secret pepper
- ห้าม copy `PublicToken` plaintext ลงฐานใหม่. ถ้ามี pepper และตรวจ hash เดิมได้ ให้ทำ compatibility verifier แบบจำกัดเวลา; ถ้าไม่มี ให้ reissue token แบบควบคุมและแจ้งผู้ใช้ผ่านช่องทางที่ยืนยันตัวตนได้
- UUID เป็น target internal PK; ทุก foreign key migration ต้อง resolve ผ่าน migration ledger ไม่ใช้ Ticket number เป็น FK ภายใน

## 12. Workflow และ transition matrix

### 12.1 Canonical statuses

| Status | Terminal ใน Legacy | Pause SLA | Action หลัก |
|---|---|---|---|
| ใหม่ | ไม่ | ไม่ | รับเรื่อง/คัดแยก/ส่งต่อ/ปิด/ยกเลิก/ยกระดับ |
| รับเรื่องแล้ว | ไม่ | ไม่ | เริ่มงาน/รอ/Outsource/เสร็จสิ้น/ปิด/ยกเลิก/ยกระดับ |
| กำลังดำเนินการ | ไม่ | ไม่ | update work/รอ/Outsource/เสร็จสิ้น/ปิด/ยกเลิก/ยกระดับ |
| รออะไหล่ | ไม่ | ใช่ | กลับดำเนินการ/เปลี่ยนรอ/Outsource/เสร็จ/ปิด/ยกเลิก/ยกระดับ |
| รอผู้ใช้งาน | ไม่ | ใช่ | กลับดำเนินการ/เปลี่ยนรอ/Outsource/เสร็จ/ปิด/ยกเลิก/ยกระดับ |
| ส่งต่อ Outsource | ไม่ | **ไม่** | update/outsource/เสร็จ/ปิด/ยกเลิก/ยกระดับ |
| เสร็จสิ้น | ใช่ | ไม่ | ปิดงาน; เปิดใหม่ผ่าน action เฉพาะ |
| ปิดงาน | ใช่ | ไม่ | เปิดใหม่ผ่าน action เฉพาะ |
| ยกเลิก | ใช่ | ไม่ | ไม่มี regular transition |
| ยกระดับเป็น Incident | ใช่ | ไม่ | ทำงานต่อใน Incident domain |

`เสร็จสิ้น` ถือเป็น terminal ใน helper ของ Legacy แม้ยังเปลี่ยนเป็น `ปิดงาน` ได้ผ่าน transition ที่อนุญาต. ระบบใหม่ต้องแยกความหมาย “หยุด SLA/งานจบ” ออกจาก “ไม่มี action ใดอีก” เพื่อไม่ให้ metadata ขัดกัน

### 12.2 Allowed transitions from Legacy code

| From | Allowed To |
|---|---|
| ใหม่ | รับเรื่องแล้ว, กำลังดำเนินการ, ส่งต่อ Outsource, ปิดงาน, ยกเลิก, ยกระดับเป็น Incident |
| รับเรื่องแล้ว | กำลังดำเนินการ, รออะไหล่, รอผู้ใช้งาน, ส่งต่อ Outsource, เสร็จสิ้น, ปิดงาน, ยกเลิก, ยกระดับเป็น Incident |
| กำลังดำเนินการ | กำลังดำเนินการ, รออะไหล่, รอผู้ใช้งาน, ส่งต่อ Outsource, เสร็จสิ้น, ปิดงาน, ยกเลิก, ยกระดับเป็น Incident |
| รออะไหล่ | กำลังดำเนินการ, รออะไหล่, รอผู้ใช้งาน, ส่งต่อ Outsource, เสร็จสิ้น, ปิดงาน, ยกเลิก, ยกระดับเป็น Incident |
| รอผู้ใช้งาน | กำลังดำเนินการ, รออะไหล่, รอผู้ใช้งาน, ส่งต่อ Outsource, เสร็จสิ้น, ปิดงาน, ยกเลิก, ยกระดับเป็น Incident |
| ส่งต่อ Outsource | กำลังดำเนินการ, รออะไหล่, รอผู้ใช้งาน, ส่งต่อ Outsource, เสร็จสิ้น, ปิดงาน, ยกเลิก, ยกระดับเป็น Incident |
| เสร็จสิ้น | ปิดงาน; หรือเปิดใหม่ → กำลังดำเนินการ |
| ปิดงาน | เปิดใหม่ → กำลังดำเนินการ |
| ยกเลิก | ไม่มี |
| ยกระดับเป็น Incident | ไม่มี |

### 12.3 Action behavior

| Action | Role | Validation | Writes | Notification |
|---|---|---|---|---|
| สร้าง Ticket | User/guest/LINE ตาม policy | category/title/description required; max 120/200/3000; active category; priority enum; consent/rate/attachment rules | Ticket, public worklog `เปิด Ticket`, audit, SLA due dates, tracking hash | ITAdmin/default LINE target |
| รับเรื่อง | Approver/ITAdmin | status ต้องอนุญาต | status=รับเรื่องแล้ว, AcknowledgedAt, public worklog, audit | requester |
| คัดแยก/มอบหมาย | Approver/ITAdmin | active category, valid priority/assignee | category/priority/assignee/security; recalc SLA when category changes; private worklog | assignee; requester if status changes |
| บันทึกงาน | ITAdmin | allowed work status, minutes valid | status/work detail/resolution/minutes, public worklog, pause/resume SLA | requester on status change |
| ส่งต่อ Outsource | ITAdmin | active vendor or allowed free text | `OUT-*`, vendor/name/issue/time, status, notes, public worklog | requester |
| ปิดงาน | ITAdmin | active transition; **resolution required** | ResolvedAt, CloseDate, settle pause, public worklog | requester + rating invitation |
| ยกเลิก | ITAdmin | active status; **reason required** | CloseDate, Notes, public worklog | requester |
| เปิดใหม่ | ITAdmin | only เสร็จสิ้น/ปิดงาน; **reason required** | status=กำลังดำเนินการ, reset close/resolution pause timestamps, recalc SLA from now, increment ReopenCount | requester + assignee |
| ยกระดับ Incident | Approver/ITAdmin | active ticket; incident payload valid | create/reconcile 1:1 Incident, provenance/attachments, mark security/status/IncidentID | requester; DPO for PDPA |
| ให้คะแนน | requester with verified ticket access | 1–5 and policy window if configured | Rating/Feedback/FeedbackAt | optional admin analytics update |

## 13. SLA and validation rules

- SLA source of truth คือ category snapshot: ResponseSLAHours และ ResolutionSLAHours; ไม่ใช่ priority-wide SLA ที่คิดขึ้นใหม่
- เวลาทำการ default: จันทร์–ศุกร์ 08:30–17:30, holidays configurable
- due date และ duration reports ต้องคำนวณ business time; resolution duration หัก `SLAPausedBusinessMinutes`
- pause SLA เฉพาะ `รออะไหล่` และ `รอผู้ใช้งาน`; `ส่งต่อ Outsource` **ไม่ pause** ใน Legacy
- category required, title required max 200, category label max 120, description required max 3000
- attachment default: สูงสุด 5 ไฟล์, 10 MB/ไฟล์, รวม 20 MB; MIME PDF/JPG/PNG/WEBP/HEIC/TXT
- public rate default: device 3/hour และ 8/day; global 60/hour และ 300/day
- public consent required by default; optional LINE-required mode, allowed email domain, honeypot/access code
- PII retention default 730 วัน, attachment 730 วัน, staged upload 72 ชั่วโมง, soft-delete retention 365 วัน; dry-run retention default

## 14. Role and permission mapping

| Legacy role | Legacy Ticket capability | APP_LIFE1 role | Required permission outcome |
|---|---|---|---|
| User | create; view own; see public worklogs | `user` | `ticket.create`, `ticket.view_own`, public comment/feedback as applicable |
| Approver | view all, acknowledge, triage/assign, escalate; may be assignee | `approver` | ต้องเพิ่ม/ยืนยัน update, assign, triage, escalate; ห้าม close/cancel/category admin |
| ITAdmin | full manage, work, outsource, close/cancel/reopen/category admin | `it_admin` | full Helpdesk operations |
| Executive | analytics/read-only | `executive` | view all/report; no mutation |
| DPO | ไม่มี Ticket module โดยตรง; รับ PDPA incident alert | `dpo` | Incident/PDPA scope; no implicit Helpdesk write |

`super_admin`, `technician`, `manager`, `auditor` เป็น role เพิ่มเติมของ APP_LIFE1 ไม่ใช่ Legacy master. อนุญาตให้ใช้ได้ แต่ห้ามเปลี่ยนสิทธิ์ของผู้ใช้เดิมระหว่าง migration โดยไม่ทำ explicit mapping/approval

Current gap: seed ของ APP_LIFE1 ให้ `approver` อ่าน Ticket ได้แต่ยังไม่ครบ capability triage/assign/escalate ตาม Legacy จึงต้องแก้ permission seed/RLS/API ก่อน cutover

## 15. Business Logic mapping

| GAS function/group | Legacy responsibility | New architecture |
|---|---|---|
| `getPublicTicketFormData` | active categories, limits/settings, identity context | public GET route + cached typed settings |
| `submitTicketPublic`, `submitTicketLine`, `submitTicket` | channel-specific validation and identity | three thin route adapters calling shared ticket application service |
| `createTicketCore_` | authoritative create, SLA, ID/token, worklog/audit/notify | transactional PostgreSQL function/RPC called by Hono service; side effect outbox |
| `trackTicketPublic`, `trackTicketLine` | verified requester read | public token verifier / LINE ownership policy + restricted projection |
| `listMyTicketsPublic`, `listMyTicketsLine` | requester list/KPI | identity-scoped API query/RLS |
| feedback functions | rating 1–5 | verified requester endpoint + constraint/audit |
| `getTicketModuleData`/bootstrap | list masters, permissions, staff/vendors | composable APIs + TanStack Query; server-authoritative permissions |
| `acknowledgeTicket` | acknowledge timestamp/status/worklog | action endpoint or RPC |
| `triageTicket` | category/priority/assignee/security/SLA | action endpoint/RPC with category lookup and private worklog |
| `updateTicketWork` | worklog/status/minutes/pause/resume | action endpoint/RPC |
| `forwardTicketToOutsource` | vendor handoff and tracking | action endpoint/RPC, vendor FK/snapshot |
| `closeTicket`/`cancelTicket`/`reopenTicket` | terminal/special transitions | explicit commands, not generic patch |
| `escalateTicketToIncident` | atomic ticket↔incident escalation | security-definer RPC/service transaction + incident permission check |
| category admin functions | master maintenance | `/helpdesk/settings/categories` CRUD + audit |
| analytics functions | aggregates and SLA/CSAT metrics | SQL views/RPCs/materialized aggregates if needed |
| notify/queue/retry functions | LINE routing, dedupe, retry | notification outbox + Worker cron/Edge Function adapters |

Generic `PATCH /tickets/:id` ไม่ควรเป็นทางเดียวสำหรับ workflow สำคัญ เพราะแต่ละ action มี validation, timestamp, worklog, audit และ notification ต่างกัน. ใช้ command endpoints เช่น `/acknowledge`, `/triage`, `/worklogs`, `/outsource`, `/close`, `/cancel`, `/reopen`, `/escalate` และบังคับ transaction เดียวกัน

## 16. Reports and dashboard mapping

| Legacy metric/report | Definition/source | New destination |
|---|---|---|
| Open tickets | non-terminal tickets | dashboard/helpdesk KPI |
| Overdue | current business time beyond resolution due, excluding terminal | dashboard/helpdesk KPI |
| Security tickets | `IsSecurity=Yes` | KPI/filter |
| Average rating / CSAT | ticket ratings 1–5 | KPI/report |
| SLA compliance | completed within effective due after paused business minutes | report RPC/view |
| Average first response | Created→Acknowledged in business hours | report RPC/view |
| Average resolution | Created→Resolved/Closed in business hours minus pauses | report RPC/view |
| Created vs closed | monthly series, last 6 months | line/bar chart |
| By status/category/priority | counts for selected range | chart/table |
| Rating distribution | 1–5 counts | chart |
| Assignee workload | active tickets per assignee | table/chart |
| Ranges | 30/90/365 days/all | shared report filter |
| Executive monthly | summarized open/overdue and service metrics | scheduled notification/export |

Global dashboard เดิมแสดง ticket total/open/warn/over และ priority distribution. สามารถใช้ dashboard components ปัจจุบัน แต่ query ต้องใช้ canonical status/SLA semantics ข้างต้นและคงตำแหน่ง/คำศัพท์ที่ผู้ใช้คุ้นเคย

## 17. Notification mapping

Legacy notification หลักเป็น LINE; email ถูกปิดใน workflow Helpdesk ปกติ ยกเว้นเส้นทาง admin MFA/legacy OTP บางส่วน

| Event | Recipient | New implementation |
|---|---|---|
| Ticket created | ITAdmin or configured default LINE target | transaction writes outbox; LINE adapter sends |
| Assigned/triaged | assignee | user→LINE link/channel preference |
| Acknowledged/status changed | requester | verified LINE/in-app channel; no data leak to unverified contact |
| Closed | requester | status/resolution + feedback invitation |
| Cancelled | requester | reason/status |
| Reopened | requester and assignee | new SLA/status context |
| Escalated | requester; DPO if PDPA | link to permitted Incident context |
| SLA reminder | responsible/admin | scheduled job; unacknowledged/near-over response and resolution SLA |
| Monthly executive | configured executives | scheduled summary |

Queue semantics ที่ต้อง preserve: PENDING/RETRY/DEAD/SENT, dedupe hash, max attempts default 5, exponential retry `5 × 2^(attempt-1)` นาที capped ที่ 360 นาที. Topbar summary ใน Legacy เป็น derived alert จาก dashboard ไม่ใช่ persistent per-user notification; APP_LIFE1 `NotificationBell` สามารถเป็น destination แต่ต้องแยก derived operational alerts กับ persisted notifications ให้ชัด

## 18. APP_LIFE1 reuse assessment

### 18.1 Reuse ได้

- React 18 + TypeScript + Vite + React Router
- `AppShell` sidebar/topbar/mobile navigation และ permission-aware menu
- Supabase Auth context, `ProtectedRoute`, `RequirePermission`
- Hono API conventions and permission middleware
- PostgreSQL/RLS foundation
- shared UI primitives: Button, Badge, Card, Skeleton, EmptyState, Toast
- TanStack Query, React Hook Form และ Zod validation
- private Supabase Storage, signed URL flow, attachment service
- notification service/`NotificationBell`
- central audit service
- existing Assets, Departments, Profiles, Incidents, Vendors, Knowledge Base และ Service Requests domains

### 18.2 ต้อง Rewrite/Extend

- Ticket create/update ให้ใช้ transaction และ business-hours SLA
- action-specific endpoints/RPCs พร้อม worklog/audit/outbox แบบ atomic
- public tracking token compatibility and secure migration
- exact category/status/priority seed
- snapshot/provenance fields และ migration ledger
- full attachment migration from Drive registry
- ticket reports and SLA reconciliation
- LINE/public identity ownership policies
- category administration and exact role behavior

### 18.3 Gap/Conflict ที่พบใน implementation ปัจจุบัน

| Severity | Current state | Legacy requirement / action |
|---|---|---|
| Blocker | Helpdesk seed มี 10 categories ที่สร้างใหม่ | replace initial master ด้วย exact 7 legacy categories; production export wins |
| Blocker | labels บาง status เปลี่ยน เช่น `รับงานแล้ว`, `รอผู้ใช้`, `ดำเนินการเสร็จ` | restore exact labels `รับเรื่องแล้ว`, `รอผู้ใช้งาน`, `เสร็จสิ้น` ฯลฯ |
| Blocker | priority display ใช้ `เร่งด่วน` สำหรับ URGENT | legacy canonical label คือ `วิกฤต` |
| Blocker | DB marks Outsource as SLA-pausing | only รออะไหล่/รอผู้ใช้งาน pause |
| Blocker | DB transition table ขาด direct close บางเส้นทาง ขณะที่ API อนุญาต | align DB/API with exact matrix; DB remains authority |
| Blocker | new Ticket function generates `HD-พ.ศ.-0001` | preserve `TCK-YYYYMMDD-16HEX` during migration |
| High | generic API patch/worklog behavior ไม่ครอบคลุม action-specific validation | implement explicit transactional commands |
| High | API SLA calculation ใช้ calendar hours | implement business calendar/holiday logic |
| High | migration transform ไม่ map TicketID → `ticket_no` | correct transform and ledger |
| High | category lookup ใช้ Category value เสมือน CategoryID | lookup Tickets.Category by CategoryName |
| High | migration transform ขาดหลาย Ticket/worklog fields | implement complete mapping in sections 8–10 |
| High | requester lookup by email อย่างเดียว | support guest/LINE/unresolved provenance |
| High | Approver permission ไม่ครบ triage/assign/escalate | correct RBAC seed/tests/RLS |
| Medium | schema เพิ่ม subcategory/room/building/root cause | keep as optional new-only fields; do not require for legacy records |
| Medium | priority-wide SLA policies ถูกสร้างใหม่ | category snapshot is migration authority; policies optional only after approved mapping |
| Medium | `requires_note` metadata ไม่ถูก enforce ที่ DB | enforce in command validation/DB where appropriate |

ไฟล์ migration/seed/helpdesk docs ที่มีอยู่ใน working tree ก่อนเอกสารนี้ถือเป็น **work in progress** และยังไม่ผ่าน Analysis Gate จนกว่า conflicts ข้างต้นได้รับการแก้และทดสอบ

## 19. Target migration architecture

```text
React Helpdesk UI
  ├─ Public: New / KB / Track / Feedback
  └─ Authenticated: List / Detail / Actions / Categories / Reports
                 │
                 ▼
Hono API (auth, Zod, rate limit, permission commands)
                 │
                 ▼
PostgreSQL transaction / RPC
  ├─ tickets + ticket_worklogs
  ├─ categories + profiles/departments/assets/vendors
  ├─ incidents + service_requests
  ├─ file_attachments + private Storage
  ├─ audit_logs
  └─ notification_outbox
                 │
                 ▼
Worker cron / Edge Function → LINE / in-app channels

Offline controlled importer
  Google Sheet export + Drive export
       → validate/normalize → staging + migration ledger
       → transactional load → reconciliation report
```

Security boundaries:

- Browser ไม่กำหนด role/status transition เอง; server/RLS/DB เป็น authority
- public API คืนเฉพาะ restricted projection และต้องพิสูจน์ tracking token/LINE ownership
- attachment private by default; signed URL อายุสั้นและมี access audit
- secrets/pepper/LINE tokens อยู่ใน secret manager/env; ไม่อยู่ใน seed/source/migration ledger
- every mutation writes business record, worklog, audit and notification outbox atomically where applicable
- service role ใช้เฉพาะ controlled backend/importer ไม่ส่งถึง browser

## 20. Data migration execution plan

1. Freeze/export production sheets and Drive registry with timestamp/checksum; do not modify `legacy-gas/`
2. Load exact exports into restricted staging tables/object storage
3. Validate headers against `Config.gs` schemas; fail closed on missing/renamed columns
4. Migrate masters first: roles/users/departments/assets/vendors/categories/KB
5. Migrate incidents/service requests needed by Ticket FKs
6. Migrate Tickets using mapping ledger and exception table
7. Migrate worklogs, attachments, feedback, audit and required notification history
8. Reconcile counts, IDs, nulls, FK misses, status/category/priority distributions, SLA dates, attachment checksums
9. Run authorization tests by all five legacy roles plus APP_LIFE1 extra roles
10. Dry-run workflow/UAT with representative old tickets and public tracking
11. Delta migration during cutover window, then switch traffic
12. Keep legacy read-only/reference until signed reconciliation and rollback window expire

Required reconciliation checks:

- source/target counts per entity and per status
- 100% unique TicketID→ticket_no preservation
- zero silent category/assignee/asset/vendor/incident FK drops
- all 50 Ticket and 17 Worklog fields either mapped, securely transformed, or recorded as an explicit exception
- timestamp normalization validated against Asia/Bangkok
- rating distribution and report totals match legacy fixtures
- attachment count/size/checksum and private access behavior
- public tokens never present as plaintext in target/logs
- sampled due dates match Legacy business-hour calculator

## 21. Analysis Gate decision and implementation order

Legacy analysis is complete enough to begin migration work, subject to using this document as the implementation contract. The current unreviewed Helpdesk foundation must first be reconciled with the Legacy facts; building more UI on top of conflicting seeds/workflow would lock in incorrect behavior.

Implementation order:

1. Correct canonical shared constants, exact Thai labels, category seed and role permission mapping
2. Correct/extend Supabase schema, transitions, business calendar/SLA and migration ledger
3. Repair importer to cover the complete field maps and add dry-run reconciliation
4. Implement transactional ticket commands and public identity/token paths
5. Implement attachment migration/private access
6. Migrate authenticated list/detail/actions using APP_LIFE1 components and Legacy IA
7. Migrate public report/KB/status experience with the exact Thai content/field order
8. Implement analytics/notifications/cron
9. Run DB/API/unit/integration/E2E/accessibility/responsive tests and visual comparison against legacy evidence

## 22. Acceptance checklist

- [ ] `legacy-gas/` remains unchanged and operational
- [ ] exact Legacy Ticket number, labels, fields, categories, priorities and transitions preserved
- [ ] all mapping exceptions are explicit; no silently discarded data
- [ ] category-based business-hour SLA matches legacy, including pause semantics
- [ ] legacy roles retain equivalent capabilities after Supabase Auth/RBAC mapping
- [ ] public/LINE requester can access only owned/verified Tickets and public worklogs
- [ ] actions write timestamps/worklogs/audit/notification consistently
- [ ] attachments are private, migrated and traceable
- [ ] Dashboard/report metrics reconcile with source
- [ ] UI preserves menu, information order, Thai terminology and familiar workflow
- [ ] responsive, accessibility, loading, empty and error states meet APP_LIFE1 standards
- [ ] migration dry-run, reconciliation, cutover and rollback artifacts are approved

## 23. Implementation checkpoint (2026-08-11)

งาน foundation ที่ทำหลังผ่าน Analysis Gate ในรอบนี้:

- แก้ priority/status master ให้ใช้ข้อความ Legacy ตรงตัว และ pause SLA เฉพาะรออะไหล่/รอผู้ใช้งาน
- แก้ transition table เป็น 45 edges ตาม state map จริง รวม close/reopen/escalate paths
- ใช้เลข `TCK-YYYYMMDD-16HEX` และ preserve TicketID เดิมระหว่าง import
- seed 7 Ticket categories พร้อม category-based response/resolution SLA เดิม
- เพิ่ม `ticket.triage`/`ticket.escalate` และคืน capability ของ Approver ตาม Legacy
- เพิ่ม schema snapshot/provenance ที่จำเป็น และแก้ importer ให้ map Ticket/Category/Worklog/identity/FK สำคัญโดยไม่ทิ้ง TicketID
- คำนวณ SLA แบบเวลาทำการ Asia/Bangkok จาก Settings สำหรับ authenticated/public/LINE create, category recalc, reopen และ pause/resume
- แสดง/ค้นหา public Ticket ด้วยเลข Ticket เดิมแทน UUID โดยยังรองรับ UUID bookmark เก่า
- ปรับคำหลักใน authenticated/public UI เป็น `แจ้งซ่อมออนไลน์`, `รายการแจ้งซ่อม`, `ส่งแจ้งซ่อม` และ field labels เดิม
- คืน Public Portal 3 modes ตาม Legacy ได้แก่ `แจ้งซ่อม`, `วิธีแก้เบื้องต้น`, `ติดตามสถานะ` โดย reuse Knowledge API ของ APP_LIFE1
- ใช้ public create limits เดิม 3/hour, 8/day ต่อ client และ 60/hour, 300/day แบบ global พร้อม validation 200/3000 ตัวอักษรจาก Ticket core
- ปรับหน้า authenticated Help Desk ตาม visual reference: header/action bar, KPI Ticket เปิดอยู่/เกิน SLA/Security/คะแนนเฉลี่ย, search/filter/export และตารางผู้แจ้ง/ผู้รับผิดชอบ/Outsource โดย KPI/query ยังผ่าน RLS
- เพิ่ม runbook สำหรับ Supabase ใหม่ที่ `docs/helpdesk/NEW_SUPABASE_SETUP.md` และ seed config สำหรับ `db push --include-seed`

งานที่ยังต้องทำก่อนถือว่า migration สมบูรณ์:

- แยก generic Ticket patch ให้เป็น transactional action commands ครบทุก action
- ทำ attachment binary export/import จาก Drive และหน้าแนบไฟล์ครบวงจร
- ทำ Ticket analytics/report/notification cron และ reconciliation เทียบ production export
- ทำ public/authenticated responsive/mobile fidelity ให้ครบรายละเอียดเดิม พร้อม visual regression
- ทำ cutover rehearsal ด้วยข้อมูลจริง, exception review, UAT, rollback และ sign-off

Verification checkpoint: Supabase 190 tests, migration 30 tests, API 146 tests และ Web 36 tests ผ่าน; typecheck ของ API/Web/Shared/Migration/Supabase ผ่าน
