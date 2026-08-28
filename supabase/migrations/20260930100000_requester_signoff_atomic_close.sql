-- Requester sign-off now records the evaluation and closes a resolved Ticket
-- in one update. The original feedback guard only accepted evaluations when
-- OLD.status was already closed, so it rejected the atomic RESOLVED -> CLOSED
-- update used by every requester sign-off API.
create or replace function public.enforce_ticket_feedback_after_close()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if new.rating is distinct from old.rating
     or new.rating_details is distinct from old.rating_details
     or new.feedback is distinct from old.feedback
     or new.feedback_at is distinct from old.feedback_at then
    if actor_id is not null and actor_id <> old.requester_id then
      raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ประเมินความพึงพอใจได้';
    end if;

    -- Preserve the legacy after-close feedback path and also allow the new
    -- atomic requester sign-off transition from resolved to closed.
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

comment on function public.enforce_ticket_feedback_after_close() is
  'Guards immutable requester feedback and permits atomic resolved-to-closed requester sign-off.';
