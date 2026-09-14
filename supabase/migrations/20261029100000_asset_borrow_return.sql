-- Asset Borrow / Return register.
-- Keep the legacy assets.loan_* columns as a projection for existing screens, but
-- store the complete custody document here and update both records atomically.

create table if not exists public.asset_loans (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete restrict,
  borrower_employee_id uuid not null references public.employees(id) on delete restrict,
  approver_employee_id uuid not null references public.employees(id) on delete restrict,
  borrowed_at date not null,
  due_at date not null,
  purpose text not null,
  condition_before text not null,
  companion_equipment jsonb not null default '[]'::jsonb,
  borrower_acknowledged boolean not null default false,
  borrower_acknowledged_at timestamptz,
  borrower_acknowledgement_name text,
  reminder_recipient_id uuid references public.profiles(id) on delete set null,
  reminder_days_before smallint not null default 3 check (reminder_days_before between 0 and 30),
  status text not null default 'active' check (status in ('active', 'returned', 'cancelled')),
  returned_at date,
  return_receiver_employee_id uuid references public.employees(id) on delete restrict,
  condition_after text,
  return_outcome text not null default 'good' check (return_outcome in ('good', 'damaged', 'lost')),
  damage_notes text,
  return_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_loans_date_order check (due_at >= borrowed_at),
  constraint asset_loans_companion_array check (jsonb_typeof(companion_equipment) = 'array'),
  constraint asset_loans_acknowledgement_consistency check (
    (borrower_acknowledged = false)
    or (borrower_acknowledged_at is not null and nullif(btrim(coalesce(borrower_acknowledgement_name, '')), '') is not null)
  ),
  constraint asset_loans_return_consistency check (
    (status = 'active' and returned_at is null and return_receiver_employee_id is null)
    or (status = 'returned' and returned_at is not null and return_receiver_employee_id is not null)
    or status = 'cancelled'
  )
);

create index if not exists asset_loans_asset_idx on public.asset_loans (asset_id, borrowed_at desc);
create index if not exists asset_loans_borrower_idx on public.asset_loans (borrower_employee_id, status);
create index if not exists asset_loans_due_idx on public.asset_loans (due_at) where status = 'active';
create unique index if not exists asset_loans_one_active_per_asset_idx
  on public.asset_loans (asset_id) where status = 'active';

drop trigger if exists trg_asset_loans_set_updated_at on public.asset_loans;
create trigger trg_asset_loans_set_updated_at
  before update on public.asset_loans
  for each row execute function public.set_updated_at();

alter table public.asset_loans enable row level security;
drop policy if exists asset_loans_select_with_permission on public.asset_loans;
create policy asset_loans_select_with_permission on public.asset_loans
  for select to authenticated using (public.has_permission('asset.view'));

-- Photo metadata remains in the shared attachment table. The stage makes it
-- possible to distinguish the handover photos from the return photos.
alter table public.file_attachments add column if not exists asset_loan_stage text;
alter table public.file_attachments drop constraint if exists file_attachments_asset_loan_stage_check;
alter table public.file_attachments add constraint file_attachments_asset_loan_stage_check
  check (asset_loan_stage is null or asset_loan_stage in ('before', 'after'));
create index if not exists file_attachments_asset_loan_stage_idx
  on public.file_attachments (target_id, asset_loan_stage)
  where module = 'asset_loan';

