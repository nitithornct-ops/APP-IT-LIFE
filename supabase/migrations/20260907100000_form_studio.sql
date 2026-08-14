-- Form Studio: versioned form templates, issue forms, and secure Vendor replies.

insert into public.permissions (key, module_key, action, description, status)
values
  ('form.view', 'form', 'view', 'ดูคลังแบบฟอร์มและรายการแบบฟอร์มงาน', 'active'),
  ('form.manage', 'form', 'manage', 'สร้าง แก้ไข และเผยแพร่แบบฟอร์ม', 'active'),
  ('form.vendor_send', 'form', 'vendor_send', 'ส่งแบบฟอร์มให้ Vendor ประเมินและตอบกลับ', 'active'),
  ('form.close', 'form', 'close', 'ตรวจรับและปิดแบบฟอร์มงาน', 'active')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
join public.permissions p on p.key in ('form.view', 'form.manage', 'form.vendor_send', 'form.close')
  and r.key in ('super_admin', 'it_admin', 'technician')
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
join public.permissions p on p.key = 'form.view'
  and r.key in ('manager', 'executive', 'auditor', 'approver')
on conflict (role_id, permission_id) do nothing;

create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  template_code text not null unique,
  name text not null,
  description text,
  category text not null default 'IT Support',
  status text not null default 'Draft' check (status in ('Draft', 'Published', 'Archived')),
  current_version integer not null default 1 check (current_version > 0),
  content_html text not null,
  page_settings jsonb not null default '{"size":"A4","orientation":"portrait","marginMm":20}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_form_templates_set_updated_at
  before update on public.form_templates
  for each row execute function public.set_updated_at();

