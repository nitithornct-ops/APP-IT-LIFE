-- ============================================================================
-- Asset Custody Register — ทะเบียนคุมทรัพย์สินรายพนักงาน
--
-- Assets & Operations ตอบว่า "ของชิ้นนี้อยู่ในสภาพไหน" แต่งานตรวจนับต้องการอีกคำถามหนึ่ง
-- คือ "ใครถืออะไรอยู่" ซึ่งอยู่ที่ employee_assignments ไม่ใช่ที่ assets เพราะของที่พนักงาน
-- ถือครองมีทั้งที่ขึ้นทะเบียนกลางและรายการอิสระอย่าง License ซอฟต์แวร์
--
-- ต้องลง definition ไว้ก่อนใช้งาน เพราะ report_exports.report_key มี FK มาที่ตารางนี้ —
-- ถ้าขาดแถวนี้ หน้าจอจะแสดงรายงานได้ตามปกติแต่การกดส่งออกจะล้มที่ FK ทุกครั้ง
--
-- สิทธิ์: employee.manage หรือ asset.view ให้ตรงกับ RLS ของ employee_assignments เอง
-- (ช่างที่ดูแล asset ต้องเห็นว่าใครถืออุปกรณ์ชิ้นไหนอยู่เช่นกัน)
-- ============================================================================

insert into public.report_definitions
  (key, label, description, required_permissions, default_columns, status, sort_order)
values
  (
    'asset-custody',
    'ทะเบียนคุมทรัพย์สินรายพนักงาน',
    'พนักงานแต่ละคนถือครองอุปกรณ์และสิทธิ์ใช้งานอะไรอยู่บ้าง สำหรับตรวจนับและใช้เป็นใบทะเบียนคุม',
    array['employee.manage', 'asset.view'],
    '["employeeCode","owner","department","category","title","code","serialNumber","status","assignedDate","returnedDate"]',
    'active',
    35
  )
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  required_permissions = excluded.required_permissions,
  default_columns = excluded.default_columns,
  status = excluded.status,
  sort_order = excluded.sort_order;
