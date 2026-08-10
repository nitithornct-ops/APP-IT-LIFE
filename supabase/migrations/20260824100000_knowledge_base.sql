-- ============================================================================
-- Phase 6 Module 18: Knowledge Base
-- Governed draft/publish lifecycle, daily unique view counters and one helpful
-- vote per authenticated user.
-- ============================================================================

create table public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  article_code text not null unique check (article_code ~ '^KB-[0-9]{8}-[0-9]{4}$'),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  category_id uuid references public.ticket_categories(id) on delete set null,
  symptom text check (symptom is null or char_length(symptom) <= 5000),
  solution text not null check (char_length(btrim(solution)) between 3 and 20000),
  tags text[] not null default '{}',
  status text not null default 'ร่าง' check (status in ('ร่าง', 'เผยแพร่')),
  views_count integer not null default 0 check (views_count >= 0),
  helpful_count integer not null default 0 check (helpful_count >= 0),
  author_id uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz,
  last_reviewed_at timestamptz,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint knowledge_articles_tags_limit check (cardinality(tags) <= 20),
  constraint knowledge_articles_publish_consistent check (
    (status = 'ร่าง' and published_at is null)
    or (status = 'เผยแพร่' and published_at is not null)
  )
);

create table public.knowledge_article_views (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  viewer_id uuid references public.profiles(id) on delete set null,
  visitor_hash text,
  viewed_on date not null default current_date,
  viewed_at timestamptz not null default now(),
  constraint knowledge_article_views_actor check (
    (viewer_id is not null and visitor_hash is null)
    or (viewer_id is null and visitor_hash is not null)
  ),
  constraint knowledge_article_views_hash check (
    visitor_hash is null or visitor_hash ~ '^[0-9a-f]{64}$'
  )
);

create table public.knowledge_article_feedback (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  helpful boolean not null default true check (helpful),
  created_at timestamptz not null default now(),
  constraint knowledge_article_feedback_unique unique (article_id, user_id)
);

create index idx_knowledge_articles_status_views on public.knowledge_articles(status, views_count desc);
create index idx_knowledge_articles_category on public.knowledge_articles(category_id);
create index idx_knowledge_articles_tags on public.knowledge_articles using gin(tags);
create unique index idx_knowledge_articles_legacy on public.knowledge_articles(legacy_id) where legacy_id is not null;
create unique index idx_knowledge_views_user_daily
  on public.knowledge_article_views(article_id, viewer_id, viewed_on)
  where viewer_id is not null;
create unique index idx_knowledge_views_public_daily
  on public.knowledge_article_views(article_id, visitor_hash, viewed_on)
  where visitor_hash is not null;
create index idx_knowledge_feedback_article on public.knowledge_article_feedback(article_id);

create trigger trg_knowledge_articles_set_updated_at
  before update on public.knowledge_articles
  for each row execute function public.set_updated_at();

alter table public.knowledge_articles enable row level security;
alter table public.knowledge_article_views enable row level security;
alter table public.knowledge_article_feedback enable row level security;

create policy knowledge_articles_select on public.knowledge_articles
  for select to authenticated
  using (
    public.has_permission('knowledge.manage')
    or (public.has_permission('knowledge.view') and status = 'เผยแพร่')
  );

create policy knowledge_articles_write on public.knowledge_articles
  for all to authenticated
  using (public.has_permission('knowledge.manage'))
  with check (public.has_permission('knowledge.manage'));

create policy knowledge_article_views_select on public.knowledge_article_views
  for select to authenticated
  using (public.has_permission('knowledge.manage'));

create policy knowledge_article_feedback_select on public.knowledge_article_feedback
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('knowledge.manage'));

create or replace function public.record_knowledge_article_view(
  article_id_input uuid,
  visitor_hash_input text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  affected_rows integer := 0;
  current_count integer;
begin
  if actor_id is null then
    if visitor_hash_input is null or visitor_hash_input !~ '^[0-9a-f]{64}$' then
      raise exception 'valid visitor hash is required';
    end if;
  elsif not public.has_permission('knowledge.view') then
    raise exception 'knowledge.view permission required';
  end if;

  if not exists (
    select 1 from public.knowledge_articles
    where id = article_id_input and status = 'เผยแพร่'
  ) then
    raise exception 'published knowledge article not found';
  end if;

  if actor_id is not null then
    insert into public.knowledge_article_views (article_id, viewer_id)
    values (article_id_input, actor_id)
    on conflict (article_id, viewer_id, viewed_on) where viewer_id is not null
    do nothing;
  else
    insert into public.knowledge_article_views (article_id, visitor_hash)
    values (article_id_input, visitor_hash_input)
    on conflict (article_id, visitor_hash, viewed_on) where visitor_hash is not null
    do nothing;
  end if;

  get diagnostics affected_rows = row_count;

  if affected_rows = 1 then
    update public.knowledge_articles
    set views_count = views_count + 1
    where id = article_id_input
    returning views_count into current_count;
  else
    select views_count into current_count
    from public.knowledge_articles
    where id = article_id_input;
  end if;

  return current_count;
end;
$$;

create or replace function public.mark_knowledge_article_helpful(article_id_input uuid)
returns table(helpful_count integer, already_voted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  affected_rows integer := 0;
begin
  if actor_id is null then
    raise exception 'authentication required';
  end if;
  if not public.has_permission('knowledge.feedback') then
    raise exception 'knowledge.feedback permission required';
  end if;
  if not exists (
    select 1 from public.knowledge_articles
    where id = article_id_input and status = 'เผยแพร่'
  ) then
    raise exception 'published knowledge article not found';
  end if;

  insert into public.knowledge_article_feedback (article_id, user_id, helpful)
  values (article_id_input, actor_id, true)
  on conflict (article_id, user_id) do nothing;

  get diagnostics affected_rows = row_count;

  if affected_rows = 1 then
    update public.knowledge_articles
    set helpful_count = knowledge_articles.helpful_count + 1
    where id = article_id_input;
  end if;

  return query
  select article.helpful_count, affected_rows = 0
  from public.knowledge_articles article
  where article.id = article_id_input;
end;
$$;

revoke all on function public.record_knowledge_article_view(uuid, text) from public;
revoke all on function public.mark_knowledge_article_helpful(uuid) from public;
grant execute on function public.record_knowledge_article_view(uuid, text) to anon, authenticated, service_role;
grant execute on function public.mark_knowledge_article_helpful(uuid) to authenticated, service_role;
