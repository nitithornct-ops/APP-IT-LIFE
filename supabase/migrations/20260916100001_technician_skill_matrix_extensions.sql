-- ============================================================================
-- Technician Skill Matrix P1 extensions
--
-- Keep the original technician/category relationship so existing assessments
-- remain readable, while adding the fields needed for assignment guidance.
-- Current workload is intentionally derived from live tickets in the API; it
-- must not be copied into this table because it would become stale.
-- ============================================================================

alter table public.technician_skills
  add column if not exists skill text,
  add column if not exists certification text,
  add column if not exists certification_expiry date,
  add column if not exists product_technology text,
  add column if not exists location text,
  add column if not exists availability text not null default 'available';

alter table public.technician_skills
  drop constraint if exists technician_skills_level_check;

alter table public.technician_skills
  add constraint technician_skills_level_check check (level between 1 and 5);

alter table public.technician_skills
  add constraint technician_skills_availability_check
  check (availability in ('available', 'limited', 'unavailable'));

-- Give legacy rows a useful Skill label without inventing a proficiency.
update public.technician_skills skills
set skill = categories.name
from public.ticket_categories categories
where categories.id = skills.category_id
  and nullif(trim(skills.skill), '') is null;

create index if not exists technician_skills_product_technology_idx
  on public.technician_skills (product_technology);
create index if not exists technician_skills_availability_idx
  on public.technician_skills (availability);

comment on column public.technician_skills.skill is
  'ชื่อทักษะที่ประเมิน; ถ้าเป็นข้อมูลเดิมจะเติมจากชื่อหมวดหมู่ Ticket';
comment on column public.technician_skills.certification is
  'ใบรับรองหรือคุณวุฒิที่เกี่ยวข้องกับทักษะนี้';
comment on column public.technician_skills.certification_expiry is
  'วันหมดอายุใบรับรอง; null หมายถึงไม่มีวันหมดอายุหรือไม่ได้ระบุ';
comment on column public.technician_skills.product_technology is
  'ผลิตภัณฑ์หรือเทคโนโลยีที่ช่างมีประสบการณ์';
comment on column public.technician_skills.location is
  'พื้นที่หรือสถานที่ที่ช่างพร้อมปฏิบัติงาน';
comment on column public.technician_skills.availability is
  'สถานะความพร้อม: available, limited, unavailable';
