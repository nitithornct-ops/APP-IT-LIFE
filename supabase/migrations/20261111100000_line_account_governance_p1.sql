-- LINE account governance (P1)
-- Keep the LINE identity separate from the application profile. The link is
-- one-to-one, consented, timestamped, auditable, and automatically revoked by
-- the authoritative employee/account lifecycle.

alter table public.line_users
  add column if not exists linked_at timestamptz,
  add column if not exists unlinked_at timestamptz,
  add column if not exists unlinked_reason text,
  add column if not exists last_used_at timestamptz,
  add column if not exists link_consent_version text,
  add column if not exists link_consent_at timestamptz,
  add column if not exists link_consent_ip text,
  add column if not exists link_consent_user_agent text;

-- Existing links predate explicit link timestamps. Preserve their history with
-- the best available value without changing the current relationship.
update public.line_users
set linked_at = coalesce(linked_at, updated_at)
where linked_user_id is not null;

do $$
begin
  if exists (
    select lower(line_user_id)
    from public.line_users
    group by lower(line_user_id)
    having count(*) > 1
  ) then
    raise exception 'Cannot create case-insensitive LINE identity uniqueness: duplicate values already exist';
  end if;
end $$;

create unique index if not exists line_users_line_user_id_ci_unique
  on public.line_users (lower(line_user_id));

do $$
begin
  alter table public.line_users
    add constraint line_users_link_consent_evidence_check
    check (link_consent_at is null or link_consent_version is not null);
exception when duplicate_object then null;
end $$;

comment on column public.line_users.linked_at is
  'When this LINE identity was most recently linked to an application profile.';
comment on column public.line_users.unlinked_at is
  'When the current LINE-to-profile relationship was removed.';
comment on column public.line_users.last_used_at is
  'Last successful use of a LINE portal session, separate from last LINE Login.';
comment on column public.line_users.link_consent_version is
  'Version of the link consent text acknowledged by the user or administrator.';
comment on column public.line_users.link_consent_ip is
  'IP captured as consent evidence; access is restricted to service-role workflows.';

create table if not exists public.line_notification_preferences (
  line_user_id uuid primary key references public.line_users(id) on delete cascade,
  disabled_types text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint line_notification_preferences_no_null_types
    check (disabled_types = array_remove(disabled_types, null)),
  constraint line_notification_preferences_max_types
    check (cardinality(disabled_types) <= 50)
);

create trigger trg_line_notification_preferences_set_updated_at
  before update on public.line_notification_preferences
  for each row execute function public.set_updated_at();

alter table public.line_notification_preferences enable row level security;
revoke all on table public.line_notification_preferences from anon, authenticated;
grant select on table public.line_notification_preferences to anon, authenticated;
grant all on table public.line_notification_preferences to service_role;

create table if not exists public.line_link_events (
  id uuid primary key default gen_random_uuid(),
  line_user_id uuid not null references public.line_users(id) on delete cascade,
  event_type text not null check (event_type in ('LINKED', 'RELINKED', 'UNLINKED', 'AUTO_UNLINKED')),
  previous_linked_user_id uuid references public.profiles(id) on delete set null,
  linked_user_id uuid references public.profiles(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('self', 'admin', 'system')),
  consent_acknowledged boolean not null default false,
  consent_version text,
  consent_at timestamptz,
  consent_ip text,
  consent_user_agent text,
  reason text,
  created_at timestamptz not null default now(),
  constraint line_link_events_consent_evidence_check
    check (not consent_acknowledged or (consent_version is not null and consent_at is not null))
);

create index if not exists line_link_events_line_user_idx
  on public.line_link_events (line_user_id, created_at desc);
create index if not exists line_link_events_linked_user_idx
  on public.line_link_events (linked_user_id, created_at desc);

alter table public.line_link_events enable row level security;
revoke all on table public.line_link_events from anon, authenticated;
grant select on table public.line_link_events to anon, authenticated;
grant all on table public.line_link_events to service_role;

