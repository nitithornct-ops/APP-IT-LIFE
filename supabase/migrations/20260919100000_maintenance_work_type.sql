-- ============================================================================
-- ประเภทงานในปฏิทินบำรุงรักษา — design_handoff_it_service_redesign 02-screens.md
-- หัวข้อ "3c ปฏิทิน PM + ตารางเวรช่าง"
--
-- สเปกกำหนดสีชิปในปฏิทินไว้ 4 แบบ: PM #1D4ED8, ลงพื้นที่ #0F766E, Change window #7C3AED
-- และเลยกำหนด #DC2626 แต่ maintenance_plans เดิมมีแค่ status กับ plan_date ทำให้แยกได้เพียง
-- "เลยกำหนด" (คำนวณจาก plan_date) ส่วนอีกสามแบบไม่มีข้อมูลรองรับ ปฏิทินจึงทาสีน้ำเงินหมด
-- ทั้งที่งานลงพื้นที่กับ Change window มีข้อจำกัดเรื่องเวลาและผู้เกี่ยวข้องต่างกันชัดเจน
--
-- เก็บเป็น text + check constraint แบบเดียวกับ status/recurrence ในตารางเดียวกัน ไม่ทำเป็นตาราง
-- อ้างอิงแยก เพราะสามค่านี้เป็นชนิดของงานที่ผูกกับวิธีทำงาน ไม่ใช่ข้อมูลหลักที่ผู้ดูแลจะเพิ่มเองได้
-- (ต่างจากหมวดหมู่งานซึ่งอยู่ใน ticket_categories)
--
-- default 'PM' เพราะแผนที่มีอยู่เดิมทั้งหมดคืองาน PM ตามรอบ — ไม่ใช่การเดา แต่เป็นสิ่งที่ตาราง
-- นี้ถูกสร้างมาเพื่อเก็บตั้งแต่แรก (ดู 20260814100000_assets.sql: recurrence, checklist, template)
-- ============================================================================

alter table public.maintenance_plans
  add column work_type text not null default 'PM'
    check (work_type in ('PM', 'ลงพื้นที่', 'Change window'));

comment on column public.maintenance_plans.work_type is
  'ชนิดงานสำหรับแยกสีในปฏิทิน: PM ตามรอบ / ลงพื้นที่ / Change window';

-- ปฏิทินกรองตามเดือนแล้วค่อยแยกสีตามชนิดงาน index จึงคู่กับ plan_date ไม่ใช่คอลัมน์เดี่ยว
create index maintenance_plans_work_type_plan_date_idx
  on public.maintenance_plans (work_type, plan_date);
