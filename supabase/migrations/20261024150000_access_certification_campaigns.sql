-- ============================================================================
-- Access Certification Campaign
--
-- A campaign is an immutable point-in-time access certification exercise.  The
-- registry remains the source of current access; campaign items are the audit
-- evidence and decision ledger for a review round.
-- ============================================================================

create table if not exists public.access_certification_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text not null,
  name text not null,
  system_id uuid references public.access_systems(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  evidence_snapshot jsonb not null default '{}'::jsonb,
  signed_off_by uuid references public.profiles(id) on delete set null,
  signed_off_at timestamptz,
  sign_off_note text,
  escalated_to uuid references public.profiles(id) on delete set null,
  escalated_at timestamptz,
  escalation_count integer not null default 0 check (escalation_count >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_certification_campaigns_code_unique unique (campaign_code)
);

create table if not exists public.access_certification_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.access_certification_campaigns(id) on delete restrict,
  registry_id uuid references public.user_access_registry(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  system_id uuid not null references public.access_systems(id) on delete restrict,
  access_item_id uuid references public.access_control_items(id) on delete set null,
  access_level text,
  permission_actions text[] not null default array[]::text[],
  data_classification text,
  privileged_access boolean not null default false,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  decision_note text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_certification_items_actions_check check (
    permission_actions <@ array['read', 'create', 'update', 'delete', 'approve']::text[]
  ),
  constraint access_certification_items_classification_check check (
    data_classification is null or data_classification in ('ไม่ลับ', 'ลับ', 'ลับมาก')
  )
);

create table if not exists public.access_certification_escalations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.access_certification_campaigns(id) on delete restrict,
  escalated_to uuid references public.profiles(id) on delete set null,
  reason text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists access_certification_campaigns_due_idx
  on public.access_certification_campaigns(status, due_date);
create index if not exists access_certification_campaigns_reviewer_idx
  on public.access_certification_campaigns(reviewer_id, created_at desc);
create index if not exists access_certification_items_campaign_idx
  on public.access_certification_items(campaign_id, status);
create index if not exists access_certification_items_registry_idx
  on public.access_certification_items(registry_id);
create index if not exists access_certification_escalations_campaign_idx
  on public.access_certification_escalations(campaign_id, created_at desc);

drop trigger if exists trg_access_certification_campaigns_set_updated_at on public.access_certification_campaigns;
create trigger trg_access_certification_campaigns_set_updated_at
  before update on public.access_certification_campaigns
  for each row execute function public.set_updated_at();

drop trigger if exists trg_access_certification_items_set_updated_at on public.access_certification_items;
create trigger trg_access_certification_items_set_updated_at
  before update on public.access_certification_items
  for each row execute function public.set_updated_at();

create or replace function public.prevent_access_certification_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.evidence_snapshot is distinct from old.evidence_snapshot then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_access_certification_campaigns_snapshot_guard on public.access_certification_campaigns;
create trigger trg_access_certification_campaigns_snapshot_guard
  before update on public.access_certification_campaigns
  for each row execute function public.prevent_access_certification_snapshot_mutation();

drop trigger if exists trg_access_certification_items_snapshot_guard on public.access_certification_items;
create trigger trg_access_certification_items_snapshot_guard
  before update on public.access_certification_items
  for each row execute function public.prevent_access_certification_snapshot_mutation();

alter table public.access_certification_campaigns enable row level security;
alter table public.access_certification_items enable row level security;
alter table public.access_certification_escalations enable row level security;

drop policy if exists access_certification_campaigns_select on public.access_certification_campaigns;
create policy access_certification_campaigns_select on public.access_certification_campaigns
  for select to authenticated
  using (
    reviewer_id = auth.uid()
    or created_by = auth.uid()
    or public.has_permission('access_registry.manage')
    or public.has_permission('access_registry.review')
    or public.has_permission('audit.view')
  );

drop policy if exists access_certification_items_select on public.access_certification_items;
create policy access_certification_items_select on public.access_certification_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.access_certification_campaigns c
      where c.id = campaign_id
        and (
          c.reviewer_id = auth.uid()
          or c.created_by = auth.uid()
          or public.has_permission('access_registry.manage')
          or public.has_permission('access_registry.review')
          or public.has_permission('audit.view')
        )
    )
  );

drop policy if exists access_certification_escalations_select on public.access_certification_escalations;
create policy access_certification_escalations_select on public.access_certification_escalations
  for select to authenticated
  using (
    exists (
      select 1
      from public.access_certification_campaigns c
      where c.id = campaign_id
        and (
          c.reviewer_id = auth.uid()
          or c.created_by = auth.uid()
          or public.has_permission('access_registry.manage')
          or public.has_permission('access_registry.review')
          or public.has_permission('audit.view')
        )
    )
  );

