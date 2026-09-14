-- Service Catalog metadata and publish lifecycle
--
-- Additive migration: existing catalog/request records remain valid.  A
-- service request keeps its catalog_version and snapshots, so later catalog
-- edits do not rewrite the meaning of an existing request.

alter table public.service_catalog
  add column if not exists audience text,
  add column if not exists documentation_url text,
  add column if not exists effective_date date not null default current_date,
  add column if not exists review_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.service_catalog'::regclass
      and conname = 'service_catalog_review_date_check'
  ) then
    alter table public.service_catalog
      add constraint service_catalog_review_date_check
      check (review_date is null or review_date >= effective_date);
  end if;
end
$$;

create index if not exists service_catalog_review_date_idx
  on public.service_catalog (review_date);
