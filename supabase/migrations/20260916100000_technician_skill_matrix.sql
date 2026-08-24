-- ============================================================================
-- Technician Skill Matrix — ระดับทักษะของเจ้าหน้าที่ต่อหมวดหมู่งาน Help Desk
--
-- design_handoff_it_service_redesign/02-screens.md หัวข้อ "3h โปรไฟล์ช่าง + Skill matrix" ต้องการ
-- ตารางทักษะที่มีค่า 1/2/3 ต่อหมวดหมู่ แต่ schema เดิมไม่มีที่เก็บข้อมูลนี้เลย — ทั้ง profiles และ
-- employees มีแค่แผนก/ตำแหน่ง ซึ่งบอกไม่ได้ว่าใครทำงานหมวดไหนได้ระดับใด การ hard-code คะแนนให้
-- หน้าจอดูเต็มจะทำให้หัวหน้างานมอบหมายงานจากตัวเลขที่ไม่มีใครประเมินจริง จึงเพิ่มตารางนี้แทน
--
-- ผูกกับ ticket_categories ไม่ใช่รายการทักษะอิสระ เพราะการมอบหมายงานจริงตัดสินจากหมวดหมู่ของ
-- Ticket อยู่แล้ว (tickets.category_id) ทักษะที่วัดแล้วใช้ตัดสินใจไม่ได้ก็ไม่ต่างจากไม่มีข้อมูล
--
-- ผูกกับ profiles ไม่ใช่ employees เพราะผู้รับผิดชอบ Ticket คือบัญชีผู้ใช้ (tickets.assignee_id ->
-- profiles) ส่วน employees เป็นทะเบียนพนักงานที่บางคนไม่มีบัญชี login และรับงานไม่ได้
--
-- "ยังไม่ประเมิน" แทนด้วยการไม่มีแถว ไม่ใช่ระดับ 0 — ช่องว่างในตารางจึงหมายถึงยังไม่มีใครประเมิน
-- ซึ่งเป็นคนละเรื่องกับ "ประเมินแล้วว่าทำไม่ได้" และหน้าจอต้องแยกสองอย่างนี้ออกจากกันให้ชัด
-- ============================================================================

insert into public.permissions (key, module_key, action, description, status)
values
  ('technician_skill.view', 'technician_skill', 'view', 'ดูตารางทักษะเจ้าหน้าที่และความครอบคลุมรายหมวดหมู่', 'active'),
  ('technician_skill.manage', 'technician_skill', 'manage', 'ประเมินและแก้ไขระดับทักษะของเจ้าหน้าที่', 'active')
on conflict (key) do nothing;

-- สายที่มอบหมายงานจริงต้องเห็นตารางนี้ ส่วนการประเมินจำกัดไว้ที่ผู้ดูแลระบบไอที
insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
join public.permissions p on p.key = 'technician_skill.view'
  and r.key in ('super_admin', 'it_admin', 'technician', 'manager', 'executive')
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
join public.permissions p on p.key = 'technician_skill.manage'
  and r.key in ('super_admin', 'it_admin')
on conflict (role_id, permission_id) do nothing;

create table public.technician_skills (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.ticket_categories(id) on delete cascade,
  -- 1 = ช่วยงานภายใต้การกำกับ, 2 = ทำงานได้ด้วยตนเอง, 3 = เชี่ยวชาญ/สอนงานได้
  -- ใช้สามระดับเท่าที่ mockup กำหนดไว้ ไม่ขยายเป็นสเกลละเอียดกว่านี้จนกว่าจะมีเกณฑ์ประเมินจริง
  level smallint not null check (level between 1 and 3),
  note text,
  assessed_at timestamptz not null default now(),
  assessed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint technician_skills_technician_category_unique unique (technician_id, category_id)
);

create index technician_skills_technician_id_idx on public.technician_skills (technician_id);
create index technician_skills_category_id_idx on public.technician_skills (category_id);
create index technician_skills_level_idx on public.technician_skills (level);

create trigger trg_technician_skills_set_updated_at
  before update on public.technician_skills
  for each row execute function public.set_updated_at();

alter table public.technician_skills enable row level security;

-- เจ้าตัวเห็นผลประเมินของตนเองได้เสมอ (หน้าโปรไฟล์) ส่วนการเห็นของคนอื่นต้องมีสิทธิ์
-- ระดับทักษะเป็นข้อมูลประเมินบุคคล ไม่ใช่ข้อมูลทั่วไปที่ทุกคนที่ login แล้วควรอ่านได้
create policy technician_skills_select_self_or_permission on public.technician_skills
  for select to authenticated
  using (technician_id = auth.uid() or public.has_permission('technician_skill.view'));

-- ไม่มี policy ให้เจ้าตัวแก้ระดับของตนเอง — ผลประเมินที่ผู้ถูกประเมินแก้เองได้ใช้ตัดสินใจไม่ได้
create policy technician_skills_write_with_permission on public.technician_skills
  for all to authenticated
  using (public.has_permission('technician_skill.manage'))
  with check (public.has_permission('technician_skill.manage'));

comment on table public.technician_skills is
  'ระดับทักษะของเจ้าหน้าที่ต่อหมวดหมู่ Ticket — ไม่มีแถว = ยังไม่ประเมิน (ไม่ใช่ระดับ 0)';
