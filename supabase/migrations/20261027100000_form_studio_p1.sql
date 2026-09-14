-- Form Studio P1: structured fields, generic source links, evidence and issued snapshots.
-- All changes are additive so existing Ticket/Asset forms keep working.

alter table public.form_templates
  add column if not exists field_schema jsonb not null default '[]'::jsonb,
  add column if not exists acknowledgement_config jsonb not null default '{"enabled":false,"statement":""}'::jsonb,
  add column if not exists approval_signature_config jsonb not null default '{"requiredRoles":[]}'::jsonb,
  add column if not exists document_number_rule jsonb not null default '{"prefix":"FRM","dateFormat":"YYYYMM","padding":5}'::jsonb;

alter table public.form_templates
  drop constraint if exists form_templates_field_schema_object_check;
alter table public.form_templates
  add constraint form_templates_field_schema_array_check check (jsonb_typeof(field_schema) = 'array');

alter table public.form_template_versions
  add column if not exists field_schema jsonb not null default '[]'::jsonb,
  add column if not exists acknowledgement_config jsonb not null default '{"enabled":false,"statement":""}'::jsonb,
  add column if not exists approval_signature_config jsonb not null default '{"requiredRoles":[]}'::jsonb,
  add column if not exists document_number_rule jsonb not null default '{"prefix":"FRM","dateFormat":"YYYYMM","padding":5}'::jsonb;

alter table public.form_template_versions
  add constraint form_template_versions_field_schema_array_check check (jsonb_typeof(field_schema) = 'array');

alter table public.issue_forms
  add column if not exists source_module text not null default 'ticket',
  add column if not exists source_record_id text,
  add column if not exists field_schema jsonb not null default '[]'::jsonb,
  add column if not exists document_number text,
  add column if not exists immutable_snapshot jsonb,
  add column if not exists snapshot_hash text,
  add column if not exists issued_at timestamptz,
  add column if not exists issued_by uuid references public.profiles(id) on delete set null;

alter table public.issue_forms
  drop constraint if exists issue_forms_source_module_check;
alter table public.issue_forms
  add constraint issue_forms_source_module_check check (source_module in (
    'ticket', 'incident', 'change', 'contract', 'audit', 'risk', 'service_request', 'asset_borrow', 'custom'
  ));
alter table public.issue_forms
  add constraint issue_forms_field_schema_array_check check (jsonb_typeof(field_schema) = 'array');

update public.issue_forms
set source_module = 'ticket', source_record_id = ticket_id::text
where source_record_id is null and ticket_id is not null;

update public.issue_forms
set document_number = form_no
where document_number is null;

create unique index if not exists issue_forms_document_number_uidx
  on public.issue_forms (document_number);
create index if not exists issue_forms_source_link_idx
  on public.issue_forms (source_module, source_record_id);

-- Keep old callers safe while making document_number the stable printed identifier.
create or replace function public.set_issue_form_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rule jsonb;
  prefix text;
  date_format text;
  padding integer;
  date_part text;
  counter text;