create table if not exists public.asset_loan_reminders (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null unique references public.asset_loans(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  remind_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_loan_reminders_due_idx
  on public.asset_loan_reminders (remind_at) where status = 'pending';

drop trigger if exists trg_asset_loan_reminders_set_updated_at on public.asset_loan_reminders;
create trigger trg_asset_loan_reminders_set_updated_at
  before update on public.asset_loan_reminders
  for each row execute function public.set_updated_at();

alter table public.asset_loan_reminders enable row level security;
drop policy if exists asset_loan_reminders_select_with_permission on public.asset_loan_reminders;
create policy asset_loan_reminders_select_with_permission on public.asset_loan_reminders
  for select to authenticated using (public.has_permission('asset.view'));

-- A single database transaction is the source of truth for handover. The API
-- intentionally calls this function instead of issuing separate asset/loan/
-- movement updates, so a concurrent handover cannot create two active owners.
create or replace function public.create_asset_loan(
  p_asset_id uuid,
  p_borrower_employee_id uuid,
  p_approver_employee_id uuid,
  p_borrowed_at date,
  p_due_at date,
  p_purpose text,
  p_condition_before text,
  p_companion_equipment jsonb default '[]'::jsonb,
  p_reminder_days_before integer default 3,
  p_borrower_acknowledged boolean default false,
  p_borrower_acknowledgement_name text default null,
  p_reminder_recipient_id uuid default null,
  p_department_id uuid default null,
  p_location text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset record;
  v_borrower record;
  v_approver record;
  v_loan_id uuid;
  v_department_id uuid;
  v_reminder_recipient_id uuid;
  v_borrower_name text;
begin
  if v_user_id is null or not public.has_permission('asset.transfer') then
    raise exception using errcode = '42501', message = 'ASSET_LOAN_PERMISSION_REQUIRED';
  end if;
  if p_borrowed_at is null or p_due_at is null or p_due_at < p_borrowed_at then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_DATE_RANGE_INVALID';
  end if;
  if nullif(btrim(coalesce(p_purpose, '')), '') is null then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_PURPOSE_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_condition_before, '')), '') is null then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_CONDITION_BEFORE_REQUIRED';
  end if;
  if coalesce(jsonb_typeof(p_companion_equipment), '') <> 'array' then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_COMPANION_EQUIPMENT_INVALID';
  end if;
  if coalesce(p_reminder_days_before, -1) not between 0 and 30 then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_REMINDER_INVALID';
  end if;
  if p_borrower_acknowledged is distinct from true
    or nullif(btrim(coalesce(p_borrower_acknowledgement_name, '')), '') is null then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_ACKNOWLEDGEMENT_REQUIRED';
  end if;

  select * into v_asset
  from public.assets
  where id = p_asset_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ASSET_NOT_FOUND';
  end if;
  if v_asset.status <> 'พร้อมใช้งาน'
    or v_asset.owner_employee_id is not null
    or exists (select 1 from public.asset_loans where asset_id = p_asset_id and status = 'active') then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_AVAILABLE';
  end if;

  select id, department_id, first_name_th, last_name_th into v_borrower
  from public.employees where id = p_borrower_employee_id and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'BORROWER_NOT_FOUND';
  end if;
  select id into v_approver
  from public.employees where id = p_approver_employee_id and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'APPROVER_NOT_FOUND';
  end if;

  v_department_id := coalesce(p_department_id, v_borrower.department_id);
  v_reminder_recipient_id := coalesce(p_reminder_recipient_id, v_user_id);
  v_borrower_name := btrim(concat(v_borrower.first_name_th, ' ', v_borrower.last_name_th));

  insert into public.asset_loans (
    asset_id, borrower_employee_id, approver_employee_id, borrowed_at, due_at,
    purpose, condition_before, companion_equipment, borrower_acknowledged,
    borrower_acknowledged_at, borrower_acknowledgement_name, reminder_recipient_id,
    reminder_days_before, created_by
  ) values (
    p_asset_id, p_borrower_employee_id, p_approver_employee_id, p_borrowed_at, p_due_at,
    btrim(p_purpose), btrim(p_condition_before), coalesce(p_companion_equipment, '[]'::jsonb), true,
    now(), btrim(coalesce(p_borrower_acknowledgement_name, v_borrower_name)),
    v_reminder_recipient_id, p_reminder_days_before, v_user_id
  ) returning id into v_loan_id;

  update public.assets
  set status = 'ใช้งานอยู่',
      lifecycle_status = 'checked_out',
      owner_employee_id = p_borrower_employee_id,
      department_id = v_department_id,
      location = coalesce(nullif(btrim(p_location), ''), v_asset.location),
      loan_date = p_borrowed_at,
      loan_due_date = p_due_at,
      updated_by = v_user_id
  where id = p_asset_id;

  insert into public.asset_movements (
    asset_id, action_type, from_employee_id, to_employee_id, department_id, location,
    status_label, notes, due_date, condition, created_by
  ) values (
    p_asset_id, 'Assign', v_asset.owner_employee_id, p_borrower_employee_id,
    v_department_id, coalesce(nullif(btrim(p_location), ''), v_asset.location),
    'ยืม/ใช้งาน', btrim(p_purpose), p_due_at, btrim(p_condition_before), v_user_id
  );

  insert into public.asset_lifecycle_events (
    asset_id, from_status, to_status, notes, performed_by, metadata
  ) values (
    p_asset_id, coalesce(v_asset.lifecycle_status, 'ready'), 'checked_out',
    btrim(p_purpose), v_user_id, jsonb_build_object('assetLoanId', v_loan_id)
  );

  insert into public.asset_loan_reminders (loan_id, recipient_id, remind_at)
  values (
    v_loan_id,
    v_reminder_recipient_id,
    (((p_due_at - p_reminder_days_before)::timestamp + time '09:00:00') at time zone 'Asia/Bangkok')
  );

  return jsonb_build_object('loan_id', v_loan_id);
