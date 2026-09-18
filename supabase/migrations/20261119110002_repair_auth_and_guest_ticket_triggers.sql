-- Keep the latest Auth trigger composition intact after the MFA-default migration.
-- Username accounts must remain searchable, normalized and excluded from internal
-- profiles when they belong to the isolated vendor portal.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.raw_user_meta_data ->> 'account_type' = 'vendor_portal' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name, username, status, mfa_enabled)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    nullif(btrim(lower(new.raw_user_meta_data ->> 'username')), ''),
    'active',
    false
  );
  return new;
end;
$$;

-- Guest Tickets have no profile or LINE identity. The initial timeline row must
-- carry the public-portal label so the actor identity constraint is satisfied.
create or replace function public.create_ticket_initial_worklog()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.ticket_worklogs (
    ticket_id, action, detail, status_to, is_public,
    actor_id, actor_line_user_id, actor_label
  ) values (
    new.id,
    'เปิด Ticket',
    case when new.source_channel = 'line' then 'สร้างผ่าน LINE' else 'สร้างผ่านระบบ' end,
    new.status,
    true,
    coalesce(new.created_by, new.requester_id),
    new.requester_line_user_id,
    case
      when new.source_channel = 'guest'
        and coalesce(new.created_by, new.requester_id) is null
        and new.requester_line_user_id is null
        then 'ผู้แจ้งผ่านหน้าสาธารณะ'
      else null
    end
  );
  return new;
end;
$$;
