-- ============================================================================
-- เลิกใช้ลายเซ็นกลางของแบบฟอร์ม Ticket — ให้เซ็นเป็นรายใบเท่านั้น
--
-- ของเดิม (20260913100000_default_ticket_form_signature.sql) ให้ตั้งลายเซ็นไว้หนึ่งอัน
-- แล้วทุก Ticket ที่ไม่ได้อัปโหลดของตัวเองจะยืมไปใช้ ผลคือใบที่ยังไม่มีใครเซ็นกลับพิมพ์ออกมา
-- พร้อมลายเซ็น ซึ่งอ่านแล้วเข้าใจผิดได้ว่ามีคนรับรองงานนั้นแล้ว
--
-- ตั้งแต่นี้ tickets.signature_storage_path เป็นแหล่งเดียว ใบที่ยังไม่มีคนเซ็นจะว่างตามจริง
-- และสิทธิ์แนบลายเซ็นย้ายจาก setting.manage ไปเป็น ticket.update เพราะคนเซ็นคือคนปิดงานหน้างาน
-- ============================================================================

-- ไฟล์ลายเซ็นกลางเก็บไว้ใต้ prefix 'default/' ส่วนของราย Ticket อยู่ใต้ 'tickets/<id>/'
-- จึงลบเฉพาะ prefix แรกได้โดยไม่แตะลายเซ็นจริงของใบไหนเลย
delete from storage.objects
where bucket_id = 'ticket-signatures'
  and name like 'default/%';

delete from public.system_settings
where key = 'TICKET_FORM_SIGNATURE_PATH';

comment on column public.tickets.signature_storage_path is
  'Optional private PNG signed for this Ticket only. No system-wide default is inherited.';