end;
$$;

create or replace function public.return_asset_loan(
  p_loan_id uuid,
  p_returned_at date,
  p_return_receiver_employee_id uuid,
  p_condition_after text,
  p_return_outcome text default 'good',
  p_damage_notes text default null,
  p_return_notes text default null,
  p_location text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_loan record;
  v_receiver record;
  v_next_status text;
  v_next_lifecycle text;
  v_location text := coalesce(nullif(btrim(p_location), ''), 'คลัง IT');
begin
  if v_user_id is null or not public.has_permission('asset.transfer') then
    raise exception using errcode = '42501', message = 'ASSET_LOAN_PERMISSION_REQUIRED';
  end if;
  if p_returned_at is null or nullif(btrim(coalesce(p_condition_after, '')), '') is null then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_RETURN_DETAILS_REQUIRED';
  end if;
  if p_return_outcome is null or p_return_outcome not in ('good', 'damaged', 'lost') then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_RETURN_OUTCOME_INVALID';
  end if;
  if p_return_outcome in ('damaged', 'lost')
    and nullif(btrim(coalesce(p_damage_notes, '')), '') is null then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_DAMAGE_DETAILS_REQUIRED';
  end if;

  select l.*, a.asset_code, a.name as asset_name, a.owner_employee_id as asset_owner_employee_id,
    a.lifecycle_status as asset_lifecycle_status
  into v_loan
  from public.asset_loans l
  join public.assets a on a.id = l.asset_id
  where l.id = p_loan_id
  for update of l, a;
  if not found then
    raise exception using errcode = 'P0002', message = 'ASSET_LOAN_NOT_FOUND';
  end if;
  if v_loan.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'ASSET_LOAN_ALREADY_RETURNED';
  end if;
  if p_returned_at < v_loan.borrowed_at then
    raise exception using errcode = '22023', message = 'ASSET_LOAN_RETURN_DATE_INVALID';
  end if;

  select id into v_receiver
  from public.employees where id = p_return_receiver_employee_id and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'RETURN_RECEIVER_NOT_FOUND';
  end if;

  if p_return_outcome = 'good' then
    v_next_status := 'พร้อมใช้งาน';
    v_next_lifecycle := 'returned';
  elsif p_return_outcome = 'damaged' then
    v_next_status := 'ซ่อมบำรุง';
    v_next_lifecycle := 'repair';
  else
    v_next_status := 'สูญหาย';
    v_next_lifecycle := 'disposed';
  end if;

  update public.asset_loans
  set status = 'returned', returned_at = p_returned_at,
      return_receiver_employee_id = p_return_receiver_employee_id,
      condition_after = btrim(p_condition_after), return_outcome = p_return_outcome,
      damage_notes = nullif(btrim(coalesce(p_damage_notes, '')), ''),
      return_notes = nullif(btrim(coalesce(p_return_notes, '')), '')
  where id = p_loan_id;

  update public.assets
  set status = v_next_status, lifecycle_status = v_next_lifecycle,
      owner_employee_id = null, department_id = null, location = v_location,
      loan_date = null, loan_due_date = null, updated_by = v_user_id
  where id = v_loan.asset_id;

  insert into public.asset_movements (
    asset_id, action_type, from_employee_id, to_employee_id, location, status_label,
    notes, due_date, condition, created_by
  ) values (
    v_loan.asset_id, 'Return', v_loan.borrower_employee_id, p_return_receiver_employee_id,
    v_location,
    case p_return_outcome when 'good' then 'คืนแล้ว' when 'damaged' then 'คืนแล้ว / ชำรุด' else 'คืนแล้ว / สูญหาย' end,
    coalesce(nullif(btrim(p_damage_notes), ''), nullif(btrim(p_return_notes), '')),
    v_loan.due_at, btrim(p_condition_after), v_user_id
  );

  insert into public.asset_lifecycle_events (
    asset_id, from_status, to_status, notes, performed_by, metadata
  ) values (
    v_loan.asset_id, coalesce(v_loan.asset_lifecycle_status, 'checked_out'), v_next_lifecycle,
    coalesce(nullif(btrim(p_damage_notes), ''), nullif(btrim(p_return_notes), ''), btrim(p_condition_after)),
    v_user_id, jsonb_build_object('assetLoanId', p_loan_id, 'returnOutcome', p_return_outcome)
  );

  update public.asset_loan_reminders
  set status = 'cancelled'
  where loan_id = p_loan_id and status = 'pending';

  return jsonb_build_object('loan_id', p_loan_id, 'asset_status', v_next_status, 'lifecycle_status', v_next_lifecycle);
end;
$$;

revoke all on function public.create_asset_loan(uuid, uuid, uuid, date, date, text, text, jsonb, integer, boolean, text, uuid, uuid, text) from public, anon;
grant execute on function public.create_asset_loan(uuid, uuid, uuid, date, date, text, text, jsonb, integer, boolean, text, uuid, uuid, text) to authenticated;
revoke all on function public.return_asset_loan(uuid, date, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.return_asset_loan(uuid, date, uuid, text, text, text, text, text) to authenticated;

-- Called only by the scheduled Worker. FOR UPDATE SKIP LOCKED makes overlapping
-- cron runs idempotent and keeps notification delivery in the existing center.
create or replace function public.dispatch_due_asset_loan_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select r.id, r.recipient_id, l.id as loan_id, l.due_at, a.asset_code, a.name as asset_name
    from public.asset_loan_reminders r
    join public.asset_loans l on l.id = r.loan_id
    join public.assets a on a.id = l.asset_id
    where r.status = 'pending' and r.remind_at <= p_now and l.status = 'active'
    order by r.remind_at
    for update of r skip locked
  loop
    insert into public.notifications (recipient_id, type, title, body, link)
    values (
      v_row.recipient_id,
      'asset_loan_reminder',
      'ใกล้ครบกำหนดคืน Asset ' || v_row.asset_code,
      v_row.asset_name || ' · กำหนดคืน ' || to_char(v_row.due_at, 'DD/MM/YYYY'),
      '/asset-borrow'
    );
    update public.asset_loan_reminders
    set status = 'sent', sent_at = p_now
    where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.dispatch_due_asset_loan_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_due_asset_loan_reminders(timestamptz) to service_role;

comment on table public.asset_loans is 'Complete Asset handover/return register with approval, condition evidence and acknowledgement.';
comment on column public.asset_loans.due_at is 'Required return date; overdue is derived when status=active and due_at is before today.';
comment on column public.asset_loans.companion_equipment is 'JSON array of equipment handed over with the asset.';
