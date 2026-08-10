# Phase 0 — Migration Roadmap (ปรับจากแผน Phase 0–9 เดิม ตามข้อเท็จจริงที่ตรวจพบ)

แผนหลักยังคงเป็นไปตามโครงสร้าง Phase 0–9 ที่กำหนดไว้ในคำสั่งเริ่มต้น (ข้อ 14) **ไม่มีการเปลี่ยนจำนวน Phase**
เอกสารนี้ปรับเฉพาะรายละเอียดภายในแต่ละ Phase ให้สอดคล้องกับสิ่งที่พบจริงใน Phase 0

## Phase 0 — วิเคราะห์ระบบเดิม ✅ (เอกสารชุดนี้)

สถานะ: เสร็จสิ้น ผลส่งมอบ 6 ไฟล์ในโฟลเดอร์ `phase0-analysis/` — ไม่มีการแก้ไข Source Code เดิม

## Phase 1 — สร้างโครงสร้างโครงการ (ยังไม่เริ่ม — รอคำสั่ง)

ข้อสังเกตเพิ่มเติมจาก Phase 0 ที่ต้องพิจารณาตอนเริ่ม Phase 1:

- โฟลเดอร์ `.git` ในโปรเจกต์ปัจจุบันว่างเปล่า (ไม่มี history จริง — ดู R-15) ต้องตัดสินใจว่าจะ `git init` ใน repo
  ปัจจุบันนี้ต่อ หรือสร้าง repo ใหม่แยกสำหรับ Monorepo `ITLIFE/`
- Source Code เดิมทั้งหมด (47 .gs + 33 .html + docs) ต้องถูกคัดลอก (ไม่ใช่ย้าย/ลบ) เข้า `legacy-gas/` ตามโครงสร้าง
  เป้าหมายข้อ 6 — ทำหลังยืนยันตำแหน่ง repo แล้วเท่านั้น
- โฟลเดอร์ `phase0-analysis/` (เอกสารชุดนี้) ควรย้ายเนื้อหาไปรวมกับ `docs/migration.md` และ `migration/reports/`
  ของ Monorepo ใหม่ตามโครงสร้างเป้าหมาย

## Phase 2 — Database Schema และ RLS

- **ต้องใช้ `Config.gs > DB_SCHEMA` เป็นแหล่งอ้างอิงหลัก ไม่ใช่ `docs/02`** (ดู R-08) — จะมีตารางประมาณ 93 ตารางฐาน
  (ก่อนหักตารางที่ตั้งใจไม่ย้าย เช่น `RateLimits`, `QATestCases`) บวกตารางใหม่ที่คำสั่งกำหนด (`departments`,
  `positions`, `roles`, `permissions`, `user_roles`, `role_permissions`, `login_logs`, `contracts`)
- ออกแบบ RLS ต้องรองรับทั้ง 2 กรณีการเข้าถึงข้อมูล: "เฉพาะของตนเอง" (Task, Personal data) และ "ตามหน่วยงาน/บทบาท"
  (Ticket, Asset ฯลฯ) ตามที่พบใน Module Matrix จริง ไม่ใช่แค่ RBAC ระดับโมดูล
- Workflow Engine (`workflow_definitions`/`workflow_steps`/`workflow_instances`/...) ของเดิมออกแบบไว้ดีมาก
  (versioning, snapshot, SoD) — ใช้เป็นต้นแบบการออกแบบตารางชุดนี้ในระบบใหม่ได้ค่อนข้างตรง ประหยัดเวลาออกแบบ

## Phase 3 — Authentication และ Permission

- ต้องได้คำตอบจากคำถามข้อ 2 ใน Risk Register (`phase0-risk_register.md`) เรื่อง Role Mapping ก่อนเริ่ม
- ต้องขอค่า Secret ของ LINE Login (Channel ID/Secret) จากเจ้าของระบบก่อนเริ่มพัฒนา LINE Login ในระบบใหม่ (R-11)
- ออกแบบ flow "เชิญผู้ใช้ตั้งรหัสผ่านใหม่" สำหรับผู้ใช้ 27 คนเดิม (R-04) — ต้องทำก่อน Cutover จริงใน Phase 9

## Phase 4 — Core API

