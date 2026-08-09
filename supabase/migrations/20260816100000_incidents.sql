-- ============================================================================
-- Phase 6 Module 10: Incident Management + Risk Matrix + Regulatory Notification
--
-- Ground truth: legacy-gas/Module_Incident.gs, Incident.html และ Config.gs > DB_SCHEMA
-- ย้าย workflow รับแจ้ง -> จำแนก/ประเมินความเสี่ยง 5x5 -> มอบหมาย -> ประเมินหน้าที่
-- แจ้งภายนอก -> บันทึกหลักฐาน -> ปิดเคส โดยรักษา regulatory closure gate เดิมไว้
--
-- การยกระดับ schema ที่ตั้งใจทำเหนือ legacy:
-- - ใช้ UUID เป็น PK และเก็บ legacy_id แยกสำหรับ Phase 7
-- - risk_score เป็น generated column ป้องกันค่าคลาดเคลื่อนจาก likelihood x impact
-- - regulatory destination เป็นค่าคงที่ (PDPC/DATA_SUBJECT/NCSA/OTHER) แทนการเดาจาก
--   ชื่อ agency ตอนตรวจ closure gate; agency ยังคงเก็บข้อความจริงเพื่อแสดงผล/ย้ายข้อมูล
-- - source_ticket_id และ tickets.incident_id เป็น FK/unique จริง ป้องกัน Ticket หนึ่งใบ
--   ถูกยกระดับซ้ำ ซึ่ง legacy ตรวจได้เพียงใน application code
-- - closure gate บังคับซ้ำด้วย database trigger ไม่พึ่ง API เพียงชั้นเดียว
--
-- ขอบเขตที่เลื่อนออกไป:
-- - LINE OA/LINE Login notification รอ Channel ID/Secret จากเจ้าของระบบ
-- - ไฟล์เดิมจาก Drive/Attachment Registry จะย้ายใน Phase 7; โมดูลนี้เก็บ evidence_url
--   และรองรับ file_attachments ที่ผูก target_table='incidents' อยู่แล้ว
-- ============================================================================

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  incident_number text not null unique,
  legacy_id text unique,
  title text not null check (char_length(title) <= 200),
  reported_by uuid not null references public.profiles(id) on delete restrict,
  report_date timestamptz not null default now(),
  category text not null check (category in (
    'มัลแวร์/ไวรัส', 'การเข้าถึงโดยไม่ได้รับอนุญาต', 'ข้อมูลรั่วไหล',
    'ฟิชชิง/หลอกลวง', 'ระบบล่ม/ใช้งานไม่ได้', 'การละเมิดนโยบาย', 'อื่นๆ'
  )),
  severity text check (severity is null or severity in ('ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต')),
  likelihood smallint check (likelihood between 1 and 5),
  impact smallint check (impact between 1 and 5),
  risk_score smallint generated always as (
    case when likelihood is not null and impact is not null then likelihood * impact else null end
  ) stored,
  description text not null check (char_length(description) <= 3000),
  affected_system text check (char_length(affected_system) <= 150),
  contains_personal_data boolean not null default false,
  assignee_id uuid references public.profiles(id) on delete set null,
  dpo_notified_at timestamptz,
  dpo_notified_by uuid references public.profiles(id) on delete set null,
  dpo_notify_note text check (char_length(dpo_notify_note) <= 300),
  dpo_notify_deadline timestamptz,
  status text not null default 'เปิด' check (status in ('เปิด', 'กำลังดำเนินการ', 'ปิดเคส')),
  root_cause text check (char_length(root_cause) <= 2000),
  resolution text check (char_length(resolution) <= 2000),
  lessons_learned text check (char_length(lessons_learned) <= 2000),
  closed_at timestamptz,
  evidence_url text check (char_length(evidence_url) <= 1000),
  regulatory_assessment_status text not null default 'รอประเมิน'
    check (regulatory_assessment_status in ('รอประเมิน', 'รอตัดสินใจ', 'ประเมินแล้ว')),
  breach_risk_level text check (breach_risk_level is null or breach_risk_level in ('ไม่มีความเสี่ยง', 'ต่ำ', 'ปานกลาง', 'สูง')),
  pdpc_notify_required text not null default 'Pending' check (pdpc_notify_required in ('Yes', 'No', 'Pending')),
  data_subject_notify_required text not null default 'Pending' check (data_subject_notify_required in ('Yes', 'No', 'Pending')),
  ncsa_report_required text not null default 'Pending' check (ncsa_report_required in ('Yes', 'No', 'Pending')),
  other_regulator_required text not null default 'Pending' check (other_regulator_required in ('Yes', 'No', 'Pending')),
  regulatory_assessment text check (char_length(regulatory_assessment) <= 3000),
  regulatory_assessed_at timestamptz,
  regulatory_assessed_by uuid references public.profiles(id) on delete set null,
  notes text check (char_length(notes) <= 2000),
  source_ticket_id uuid unique references public.tickets(id) on delete set null,
  legacy_source_ticket_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint incidents_pii_dpo_deadline_required check (
    not contains_personal_data or dpo_notify_deadline is not null
  ),
  constraint incidents_closed_summary_required check (
    status <> 'ปิดเคส' or (root_cause is not null and resolution is not null and closed_at is not null)
  )
);

