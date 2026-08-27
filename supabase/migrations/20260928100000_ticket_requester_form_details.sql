-- เก็บ snapshot และข้อมูลเฉพาะจาก "ส่วนที่ 1" ของแบบฟอร์มแจ้งปัญหา
-- เพื่อให้เอกสารย้อนหลังไม่เปลี่ยนตามตำแหน่งของพนักงานในอนาคต
alter table public.tickets
  add column requester_position_snapshot text,
  add column incident_at timestamptz,
  add column erp_module text,
  add column requester_signature_storage_path text,
  add column requester_signature_uploaded_by uuid references public.profiles(id),
  add column requester_signature_uploaded_at timestamptz;

comment on column public.tickets.requester_position_snapshot is
  'ชื่อตำแหน่งของผู้แจ้ง ณ เวลาที่เปิด Ticket สำหรับแสดงในแบบฟอร์มส่วนที่ 1';

comment on column public.tickets.incident_at is
  'วันที่และเวลาที่ผู้แจ้งพบปัญหา ตามแบบฟอร์มส่วนที่ 1';

comment on column public.tickets.erp_module is
  'ชื่อ ERP Module ที่ผู้แจ้งระบุในแบบฟอร์มส่วนที่ 1 (ถ้ามี)';

comment on column public.tickets.requester_signature_storage_path is
  'ไฟล์ลายเซ็นตรวจรับของผู้แจ้งในส่วนที่ 5 แยกจากลายเซ็นเจ้าหน้าที่ IT';

comment on column public.tickets.requester_signature_uploaded_at is
  'วันเวลาที่ผู้แจ้งลงลายเซ็นตรวจรับและยืนยันปิดงาน';
