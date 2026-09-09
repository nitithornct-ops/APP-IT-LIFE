-- Keep the existing repair template and its customizations. Add the borrowing master.
insert into public.form_templates (template_code, name, description, category, status, content_html, published_at)
values ('ASSET-BORROW', 'แบบฟอร์มการขอยืมทรัพย์สิน', 'แม่แบบหลักสำหรับรายการยืมทรัพย์สิน เติมข้อมูลผู้ถือครองและทรัพย์สินจากระบบ พร้อมดาวน์โหลด Word', 'ทรัพย์สิน', 'Published',
$html$<h1>แบบฟอร์มการขอยืมทรัพย์สิน</h1>
<p>อ้างอิงทรัพย์สิน: {{document_no}}</p>
<h2>1. ข้อมูลผู้ขอยืม</h2>
<table><tbody><tr><td>ชื่อผู้ขอยืม: {{borrower_name}}</td><td>รหัสพนักงาน: {{employee_code}}</td></tr><tr><td>แผนก: {{department}}</td><td>สถานที่ใช้งาน: {{location}}</td></tr></tbody></table>
<h2>2. รายการทรัพย์สิน</h2>
<table><thead><tr><th>รหัสทรัพย์สิน</th><th>ชื่อทรัพย์สิน</th><th>วันที่ยืม</th><th>กำหนดคืน</th></tr></thead><tbody><tr><td>{{asset_code}}</td><td>{{asset_name}}</td><td>{{loan_date}}</td><td>{{due_date}}</td></tr></tbody></table>
<p>วัตถุประสงค์ในการขอยืม: ................................................................................</p>
<p>อุปกรณ์ประกอบ / สภาพก่อนยืม: ......................................................................</p>
<h2>3. การรับมอบและอนุมัติ</h2>
<p>ข้าพเจ้ารับทราบรายการทรัพย์สินที่ยืม และจะส่งคืนตามกำหนด</p>
<table><tbody><tr><td>ผู้ขอยืม: ................................<br>วันที่: ................................</td><td>ผู้ส่งมอบ: ................................<br>วันที่: ................................</td><td>ผู้อนุมัติ: ................................<br>วันที่: ................................</td></tr></tbody></table>
<h2>4. การคืนทรัพย์สิน</h2>
<p>วันที่คืน: ................................ สภาพเมื่อคืน: ................................</p>
<p>ผู้คืน: ................................ ผู้รับคืน: ................................</p>$html$, now())
on conflict (template_code) do nothing;

insert into public.form_template_versions (template_id, version, name, description, content_html, page_settings, change_note)
select id, current_version, name, description, content_html, page_settings, 'สร้างแม่แบบหลักสำหรับงานยืมทรัพย์สิน'
from public.form_templates where template_code = 'ASSET-BORROW'
on conflict (template_id, version) do nothing;

-- The Ticket form and the asset-borrowing form are wired into application code by template_code,
-- so the codes must keep resolving to a published template no matter what the Form Studio UI allows.
create or replace function public.protect_master_work_form() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.template_code in ('IT-ERP-ISSUE', 'ASSET-BORROW') then
    if TG_OP = 'DELETE' then
      raise exception 'ไม่สามารถลบแม่แบบหลักที่ระบบใช้งานอยู่';
    end if;
    if new.template_code <> old.template_code or new.status = 'Archived' then
      raise exception 'ไม่สามารถเปลี่ยนรหัสหรือเก็บถาวรแม่แบบหลักที่ระบบใช้งานอยู่';
    end if;
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.protect_master_work_form() from public, anon, authenticated;

drop trigger if exists trg_form_templates_protect_master on public.form_templates;
create trigger trg_form_templates_protect_master
  before delete or update on public.form_templates
  for each row execute function public.protect_master_work_form();

comment on function public.protect_master_work_form() is
  'Keeps IT-ERP-ISSUE and ASSET-BORROW resolvable: the Ticket and asset-borrowing forms look them up by template_code.';
