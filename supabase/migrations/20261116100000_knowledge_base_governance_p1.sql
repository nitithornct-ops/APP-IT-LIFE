-- Knowledge Base P1: governance, taxonomy, relationships and guided self-service.
-- The legacy category_id is intentionally retained as a compatibility column;
-- taxonomy_id is the new source of truth for Knowledge Base categorisation.

create table if not exists public.knowledge_taxonomies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^KT-[A-Z0-9][A-Z0-9_-]{1,49}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  parent_id uuid references public.knowledge_taxonomies(id) on delete set null,
  sort_order integer not null default 100 check (sort_order >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  effective_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint knowledge_taxonomies_not_self_parent check (parent_id is null or parent_id <> id)
);

create index if not exists knowledge_taxonomies_parent_status_idx
  on public.knowledge_taxonomies(parent_id, status, sort_order, name);

create trigger trg_knowledge_taxonomies_set_updated_at
  before update on public.knowledge_taxonomies
  for each row execute function public.set_updated_at();

-- Give existing Ticket categories a stable taxonomy counterpart. Existing
-- articles are mapped below, while the old FK remains readable by old clients.
insert into public.knowledge_taxonomies (code, name, sort_order, status, effective_date)
select 'KT-' || upper(substr(replace(tc.id::text, '-', ''), 1, 12)), tc.name,
       coalesce(tc.sort_order, 100), tc.status, current_date
from public.ticket_categories tc
where not exists (
  select 1 from public.knowledge_taxonomies kt
  where kt.code = 'KT-' || upper(substr(replace(tc.id::text, '-', ''), 1, 12))
);

alter table public.knowledge_articles
  add column if not exists taxonomy_id uuid references public.knowledge_taxonomies(id) on delete set null,
  add column if not exists article_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists reviewer_id uuid references public.profiles(id) on delete set null,
  add column if not exists review_due_date date,
  add column if not exists expiry_date date,
  add column if not exists version_number integer not null default 1 check (version_number > 0),
  add column if not exists is_deprecated boolean not null default false,
  add column if not exists deprecated_at timestamptz,
  add column if not exists deprecated_reason text,
  add column if not exists search_rank integer not null default 0 check (search_rank between 0 and 1000),
  add column if not exists synonyms text[] not null default '{}',
  add column if not exists last_change_note text,
  add column if not exists not_helpful_count integer not null default 0 check (not_helpful_count >= 0);

update public.knowledge_articles article
set taxonomy_id = taxonomy.id
from public.ticket_categories ticket_category
join public.knowledge_taxonomies taxonomy
  on taxonomy.code = 'KT-' || upper(substr(replace(ticket_category.id::text, '-', ''), 1, 12))
where article.category_id = ticket_category.id
  and article.taxonomy_id is null;

update public.knowledge_articles
set article_owner_id = author_id
where article_owner_id is null;

alter table public.knowledge_articles
  add constraint knowledge_articles_synonyms_limit
    check (cardinality(synonyms) <= 30),
  add constraint knowledge_articles_deprecated_consistent
    check (
      (not is_deprecated and deprecated_at is null)
      or (is_deprecated and deprecated_at is not null)
    ),
  add constraint knowledge_articles_deprecated_reason_required
    check (not is_deprecated or nullif(btrim(deprecated_reason), '') is not null),
  add constraint knowledge_articles_deprecated_must_be_draft
    check (not is_deprecated or status = 'ร่าง');

create index if not exists knowledge_articles_taxonomy_idx on public.knowledge_articles(taxonomy_id);
create index if not exists knowledge_articles_owner_idx on public.knowledge_articles(article_owner_id);
create index if not exists knowledge_articles_reviewer_due_idx
  on public.knowledge_articles(reviewer_id, review_due_date)
  where review_due_date is not null;
create index if not exists knowledge_articles_expiry_idx
  on public.knowledge_articles(expiry_date)
  where expiry_date is not null;
create index if not exists knowledge_articles_rank_idx
  on public.knowledge_articles(search_rank desc, views_count desc);
create index if not exists knowledge_articles_synonyms_idx
  on public.knowledge_articles using gin(synonyms);

-- Version snapshots contain the article content and governance metadata. The
-- current row remains the fast read path; this table is the immutable audit
-- trail users see as Version History.
create table if not exists public.knowledge_article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  title text not null,
  taxonomy_id uuid references public.knowledge_taxonomies(id) on delete set null,
  symptom text,
  solution text not null,
  tags text[] not null default '{}',
  synonyms text[] not null default '{}',
  status text not null check (status in ('เผยแพร่', 'ร่าง')),
  is_deprecated boolean not null default false,
  review_due_date date,
  expiry_date date,
  search_rank integer not null default 0,
  article_owner_id uuid references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  change_note text,
  snapshot_by uuid references auth.users(id) on delete set null,
  snapshot_at timestamptz not null default now(),
  constraint knowledge_article_versions_unique unique (article_id, version_number)
);

