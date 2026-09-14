-- Unified My Work state is user-scoped UI state, not a replacement for module records.

create table public.my_work_snoozes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_key text not null check (char_length(work_key) between 3 and 180),
  snoozed_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_key)
);

create index my_work_snoozes_due_idx on public.my_work_snoozes (user_id, snoozed_until);

create trigger trg_my_work_snoozes_set_updated_at
  before update on public.my_work_snoozes
  for each row execute function public.set_updated_at();

alter table public.my_work_snoozes enable row level security;

create policy my_work_snoozes_all_own on public.my_work_snoozes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.my_work_saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  scope text not null default 'all' check (scope in ('all', 'approval', 'assigned', 'personal', 'overdue')),
  source_kind text,
  sort_by text not null default 'risk_sla_due' check (sort_by in ('risk_sla_due', 'due_date')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint my_work_saved_views_name_unique unique (user_id, name)
);

create index my_work_saved_views_user_idx on public.my_work_saved_views (user_id, updated_at desc);

create trigger trg_my_work_saved_views_set_updated_at
  before update on public.my_work_saved_views
  for each row execute function public.set_updated_at();

alter table public.my_work_saved_views enable row level security;

create policy my_work_saved_views_all_own on public.my_work_saved_views
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