- ต้องตัดสินใจเครื่องมือสร้าง PDF/รายงานก่อนเริ่ม endpoint ของ Report Center และ Evidence Export (R-13)
- ควรอ่าน `Module_OperationsHardening.gs` แบบละเอียด (ยังไม่ได้อ่านลึกใน Phase 0) ก่อน implement SLA/Retention
  engine ใหม่ (R-14) เพราะมี business logic เวลาทำการ/วันหยุดเฉพาะ

## Phase 5 — Frontend Core

ไม่มีข้อสังเกตเพิ่มเติมนอกเหนือจากสเปกเดิม — Design System เดิม (`Styles.html`, ธีมน้ำเงิน-ขาว, Dark mode,
Accessibility, Command Palette) เป็นข้อมูลอ้างอิงที่ดีสำหรับทีม UX/UI ออกแบบ Design System ใหม่ด้วย Tailwind

## Phase 6 — ย้ายโมดูล (ลำดับที่ปรับจากคำสั่งเดิม ให้ครอบคลุมโมดูลกลุ่ม E ด้วย — รอการยืนยันขอบเขตจากคำถามข้อ 1)

ลำดับเดิมในคำสั่ง (20 ลำดับ) ยังใช้ได้กับกลุ่ม A–D ทั้งหมด เสนอแทรกโมดูลกลุ่ม E เข้าไปตามความสัมพันธ์เชิงข้อมูล
(โมดูลที่โมดูลอื่นพึ่งพา ควรย้ายก่อน):

| ลำดับ | โมดูล | เหตุผลของลำดับ |
|---|---|---|
| 1 | Master Data (รวม Departments/Positions ใหม่) | ทุกโมดูลอ้างอิง |
| 2 | User/Role/Permission (รวม Action Permission + Approval Group) | ต้องมีก่อนทดสอบสิทธิ์โมดูลอื่น |
| 3 | Employee (**เพิ่มจากเดิม** — Asset/Ticket ผูกเจ้าของกับ Employee) | Asset/Ticket ต้องการ owner ที่ถูกต้อง |
| 4 | Ticket | ตามแผนเดิม |
| 5 | Service Catalog | ตามแผนเดิม |
| 6 | Access Request | ตามแผนเดิม |
| 7 | Task และ My Work (รวม Kanban ใหม่) | ตามแผนเดิม |
| 8 | Asset (รวม Borrow/PM/Inventory/License เดิม) | ตามแผนเดิม — ควบรวม IT Asset Extras เข้าด้วยกัน |
| 9 | CMDB | ตามแผนเดิม |
| 10 | Incident (รวม Risk Matrix) | ตามแผนเดิม |
| 11 | Problem | ตามแผนเดิม |
| 12 | Change | ตามแผนเดิม |
| 13 | Contract และ Vendor (ตาราง `contracts` ใหม่ทั้งหมด — R-07) | ตามแผนเดิม แต่ปริมาณงานสูงกว่าที่คาด |
| 14 | Software License | ตามแผนเดิม |
| 15 | Vulnerability และ Patch | ตามแผนเดิม |
| 16 | Backup และ Monitoring | ตามแผนเดิม |
| 17 | Workflow Approval (ใช้เป็นต้นแบบ engine กลาง) | ตามแผนเดิม |
| 18 | Knowledge Base | ตามแผนเดิม |
| 19 | **Data Classification, Legal Compliance, Privacy/PDPA, Risk, AI/Cloud Register, Awareness, Audit Evidence/Management, Governance Documents (กลุ่ม E — เพิ่มจากเดิม)** | รอการยืนยันขอบเขตตามคำถามข้อ 1 — เสนอทำเป็นกลุ่มหลัง ITSM หลักเสร็จ เพราะผู้ใช้ธุรกิจส่วนใหญ่ (27 คน) ใช้ ITSM บ่อยกว่า |
| 20 | Report Center | ตามแผนเดิม — รวมศูนย์จากที่กระจายอยู่เดิม |
| 21 | Dashboard | ตามแผนเดิม |
| 22 | Settings และ Audit Log | ตามแผนเดิม |

**Field Designer และ PDF Designer ไม่อยู่ในลำดับนี้** — รอการตัดสินใจตามคำถามข้อ 3 ใน Risk Register ก่อนกำหนดลำดับ

