-- Let Form Studio assign one master template to each supported work module.
-- Existing templates remain valid; the initial bindings preserve the current defaults.

create table public.form_module_bindings (
  module_key text primary key check (module_key in ('ticket', 'asset_borrow')),
  template_id uuid not null references public.form_templates(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id)
);

create trigger trg_form_module_bindings_set_updated_at
  before update on public.form_module_bindings
  for each row execute function public.set_updated_at();

alter table public.form_module_bindings enable row level security;

create policy form_module_bindings_select on public.form_module_bindings
  for select to authenticated using (public.has_permission('form.view'));
create policy form_module_bindings_insert on public.form_module_bindings
  for insert to authenticated with check (public.has_permission('form.manage'));
create policy form_module_bindings_update on public.form_module_bindings
  for update to authenticated using (public.has_permission('form.manage'))
  with check (public.has_permission('form.manage'));
create policy form_module_bindings_delete on public.form_module_bindings
  for delete to authenticated using (public.has_permission('form.manage'));

insert into public.form_module_bindings (module_key, template_id)
select 'ticket', id from public.form_templates where template_code = 'IT-ERP-ISSUE'
on conflict (module_key) do update set template_id = excluded.template_id, updated_at = now();

insert into public.form_module_bindings (module_key, template_id)
select 'asset_borrow', id from public.form_templates where template_code = 'ASSET-BORROW'
on conflict (module_key) do update set template_id = excluded.template_id, updated_at = now();

-- Reassigning a module is a single database operation. The old binding for the
-- selected template is removed first so the unique(template_id) invariant holds.
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
  if module_key_input not in ('ticket', 'asset_borrow') then
    raise exception 'ไม่พบโมดูลที่รองรับสำหรับ Form Studio';
  end if;

  if not exists (
    select 1 from public.form_templates
    where id = template_id_input and status <> 'Archived'
  ) then
    raise exception 'ไม่สามารถผูก Template ที่ไม่พร้อมใช้งานกับโมดูลได้';
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

comment on table public.form_module_bindings is
  'The Form Studio master template selected for each supported work module.';
