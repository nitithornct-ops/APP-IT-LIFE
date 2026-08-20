-- Dynamic service-rating criteria plus one administrator-managed PNG signature per Ticket.

create table public.ticket_rating_criteria (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[A-Za-z][A-Za-z0-9_]{2,63}$'),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  description text check (description is null or char_length(description) <= 500),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ticket_rating_criteria_label_unique
  on public.ticket_rating_criteria (lower(btrim(label)));
create index ticket_rating_criteria_order_idx
  on public.ticket_rating_criteria (status, sort_order, created_at);

insert into public.ticket_rating_criteria (key, label, sort_order)
values
  ('responsiveness', 'ความรวดเร็ว', 10),
  ('workQuality', 'คุณภาพงานซ่อม', 20),
  ('serviceManners', 'การบริการและมารยาท', 30),
  ('expertise', 'ความรู้ความสามารถ', 40),
  ('communication', 'การสื่อสารและแจ้งความคืบหน้า', 50)
on conflict (key) do update set
  label = excluded.label,
  sort_order = excluded.sort_order;

alter table public.ticket_rating_criteria enable row level security;

create policy ticket_rating_criteria_select_authenticated
  on public.ticket_rating_criteria for select to authenticated using (true);
create policy ticket_rating_criteria_manage
  on public.ticket_rating_criteria for all to authenticated
  using (public.has_permission('setting.manage'))
  with check (public.has_permission('setting.manage'));

alter table public.tickets
  add column rating_criteria_snapshot jsonb,
  add column signature_storage_path text,
  add column signature_uploaded_by uuid references public.profiles(id),
  add column signature_uploaded_at timestamptz;

alter table public.tickets drop constraint if exists tickets_rating_details_valid;

create or replace function public.is_valid_ticket_rating_details(details jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  item record;
  rating_value numeric;
  item_count integer;
begin
  if details is null then
    return true;
  end if;
  if jsonb_typeof(details) <> 'object' then
    return false;
  end if;
  select count(*)::integer into item_count from jsonb_each(details);
  if item_count < 1 or item_count > 20 then return false; end if;
  for item in select key, value from jsonb_each(details) loop
    if item.key !~ '^[A-Za-z][A-Za-z0-9_]{2,63}$'
       or jsonb_typeof(item.value) <> 'number' then
      return false;
    end if;
    rating_value := item.value::text::numeric;
    if rating_value < 1 or rating_value > 5 or rating_value <> trunc(rating_value) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.tickets
  add constraint tickets_rating_details_valid
  check (public.is_valid_ticket_rating_details(rating_details));

insert into storage.buckets (id, name, public, file_size_limit)
values ('ticket-signatures', 'ticket-signatures', false, 2097152)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

comment on table public.ticket_rating_criteria is 'Administrator-managed service-rating topics used for future Ticket feedback.';
comment on column public.tickets.rating_criteria_snapshot is 'Labels and scores captured when feedback is submitted so historical results do not change after criteria edits.';
comment on column public.tickets.signature_storage_path is 'Private Storage path for the administrator-uploaded PNG signature shown on this Ticket.';