## Phase 7 — Data Migration

- Phase 0 นี้ไม่มีสิทธิ์เข้าถึง Production Spreadsheet จริง (A-06) — Phase 7 ต้องเริ่มด้วยการขอสิทธิ์อ่านข้อมูลจริง
  ก่อนจะออกแบบ Exporter ได้อย่างแม่นยำ
- ต้องมีขั้นตอนพิเศษสำหรับ Legacy ID เนื่องจากระบบเดิมมี ID หลายรูปแบบปนกัน (`TicketID`, `IncidentID` ฯลฯ เป็น
  Text ที่ generate เอง ไม่ใช่ UUID) — เก็บ Legacy ID คู่กับ UUID ใหม่ตามที่คำสั่งกำหนดไว้แล้ว
- ไฟล์แนบต้อง handle 2 เส้นทาง (Drive.gs เดิม + Attachment Registry ใหม่) แยกกันตาม R-12

## Phase 8 — Testing และ Security

- ต้องวัด Performance Baseline ของระบบเดิมจริงก่อน (Login/Dashboard/Ticket list/รายงาน) เพื่อใช้เปรียบเทียบ
  ตามที่คำสั่งข้อ 10 กำหนด (ยังไม่มีตัวเลขนี้จาก Phase 0 — ดู R-16)
- ควรออกแบบ Test Case เทียบผลลัพธ์ SLA/Workflow ระหว่างระบบเดิมกับระบบใหม่แบบขนาน (parallel run) ก่อนเชื่อถือ
  ตัวเลขจากระบบใหม่ (R-14)

## Phase 9 — Deploy และ Cutover

- ต้องมีแผนสื่อสารกับผู้ใช้ 27 คนเรื่องการตั้งรหัสผ่านใหม่ (R-04) ล่วงหน้าก่อน Cutover
- Rollback Plan ควรอ้างอิงแนวทางที่ระบบเดิมมีอยู่แล้ว (`docs/18` มี Exact rollback procedure ที่ละเอียดมาก เป็น
  ตัวอย่างที่ดีสำหรับเขียน Rollback Guide ของระบบใหม่)

---

## จุดตัดสินใจ (Decision Gates) ที่ต้องได้คำตอบก่อนเริ่ม Phase ถัดไป

| Gate | ต้องตัดสินใจก่อน Phase | อ้างอิง | สถานะ |
|---|---|---|---|
| ขอบเขตโมดูลกลุ่ม E (GRC/ISMS/PDPA) | Phase 1 (กำหนดขนาด Monorepo/Schema) | R-01, คำถามข้อ 1 | ✅ ตัดสินใจแล้วโดยพฤตินัย — สร้างโมดูลกลุ่ม E ครบแล้วใน Phase 6 ลำดับ 19 |
| Role Mapping 5→9 บทบาท | Phase 3 | R-02, คำถามข้อ 2 | ✅ เสร็จแล้ว — ดู `LEGACY_ROLE_MAP` ใน `packages/migration/src/importPlan.ts` |
| เครื่องมือสร้าง PDF ในระบบใหม่ | Phase 4 | R-13 | ✅ ตัดสินใจแล้ว (2026-08-10): Cloudflare Browser Rendering API |
| ชะตากรรมของ Field Designer/PDF Designer | Phase 6 (ก่อนกำหนดลำดับท้าย) | R-05, คำถามข้อ 3 | ✅ ตัดสินใจแล้ว (2026-08-10): **ตัดออกถาวร ไม่สร้างใหม่** ตามที่ R-05 แนะนำ |
| สิทธิ์เข้าถึง Production Spreadsheet/Drive จริง | Phase 7 | R-10, A-06 | ⬜ ยังรอ — ดู `docs/migration/phase7-migration-runbook.md` § Running the rehearsal |
| ค่า LINE Channel ID/Secret และ Script Properties อื่น | Phase 3 | R-11 | 🔶 ตัดสินใจแล้วว่าจะทำ (2026-08-10) — เจ้าของระบบจะใส่ค่าเองใน `.dev.vars`/`.env` โดยตรง ไม่ผ่าน chat |
