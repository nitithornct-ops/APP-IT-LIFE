-- แบบประเมิน CSAT เปิดได้หลัง Ticket ปิดงานเท่านั้น
-- API และ UI ตรวจเงื่อนไขนี้เช่นกัน แต่ trigger ป้องกันการเขียนตรงผ่าน PostgREST/RLS ด้วย
create or replace function public.is_valid_ticket_rating_details(details jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  rating_key text;
  rating_value numeric;
  required_keys constant text[] := array[
    'responsiveness', 'workQuality', 'serviceManners', 'expertise', 'communication'
  ];
begin
  if details is null then
    return true;
  end if;
  if jsonb_typeof(details) <> 'object'
     or not (details ?& required_keys)
     or details - required_keys <> '{}'::jsonb then
    return false;
  end if;
  foreach rating_key in array required_keys loop
    if jsonb_typeof(details -> rating_key) <> 'number' then
      return false;
    end if;
    rating_value := (details ->> rating_key)::numeric;
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
  add column rating_details jsonb,
  add constraint tickets_rating_details_valid
    check (public.is_valid_ticket_rating_details(rating_details));

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
    if old.status <> 'ปิดงาน' then
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

drop trigger if exists trg_tickets_feedback_after_close on public.tickets;
create trigger trg_tickets_feedback_after_close
  before update on public.tickets
  for each row execute function public.enforce_ticket_feedback_after_close();
