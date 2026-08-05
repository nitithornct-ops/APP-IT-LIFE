# Phase 0 — สรุปผลการวิเคราะห์ระบบเดิม

**โครงการ:** ย้ายระบบจาก Google Apps Script → Web Application (React + Cloudflare + Supabase)
**ระบบเดิม:** ISMS Governance System (กองทุนประกันชีวิต) — v1.11.0, Production ตั้งแต่ 21 กรกฎาคม 2569
**วันที่วิเคราะห์:** 2026-08-05 · **สถานะ:** เสร็จสิ้น Phase 0 — ไม่มีการแก้ไข Source Code เดิม

## เอกสารในชุดนี้

1. [`phase0-system_inventory.md`](phase0-system_inventory.md) — ไฟล์, Sheet, Trigger, Entry point, บริการภายนอกทั้งหมด
2. [`phase0-module_matrix.md`](phase0-module_matrix.md) — โมดูลทั้ง 43 รายการ จับคู่ไฟล์/Sheet/สิทธิ์
3. [`phase0-data_dictionary_reference.md`](phase0-data_dictionary_reference.md) — Data Dictionary เดิม (93 ทะเบียน) + ข้อสังเกตเชิงโครงสร้าง
4. [`phase0-migration_matrix.md`](phase0-migration_matrix.md) — ตารางเปรียบเทียบโมดูลเดิม ↔ API/ตาราง PostgreSQL ใหม่
5. [`phase0-risk_register.md`](phase0-risk_register.md) — ความเสี่ยง 16 รายการ + สมมติฐาน 8 ข้อ + คำถามที่ต้องยืนยัน 3 ข้อ
6. [`phase0-migration_roadmap.md`](phase0-migration_roadmap.md) — แผน Phase 0–9 ที่ปรับตามข้อเท็จจริงที่พบ

## สิ่งที่ค้นพบสำคัญที่สุด (ต้องอ่านก่อนเริ่ม Phase 1)

1. **ระบบเดิมกว้างกว่ารายการโมดูลเป้าหมายในคำสั่งเริ่มต้นมาก** — พบ 43 โมดูลจริง เทียบกับ ~26 โมดูลในรายการเป้าหมาย
   ส่วนต่าง 12 โมดูลเป็นกลุ่ม GRC/ISMS/PDPA (Data Classification, Legal Compliance, Privacy/PDPA, Risk Register,
   AI/Cloud Register, Awareness Training, Audit Evidence/Management, Governance Documents) ซึ่งเป็นแก่นของระบบเดิม
   ตามกฎ "ห้ามตัดฟังก์ชันเดิม" จึงนับรวมไว้ในขอบเขตเป็นค่าเริ่มต้น — **ต้องการคำยืนยันจากท่านว่าต้องการย้ายทั้งหมด
   หรือจะจำกัดขอบเขตเฉพาะกลุ่ม ITSM ก่อน**
2. **ฐานข้อมูลเดิมมี 93 ทะเบียน (Sheet)** ไม่ใช่ 71 ตามที่เอกสารเดิม `docs/02` บันทึกไว้ — พบและแก้ไขความเข้าใจนี้แล้ว
   ในเอกสารชุดนี้ (`phase0-data_dictionary_reference.md`) Phase 2 ต้องใช้ `Config.gs > DB_SCHEMA` เป็นหลัก
3. **RBAC เดิมมีแค่ 5 บทบาทตายตัว และ 1 ผู้ใช้ = 1 บทบาทเท่านั้น** ต่างจาก Configurable RBAC 9 บทบาทที่คำสั่งต้องการ
   — ต้องออกแบบ Role Mapping ให้ชัดก่อน Phase 3
4. **รหัสผ่านเดิม migrate เข้า Supabase Auth ไม่ได้โดยตรง** — ต้องใช้กระบวนการเชิญตั้งรหัสผ่านใหม่ (ตรงกับสเปกที่
   กำหนดไว้แล้วพอดี คือปิด Public Sign-up + Admin เป็นผู้เชิญ)
5. **LINE เป็นช่องทางแจ้งเตือนหลักของระบบ ไม่ใช่อีเมล** — ต้องคงไว้ในระบบใหม่ และต้องขอค่า LINE Channel
   ID/Secret จากเจ้าของระบบก่อนเริ่ม Phase 3 (เป็นค่าที่ไม่อยู่ใน Source Code โดยตั้งใจ)
6. **ระบบเดิมมี Production Rollout ล่าสุดเมื่อ 21 กรกฎาคม 2569 แต่ยังมี UAT/Rollback Drill ค้างอยู่** ตามหลักฐาน
   ใน `docs/18` — บ่งชี้ว่าโมดูล Workflow/Attachment/Integration (v1.11) อาจยังมี edge case ที่ยังไม่ถูกพบ ต้อง
   ตรวจ Source Code อย่างละเอียดตอนย้าย ไม่ใช่เชื่อเอกสารอย่างเดียว
7. **คุณภาพเอกสารเดิมสูงมาก** (README, CHANGELOG, docs/01–18 ครบและอัปเดตต่อเนื่อง) ทำให้ Phase 0 นี้ทำได้รวดเร็ว
   และแม่นยำกว่าระบบ GAS ทั่วไป

## สิ่งที่ยังไม่ได้ทำใน Phase 0 นี้ (ตั้งใจ — อยู่นอกขอบเขตของ Phase 0)

- ไม่ได้เชื่อมต่อหรืออ่านข้อมูลจริงใน Production Google Sheets/Drive (ไม่มีสิทธิ์เข้าถึง และ Phase 0 ห้ามแตะระบบเดิม)
- ไม่ได้อ่าน `Module_OperationsHardening.gs`, `Module_Workflow.gs`, `Module_Integration.gs`,
  `Module_AttachmentRegistry.gs`, `Module_ServiceCatalog.gs` แบบ line-by-line ทั้งไฟล์ (ไฟล์ใหญ่ 70–150 KB) —
  ตรวจโครงสร้าง/Schema/Trigger/Permission ครบแล้ว แต่ business logic ละเอียดจะอ่านเจาะใน Phase ที่เกี่ยวข้องโดยตรง
  (Phase 4 สำหรับ SLA, Phase 6 ลำดับ 17/19 สำหรับ Workflow)
- ไม่ได้วัด Performance Baseline ของระบบเดิมจริง (เสนอทำใน Phase 8 ตาม R-16)

## คำถามที่รอคำตอบก่อนเริ่ม Phase 1

ดูรายละเอียดเต็มใน [`phase0-risk_register.md`](phase0-risk_register.md) หัวข้อสุดท้าย — สรุปสั้น:

1. ยืนยันขอบเขต: ย้ายโมดูลกลุ่ม GRC/ISMS/PDPA (12 โมดูล) ไปด้วยหรือไม่
2. ยืนยันการ Mapping บทบาทเดิม 5 บทบาท → บทบาทใหม่ 9 บทบาท
3. Field Designer / PDF Designer: ย้าย 1:1, ตัดออก, หรือเลื่อนไปทำหลัง Go-live

---

**Phase 0 เสร็จสิ้น — รอคำสั่งเริ่ม Phase 1 ตามกฎข้อ 20 ("หลังจบแต่ละ Phase ให้หยุดรอคำสั่งก่อนเริ่ม Phase ถัดไป")**
