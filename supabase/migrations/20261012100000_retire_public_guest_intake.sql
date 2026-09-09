-- ============================================================================
-- ปลดหน้าแจ้งซ่อมสาธารณะ (no-login) ออกจากระบบ
--
-- เดิมมีสามช่องทางเปิด Ticket: web (login), line (พนักงานที่ผูกบัญชี LINE) และ guest (หน้า /report
-- ที่ใครก็ส่งได้ด้วยการพิมพ์ชื่อเปล่า ๆ — migration 20260831100000) ตอนนี้เจ้าของระบบตัดสินใจให้
-- พนักงานทุกคนมีบัญชีและ login เข้าใช้งานตามสิทธิ์แทน ช่องทาง guest จึงถูกยกเลิก
--
-- Migration นี้ลบเฉพาะ "รายการตั้งค่า" ที่ไม่มีอะไรอ่านแล้ว ไม่แตะโครงสร้างตาราง tickets โดยตั้งใจ:
--
--   * คอลัมน์ guest_name / guest_department / public_tracking_token_hash และ constraint
--     tickets_requester_identity_check ยังอยู่ครบ เพราะ Ticket ที่ guest เคยส่งไว้ต้องอ่านและ
--     แสดงผลได้ต่อ (TicketsPage/TicketDetailPage ยัง fallback ไปที่ guest_name อยู่)
--   * privacyRetentionService ยังใช้ source_channel = 'guest' ล้าง PII ของใบเก่าตามกำหนดเวลา
--     ถ้าลบคอลัมน์ทิ้งตอนนี้ ข้อมูลส่วนบุคคลที่ค้างอยู่จะกลายเป็นข้อมูลกำพร้าที่ไม่มีใครล้างให้
--
-- การเก็บกวาดคอลัมน์เหล่านี้ให้ทำเป็น migration แยกหลังยืนยันว่าไม่มีแถว source_channel = 'guest'
-- เหลือแล้ว และหลังมีไฟล์สำรองที่ restore ได้จริง
-- ============================================================================

delete from public.system_settings where key in (
  'PUBLIC_TICKET_ENABLED',
  'PUBLIC_TICKET_REQUIRE_LINE',
  'PUBLIC_TICKET_MAX_FILES',
  'PUBLIC_TICKET_MAX_FILE_MB',
  'PUBLIC_TICKET_MAX_TOTAL_MB',
  'PUBLIC_TICKET_MAX_PER_HOUR',
  'PUBLIC_TICKET_MAX_PER_DAY',
  'PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR',
  'PUBLIC_TICKET_GLOBAL_MAX_PER_DAY',
  'PUBLIC_TICKET_EMAIL_OTP_ENABLED',
  'PUBLIC_TICKET_ALLOWED_EMAIL_DOMAINS',
  'PUBLIC_TICKET_CONSENT_REQUIRED'
);

comment on column public.tickets.guest_name is
  'ประวัติเท่านั้น: ชื่อที่พิมพ์บนหน้าแจ้งซ่อมสาธารณะซึ่งถูกปลดออกแล้ว (migration 20261012100000) ไม่มีการเขียนค่าใหม่';
comment on column public.tickets.public_tracking_token_hash is
  'ประวัติเท่านั้น: SHA-256 ของรหัสติดตามที่เคยออกให้ผู้แจ้งสาธารณะ ไม่มีการเขียนค่าใหม่';
