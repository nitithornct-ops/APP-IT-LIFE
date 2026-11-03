create table public.service_request_automation_jobs (
  request_id uuid primary key references public.service_requests(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','COMPLETED','DEAD')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz default now(),
  claim_token uuid,
  lease_until timestamptz,
  last_reason text,
  updated_at timestamptz not null default now()
);
create index service_automation_due_idx on public.service_request_automation_jobs(next_attempt_at, request_id) where status in ('PENDING','PROCESSING');
alter table public.service_request_automation_jobs enable row level security;
create policy require_active_verified_session on public.service_request_automation_jobs as restrictive for all to authenticated
  using ((select app_private.session_is_allowed())) with check ((select app_private.session_is_allowed()));
create policy service_automation_read on public.service_request_automation_jobs for select to authenticated
  using (exists(select 1 from public.service_requests r where r.id = request_id));
revoke insert, update, delete on public.service_request_automation_jobs from anon, authenticated;

create function public.track_service_request_automation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
    and new.assignee_id is not distinct from old.assignee_id
    and new.assigned_group_id is not distinct from old.assigned_group_id then return new; end if;
  if new.status = 'รอมอบหมาย' and new.assignee_id is null and new.assigned_group_id is not null then
    insert into public.service_request_automation_jobs(request_id) values(new.id)
    on conflict(request_id) do update set status = 'PENDING', attempt_count = 0, next_attempt_at = now(),
      last_reason = null, claim_token = null, lease_until = null, updated_at = now();
  else
    update public.service_request_automation_jobs set status = 'COMPLETED', next_attempt_at = null, updated_at = now()
      where request_id = new.id and status <> 'PROCESSING';
  end if;
  return new;
end;
$$;
revoke all on function public.track_service_request_automation() from public, anon, authenticated;
create trigger trg_service_request_automation after insert or update of status, assignee_id, assigned_group_id
on public.service_requests for each row execute function public.track_service_request_automation();

insert into public.service_request_automation_jobs(request_id)
  select id from public.service_requests where status = 'รอมอบหมาย' and assignee_id is null and assigned_group_id is not null;

create function public.claim_service_request_automation(p_now timestamptz, p_token uuid, p_limit integer default 100)
returns table(request_id uuid, created_by uuid, requester_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or p_limit not between 1 and 100 then raise exception 'INVALID_AUTOMATION_CLAIM'; end if;
  -- Exhausted abandoned leases must not stay PROCESSING forever.
  update public.service_request_automation_jobs j set status = 'DEAD', next_attempt_at = null,
    claim_token = null, lease_until = null, last_reason = 'LEASE_EXHAUSTED', updated_at = p_now
    where j.status = 'PROCESSING' and j.lease_until <= p_now and j.attempt_count >= 6;
  return query
  with due as (
    select j.request_id from public.service_request_automation_jobs j
    join public.service_requests r on r.id = j.request_id
    where ((j.status = 'PENDING' and j.next_attempt_at <= p_now) or (j.status = 'PROCESSING' and j.lease_until <= p_now))
      and j.attempt_count < 6 and r.status = 'รอมอบหมาย' and r.assignee_id is null and r.assigned_group_id is not null
    order by j.next_attempt_at, j.request_id for update of j skip locked limit p_limit
  ), claimed as (
    update public.service_request_automation_jobs j set status = 'PROCESSING', attempt_count = j.attempt_count + 1,
      claim_token = p_token, lease_until = p_now + interval '10 minutes', updated_at = p_now
    from due where j.request_id = due.request_id returning j.request_id
  ) select r.id, r.created_by, r.requester_id from claimed c join public.service_requests r on r.id = c.request_id;
end;
$$;

create function public.finish_service_request_automation(p_request uuid, p_token uuid, p_now timestamptz, p_success boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.service_request_automation_jobs j set
    status = case when p_success then 'COMPLETED' when j.attempt_count >= 6 then 'DEAD' else 'PENDING' end,
    next_attempt_at = case when p_success or j.attempt_count >= 6 then null
      else p_now + make_interval(secs => least(3600, 60 * power(2, greatest(0, j.attempt_count - 1)))::integer) end,
    last_reason = case when p_success then null else left(coalesce(p_reason, 'AUTOMATION_FAILED'), 200) end,
    claim_token = null, lease_until = null, updated_at = p_now
  where j.request_id = p_request and j.claim_token = p_token and j.status = 'PROCESSING' and j.lease_until > p_now;
  return found;
end;
$$;

create function public.retry_service_request_automation(p_request uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  -- This RPC is service-only; the API must check permission and row visibility.
  update public.service_request_automation_jobs set status = 'PENDING', attempt_count = 0, next_attempt_at = now(),
    last_reason = null, claim_token = null, lease_until = null, updated_at = now()
  where request_id = p_request and status in ('PENDING','DEAD')
    and exists(select 1 from public.service_requests r where r.id = p_request and r.status = 'รอมอบหมาย' and r.assignee_id is null and r.assigned_group_id is not null);
  return found;
end;
$$;
revoke all on function public.claim_service_request_automation(timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_service_request_automation(uuid,uuid,timestamptz,boolean,text) from public, anon, authenticated;
revoke all on function public.retry_service_request_automation(uuid) from public, anon, authenticated;
grant execute on function public.claim_service_request_automation(timestamptz,uuid,integer) to service_role;
grant execute on function public.finish_service_request_automation(uuid,uuid,timestamptz,boolean,text) to service_role;
grant execute on function public.retry_service_request_automation(uuid) to service_role;