create or replace function public.capture_line_link_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_actor_type text;
  v_reason text;
begin
  if old.linked_user_id is not distinct from new.linked_user_id then
    return new;
  end if;

  if old.linked_user_id is null then
    v_event_type := 'LINKED';
  elsif new.linked_user_id is null then
    v_event_type := case
      when new.unlinked_reason in ('employee_terminated', 'profile_inactive') then 'AUTO_UNLINKED'
      else 'UNLINKED'
    end;
  else
    v_event_type := 'RELINKED';
  end if;

  v_actor_type := case
    when new.updated_by is null then 'system'
    when new.updated_by = old.linked_user_id or new.updated_by = new.linked_user_id then 'self'
    else 'admin'
  end;
  v_reason := nullif(new.unlinked_reason, '');

  insert into public.line_link_events (
    line_user_id, event_type, previous_linked_user_id, linked_user_id,
    actor_id, actor_type, consent_acknowledged, consent_version, consent_at,
    consent_ip, consent_user_agent, reason
  ) values (
    new.id, v_event_type, old.linked_user_id, new.linked_user_id,
    new.updated_by, v_actor_type, new.link_consent_at is not null,
    new.link_consent_version, new.link_consent_at, new.link_consent_ip,
    new.link_consent_user_agent, v_reason
  );
  return new;
end;
$$;

drop trigger if exists trg_line_users_capture_link_event on public.line_users;
create trigger trg_line_users_capture_link_event
  after update of linked_user_id, linked_at, unlinked_at, unlinked_reason,
    link_consent_version, link_consent_at, link_consent_ip, link_consent_user_agent
  on public.line_users
  for each row execute function public.capture_line_link_event();

create or replace function public.prevent_line_link_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'LINE link events are immutable';
end;
$$;

drop trigger if exists trg_line_link_events_immutable on public.line_link_events;
create trigger trg_line_link_events_immutable
  before update or delete on public.line_link_events
  for each row execute function public.prevent_line_link_event_mutation();

create or replace function public.unlink_line_account_on_profile_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.status = 'inactive' or new.employment_status = 'terminated')
    and not (old.status = 'inactive' or old.employment_status = 'terminated') then
    update public.line_users
    set linked_user_id = null,
        unlinked_at = now(),
        unlinked_reason = 'profile_inactive',
        updated_by = null
    where linked_user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_unlink_line_account on public.profiles;
create trigger trg_profiles_unlink_line_account
  after update of status, employment_status on public.profiles
  for each row execute function public.unlink_line_account_on_profile_lifecycle();

create or replace function public.unlink_line_account_on_employee_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.status = 'inactive' or new.employment_status = 'terminated')
    and not (old.status = 'inactive' or old.employment_status = 'terminated') then
    update public.line_users l
    set linked_user_id = null,
        unlinked_at = now(),
        unlinked_reason = 'employee_terminated',
        updated_by = null
    from public.profiles p
    where p.id = l.linked_user_id
      and p.employee_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_unlink_line_account on public.employees;
create trigger trg_employees_unlink_line_account
  after update of status, employment_status on public.employees
  for each row execute function public.unlink_line_account_on_employee_lifecycle();

revoke all on function public.capture_line_link_event() from public, anon, authenticated;
revoke all on function public.prevent_line_link_event_mutation() from public, anon, authenticated;
revoke all on function public.unlink_line_account_on_profile_lifecycle() from public, anon, authenticated;
revoke all on function public.unlink_line_account_on_employee_lifecycle() from public, anon, authenticated;
grant execute on function public.capture_line_link_event() to service_role;
grant execute on function public.prevent_line_link_event_mutation() to service_role;
grant execute on function public.unlink_line_account_on_profile_lifecycle() to service_role;
grant execute on function public.unlink_line_account_on_employee_lifecycle() to service_role;