create index if not exists knowledge_article_versions_article_idx
  on public.knowledge_article_versions(article_id, version_number desc);

insert into public.knowledge_article_versions (
  article_id, version_number, title, taxonomy_id, symptom, solution, tags,
  synonyms, status, is_deprecated, review_due_date, expiry_date, search_rank,
  article_owner_id, reviewer_id, change_note, snapshot_by, snapshot_at
)
select id, version_number, title, taxonomy_id, symptom, solution, tags,
       synonyms, status, is_deprecated, review_due_date, expiry_date, search_rank,
       article_owner_id, reviewer_id, 'Initial version', created_by, created_at
from public.knowledge_articles article
where not exists (
  select 1 from public.knowledge_article_versions version
  where version.article_id = article.id
    and version.version_number = article.version_number
);

create or replace function public.capture_knowledge_article_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.knowledge_article_versions (
      article_id, version_number, title, taxonomy_id, symptom, solution, tags,
      synonyms, status, is_deprecated, review_due_date, expiry_date, search_rank,
      article_owner_id, reviewer_id, change_note, snapshot_by, snapshot_at
    ) values (
      new.id, new.version_number, new.title, new.taxonomy_id, new.symptom, new.solution, new.tags,
      new.synonyms, new.status, new.is_deprecated, new.review_due_date, new.expiry_date, new.search_rank,
      new.article_owner_id, new.reviewer_id, coalesce(new.last_change_note, 'Initial version'),
      new.updated_by, now()
    ) on conflict (article_id, version_number) do nothing;
    return new;
  end if;

  if old.title is distinct from new.title
     or old.taxonomy_id is distinct from new.taxonomy_id
     or old.symptom is distinct from new.symptom
     or old.solution is distinct from new.solution
     or old.tags is distinct from new.tags
     or old.synonyms is distinct from new.synonyms
     or old.status is distinct from new.status
     or old.is_deprecated is distinct from new.is_deprecated
     or old.review_due_date is distinct from new.review_due_date
     or old.expiry_date is distinct from new.expiry_date
     or old.search_rank is distinct from new.search_rank
     or old.article_owner_id is distinct from new.article_owner_id
     or old.reviewer_id is distinct from new.reviewer_id then
    new.version_number := old.version_number + 1;
    insert into public.knowledge_article_versions (
      article_id, version_number, title, taxonomy_id, symptom, solution, tags,
      synonyms, status, is_deprecated, review_due_date, expiry_date, search_rank,
      article_owner_id, reviewer_id, change_note, snapshot_by, snapshot_at
    ) values (
      new.id, new.version_number, new.title, new.taxonomy_id, new.symptom, new.solution, new.tags,
      new.synonyms, new.status, new.is_deprecated, new.review_due_date, new.expiry_date, new.search_rank,
      new.article_owner_id, new.reviewer_id, coalesce(new.last_change_note, 'Updated article'),
      new.updated_by, now()
    ) on conflict (article_id, version_number) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_knowledge_articles_capture_version on public.knowledge_articles;
drop trigger if exists trg_knowledge_articles_capture_version_insert on public.knowledge_articles;
drop trigger if exists trg_knowledge_articles_capture_version_update on public.knowledge_articles;
-- INSERT must be AFTER the article row exists because the history row has an FK
-- back to it. UPDATE stays BEFORE so the new current version can be assigned.
create trigger trg_knowledge_articles_capture_version_insert
  after insert on public.knowledge_articles
  for each row execute function public.capture_knowledge_article_version();
create trigger trg_knowledge_articles_capture_version_update
  before update on public.knowledge_articles
  for each row execute function public.capture_knowledge_article_version();

-- Cross-module references are many-to-many so one article can document a
-- recurring Incident/Problem and be relevant to more than one Service.
create table if not exists public.knowledge_article_incidents (
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (article_id, incident_id)
);

create table if not exists public.knowledge_article_problems (
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (article_id, problem_id)
);