begin
  if new.source_module is null or new.source_module = '' then
    new.source_module := case when new.ticket_id is not null then 'ticket' else 'custom' end;
  end if;
  if new.source_record_id is null and new.ticket_id is not null then
    new.source_record_id := new.ticket_id::text;
  end if;
  if new.document_number is null or new.document_number = '' then
    select document_number_rule into rule from public.form_templates where id = new.template_id;
    prefix := coalesce(nullif(rule->>'prefix', ''), 'FRM');
    date_format := coalesce(nullif(rule->>'dateFormat', ''), 'YYYYMM');
    padding := greatest(1, least(12, coalesce((rule->>'padding')::integer, 5)));
    date_part := case date_format
      when 'YYYY' then to_char(current_date, 'YYYY')
      when 'YYMM' then to_char(current_date, 'YYMM')
      else to_char(current_date, 'YYYYMM')
    end;
    counter := coalesce(nullif(substring(new.form_no from '([0-9]+)$'), ''), nextval('public.issue_form_no_seq')::text);
    new.document_number := prefix || '-' || date_part || '-' || lpad(counter, padding, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_issue_forms_set_provenance on public.issue_forms;
create trigger trg_issue_forms_set_provenance
  before insert on public.issue_forms
  for each row execute function public.set_issue_form_provenance();

create table public.issue_form_snapshots (
  id uuid primary key default gen_random_uuid(),
  issue_form_id uuid not null unique references public.issue_forms(id) on delete restrict,
  form_no text not null,
  document_number text not null,
  title text not null,
  template_id uuid references public.form_templates(id) on delete set null,
  template_version integer not null,
  source_module text not null,
  source_record_id text,
  content_html text not null,
  field_schema jsonb not null default '[]'::jsonb,
  form_data jsonb not null default '{}'::jsonb,
  acknowledgement_evidence jsonb not null default '[]'::jsonb,
  signature_evidence jsonb not null default '[]'::jsonb,
  snapshot_hash text not null,
  issued_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now()
);

create index issue_form_snapshots_document_number_idx on public.issue_form_snapshots (document_number);

create or replace function public.prevent_issue_form_snapshot_mutation()
returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'ISSUE_FORM_SNAPSHOT_IMMUTABLE';
end;
$$;

create trigger trg_issue_form_snapshots_immutable
  before update or delete on public.issue_form_snapshots
  for each row execute function public.prevent_issue_form_snapshot_mutation();

create table public.issue_form_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  issue_form_id uuid not null references public.issue_forms(id) on delete restrict,
  party_type text not null check (party_type in ('requester', 'vendor', 'internal', 'approver')),
  party_name text not null,
  party_email text,
  statement text not null,
  accepted boolean not null check (accepted),
  actor_id uuid references public.profiles(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  acknowledged_at timestamptz not null default now(),
  unique (issue_form_id, party_type)
);

create index issue_form_acknowledgements_form_idx on public.issue_form_acknowledgements (issue_form_id, acknowledged_at);

create table public.issue_form_signatures (
  id uuid primary key default gen_random_uuid(),
  issue_form_id uuid not null references public.issue_forms(id) on delete restrict,
  role text not null check (char_length(role) between 1 and 100),
  signer_name text not null,
  signer_email text,
  signature_type text not null default 'typed' check (signature_type in ('typed', 'drawn', 'certificate')),
  signature_value text not null,
  evidence_hash text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  actor_id uuid references public.profiles(id) on delete set null,
  signed_at timestamptz not null default now(),
  unique (issue_form_id, role)
);

create index issue_form_signatures_form_idx on public.issue_form_signatures (issue_form_id, signed_at);

create or replace function public.prevent_issue_form_evidence_mutation()
returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'ISSUE_FORM_EVIDENCE_IMMUTABLE';
end;
$$;

create trigger trg_issue_form_acknowledgements_immutable
  before update or delete on public.issue_form_acknowledgements
  for each row execute function public.prevent_issue_form_evidence_mutation();
create trigger trg_issue_form_signatures_immutable
  before update or delete on public.issue_form_signatures
  for each row execute function public.prevent_issue_form_evidence_mutation();

create or replace function public.protect_issued_issue_form()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.issued_at is not null and (
    new.title is distinct from old.title or
    new.template_id is distinct from old.template_id or
    new.template_version is distinct from old.template_version or
    new.source_module is distinct from old.source_module or
    new.source_record_id is distinct from old.source_record_id or
    new.content_html is distinct from old.content_html or
    new.form_data is distinct from old.form_data or
    new.field_schema is distinct from old.field_schema or
    new.immutable_snapshot is distinct from old.immutable_snapshot or
    new.snapshot_hash is distinct from old.snapshot_hash or
    new.issued_at is distinct from old.issued_at or
    new.issued_by is distinct from old.issued_by
  ) then
    raise exception 'ISSUE_FORM_IMMUTABLE_AFTER_ISSUE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_issue_forms_protect_issued on public.issue_forms;
create trigger trg_issue_forms_protect_issued
  before update on public.issue_forms
  for each row execute function public.protect_issued_issue_form();

insert into public.permissions (key, module_key, action, description, status)
values
  ('form.acknowledge', 'form', 'acknowledge', 'บันทึก Digital acknowledgement ของแบบฟอร์ม', 'active'),
  ('form.sign', 'form', 'sign', 'บันทึกลายเซ็นและหลักฐานการอนุมัติของแบบฟอร์ม', 'active'),
  ('form.export', 'form', 'export', 'ส่งออกแบบฟอร์มเป็น PDF', 'active')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
join public.permissions p on p.key in ('form.acknowledge', 'form.sign', 'form.export')
  and r.key in ('super_admin', 'it_admin', 'technician')
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
join public.permissions p on p.key in ('form.export')
  and r.key in ('manager', 'executive', 'auditor', 'approver')
on conflict (role_id, permission_id) do nothing;

alter table public.issue_form_snapshots enable row level security;
alter table public.issue_form_acknowledgements enable row level security;
alter table public.issue_form_signatures enable row level security;

create policy issue_form_snapshots_select on public.issue_form_snapshots
  for select to authenticated using (public.has_permission('form.view'));
create policy issue_form_snapshots_insert on public.issue_form_snapshots
  for insert to authenticated with check (public.has_permission('form.manage'));
create policy issue_form_acknowledgements_select on public.issue_form_acknowledgements
  for select to authenticated using (public.has_permission('form.view'));
create policy issue_form_acknowledgements_insert on public.issue_form_acknowledgements
  for insert to authenticated with check (public.has_permission('form.acknowledge'));
create policy issue_form_signatures_select on public.issue_form_signatures
  for select to authenticated using (public.has_permission('form.view'));
create policy issue_form_signatures_insert on public.issue_form_signatures
  for insert to authenticated with check (public.has_permission('form.sign'));

comment on column public.form_templates.field_schema is
  'Structured field definitions. HTML is presentation only; validation uses this schema.';
comment on column public.issue_forms.source_module is
  'Generic source module for the work record linked to this form.';
comment on table public.issue_form_snapshots is
  'Append-only issued document snapshot. Never update or delete.';

-- Expand module bindings beyond the historical Ticket/Asset pair.
alter table public.form_module_bindings
  drop constraint if exists form_module_bindings_module_key_check;
alter table public.form_module_bindings
  add constraint form_module_bindings_module_key_check check (module_key in (
    'ticket', 'incident', 'change', 'contract', 'audit', 'risk', 'service_request', 'asset_borrow', 'custom'
  ));

create or replace function public.assign_form_module_template(
  module_key_input text,
  template_id_input uuid,
  updated_by_input uuid
) returns public.form_module_bindings
language plpgsql
security definer
set search_path = public
as $$
declare
  binding public.form_module_bindings;
begin
  if module_key_input not in ('ticket', 'incident', 'change', 'contract', 'audit', 'risk', 'service_request', 'asset_borrow', 'custom') then
    raise exception 'FORM_MODULE_UNSUPPORTED';
  end if;
  if not exists (select 1 from public.form_templates where id = template_id_input and status <> 'Archived') then
    raise exception 'FORM_TEMPLATE_NOT_USABLE';
  end if;
  delete from public.form_module_bindings
  where template_id = template_id_input and module_key <> module_key_input;
  insert into public.form_module_bindings (module_key, template_id, updated_by)
  values (module_key_input, template_id_input, updated_by_input)
  on conflict (module_key) do update set
    template_id = excluded.template_id,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into binding;
  return binding;
end;
$$;

revoke all on function public.assign_form_module_template(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_form_module_template(text, uuid, uuid) to service_role;