create index incidents_reported_by_idx on public.incidents (reported_by);
create index incidents_assignee_id_idx on public.incidents (assignee_id);
create index incidents_status_idx on public.incidents (status);
create index incidents_report_date_idx on public.incidents (report_date desc);
create index incidents_personal_data_idx on public.incidents (contains_personal_data) where contains_personal_data;
create index incidents_risk_matrix_idx on public.incidents (likelihood, impact) where status <> 'ปิดเคส';

create trigger trg_incidents_set_updated_at
  before update on public.incidents
  for each row execute function public.set_updated_at();

create table public.regulatory_notifications (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  destination text not null check (destination in ('PDPC', 'DATA_SUBJECT', 'NCSA', 'OTHER')),
  agency text not null check (char_length(agency) <= 250),
  notification_type text not null check (char_length(notification_type) <= 250),
  required boolean not null default true,
  legal_basis text check (char_length(legal_basis) <= 1000),
  deadline timestamptz,
  status text not null default 'รอแจ้ง' check (status in ('รอแจ้ง', 'แจ้งแล้ว', 'ไม่ต้องแจ้ง', 'ยกเลิก')),
  notified_at timestamptz,
  reference_no text check (char_length(reference_no) <= 250),
  approved_by uuid references public.profiles(id) on delete set null,
  evidence_url text check (char_length(evidence_url) <= 1000),
  reason_not_required text check (char_length(reason_not_required) <= 2000),
  notes text check (char_length(notes) <= 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint regulatory_notifications_required_status_consistent check (
    (required and status <> 'ไม่ต้องแจ้ง')
    or (not required and status = 'ไม่ต้องแจ้ง' and reason_not_required is not null)
  ),
  constraint regulatory_notifications_sent_evidence_required check (
    status <> 'แจ้งแล้ว'
    or (notified_at is not null and (reference_no is not null or evidence_url is not null))
  )
);

create index regulatory_notifications_incident_id_idx on public.regulatory_notifications (incident_id);
create index regulatory_notifications_deadline_idx on public.regulatory_notifications (deadline) where status = 'รอแจ้ง';

create trigger trg_regulatory_notifications_set_updated_at
  before update on public.regulatory_notifications
  for each row execute function public.set_updated_at();

-- FK ย้อนกลับช่วยให้หน้า Ticket เปิด Incident ที่ถูกยกระดับได้โดยตรง และ unique รักษา 1:1
alter table public.tickets
  add column incident_id uuid unique references public.incidents(id) on delete set null;

-- Database-level regulatory closure gate: ใช้ destination ที่ normalize แล้ว ไม่เดาจากชื่อ agency
create or replace function public.enforce_incident_closure_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing_destinations text[] := array[]::text[];
begin
  if new.status <> 'ปิดเคส' then
    return new;
  end if;

  if new.regulatory_assessment_status <> 'ประเมินแล้ว' then
    raise exception 'INCIDENT_REGULATORY_ASSESSMENT_INCOMPLETE';
  end if;

  if new.contains_personal_data and new.dpo_notified_at is null then
    raise exception 'INCIDENT_DPO_NOT_NOTIFIED';
  end if;

  if new.pdpc_notify_required = 'Yes' and not exists (
    select 1 from public.regulatory_notifications n
    where n.incident_id = new.id and n.destination = 'PDPC' and n.required and n.status = 'แจ้งแล้ว'
  ) then missing_destinations := array_append(missing_destinations, 'PDPC'); end if;

  if new.data_subject_notify_required = 'Yes' and not exists (
    select 1 from public.regulatory_notifications n
    where n.incident_id = new.id and n.destination = 'DATA_SUBJECT' and n.required and n.status = 'แจ้งแล้ว'
  ) then missing_destinations := array_append(missing_destinations, 'DATA_SUBJECT'); end if;

  if new.ncsa_report_required = 'Yes' and not exists (
    select 1 from public.regulatory_notifications n
    where n.incident_id = new.id and n.destination = 'NCSA' and n.required and n.status = 'แจ้งแล้ว'
  ) then missing_destinations := array_append(missing_destinations, 'NCSA'); end if;

  if new.other_regulator_required = 'Yes' and not exists (
    select 1 from public.regulatory_notifications n
    where n.incident_id = new.id and n.destination = 'OTHER' and n.required and n.status = 'แจ้งแล้ว'
  ) then missing_destinations := array_append(missing_destinations, 'OTHER'); end if;

  if cardinality(missing_destinations) > 0 then
    raise exception 'INCIDENT_REGULATORY_EVIDENCE_MISSING:%', array_to_string(missing_destinations, ',');
  end if;
  return new;
end;
$$;

create trigger trg_incidents_enforce_closure_gate
  before insert or update
  on public.incidents
  for each row execute function public.enforce_incident_closure_gate();

alter table public.incidents enable row level security;
alter table public.regulatory_notifications enable row level security;

-- ผู้แจ้งเห็นเคสตนเอง, ผู้รับผิดชอบเห็นเคสที่รับมอบหมาย, DPO เห็นเฉพาะเคส PII,
-- ส่วนสิทธิ์ view_all/manage เปิดภาพรวม ทั้งหมดเป็น permission configurable ไม่ผูกชื่อ role ใน policy
create policy incidents_select_visible on public.incidents
  for select to authenticated
  using (
    reported_by = auth.uid()
    or assignee_id = auth.uid()
    or public.has_permission('incident.manage')
    or public.has_permission('incident.view_all')
    or (contains_personal_data and public.has_permission('incident.regulatory'))
  );

create policy incidents_insert_own on public.incidents
  for insert to authenticated
  with check (reported_by = auth.uid() and public.has_permission('incident.create'));

create policy incidents_update_manage on public.incidents
  for update to authenticated
  using (public.has_permission('incident.manage'))
  with check (public.has_permission('incident.manage'));

create policy regulatory_notifications_select_visible_incident on public.regulatory_notifications
  for select to authenticated
  using (
    exists (select 1 from public.incidents i where i.id = regulatory_notifications.incident_id)
  );

-- Regulatory writes ใช้ Workers service-role หลังตรวจ incident.regulatory/incident.manage ทุก request
-- โดยตั้งใจไม่เปิด insert/update/delete policy ให้ JWT ฝั่งผู้ใช้ เพื่อป้องกันการแก้คอลัมน์อื่นตรงๆ

create policy file_attachments_select_incident_participant on public.file_attachments
  for select to authenticated
  using (
    module = 'incident' and target_table = 'incidents'
    and exists (
      select 1 from public.incidents i where i.id::text = file_attachments.target_id
    )
  );