grant select on public.access_certification_campaigns to authenticated;
grant select on public.access_certification_items to authenticated;
grant select on public.access_certification_escalations to authenticated;

-- All writes below are intentionally RPC-only.  This keeps the snapshot and
-- registry side effects in one transaction instead of exposing raw table writes.
create or replace function public.create_access_certification_campaign(
  p_campaign_code text,
  p_name text,
  p_system_id uuid,
  p_reviewer_id uuid,
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_id uuid;
  snapshot_entries jsonb;
  total_entitlements integer;
  total_users integer;
  system_name text;
  reviewer_name text;
  reviewer_email text;
begin
  if not public.has_permission('access_registry.manage') then
    raise exception using errcode = '42501', message = 'ACCESS_CERTIFICATION_CREATE_FORBIDDEN';
  end if;
  if p_campaign_code is null or length(trim(p_campaign_code)) < 2 then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_CODE_INVALID';
  end if;
  if p_name is null or length(trim(p_name)) < 1 then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_NAME_INVALID';
  end if;
  if p_due_date is null or p_due_date < current_date then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_DUE_DATE_INVALID';
  end if;
  if p_reviewer_id = auth.uid() then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_REVIEWER_SOD_CONFLICT';
  end if;

  select p.full_name, p.email
    into reviewer_name, reviewer_email
  from public.profiles p
  where p.id = p_reviewer_id and p.status = 'active';
  if reviewer_name is null then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_REVIEWER_INVALID';
  end if;

  if p_system_id is not null then
    select s.name into system_name
    from public.access_systems s
    where s.id = p_system_id and s.status = 'active';
    if system_name is null then
      raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_SYSTEM_INVALID';
    end if;
  end if;

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'registryId', r.id,
        'userId', r.user_id,
        'userName', coalesce(u.full_name, ''),
        'userEmail', coalesce(u.email, ''),
        'systemId', r.system_id,
        'systemName', coalesce(s.name, ''),
        'accessItemId', r.access_item_id,
        'accessItemKind', ci.kind,
        'accessItemCode', ci.code,
        'accessItemName', ci.name,
        'accessLevel', r.access_level,
        'permissionActions', r.permission_actions,
        'dataClassification', r.data_classification,
        'privilegedAccess', r.privileged_access,
        'lifecycleEvent', r.lifecycle_event,
        'grantDate', r.grant_date,
        'nextReviewDue', r.next_review_due,
        'registryStatus', r.status
      ) order by r.created_at, r.id
    ), '[]'::jsonb),
    count(*)::integer,
    count(distinct r.user_id)::integer
    into snapshot_entries, total_entitlements, total_users
  from public.user_access_registry r
  left join public.profiles u on u.id = r.user_id
  left join public.access_systems s on s.id = r.system_id
  left join public.access_control_items ci on ci.id = r.access_item_id
  where r.status in ('active', 'scheduled')
    and (p_system_id is null or r.system_id = p_system_id);

  if total_entitlements = 0 then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_EMPTY_SCOPE';
  end if;

  insert into public.access_certification_campaigns (
    campaign_code, name, system_id, reviewer_id, due_date, evidence_snapshot, created_by
  ) values (
    upper(trim(p_campaign_code)), trim(p_name), p_system_id, p_reviewer_id, p_due_date,
    jsonb_build_object(
      'capturedAt', now(),
      'campaignCode', upper(trim(p_campaign_code)),
      'name', trim(p_name),
      'systemId', p_system_id,
      'systemName', system_name,
      'reviewerId', p_reviewer_id,
      'reviewerName', reviewer_name,
      'reviewerEmail', reviewer_email,
      'totalUsers', total_users,
      'totalEntitlements', total_entitlements,
      'entries', snapshot_entries
    ),
    auth.uid()
  ) returning id into campaign_id;

  insert into public.access_certification_items (
    campaign_id, registry_id, user_id, system_id, access_item_id, access_level,
    permission_actions, data_classification, privileged_access, evidence_snapshot
  )
  select
    campaign_id,
    r.id,
    r.user_id,
    r.system_id,
    r.access_item_id,
    r.access_level,
    r.permission_actions,
    r.data_classification,
    r.privileged_access,
    jsonb_build_object(
      'registryId', r.id,
      'userId', r.user_id,
      'userName', coalesce(u.full_name, ''),
      'userEmail', coalesce(u.email, ''),
      'systemId', r.system_id,
      'systemName', coalesce(s.name, ''),
      'accessItemId', r.access_item_id,
      'accessItemKind', ci.kind,
      'accessItemCode', ci.code,
      'accessItemName', ci.name,
      'accessLevel', r.access_level,
      'permissionActions', r.permission_actions,
      'dataClassification', r.data_classification,
      'privilegedAccess', r.privileged_access,
      'lifecycleEvent', r.lifecycle_event,
      'grantDate', r.grant_date,
      'nextReviewDue', r.next_review_due,
      'registryStatus', r.status
    )
  from public.user_access_registry r
  left join public.profiles u on u.id = r.user_id
  left join public.access_systems s on s.id = r.system_id
  left join public.access_control_items ci on ci.id = r.access_item_id
  where r.status in ('active', 'scheduled')
    and (p_system_id is null or r.system_id = p_system_id);

  return campaign_id;
