-- Login broker state is opaque to the browser and single-use at the database boundary.
-- Only the Cloudflare Worker service role can read or mutate these rows.

create table public.login_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_hash text not null unique,
  flow text not null check (flow in ('internal', 'vendor')),
  identifier_hash text not null,
  context_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index login_challenges_expiry_idx on public.login_challenges (expires_at);
create index login_challenges_lookup_idx on public.login_challenges (challenge_hash, flow, identifier_hash, context_hash);

alter table public.login_challenges enable row level security;
revoke all on table public.login_challenges from public, anon, authenticated;
grant all on table public.login_challenges to service_role;

create or replace function public.purge_expired_login_challenges(max_rows_input integer default 100)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.login_challenges
  where id in (
    select id
    from public.login_challenges
    where expires_at <= now()
    order by expires_at
    limit greatest(1, least(coalesce(max_rows_input, 100), 5000))
  );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_login_challenges(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_login_challenges(integer) to service_role;

comment on table public.login_challenges is
  'Hashed, short-lived, one-time login broker challenges. Raw challenge tokens are never persisted.';