create table public.form_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.form_templates(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null,
  description text,
  content_html text not null,
  page_settings jsonb not null default '{}'::jsonb,
  change_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create sequence public.issue_form_no_seq;

create table public.issue_forms (
  id uuid primary key default gen_random_uuid(),
  form_no text not null unique default (
    'FRM-' || to_char(current_date, 'YYYYMM') || '-' || lpad(nextval('public.issue_form_no_seq')::text, 5, '0')
  ),
  title text not null,
  template_id uuid references public.form_templates(id) on delete set null,
  template_version integer not null default 1,
  ticket_id uuid references public.tickets(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  status text not null default 'Draft' check (
    status in ('Draft', 'Internal Review', 'Sent to Vendor', 'Vendor Replied', 'Approved', 'Closed', 'Cancelled')
  ),
  content_html text not null,
  form_data jsonb not null default '{}'::jsonb,
  vendor_response jsonb not null default '{}'::jsonb,
  vendor_access_token_hash text,
  vendor_access_expires_at timestamptz,
  vendor_sent_at timestamptz,
  vendor_due_at date,
  vendor_responded_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issue_forms_status_idx on public.issue_forms (status, updated_at desc);
create index issue_forms_ticket_id_idx on public.issue_forms (ticket_id);
create index issue_forms_vendor_id_idx on public.issue_forms (vendor_id);
create unique index issue_forms_vendor_token_hash_uidx
  on public.issue_forms (vendor_access_token_hash)
  where vendor_access_token_hash is not null;

create trigger trg_issue_forms_set_updated_at
  before update on public.issue_forms
  for each row execute function public.set_updated_at();

create table public.issue_form_activities (
  id uuid primary key default gen_random_uuid(),
  issue_form_id uuid not null references public.issue_forms(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'internal' check (actor_type in ('internal', 'vendor', 'system')),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index issue_form_activities_form_idx
  on public.issue_form_activities (issue_form_id, created_at);

alter table public.form_templates enable row level security;
alter table public.form_template_versions enable row level security;
alter table public.issue_forms enable row level security;
alter table public.issue_form_activities enable row level security;

create policy form_templates_select on public.form_templates
  for select to authenticated using (public.has_permission('form.view'));
create policy form_templates_insert on public.form_templates
  for insert to authenticated with check (public.has_permission('form.manage'));
create policy form_templates_update on public.form_templates
  for update to authenticated using (public.has_permission('form.manage'))
  with check (public.has_permission('form.manage'));

create policy form_template_versions_select on public.form_template_versions
  for select to authenticated using (public.has_permission('form.view'));
create policy form_template_versions_insert on public.form_template_versions
  for insert to authenticated with check (public.has_permission('form.manage'));

create policy issue_forms_select on public.issue_forms
  for select to authenticated using (public.has_permission('form.view'));
create policy issue_forms_insert on public.issue_forms
  for insert to authenticated with check (public.has_permission('form.manage'));
create policy issue_forms_update on public.issue_forms
  for update to authenticated using (public.has_permission('form.manage'))
  with check (public.has_permission('form.manage'));

create policy issue_form_activities_select on public.issue_form_activities
  for select to authenticated using (public.has_permission('form.view'));
create policy issue_form_activities_insert on public.issue_form_activities
  for insert to authenticated with check (public.has_permission('form.manage'));

with inserted as (
  insert into public.form_templates (
    template_code, name, description, category, status, current_version, content_html, published_at
  ) values (
    'IT-ERP-ISSUE',
    'แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP',
    'ต้นแบบจาก Unified_IT_ERP_Issue_Form.docx ครบ 5 ส่วน พร้อมขั้นตอนส่งต่อ Vendor และประเมิน Manday/Credit',
    'IT Support / ERP',
    'Published',
    1,
    $form$
<h1 style="text-align:center">แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP</h1>
<p><strong>เลขที่ Ticket No:</strong> {{ticket_no}}</p>
<h2>ส่วนที่ 1: ข้อมูลผู้แจ้ง และรายละเอียดปัญหา</h2>
<table><tbody>
<tr><td><strong>ชื่อ-นามสกุล</strong><br>{{requester_name}}</td><td><strong>ตำแหน่ง</strong><br>{{position}}</td></tr>
<tr><td><strong>ส่วนงาน</strong><br>{{department}}</td><td><strong>เบอร์โทรศัพท์</strong><br>{{phone}}</td></tr>
<tr><td><strong>วันที่พบปัญหา</strong><br>{{incident_date}}</td><td><strong>เวลา</strong><br>{{incident_time}}</td></tr>
</tbody></table>
<h3>ประเภทงานที่ขอรับบริการ</h3>
<p>☐ คอมพิวเตอร์/โน้ตบุ๊ก &nbsp; ☐ เครื่องพิมพ์/สแกนเนอร์ &nbsp; ☐ เครือข่าย Internet/Wi-Fi<br>
☐ อีเมล/รหัสผ่าน &nbsp; ☐ ซอฟต์แวร์ทั่วไป &nbsp; ☐ ระบบ ERP / Module {{erp_module}} &nbsp; ☐ อื่น ๆ</p>
<p><strong>ระดับความรุนแรง:</strong> ☐ รุนแรงมาก &nbsp; ☐ ปานกลาง &nbsp; ☐ น้อย</p>
<p><strong>รายละเอียดปัญหา / Error</strong><br>{{issue_detail}}</p>
<p>☐ มีไฟล์ภาพประกอบ (Screenshot)</p>

<h2>ส่วนที่ 2: การประเมินและดำเนินการโดยงานเทคโนโลยีสารสนเทศ</h2>
<p><strong>วัน/เวลารับเรื่อง:</strong> {{received_at}} &nbsp; <strong>ผู้รับเรื่อง:</strong> {{receiver_name}}</p>
<p><strong>Priority:</strong> ☐ High &nbsp; ☐ Medium &nbsp; ☐ Low</p>
<p><strong>การดำเนินการ:</strong><br>☐ แก้ไขโดย IT ภายใน &nbsp; ☐ ส่งต่อผู้เชี่ยวชาญภายนอก/Vendor</p>
<p><strong>เหตุผลที่ส่งต่อ:</strong> ☐ Source Code/Bug &nbsp; ☐ Hardware/Claim &nbsp; ☐ อื่น ๆ {{escalation_reason}}</p>
<p><strong>Vendor Ticket No:</strong> {{vendor_ticket_no}}</p>

<h2>ส่วนที่ 3: การแก้ไขปัญหาโดยผู้รับจ้าง (Vendor / Outsource)</h2>
<p><strong>SLA Category:</strong> ☐ Emergency Case &nbsp; ☐ Minor Case &nbsp; ☐ อื่น ๆ</p>
<table><thead><tr><th>ขั้นตอนการให้บริการ</th><th>Emergency Case</th><th>Minor Case</th><th>เวลาดำเนินการจริง</th></tr></thead><tbody>
<tr><td>รับแจ้งเรื่อง</td><td>ภายใน 1 ชั่วโมง</td><td>ภายใน 1 ชั่วโมง</td><td>{{vendor_received_time}}</td></tr>
<tr><td>แก้ไขเบื้องต้น / Workaround</td><td>ภายใน 4 ชั่วโมง</td><td>ภายใน 1-5 วัน</td><td>{{vendor_workaround_time}}</td></tr>
<tr><td>สรุปและวิเคราะห์สาเหตุ</td><td>ภายใน 24 ชั่วโมง</td><td>ภายใน 2-10 วัน</td><td>{{vendor_analysis_time}}</td></tr>
<tr><td>แก้ไขปัญหาถาวรสำเร็จ</td><td>ภายใน 4 วัน</td><td>ภายใน 5-15 วัน</td><td>{{vendor_resolution_time}}</td></tr>
</tbody></table>
<p><strong>Root Cause Analysis</strong><br>{{root_cause}}</p>
<p><strong>วิธีแก้ไข / ป้องกันไม่ให้เกิดซ้ำ</strong><br>{{resolution_and_prevention}}</p>
<p style="text-align:right">ลงชื่อ {{vendor_assessor_name}} ผู้รับจ้าง/Vendor &nbsp; วันที่ {{vendor_signed_date}}</p>

<h2>ส่วนที่ 4: การประเมิน Manday / Credit</h2>
<p>☐ ไม่ใช้ Credit (Bug/เงื่อนไขรับประกัน) &nbsp; ☐ ใช้ Credit / Manday</p>
<p><strong>ประเภท:</strong> ☐ ปรับ (Adjust) &nbsp; ☐ แก้ไข (Edit) &nbsp; ☐ เพิ่มเติม (Add) &nbsp; ☐ ลบ (Delete)</p>
<table><tbody>
<tr><td>คงเหลือเริ่มต้น</td><td>{{credit_balance_before}}</td></tr>
<tr><td>ใช้ครั้งนี้</td><td>{{manday_used}}</td></tr>
<tr><td>คงเหลือสุทธิ</td><td>{{credit_balance_after}}</td></tr>
</tbody></table>
<p><strong>หมายเหตุการประเมิน</strong><br>{{credit_note}}</p>

<h2>ส่วนที่ 5: ผลการดำเนินงานและการปิดงาน</h2>
<p><strong>วันที่แล้วเสร็จจริง:</strong> {{completed_at}}</p>
<p><strong>สถานะ:</strong> ☐ แก้ไขสมบูรณ์ &nbsp; ☐ แก้ไขชั่วคราว &nbsp; ☐ ไม่สามารถแก้ไขได้</p>
<p><strong>รายละเอียดผลการซ่อม/ทดสอบ</strong><br>{{test_result}}</p>
<p>☐ ผู้แจ้งทดสอบและยืนยันว่าปัญหาได้รับการแก้ไขเรียบร้อยแล้ว</p>
<table><tbody><tr><td>ผู้แจ้ง<br><br>ลงชื่อ {{requester_signature}}<br>วันที่ {{requester_sign_date}}</td><td>เจ้าหน้าที่ IT<br><br>ลงชื่อ {{it_signature}}<br>วันที่ {{it_sign_date}}</td></tr></tbody></table>
    $form$,
    now()
  )
  on conflict (template_code) do update set
    name = excluded.name,
    description = excluded.description,
    status = excluded.status
  returning id, name, description, content_html, page_settings
)
insert into public.form_template_versions (
  template_id, version, name, description, content_html, page_settings, change_note
)
select id, 1, name, description, content_html, page_settings, 'นำเข้าจากแบบฟอร์ม Word ต้นฉบับ'
from inserted
on conflict (template_id, version) do nothing;
