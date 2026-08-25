-- LINE Service Portal authenticates and owns tickets by LINE identity directly.
-- Employee/profile linkage and the manual approval queue are no longer part of this flow.

alter table public.tickets
  drop constraint if exists tickets_requester_identity_check;

alter table public.tickets
  add constraint tickets_requester_identity_check check (
    requester_id is not null
    or requester_line_user_id is not null
    or (guest_name is not null and public_tracking_token_hash is not null)
  );

update public.line_users
set
  employee_code = null,
  linked_user_id = null,
  full_name = coalesce(display_name, full_name),
  department = null,
  link_status = case when link_status = 'Suspended' then 'Suspended' else 'Active' end;

drop index if exists public.line_users_employee_code_idx;

delete from public.system_settings
where key in ('LINE_REQUIRE_EMPLOYEE_LINK', 'LINE_AUTO_APPROVE_EMPLOYEE_LINK');

update public.permissions
set description = 'ตรวจสอบ ระงับ และเปิดใช้งานบัญชี LINE Service Portal'
where key = 'line.manage';

update public.integration_outbox
set
  status = 'CANCELLED',
  next_attempt_at = null,
  cancelled_at = now(),
  last_error = case
    when payload ->> 'type' = 'line_link_approval_needed' then 'employee link approval workflow removed'
    else 'cancelled: invalid notification payload'
  end
where event_type = 'NOTIFICATION'
  and target_module = 'notifications'
  and status in ('PENDING', 'ERROR', 'DEAD')
  and (
    payload ->> 'type' = 'line_link_approval_needed'
    or nullif(payload ->> 'recipientId', '') is null
    or nullif(payload ->> 'type', '') is null
    or nullif(payload ->> 'title', '') is null
  );

comment on column public.tickets.requester_line_user_id is
  'LINE identity that owns a LINE-channel ticket and receives status notifications.';
