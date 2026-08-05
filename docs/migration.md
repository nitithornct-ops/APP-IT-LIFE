# Migration — จาก ISMS Governance System (Google Apps Script) สู่ LIFE IT Smart Service Center

หน้านี้เป็นดัชนีของเอกสารการย้ายระบบทั้งหมด รายละเอียดฉบับเต็มอยู่ที่ [`migration/`](migration/)

## Phase 0 — วิเคราะห์ระบบเดิม (เสร็จสิ้น)

| เอกสาร | เนื้อหา |
|---|---|
| [`migration/phase0-summary.md`](migration/phase0-summary.md) | สรุปผู้บริหาร + สิ่งที่ค้นพบสำคัญที่สุด |
| [`migration/phase0-system_inventory.md`](migration/phase0-system_inventory.md) | ไฟล์, Sheet, Trigger, Entry point, บริการภายนอกทั้งหมดของระบบเดิม |
| [`migration/phase0-module_matrix.md`](migration/phase0-module_matrix.md) | โมดูลทั้ง 43 รายการ จับคู่ไฟล์/Sheet/สิทธิ์ |
| [`migration/phase0-data_dictionary_reference.md`](migration/phase0-data_dictionary_reference.md) | Data Dictionary เดิม (93 ทะเบียน) + ข้อสังเกตเชิงโครงสร้างสำหรับออกแบบ PostgreSQL |
| [`migration/phase0-migration_matrix.md`](migration/phase0-migration_matrix.md) | ตารางเปรียบเทียบโมดูลเดิม ↔ API/ตาราง PostgreSQL ใหม่ |
| [`migration/phase0-risk_register.md`](migration/phase0-risk_register.md) | ความเสี่ยง 16 รายการ + สมมติฐาน 8 ข้อ |
| [`migration/phase0-migration_roadmap.md`](migration/phase0-migration_roadmap.md) | แผน Phase 0–9 ที่ปรับตามข้อเท็จจริงที่พบ |

**ขอบเขตที่ยืนยันแล้ว:** ผู้ใช้อนุมัติให้เริ่ม Phase 1 ตามสมมติฐานที่ตั้งไว้ใน Risk Register (รวมทุก 43 โมดูล,
รอ mapping บทบาทแบบละเอียดใน Phase 3, เลื่อน Field/PDF Designer)

## Phase 1 — สร้างโครงสร้างโครงการ (กำลังดำเนินการ)

สร้าง Monorepo, ตั้งค่า Frontend/Workers/Shared Package, Environment, Lint/TypeScript/Test, README, หน้า Health
Check — ดูรายละเอียดที่ [`architecture.md`](architecture.md)

## Phase 2–9

ยังไม่เริ่ม — จะเพิ่มเอกสารในหมวดนี้เมื่อแต่ละ Phase เสร็จสิ้น ตามลำดับที่กำหนดไว้ใน
[`migration/phase0-migration_roadmap.md`](migration/phase0-migration_roadmap.md)
