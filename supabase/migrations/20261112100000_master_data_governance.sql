-- ============================================================================
-- Master Data governance
--
-- Every reference list has the same lifecycle metadata.  Existing records are
-- backfilled with stable codes so adding the central registry never changes the
-- meaning of historical Ticket/Asset/Access rows.
-- ============================================================================

alter table public.departments
  add column effective_date date not null default current_date,
  add column sort_order integer not null default 100 check (sort_order >= 0);

alter table public.positions
  add column effective_date date not null default current_date,
  add column sort_order integer not null default 100 check (sort_order >= 0);

alter table public.ticket_categories
  add column if not exists code text,
  add column if not exists effective_date date not null default current_date,
  add column if not exists sort_order integer not null default 100 check (sort_order >= 0);

update public.ticket_categories
set code = 'TC-' || upper(substr(replace(id::text, '-', ''), 1, 12))
where code is null;

alter table public.ticket_categories
  alter column code set not null,
  alter column code set default ('TC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  add constraint ticket_categories_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$');
create unique index ticket_categories_code_unique on public.ticket_categories (code);

alter table public.asset_categories
  add column code text,
  add column effective_date date not null default current_date,
  add column sort_order integer not null default 100 check (sort_order >= 0);

update public.asset_categories
set code = upper(code_prefix)
where code is null;

alter table public.asset_categories
  alter column code set not null,
  add constraint asset_categories_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$');
create unique index asset_categories_code_unique on public.asset_categories (code);

alter table public.access_systems
  add column code text,
  add column effective_date date not null default current_date,
  add column sort_order integer not null default 100 check (sort_order >= 0);

update public.access_systems
set code = 'SYS-' || upper(substr(replace(id::text, '-', ''), 1, 12))
where code is null;

alter table public.access_systems
  alter column code set not null,
  alter column code set default ('SYS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  add constraint access_systems_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$');
create unique index access_systems_code_unique on public.access_systems (code);

alter table public.ticket_cause_codes
  add column effective_date date not null default current_date;

alter table public.access_control_items
  add column effective_date date not null default current_date,
  add column sort_order integer not null default 100 check (sort_order >= 0);

