-- CMDB P0/P1 extensions.
-- Keep the operational status column backward-compatible and add governance,
-- provenance, lifecycle, reconciliation and owner-review metadata.

alter table public.configuration_items
  add column if not exists application_service text,
  add column if not exists source_of_truth text,
  add column if not exists discovery_source text,
  add column if not exists lifecycle text not null default 'Planned',
  add column if not exists data_quality_score smallint not null default 0,
  add column if not exists auto_reconciliation boolean not null default false,
  add column if not exists ci_owner_review_status text not null default 'Pending',
  add column if not exists ci_owner_review_at timestamptz,
  add column if not exists ci_owner_review_by uuid references auth.users(id) on delete set null;

alter table public.configuration_items
  drop constraint if exists configuration_items_ci_type_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.configuration_items'::regclass
      and conname = 'configuration_items_ci_type_valid'
  ) then
    alter table public.configuration_items
      add constraint configuration_items_ci_type_valid check (
        ci_type in (
          'Server', 'VM', 'Database', 'Application', 'Application Service',
          'Website', 'Network', 'Network Device', 'Firewall', 'Switch',
          'Access Point', 'Domain', 'SSL Certificate', 'API', 'Cloud Service',
          'Backup Job', 'Business Service', 'Other'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'configuration_items_lifecycle_valid'
      and conrelid = 'public.configuration_items'::regclass
  ) then
    alter table public.configuration_items
      add constraint configuration_items_lifecycle_valid
      check (lifecycle in ('Planned', 'In Development', 'In Service', 'Maintenance', 'Retired'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'configuration_items_data_quality_score_valid'
      and conrelid = 'public.configuration_items'::regclass
  ) then
    alter table public.configuration_items
      add constraint configuration_items_data_quality_score_valid
      check (data_quality_score between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'configuration_items_owner_review_status_valid'
      and conrelid = 'public.configuration_items'::regclass
  ) then
    alter table public.configuration_items
      add constraint configuration_items_owner_review_status_valid
      check (ci_owner_review_status in ('Pending', 'Reviewed', 'Needs Update'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'configuration_items_owner_review_consistent'
      and conrelid = 'public.configuration_items'::regclass
  ) then
    alter table public.configuration_items
      add constraint configuration_items_owner_review_consistent
      check (
        (ci_owner_review_status = 'Pending' and ci_owner_review_at is null and ci_owner_review_by is null)
        or (ci_owner_review_status <> 'Pending' and ci_owner_review_at is not null and ci_owner_review_by is not null)
      );
  end if;
end;
$$;

-- Existing rows get a meaningful lifecycle without changing operational status.
update public.configuration_items
set lifecycle = case status
  when 'Draft' then 'Planned'
  when 'Maintenance' then 'Maintenance'
  when 'Retired' then 'Retired'
  else 'In Service'
end
where lifecycle = 'Planned';

create or replace function public.configuration_item_data_quality_score(
  p_owner_employee_id uuid,
  p_administrator_employee_id uuid,
  p_business_service text,
  p_application_service text,
  p_source_of_truth text,
  p_discovery_source text,
  p_last_verified_at timestamptz,
  p_lifecycle text,
  p_ci_owner_review_status text
)
returns smallint
language sql
immutable
set search_path = public
as $$
  select least(100,
    10
    + case when p_owner_employee_id is not null then 15 else 0 end
    + case when p_administrator_employee_id is not null then 15 else 0 end
    + case when nullif(btrim(coalesce(p_business_service, '')), '') is not null
             or nullif(btrim(coalesce(p_application_service, '')), '') is not null then 10 else 0 end
    + case when nullif(btrim(coalesce(p_source_of_truth, '')), '') is not null then 15 else 0 end
    + case when nullif(btrim(coalesce(p_discovery_source, '')), '') is not null then 10 else 0 end
    + case when p_last_verified_at is not null then 10 else 0 end
    + case when p_lifecycle is not null then 10 else 0 end
    + case when p_ci_owner_review_status = 'Reviewed' then 5 else 0 end
  )::smallint;
$$;

create or replace function public.set_configuration_item_data_quality_score()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.data_quality_score := public.configuration_item_data_quality_score(
    new.owner_employee_id,
    new.administrator_employee_id,
    new.business_service,
    new.application_service,
    new.source_of_truth,
    new.discovery_source,
    new.last_verified_at,
    new.lifecycle,
    new.ci_owner_review_status
  );
  return new;
end;
$$;

drop trigger if exists trg_configuration_items_data_quality_score on public.configuration_items;
create trigger trg_configuration_items_data_quality_score
  before insert or update on public.configuration_items
  for each row execute function public.set_configuration_item_data_quality_score();

-- Recalculate the score for rows created before this migration.
update public.configuration_items
set data_quality_score = public.configuration_item_data_quality_score(
  owner_employee_id,
  administrator_employee_id,
  business_service,
  application_service,
  source_of_truth,
  discovery_source,
  last_verified_at,
  lifecycle,
  ci_owner_review_status
);

create index if not exists configuration_items_application_service_idx
  on public.configuration_items (application_service);
create index if not exists configuration_items_source_of_truth_idx
  on public.configuration_items (source_of_truth);
create index if not exists configuration_items_discovery_source_idx
  on public.configuration_items (discovery_source);
create index if not exists configuration_items_lifecycle_idx
  on public.configuration_items (lifecycle);
create index if not exists configuration_items_data_quality_score_idx
  on public.configuration_items (data_quality_score);
create index if not exists configuration_items_owner_review_status_idx
  on public.configuration_items (ci_owner_review_status);

comment on column public.configuration_items.business_service is 'Business service supported by this CI';
comment on column public.configuration_items.application_service is 'Application service supported by or running on this CI';
comment on column public.configuration_items.source_of_truth is 'Authoritative inventory or register for this CI';
comment on column public.configuration_items.discovery_source is 'Discovery or ingestion source that last identified this CI';
comment on column public.configuration_items.lifecycle is 'Lifecycle stage, separate from operational status';
comment on column public.configuration_items.data_quality_score is 'Automatically calculated completeness score from 0 to 100';
comment on column public.configuration_items.auto_reconciliation is 'Whether discovery reconciliation is enabled for this CI';
comment on column public.configuration_items.ci_owner_review_status is 'Current CI owner review decision';

-- Change Management needs a first-class CI link like Incident, Vulnerability
-- and Backup. Existing changes remain valid because the link is nullable.
alter table public.change_requests
  add column if not exists configuration_item_id uuid references public.configuration_items(id) on delete set null;

create index if not exists change_requests_configuration_item_id_idx
  on public.change_requests (configuration_item_id)
  where configuration_item_id is not null;