create table if not exists public.knowledge_article_known_errors (
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  known_error_id uuid not null references public.known_errors(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (article_id, known_error_id)
);

create table if not exists public.knowledge_article_services (
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  service_id uuid not null references public.service_catalog(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (article_id, service_id)
);

create index if not exists knowledge_article_incidents_incident_idx on public.knowledge_article_incidents(incident_id);
create index if not exists knowledge_article_problems_problem_idx on public.knowledge_article_problems(problem_id);
create index if not exists knowledge_article_known_errors_error_idx on public.knowledge_article_known_errors(known_error_id);
create index if not exists knowledge_article_services_service_idx on public.knowledge_article_services(service_id);

create or replace function public.replace_knowledge_article_links(
  article_id_input uuid,
  incident_ids_input uuid[] default '{}',
  problem_ids_input uuid[] default '{}',
  known_error_ids_input uuid[] default '{}',
  service_ids_input uuid[] default '{}',
  actor_id_input uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.knowledge_article_incidents where article_id = article_id_input;
  delete from public.knowledge_article_problems where article_id = article_id_input;
  delete from public.knowledge_article_known_errors where article_id = article_id_input;
  delete from public.knowledge_article_services where article_id = article_id_input;

  insert into public.knowledge_article_incidents(article_id, incident_id, sort_order, created_by)
  select article_id_input, item, row_number() over () - 1, actor_id_input
  from unnest(coalesce(incident_ids_input, '{}')) item;
  insert into public.knowledge_article_problems(article_id, problem_id, sort_order, created_by)
  select article_id_input, item, row_number() over () - 1, actor_id_input
  from unnest(coalesce(problem_ids_input, '{}')) item;
  insert into public.knowledge_article_known_errors(article_id, known_error_id, sort_order, created_by)
  select article_id_input, item, row_number() over () - 1, actor_id_input
  from unnest(coalesce(known_error_ids_input, '{}')) item;
  insert into public.knowledge_article_services(article_id, service_id, sort_order, created_by)
  select article_id_input, item, row_number() over () - 1, actor_id_input
  from unnest(coalesce(service_ids_input, '{}')) item;
end;
$$;

-- Feedback keeps the existing helpful RPC contract and adds a separate
-- not-helpful path that stores a mandatory reason.
alter table public.knowledge_article_feedback
  drop constraint if exists knowledge_article_feedback_helpful_check,
  add column if not exists not_helpful_reason text;

alter table public.knowledge_article_feedback
  add constraint knowledge_article_feedback_reason_check
  check (
    helpful
    or (not_helpful_reason is not null and char_length(btrim(not_helpful_reason)) between 3 and 500)
  );

create or replace function public.mark_knowledge_article_not_helpful(
  article_id_input uuid,
  reason_input text
)
returns table(not_helpful_count integer, already_voted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  affected_rows integer := 0;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  if not public.has_permission('knowledge.feedback') then raise exception 'knowledge.feedback permission required'; end if;
  if reason_input is null or char_length(btrim(reason_input)) < 3 then raise exception 'not-helpful reason is required'; end if;
  if not exists (
    select 1 from public.knowledge_articles
    where id = article_id_input and status = 'เผยแพร่' and not is_deprecated
      and (expiry_date is null or expiry_date >= current_date)
  ) then raise exception 'published knowledge article not found'; end if;

  insert into public.knowledge_article_feedback(article_id, user_id, helpful, not_helpful_reason)
  values (article_id_input, actor_id, false, btrim(reason_input))
  on conflict (article_id, user_id) do nothing;
  get diagnostics affected_rows = row_count;
  if affected_rows = 1 then
    update public.knowledge_articles
    set not_helpful_count = public.knowledge_articles.not_helpful_count + 1
    where public.knowledge_articles.id = article_id_input;
  end if;
  return query
  select article.not_helpful_count, affected_rows = 0
  from public.knowledge_articles article
  where article.id = article_id_input;
end;
$$;

create or replace function public.mark_knowledge_article_helpful(article_id_input uuid)
returns table(helpful_count integer, already_voted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  affected_rows integer := 0;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  if not public.has_permission('knowledge.feedback') then raise exception 'knowledge.feedback permission required'; end if;
  if not exists (
    select 1 from public.knowledge_articles
    where id = article_id_input and status = 'เผยแพร่' and not is_deprecated
      and (expiry_date is null or expiry_date >= current_date)
  ) then raise exception 'published knowledge article not found'; end if;

  insert into public.knowledge_article_feedback(article_id, user_id, helpful, not_helpful_reason)
  values (article_id_input, actor_id, true, null)
  on conflict (article_id, user_id) do nothing;
  get diagnostics affected_rows = row_count;
  if affected_rows = 1 then
    update public.knowledge_articles set helpful_count = public.knowledge_articles.helpful_count + 1 where public.knowledge_articles.id = article_id_input;
  end if;
  return query
  select article.helpful_count, affected_rows = 0
  from public.knowledge_articles article
  where article.id = article_id_input;
end;
$$;

create or replace function public.record_knowledge_article_view(
  article_id_input uuid,
  visitor_hash_input text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  affected_rows integer := 0;
  current_count integer;
begin
  if actor_id is null then
    if visitor_hash_input is null or visitor_hash_input !~ '^[0-9a-f]{64}$' then raise exception 'valid visitor hash is required'; end if;
  elsif not public.has_permission('knowledge.view') then
    raise exception 'knowledge.view permission required';
  end if;
  if not exists (
    select 1 from public.knowledge_articles
    where id = article_id_input and status = 'เผยแพร่' and not is_deprecated
      and (expiry_date is null or expiry_date >= current_date)
  ) then raise exception 'published knowledge article not found'; end if;

  if actor_id is not null then
    insert into public.knowledge_article_views(article_id, viewer_id) values (article_id_input, actor_id)
    on conflict (article_id, viewer_id, viewed_on) where viewer_id is not null do nothing;
  else
    insert into public.knowledge_article_views(article_id, visitor_hash) values (article_id_input, visitor_hash_input)
    on conflict (article_id, visitor_hash, viewed_on) where visitor_hash is not null do nothing;
  end if;
  get diagnostics affected_rows = row_count;
  if affected_rows = 1 then
    update public.knowledge_articles set views_count = views_count + 1 where id = article_id_input returning views_count into current_count;
  else
    select views_count into current_count from public.knowledge_articles where id = article_id_input;
  end if;
  return current_count;
end;
$$;

-- Readers must not discover expired or deprecated content through direct RLS.
drop policy if exists knowledge_articles_select on public.knowledge_articles;
create policy knowledge_articles_select on public.knowledge_articles
  for select to authenticated
  using (
    public.has_permission('knowledge.manage')
    or (
      public.has_permission('knowledge.view')
      and status = 'เผยแพร่'
      and not is_deprecated
      and (expiry_date is null or expiry_date >= current_date)
    )
  );

alter table public.knowledge_taxonomies enable row level security;
alter table public.knowledge_article_versions enable row level security;
alter table public.knowledge_article_incidents enable row level security;
alter table public.knowledge_article_problems enable row level security;
alter table public.knowledge_article_known_errors enable row level security;
alter table public.knowledge_article_services enable row level security;

create policy knowledge_taxonomies_select on public.knowledge_taxonomies
  for select to authenticated
  using (status = 'active' or public.has_permission('knowledge.manage'));
create policy knowledge_taxonomies_write on public.knowledge_taxonomies
  for all to authenticated
  using (public.has_permission('knowledge.manage'))
  with check (public.has_permission('knowledge.manage'));
create policy knowledge_article_versions_select on public.knowledge_article_versions
  for select to authenticated using (public.has_permission('knowledge.manage'));
create policy knowledge_article_incidents_select on public.knowledge_article_incidents
  for select to authenticated using (public.has_permission('knowledge.view'));
create policy knowledge_article_problems_select on public.knowledge_article_problems
  for select to authenticated using (public.has_permission('knowledge.view'));
create policy knowledge_article_known_errors_select on public.knowledge_article_known_errors
  for select to authenticated using (public.has_permission('knowledge.view'));
create policy knowledge_article_services_select on public.knowledge_article_services
  for select to authenticated using (public.has_permission('knowledge.view'));
create policy knowledge_article_links_write on public.knowledge_article_incidents
  for all to authenticated using (public.has_permission('knowledge.manage')) with check (public.has_permission('knowledge.manage'));
create policy knowledge_article_problems_write on public.knowledge_article_problems
  for all to authenticated using (public.has_permission('knowledge.manage')) with check (public.has_permission('knowledge.manage'));
create policy knowledge_article_known_errors_write on public.knowledge_article_known_errors
  for all to authenticated using (public.has_permission('knowledge.manage')) with check (public.has_permission('knowledge.manage'));
create policy knowledge_article_services_write on public.knowledge_article_services
  for all to authenticated using (public.has_permission('knowledge.manage')) with check (public.has_permission('knowledge.manage'));

revoke all on function public.replace_knowledge_article_links(uuid, uuid[], uuid[], uuid[], uuid[], uuid) from public, anon, authenticated;
grant execute on function public.replace_knowledge_article_links(uuid, uuid[], uuid[], uuid[], uuid[], uuid) to service_role;
revoke all on function public.mark_knowledge_article_not_helpful(uuid, text) from public, anon;
grant execute on function public.mark_knowledge_article_not_helpful(uuid, text) to authenticated, service_role;
revoke all on function public.mark_knowledge_article_helpful(uuid) from public, anon;
grant execute on function public.mark_knowledge_article_helpful(uuid) to authenticated, service_role;
revoke all on function public.record_knowledge_article_view(uuid, text) from anon;
grant execute on function public.record_knowledge_article_view(uuid, text) to authenticated, service_role;

comment on column public.knowledge_articles.category_id is 'Legacy compatibility only. Knowledge Base uses taxonomy_id.';
comment on column public.knowledge_articles.taxonomy_id is 'Central Knowledge Taxonomy reference.';
