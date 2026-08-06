-- ============================================================================
-- Seed ข้อมูลเริ่มต้น — Idempotent (รันซ้ำได้โดยไม่สร้างข้อมูลซ้ำ ใช้ ON CONFLICT DO NOTHING)
-- ไม่มีการ seed บัญชีผู้ใช้ใดๆ ที่นี่ — การสร้าง super_admin คนแรกต้องทำผ่านสคริปต์ bootstrap
-- เฉพาะที่เจ้าของระบบรันเองด้วยอีเมลจริงของตน (จะจัดทำใน Phase 3 คู่กับ Supabase Auth)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Roles (9 บทบาทเริ่มต้นตามสเปก — ตรงกับ packages/shared/src/constants/roles.ts)
-- ---------------------------------------------------------------------------
insert into public.roles (key, name_th, name_en, description, is_system, status) values
  ('super_admin', 'ผู้ดูแลระบบสูงสุด', 'Super Admin', 'สิทธิ์เต็มทุกโมดูล รวมถึงตั้งค่าระบบระดับสูง', true, 'active'),
  ('it_admin', 'ผู้ดูแลระบบไอที', 'IT Admin', 'บริหารจัดการบัญชี บทบาท และโมดูลปฏิบัติการไอทีส่วนใหญ่', true, 'active'),
  ('technician', 'เจ้าหน้าที่ไอที', 'Technician', 'ดำเนินการ Ticket/Asset/Incident ตามที่ได้รับมอบหมาย', true, 'active'),
  ('approver', 'ผู้อนุมัติ', 'Approver', 'พิจารณาอนุมัติคำขอตามสายงาน', true, 'active'),
  ('manager', 'หัวหน้างาน', 'Manager', 'ดูแลทีม/หน่วยงานของตนเอง', true, 'active'),
  ('executive', 'ผู้บริหาร', 'Executive', 'ดูภาพรวมและรายงานระดับบริหาร', true, 'active'),
  ('auditor', 'ผู้ตรวจสอบ', 'Auditor', 'อ่านข้อมูลและ Audit Log ได้ทุกโมดูล แก้ไขไม่ได้', true, 'active'),
  ('dpo', 'เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล', 'DPO', 'กำกับดูแลด้านข้อมูลส่วนบุคคลและ Incident ที่เกี่ยวข้อง', true, 'active'),
  ('user', 'ผู้ใช้งานทั่วไป', 'User', 'พนักงานทั่วไปที่ใช้งานระบบพื้นฐาน', true, 'active')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Permissions (24 permission key เริ่มต้น — ตรงกับ packages/shared/src/constants/permissions.ts)
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module_key, action, description, status) values
  ('dashboard.view', 'dashboard', 'view', 'ดู Dashboard ภาพรวม', 'active'),
  ('ticket.view', 'ticket', 'view', 'ดูรายการ Ticket', 'active'),
  ('ticket.create', 'ticket', 'create', 'เปิด Ticket ใหม่', 'active'),
  ('ticket.update', 'ticket', 'update', 'แก้ไข/อัปเดต Ticket', 'active'),
  ('ticket.assign', 'ticket', 'assign', 'มอบหมายผู้รับผิดชอบ Ticket', 'active'),
  ('ticket.close', 'ticket', 'close', 'ปิดงาน Ticket', 'active'),
  ('asset.view', 'asset', 'view', 'ดูทะเบียนทรัพย์สิน', 'active'),
  ('asset.create', 'asset', 'create', 'เพิ่มทรัพย์สินใหม่', 'active'),
  ('asset.update', 'asset', 'update', 'แก้ไขข้อมูลทรัพย์สิน', 'active'),
  ('asset.transfer', 'asset', 'transfer', 'โอนย้ายทรัพย์สิน', 'active'),
  ('asset.dispose', 'asset', 'dispose', 'ปลดระวางทรัพย์สิน', 'active'),
  ('incident.view', 'incident', 'view', 'ดูรายการ Incident', 'active'),
  ('incident.manage', 'incident', 'manage', 'จัดการ/ปิดเคส Incident', 'active'),
  ('report.export', 'report', 'export', 'Export รายงาน', 'active'),
  ('user.manage', 'user', 'manage', 'จัดการบัญชีผู้ใช้งาน', 'active'),
  ('role.manage', 'role', 'manage', 'จัดการบทบาทและสิทธิ์', 'active'),
  ('role.view', 'role', 'view', 'ดูบทบาทและสิทธิ์ (อ่านอย่างเดียว)', 'active'),
  ('department.manage', 'department', 'manage', 'จัดการข้อมูลหน่วยงาน', 'active'),
  ('position.manage', 'position', 'manage', 'จัดการข้อมูลตำแหน่ง', 'active'),
  ('audit.view', 'audit', 'view', 'ดู Audit Log และ Login Log', 'active'),
  ('ticket_category.manage', 'ticket_category', 'manage', 'จัดการหมวดหมู่ Ticket และค่า SLA ตั้งต้น', 'active'),
  ('asset_category.manage', 'asset_category', 'manage', 'จัดการหมวดหมู่ทรัพย์สิน', 'active'),
  ('approval_group.manage', 'approval_group', 'manage', 'จัดการกลุ่มอนุมัติและสมาชิกกลุ่ม', 'active'),
  ('employee.manage', 'employee', 'manage', 'จัดการทะเบียนพนักงาน', 'active')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Role ↔ Permission เริ่มต้น (ปรับได้ภายหลังผ่านหน้า Permission Matrix — นี่เป็นแค่ค่าตั้งต้น)
-- super_admin และ it_admin ได้สิทธิ์เต็มเหมือนกันในช่วงเริ่มต้นระบบ เพื่อให้ทีมไอทีใช้งานได้ทันที
-- แนะนำให้ผู้ดูแลปรับลดสิทธิ์ it_admin ให้เหมาะสมกับองค์กรจริงหลัง Go-live
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
cross join public.permissions p
where r.key in ('super_admin', 'it_admin')
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from (values
  ('technician', 'dashboard.view'),
  ('technician', 'ticket.view'),
  ('technician', 'ticket.update'),
  ('technician', 'ticket.assign'),
  ('technician', 'asset.view'),
  ('technician', 'incident.view'),

  ('approver', 'dashboard.view'),
  ('approver', 'ticket.view'),
  ('approver', 'incident.view'),
  ('approver', 'report.export'),

  ('manager', 'dashboard.view'),
  ('manager', 'ticket.view'),
  ('manager', 'asset.view'),
  ('manager', 'incident.view'),
  ('manager', 'report.export'),

  ('executive', 'dashboard.view'),
  ('executive', 'ticket.view'),
  ('executive', 'asset.view'),
  ('executive', 'incident.view'),
  ('executive', 'report.export'),
  ('executive', 'audit.view'),

  ('auditor', 'dashboard.view'),
  ('auditor', 'ticket.view'),
  ('auditor', 'asset.view'),
  ('auditor', 'incident.view'),
  ('auditor', 'report.export'),
  ('auditor', 'role.view'),
  ('auditor', 'audit.view'),

  ('dpo', 'dashboard.view'),
  ('dpo', 'incident.view'),
  ('dpo', 'report.export'),
  ('dpo', 'audit.view'),

  ('user', 'dashboard.view'),
  ('user', 'ticket.view'),
  ('user', 'ticket.create')
) as mapping(role_key, permission_key)
join public.roles r on r.key = mapping.role_key
join public.permissions p on p.key = mapping.permission_key
on conflict (role_id, permission_id) do nothing;
