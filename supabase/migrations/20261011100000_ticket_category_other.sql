-- ============================================================================
-- Master Data: หมวดหมู่ Ticket "อื่น ๆ"
-- หน้าแจ้งซ่อมทั้งของ LINE และของสาธารณะบังคับให้เลือกหมวดหมู่ก่อนจึงจะส่ง Ticket ได้
-- ผู้แจ้งที่ไม่รู้ว่าอาการของตนอยู่หมวดใดจึงติดอยู่ตรงนั้นและแจ้งงานไม่ได้เลย แถวนี้เปิดทางให้
-- แจ้งเข้ามาก่อน แล้วทีม IT ค่อยย้ายหมวดหมู่ทีหลังจากรายละเอียดที่ผู้แจ้งกรอกมา
--
-- ไม่มี legacy_id เพราะหมวดหมู่นี้ไม่มีต้นทางในระบบ GAS เดิม (ต่างจาก TCAT-001..007 ใน seed.sql)
-- และอยู่ใน migration ไม่ใช่ seed.sql เพราะ deploy production รันเฉพาะ migration
-- (`supabase db push`) ส่วน seed.sql รันเฉพาะตอนตั้งโปรเจกต์ใหม่
-- ============================================================================

insert into public.ticket_categories
  (name, default_priority, response_sla_hours, resolution_sla_hours,
   sla_hours, is_security_default, notes, sort_order, status)
values
  ('อื่น ๆ', 'ปานกลาง', 4, 24, 24, false, 'Other — ทีม IT จัดหมวดหมู่ใหม่หลังอ่านรายละเอียด', 80, 'active')
on conflict (name) do update
set default_priority = excluded.default_priority,
    response_sla_hours = excluded.response_sla_hours,
    resolution_sla_hours = excluded.resolution_sla_hours,
    sla_hours = excluded.sla_hours,
    is_security_default = excluded.is_security_default,
    notes = excluded.notes,
    sort_order = excluded.sort_order,
    status = excluded.status;