-- Older callers may still insert an Asset Category with only code_prefix.
-- Generate the central code at the database boundary so those writes remain
-- compatible while all new registry writes can provide an explicit Code.
create or replace function public.set_master_data_code_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    if tg_table_name = 'asset_categories' then
      new.code := coalesce(nullif(upper(btrim(new.code_prefix)), ''), 'AC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)));
    elsif tg_table_name = 'ticket_categories' then
      new.code := 'TC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    elsif tg_table_name = 'access_systems' then
      new.code := 'SYS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ticket_categories_code_default on public.ticket_categories;
create trigger trg_ticket_categories_code_default
  before insert on public.ticket_categories
  for each row execute function public.set_master_data_code_defaults();

drop trigger if exists trg_asset_categories_code_default on public.asset_categories;
create trigger trg_asset_categories_code_default
  before insert on public.asset_categories
  for each row execute function public.set_master_data_code_defaults();

drop trigger if exists trg_access_systems_code_default on public.access_systems;
create trigger trg_access_systems_code_default
  before insert on public.access_systems
  for each row execute function public.set_master_data_code_defaults();

-- Direct DELETE is blocked at the database boundary.  The API catches this
-- marker and performs a status-only deactivation, so no foreign key or history
-- is destroyed even if a caller tries the generic record-deletion endpoint.
create or replace function public.guard_master_data_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reference_count integer := 0;
begin
  if tg_table_name = 'ticket_categories' then
    select count(*) into reference_count from (
      select id from public.tickets where category_id = old.id
      union all select id from public.knowledge_articles where category_id = old.id
      union all select id from public.ticket_subcategories where category_id = old.id
      union all select id from public.technician_skills where category_id = old.id
      union all select id from public.ticket_cause_codes where category_id = old.id
    ) reference_rows;
  elsif tg_table_name = 'asset_categories' then
    select count(*) into reference_count from public.assets where category_id = old.id;
  elsif tg_table_name = 'access_systems' then
    select count(*) into reference_count from (
      select id from public.access_requests where system_id = old.id
      union all select id from public.user_access_registry where system_id = old.id
      union all select id from public.access_control_items where system_id = old.id
      union all select id from public.access_certification_campaigns where system_id = old.id
      union all select id from public.access_certification_items where system_id = old.id
    ) reference_rows;
  elsif tg_table_name = 'departments' then
    select count(*) into reference_count from (
      select id from public.departments where parent_department_id = old.id
      union all select id from public.profiles where department_id = old.id
      union all select id from public.employees where department_id = old.id
      union all select id from public.approval_groups where department_id = old.id
      union all select id from public.service_catalog where fulfillment_group_id = old.id
      union all select id from public.service_requests where assigned_group_id = old.id
      union all select id from public.service_request_tasks where owner_group_id = old.id
      union all select id from public.assets where department_id = old.id
      union all select id from public.tickets where department_id = old.id
    ) reference_rows;
  elsif tg_table_name = 'positions' then
    select count(*) into reference_count from (
      select id from public.profiles where position_id = old.id
      union all select id from public.employees where position_id = old.id
    ) reference_rows;
  elsif tg_table_name = 'ticket_cause_codes' then
    select count(*) into reference_count from public.tickets where cause_code_id = old.id;
  end if;

  if reference_count > 0 then
    raise exception using errcode = '23514', message = 'MASTER_DATA_IN_USE';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_ticket_categories_guard_delete on public.ticket_categories;
create trigger trg_ticket_categories_guard_delete
  before delete on public.ticket_categories
  for each row execute function public.guard_master_data_delete();

drop trigger if exists trg_asset_categories_guard_delete on public.asset_categories;
create trigger trg_asset_categories_guard_delete
  before delete on public.asset_categories
  for each row execute function public.guard_master_data_delete();

drop trigger if exists trg_access_systems_guard_delete on public.access_systems;
create trigger trg_access_systems_guard_delete
  before delete on public.access_systems
  for each row execute function public.guard_master_data_delete();

drop trigger if exists trg_departments_guard_delete on public.departments;
create trigger trg_departments_guard_delete
  before delete on public.departments
  for each row execute function public.guard_master_data_delete();

drop trigger if exists trg_positions_guard_delete on public.positions;
create trigger trg_positions_guard_delete
  before delete on public.positions
  for each row execute function public.guard_master_data_delete();

drop trigger if exists trg_ticket_cause_codes_guard_delete on public.ticket_cause_codes;
create trigger trg_ticket_cause_codes_guard_delete
  before delete on public.ticket_cause_codes
  for each row execute function public.guard_master_data_delete();

create index departments_registry_order_idx on public.departments (sort_order, name_th);
create index positions_registry_order_idx on public.positions (sort_order, name_th);
create index ticket_categories_registry_order_idx on public.ticket_categories (sort_order, name);
create index asset_categories_registry_order_idx on public.asset_categories (sort_order, name);
create index access_systems_registry_order_idx on public.access_systems (sort_order, name);
create index ticket_cause_codes_registry_order_idx on public.ticket_cause_codes (sort_order, name);

comment on column public.ticket_categories.code is 'รหัสกลางที่ไม่เปลี่ยนเพื่อใช้อ้างอิงย้อนหลัง';
comment on column public.asset_categories.code is 'รหัสกลางของประเภททรัพย์สิน แยกจาก code_prefix ที่ใช้สร้าง asset code';
comment on column public.access_systems.code is 'รหัสกลางของระบบงานที่ใช้ใน Access Request';
comment on column public.ticket_cause_codes.effective_date is 'วันที่เริ่มมีผลของรหัสสาเหตุ';

-- Merge is a single database transaction: references move first, then the
-- duplicate is retained as an inactive record. The source code is never
-- rewritten, which keeps old exports and audit evidence readable.
create or replace function public.merge_master_data(
  kind_input text,
  source_id_input uuid,
  target_id_input uuid,
  actor_id_input uuid,
  actor_email_input text,
  reason_input text,
  request_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_row jsonb;
  target_row jsonb;
  moved_count integer := 0;
  affected_rows integer := 0;
  source_table text;
  source_module text;
begin
  if source_id_input = target_id_input then
    raise exception using errcode = '22023', message = 'MASTER_DATA_MERGE_SELF';
  end if;
  if reason_input is null or char_length(btrim(reason_input)) < 3 then
    raise exception using errcode = '22023', message = 'MASTER_DATA_MERGE_REASON_INVALID';
  end if;

  case kind_input
    when 'department' then source_table := 'departments'; source_module := 'department';
    when 'position' then source_table := 'positions'; source_module := 'position';
    when 'ticket_category' then source_table := 'ticket_categories'; source_module := 'ticket_category';
    when 'asset_category' then source_table := 'asset_categories'; source_module := 'asset_category';
    when 'access_system' then source_table := 'access_systems'; source_module := 'access_system';
    when 'cause_code' then source_table := 'ticket_cause_codes'; source_module := 'cause_code';
    else raise exception using errcode = '22023', message = 'MASTER_DATA_KIND_INVALID';
  end case;

  execute format('select to_jsonb(row) from public.%I row where row.id = $1 for update', source_table)
    into source_row using source_id_input;
  execute format('select to_jsonb(row) from public.%I row where row.id = $1 for update', source_table)
    into target_row using target_id_input;
  if source_row is null or target_row is null then
    raise exception using errcode = 'P0002', message = 'MASTER_DATA_NOT_FOUND';
  end if;
  if kind_input = 'cause_code' then
    if coalesce((target_row ->> 'is_active')::boolean, false) is not true then
      raise exception using errcode = '23514', message = 'MASTER_DATA_TARGET_INACTIVE';
    end if;
  elsif coalesce(target_row ->> 'status', 'inactive') <> 'active' then
    raise exception using errcode = '23514', message = 'MASTER_DATA_TARGET_INACTIVE';
  end if;

  if kind_input = 'ticket_category' then
    if exists (
      select 1 from public.ticket_subcategories source_sub
      join public.ticket_subcategories target_sub
        on target_sub.category_id = target_id_input and target_sub.name = source_sub.name
      where source_sub.category_id = source_id_input
    ) or exists (
      select 1 from public.technician_skills source_skill
      join public.technician_skills target_skill
        on target_skill.category_id = target_id_input and target_skill.technician_id = source_skill.technician_id
      where source_skill.category_id = source_id_input
    ) then
      raise exception using errcode = '23514', message = 'MASTER_DATA_MERGE_CONFLICT';
    end if;
    update public.tickets set category_id = target_id_input where category_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.knowledge_articles set category_id = target_id_input where category_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.ticket_subcategories set category_id = target_id_input where category_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.technician_skills set category_id = target_id_input where category_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.ticket_cause_codes set category_id = target_id_input where category_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.ticket_categories set status = 'inactive', updated_by = actor_id_input where id = source_id_input;
  elsif kind_input = 'asset_category' then
    update public.assets set category_id = target_id_input where category_id = source_id_input;
    get diagnostics moved_count = row_count;
    update public.asset_categories set status = 'inactive', updated_by = actor_id_input where id = source_id_input;
  elsif kind_input = 'access_system' then
    if exists (
      select 1 from public.access_control_items source_item
      join public.access_control_items target_item
        on target_item.system_id = target_id_input and target_item.code = source_item.code
      where source_item.system_id = source_id_input
    ) then
      raise exception using errcode = '23514', message = 'MASTER_DATA_MERGE_CONFLICT';
    end if;
    update public.access_requests set system_id = target_id_input where system_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.user_access_registry set system_id = target_id_input where system_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.access_control_items set system_id = target_id_input where system_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.access_certification_campaigns set system_id = target_id_input where system_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.access_certification_items set system_id = target_id_input where system_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.access_systems set status = 'inactive', updated_by = actor_id_input where id = source_id_input;
  elsif kind_input = 'cause_code' then
    update public.tickets set cause_code_id = target_id_input where cause_code_id = source_id_input;
    get diagnostics moved_count = row_count;
    update public.ticket_cause_codes set is_active = false, updated_by = actor_id_input where id = source_id_input;
  elsif kind_input = 'department' then
    update public.departments
    set parent_department_id = (source_row ->> 'parent_department_id')::uuid
    where id = target_id_input and parent_department_id = source_id_input;
    update public.departments set parent_department_id = target_id_input where parent_department_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.profiles set department_id = target_id_input where department_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.employees set department_id = target_id_input where department_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.approval_groups set department_id = target_id_input where department_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.service_catalog set fulfillment_group_id = target_id_input where fulfillment_group_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.service_requests set assigned_group_id = target_id_input where assigned_group_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.service_request_tasks set owner_group_id = target_id_input where owner_group_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.assets set department_id = target_id_input where department_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.tickets set department_id = target_id_input where department_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.departments set status = 'inactive', updated_by = actor_id_input where id = source_id_input;
  elsif kind_input = 'position' then
    update public.profiles set position_id = target_id_input where position_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.employees set position_id = target_id_input where position_id = source_id_input;
    get diagnostics affected_rows = row_count; moved_count := moved_count + affected_rows;
    update public.positions set status = 'inactive', updated_by = actor_id_input where id = source_id_input;
  end if;

  insert into public.audit_logs (
    actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id
  ) values (
    actor_id_input, actor_email_input, 'MERGE', 'master-data', source_table, source_id_input::text,
    jsonb_build_object(
      'kind', kind_input,
      'targetId', target_id_input,
      'sourceCode', source_row ->> 'code',
      'targetCode', target_row ->> 'code',
      'movedReferences', moved_count,
      'reason', btrim(reason_input)
    ), 'success', request_id_input
  );

  return jsonb_build_object('kind', kind_input, 'sourceId', source_id_input, 'targetId', target_id_input, 'movedReferences', moved_count, 'mode', 'inactive');
end;
$$;

revoke all on function public.merge_master_data(text, uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.merge_master_data(text, uuid, uuid, uuid, text, text, text)
  to service_role;