end;
$$;

create or replace function public.decide_access_certification_items(
  p_campaign_id uuid,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_row record;
  decision_row record;
  item_row record;
  registry_row record;
  pending_count integer;
  approved_count integer := 0;
  revoked_count integer := 0;
begin
  if not (public.has_permission('access_registry.manage') or public.has_permission('access_registry.review')) then
    raise exception using errcode = '42501', message = 'ACCESS_CERTIFICATION_DECISION_FORBIDDEN';
  end if;
  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_DECISIONS_EMPTY';
  end if;

  select id, reviewer_id, status
    into campaign_row
  from public.access_certification_campaigns
  where id = p_campaign_id
  for update;
  if campaign_row.id is null then
    raise exception using errcode = 'P0002', message = 'ACCESS_CERTIFICATION_NOT_FOUND';
  end if;
  if campaign_row.status <> 'open' then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_NOT_OPEN';
  end if;
  if campaign_row.reviewer_id <> auth.uid() and not public.has_permission('access_registry.manage') then
    raise exception using errcode = '42501', message = 'ACCESS_CERTIFICATION_REVIEWER_ONLY';
  end if;

  for decision_row in
    select * from jsonb_to_recordset(p_decisions)
      as d(item_id uuid, decision_status text, decision_note text)
  loop
    if decision_row.decision_status not in ('approved', 'revoked') then
      raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_DECISION_INVALID';
    end if;

    select id, registry_id, status
      into item_row
    from public.access_certification_items
    where id = decision_row.item_id and campaign_id = p_campaign_id
    for update;
    if item_row.id is null then
      raise exception using errcode = 'P0002', message = 'ACCESS_CERTIFICATION_ITEM_NOT_FOUND';
    end if;
    if item_row.status <> 'pending' then
      raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_ITEM_ALREADY_DECIDED';
    end if;

    select id, status, expires_at
      into registry_row
    from public.user_access_registry
    where id = item_row.registry_id
    for update;
    if registry_row.id is null or registry_row.status not in ('active', 'scheduled') then
      raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_REGISTRY_CHANGED';
    end if;

    update public.access_certification_items
    set status = decision_row.decision_status,
        decision_note = nullif(trim(decision_row.decision_note), ''),
        decided_by = auth.uid(),
        decided_at = now()
    where id = item_row.id;

    if decision_row.decision_status = 'approved' then
      update public.user_access_registry r
      set last_review_date = now(),
          next_review_due = case
            when r.expires_at is not null and r.expires_at < now() + interval '180 days' then r.expires_at
            else now() + interval '180 days'
          end,
          updated_by = auth.uid()
      where r.id = registry_row.id;
      approved_count := approved_count + 1;
    else
      update public.user_access_registry r
      set status = 'revoked',
          notes = coalesce(nullif(r.notes, ''), '')
            || case when nullif(r.notes, '') is null then '' else ' · ' end
            || 'Access Certification: '
            || coalesce(nullif(trim(decision_row.decision_note), ''), 'เพิกถอนจากรอบทบทวน'),
          updated_by = auth.uid()
      where r.id = registry_row.id;
      revoked_count := revoked_count + 1;
    end if;
  end loop;

  select count(*)::integer into pending_count
  from public.access_certification_items
  where campaign_id = p_campaign_id and status = 'pending';

  return jsonb_build_object(
    'campaignId', p_campaign_id,
    'approvedCount', approved_count,
    'revokedCount', revoked_count,
    'pendingCount', pending_count
  );
end;
$$;

create or replace function public.sign_off_access_certification_campaign(
  p_campaign_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_row record;
  pending_count integer;
begin
  if not (public.has_permission('access_registry.manage') or public.has_permission('access_registry.review')) then
    raise exception using errcode = '42501', message = 'ACCESS_CERTIFICATION_SIGNOFF_FORBIDDEN';
  end if;

  select id, reviewer_id, status
    into campaign_row
  from public.access_certification_campaigns
  where id = p_campaign_id
  for update;
  if campaign_row.id is null then
    raise exception using errcode = 'P0002', message = 'ACCESS_CERTIFICATION_NOT_FOUND';
  end if;
  if campaign_row.status <> 'open' then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_NOT_OPEN';
  end if;
  if campaign_row.reviewer_id <> auth.uid() and not public.has_permission('access_registry.manage') then
    raise exception using errcode = '42501', message = 'ACCESS_CERTIFICATION_REVIEWER_ONLY';
  end if;

  select count(*)::integer into pending_count
  from public.access_certification_items
  where campaign_id = p_campaign_id and status = 'pending';
  if pending_count > 0 then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_PENDING_ITEMS';
  end if;

  update public.access_certification_campaigns
  set status = 'completed',
      signed_off_by = auth.uid(),
      signed_off_at = now(),
      sign_off_note = nullif(trim(p_note), '')
  where id = p_campaign_id;

  return jsonb_build_object('campaignId', p_campaign_id, 'status', 'completed', 'pendingCount', pending_count);
end;
$$;

create or replace function public.escalate_access_certification_campaign(
  p_campaign_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_row record;
  escalation_id uuid;
begin
  if not public.has_permission('access_registry.manage') then
    raise exception using errcode = '42501', message = 'ACCESS_CERTIFICATION_ESCALATION_FORBIDDEN';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_ESCALATION_REASON_INVALID';
  end if;

  select id, reviewer_id, due_date, status
    into campaign_row
  from public.access_certification_campaigns
  where id = p_campaign_id
  for update;
  if campaign_row.id is null then
    raise exception using errcode = 'P0002', message = 'ACCESS_CERTIFICATION_NOT_FOUND';
  end if;
  if campaign_row.status <> 'open' then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_NOT_OPEN';
  end if;
  if campaign_row.due_date >= current_date then
    raise exception using errcode = '23514', message = 'ACCESS_CERTIFICATION_NOT_OVERDUE';
  end if;

  insert into public.access_certification_escalations (campaign_id, escalated_to, reason, created_by)
  values (p_campaign_id, campaign_row.reviewer_id, trim(p_reason), auth.uid())
  returning id into escalation_id;

  update public.access_certification_campaigns
  set escalated_to = campaign_row.reviewer_id,
      escalated_at = now(),
      escalation_count = escalation_count + 1
  where id = p_campaign_id;

  return jsonb_build_object(
    'campaignId', p_campaign_id,
    'escalationId', escalation_id,
    'reviewerId', campaign_row.reviewer_id,
    'escalatedAt', now()
  );
end;
$$;

revoke all on function public.prevent_access_certification_snapshot_mutation() from public, anon, authenticated;
revoke all on function public.create_access_certification_campaign(text, text, uuid, uuid, date) from public, anon;
revoke all on function public.decide_access_certification_items(uuid, jsonb) from public, anon;
revoke all on function public.sign_off_access_certification_campaign(uuid, text) from public, anon;
revoke all on function public.escalate_access_certification_campaign(uuid, text) from public, anon;
grant execute on function public.create_access_certification_campaign(text, text, uuid, uuid, date) to authenticated;
grant execute on function public.decide_access_certification_items(uuid, jsonb) to authenticated;
grant execute on function public.sign_off_access_certification_campaign(uuid, text) to authenticated;
grant execute on function public.escalate_access_certification_campaign(uuid, text) to authenticated;

-- The audit trigger exists in 20260915130000_sensitive_change_audit.sql.
drop trigger if exists trg_access_certification_campaigns_atomic_audit on public.access_certification_campaigns;
create trigger trg_access_certification_campaigns_atomic_audit
  after insert or update on public.access_certification_campaigns
  for each row execute function public.audit_sensitive_table_change();

drop trigger if exists trg_access_certification_items_atomic_audit on public.access_certification_items;
create trigger trg_access_certification_items_atomic_audit
  after insert or update on public.access_certification_items
  for each row execute function public.audit_sensitive_table_change();

drop trigger if exists trg_access_certification_escalations_atomic_audit on public.access_certification_escalations;
create trigger trg_access_certification_escalations_atomic_audit
  after insert on public.access_certification_escalations
  for each row execute function public.audit_sensitive_table_change();

comment on table public.access_certification_campaigns is
  'Immutable point-in-time access certification campaigns for audit and sign-off.';
comment on column public.access_certification_campaigns.evidence_snapshot is
  'Point-in-time registry evidence captured when the campaign is created; immutable.';
comment on table public.access_certification_items is
  'Per-entitlement certification decisions linked to an immutable evidence snapshot.';
