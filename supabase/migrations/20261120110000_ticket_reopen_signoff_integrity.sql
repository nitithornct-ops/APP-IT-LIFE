-- Reopening a Ticket starts a new SLA round and must not reuse the prior
-- requester evaluation or signature. The old evidence remains auditable.

create table public.ticket_signoff_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  source_round_no integer not null check (source_round_no > 0),
  status_before_reopen text not null,
  rating smallint,
  rating_details jsonb,
  rating_criteria_snapshot jsonb,
  feedback text,
  feedback_at timestamptz,
  requester_signature_storage_path text,
  requester_signature_uploaded_by uuid references public.profiles(id) on delete set null,
  requester_signature_uploaded_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  archived_line_user_id uuid references public.line_users(id) on delete set null,
  source_channel text not null check (source_channel in ('staff', 'web', 'line')),
  archived_at timestamptz not null default now(),
  unique (ticket_id, source_round_no)
);

create index ticket_signoff_history_ticket_idx
  on public.ticket_signoff_history (ticket_id, source_round_no desc);

alter table public.ticket_signoff_history enable row level security;
create policy ticket_signoff_history_select_participant_or_staff
  on public.ticket_signoff_history for select to authenticated
  using (
    exists (
      select 1
      from public.tickets ticket
      where ticket.id = ticket_signoff_history.ticket_id
        and (
          ticket.requester_id = auth.uid()
          or ticket.assignee_id = auth.uid()
          or public.has_permission('ticket.view')
        )
    )
  );
revoke insert, update, delete on public.ticket_signoff_history from public, anon, authenticated;
grant select on public.ticket_signoff_history to authenticated;
grant all on public.ticket_signoff_history to service_role;

-- The archive trigger clears the current sign-off in the same UPDATE that
-- starts a new work round. The legacy feedback guard must recognize that
-- narrow, database-controlled reset as a workflow operation rather than as a
-- requester attempting to edit an immutable evaluation.
create or replace function public.enforce_ticket_feedback_after_close()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if old.status in ('เสร็จสิ้น', 'ปิดงาน')
     and new.status = 'กำลังดำเนินการ' then
    return new;
  end if;

  if new.rating is distinct from old.rating
     or new.rating_details is distinct from old.rating_details
     or new.feedback is distinct from old.feedback
     or new.feedback_at is distinct from old.feedback_at then
    if actor_id is not null and actor_id <> old.requester_id then
      raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ประเมินความพึงพอใจได้';
    end if;
    if not (
      old.status = 'ปิดงาน'
      or (old.status = 'เสร็จสิ้น' and new.status = 'ปิดงาน')
    ) then
      raise exception 'ประเมินความพึงพอใจได้หลังปิดงาน Ticket แล้วเท่านั้น';
    end if;
    if old.feedback_at is not null then
      raise exception 'ไม่สามารถแก้ไขแบบประเมินที่ส่งแล้วได้';
    end if;
    if new.rating_details is not null
       and not public.is_valid_ticket_rating_details(new.rating_details) then
      raise exception 'คะแนนรายหัวข้อต้องครบทุกข้อและอยู่ระหว่าง 1-5';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.archive_ticket_signoff(
  ticket_id_input uuid,
  source_round_no_input integer,
  status_before_reopen_input text,
  rating_input smallint,
  rating_details_input jsonb,
  rating_criteria_snapshot_input jsonb,
  feedback_input text,
  feedback_at_input timestamptz,
  signature_path_input text,
  signature_uploaded_by_input uuid,
  signature_uploaded_at_input timestamptz,
  archived_by_input uuid,
  archived_line_user_id_input uuid,
  source_channel_input text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if rating_input is null
     and rating_details_input is null
     and rating_criteria_snapshot_input is null
     and feedback_input is null
     and feedback_at_input is null
     and signature_path_input is null
     and signature_uploaded_by_input is null
     and signature_uploaded_at_input is null then
    return;
  end if;

  insert into public.ticket_signoff_history (
    ticket_id, source_round_no, status_before_reopen,
    rating, rating_details, rating_criteria_snapshot, feedback, feedback_at,
    requester_signature_storage_path, requester_signature_uploaded_by,
    requester_signature_uploaded_at, archived_by, archived_line_user_id,
    source_channel
  ) values (
    ticket_id_input, source_round_no_input, status_before_reopen_input,
    rating_input, rating_details_input, rating_criteria_snapshot_input, feedback_input, feedback_at_input,
    signature_path_input, signature_uploaded_by_input,
    signature_uploaded_at_input, archived_by_input, archived_line_user_id_input,
    source_channel_input
  ) on conflict (ticket_id, source_round_no) do nothing;
end;
$$;

revoke all on function public.archive_ticket_signoff(uuid, integer, text, smallint, jsonb, jsonb, text, timestamptz, text, uuid, timestamptz, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.archive_ticket_signoff(uuid, integer, text, smallint, jsonb, jsonb, text, timestamptz, text, uuid, timestamptz, uuid, uuid, text) to service_role;

create or replace function public.archive_and_reset_ticket_signoff_on_reopen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_round_no integer;
  actor_id_value uuid;
  channel_value text;
begin
  if old.status in ('เสร็จสิ้น', 'ปิดงาน') and new.status = 'กำลังดำเนินการ' then
    select coalesce(max(round_no), 1)
      into source_round_no
      from public.ticket_sla_rounds
     where ticket_id = old.id;

    actor_id_value := coalesce(new.updated_by, auth.uid());
    channel_value := case
      when old.source_channel = 'line' then 'line'
      when actor_id_value is not null and actor_id_value = old.requester_id then 'web'
      else 'staff'
    end;

    perform public.archive_ticket_signoff(
      old.id,
      source_round_no,
      old.status,
      old.rating,
      old.rating_details,
      old.rating_criteria_snapshot,
      old.feedback,
      old.feedback_at,
      old.requester_signature_storage_path,
      old.requester_signature_uploaded_by,
      old.requester_signature_uploaded_at,
      actor_id_value,
      old.requester_line_user_id,
      channel_value
    );

    new.rating := null;
    new.rating_details := null;
    new.rating_criteria_snapshot := null;
    new.feedback := null;
    new.feedback_at := null;
    new.requester_signature_storage_path := null;
    new.requester_signature_uploaded_by := null;
    new.requester_signature_uploaded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tickets_archive_signoff_on_reopen on public.tickets;
drop trigger if exists trg_zz_tickets_archive_signoff_on_reopen on public.tickets;
-- PostgreSQL fires same-timing triggers by name. Keep this reset after the
-- existing feedback/transition guards so those guards see the original row;
-- the returned NEW row is still cleared before it is written.
create trigger trg_zz_tickets_archive_signoff_on_reopen
  before update on public.tickets
  for each row execute function public.archive_and_reset_ticket_signoff_on_reopen();

revoke all on function public.archive_and_reset_ticket_signoff_on_reopen() from public, anon, authenticated;
grant execute on function public.archive_and_reset_ticket_signoff_on_reopen() to service_role;

comment on table public.ticket_signoff_history is
  'Immutable audit snapshot of requester sign-off evidence archived before a Ticket starts a new reopen round.';
